import * as THREE from 'three';
import { heroConfig, type QualityTier } from '../heroConfig';
import { computeStageFrame, posterMeta, type StageFrame } from '../framing';
import { QualityController } from './QualityController';
import { StoneMonolith } from './StoneMonolith';
import { createStoneMaterial, type StoneTextures } from './stoneMaterial';
import { EnergyCore } from './EnergyCore';
import { EnergyRibbons, createFlowUniforms } from './EnergyRibbons';
import { ParticleField } from './ParticleField';
import { FloatingDebris } from './FloatingDebris';
import { Environment } from './Environment';
import { PostFX } from './PostFX';

const DEG = Math.PI / 180;

export interface HeroSceneOptions {
  hero: HTMLElement;
  /** Element the canvas fills (the framing reference). */
  container: HTMLElement;
  /** Empty layout element marking where the sculpture should sit. */
  stage: HTMLElement;
  playing: boolean;
  /** Fine pointer available (enables parallax + hover). */
  finePointer: boolean;
  /** Render a fixed frame at the poster framing (used to capture the poster). */
  posterMode?: boolean;
  /** Disable the loop; frames are rendered on demand via renderAt(). */
  captureMode?: boolean;
  onContextLost?: () => void;
}

export interface HeroStats {
  tier: QualityTier;
  frames: number;
  frameTimes: number[];
  /** Main-thread time spent in update + render submission per frame (ms). */
  cpuTimes: number[];
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  width: number;
  height: number;
}

async function loadTextures(set: 'desktop' | 'mobile', maxAniso: number): Promise<StoneTextures> {
  const loader = new THREE.TextureLoader();
  const base = `${import.meta.env.BASE_URL}${heroConfig.assets.textureBase}/${set}/`;
  const [albedo, normal, orm, noise] = await Promise.all([
    loader.loadAsync(`${base}stone_albedo.webp`),
    loader.loadAsync(`${base}stone_normal.webp`),
    loader.loadAsync(`${base}stone_orm.webp`),
    loader.loadAsync(`${import.meta.env.BASE_URL}${heroConfig.assets.noiseTexture}`),
  ]);
  albedo.colorSpace = THREE.SRGBColorSpace;
  for (const t of [albedo, normal, orm, noise]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, maxAniso);
  }
  noise.anisotropy = 1;
  return { albedo, normal, orm, noise };
}

export class HeroScene {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
  private root = new THREE.Group();
  private quality: QualityController;
  private textures!: StoneTextures;
  private stoneMaterial!: THREE.MeshStandardMaterial;
  private monolith!: StoneMonolith;
  private core!: EnergyCore;
  private ribbons!: EnergyRibbons;
  private particles!: ParticleField;
  private debris!: FloatingDebris;
  private env!: Environment;
  private post!: PostFX;
  private flow = createFlowUniforms();
  private glow = {
    uCorePos: { value: new THREE.Vector3() },
    uCoreColor: { value: new THREE.Color(heroConfig.core.color) },
    uCoreIntensity: { value: 1 },
  };

  // Animation state (never stored in framework state; mutated in place).
  private time = 0;
  private last = 0;
  private raf = 0;
  private playing: boolean;
  private inView = true;
  private pageVisible = !document.hidden;
  private hover = 0;
  private hoverTarget = 0;
  private scroll = 0;
  private scrollTarget = 0;
  private pointerNdc = new THREE.Vector2();
  private pointerActive = false;
  private parallax = new THREE.Vector2();
  private pointerAmount = 0;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private tmpV = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private camBase = new THREE.Vector3(...heroConfig.camera.position);
  private camTarget = new THREE.Vector3(...heroConfig.camera.target);
  private cleanup: (() => void)[] = [];
  private resizeQueued = false;
  private disposed = false;
  readonly stats: HeroStats;

  private constructor(private opts: HeroSceneOptions, renderer: THREE.WebGLRenderer, tier: QualityTier, locked: boolean) {
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.playing = opts.playing;
    this.quality = new QualityController(tier, locked);
    this.stats = { tier, frames: 0, frameTimes: [], cpuTimes: [], drawCalls: 0, triangles: 0, pixelRatio: 1, width: 0, height: 0 };
  }

  /** Create the renderer, load assets, build the scene and render the first frame. */
  static async create(opts: HeroSceneOptions): Promise<HeroScene> {
    const canvas = document.createElement('canvas');
    canvas.className = 'hero__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false, // MSAA happens on the composer target
        alpha: false,
        stencil: false,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      throw new Error(`WebGL context creation failed: ${(err as Error).message}`);
    }
    const detected = QualityController.detect(renderer.getContext());
    const scene = new HeroScene(opts, renderer, opts.posterMode ? 'high' : detected.tier, opts.posterMode || detected.locked);
    try {
      await scene.init();
    } catch (err) {
      scene.dispose();
      throw err;
    }
    return scene;
  }

  private async init() {
    const q = this.quality.settings;
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = heroConfig.atmosphere.exposure;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false; // the composer renders several passes per frame

    this.textures = await loadTextures(q.textureSet, r.capabilities.getMaxAnisotropy());
    if (this.disposed) throw new Error('disposed during load');

    const st = heroConfig.stone;
    this.stoneMaterial = createStoneMaterial(this.textures, this.glow, {
      tint: st.tint,
      texScale: st.textureScale,
      normalStrength: st.normalStrength,
      glowFalloff: st.glowFalloff,
      envMapIntensity: heroConfig.lights.envIntensity,
    });
    const shadows = q.shadowMapSize > 0;

    const model = heroConfig.assets.monolithModel;
    this.monolith = model
      ? await StoneMonolith.fromGLB(`${import.meta.env.BASE_URL}${model}`, this.stoneMaterial, shadows)
      : StoneMonolith.procedural(this.stoneMaterial, q.stoneDetail, shadows);

    this.core = new EnergyCore(this.textures.noise, this.flow.uTime);
    this.ribbons = new EnergyRibbons(this.flow, this.textures.noise, q.ribbonSegments);
    this.particles = new ParticleField(this.flow, {
      bright: q.brightParticles,
      dark: q.darkParticles,
      dust: q.dustParticles,
    });
    this.debris = new FloatingDebris(this.stoneMaterial, q.stoneDetail, shadows, q.stoneDetail < 0.6 ? 0.7 : 1);
    this.env = new Environment(r, this.scene, this.textures, this.stoneMaterial, this.flow.uTime, {
      shadowMapSize: q.shadowMapSize,
      mistLayers: q.mistLayers,
      detail: q.stoneDetail,
    });

    const s = heroConfig.sculpture;
    this.root.name = 'Sculpture';
    this.root.position.set(...s.position);
    this.root.scale.setScalar(s.scale);
    this.root.add(this.monolith.group, this.core.group, this.ribbons.group, this.particles.group, this.debris.group);
    this.monolith.group.rotation.y = s.yaw * DEG;
    this.scene.add(this.env.group, this.root);

    // Development aid: ?debug=noparticles,nocore,noribbons,nodebris,noenv
    const debug = new URLSearchParams(location.search).get('debug') ?? '';
    if (debug.includes('noparticles')) this.particles.group.visible = false;
    if (debug.includes('nocore')) this.core.group.visible = false;
    if (debug.includes('noribbons')) this.ribbons.group.visible = false;
    if (debug.includes('nodebris')) this.debris.group.visible = false;

    this.post = new PostFX(r, this.scene, this.camera, { samples: q.msaaSamples, bloomResolution: q.bloomResolution });

    this.attachListeners();
    this.resize();
    this.update(0);

    // Compile every program before the first visible frame to avoid a hitch.
    if (r.extensions.has('KHR_parallel_shader_compile')) await r.compileAsync(this.scene, this.camera);
    else r.compile(this.scene, this.camera);
    if (this.disposed) throw new Error('disposed during compile');
    if (this.opts.posterMode) this.time = Number(new URLSearchParams(location.search).get('t') ?? 7.5);
    this.update(0);
    this.render(0);
    this.opts.container.appendChild(this.canvas);
    await new Promise((res) => requestAnimationFrame(() => res(null)));
    if (this.playing && !this.opts.captureMode && !this.opts.posterMode) this.start();
  }

  // ------------------------------------------------------------------ lifecycle
  private get shouldRun() {
    const onDemand = this.opts.captureMode || this.opts.posterMode;
    return this.playing && this.inView && this.pageVisible && !this.disposed && !onDemand;
  }

  private start() {
    if (this.raf || !this.shouldRun) return;
    this.last = performance.now();
    this.quality.reset();
    this.raf = requestAnimationFrame(this.tick);
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
    if (playing) this.start();
    else {
      this.stop();
      this.render(0);
    }
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    // Clamp dt so a stalled tab or long frame never causes a visible jump.
    const rawDt = (now - this.last) / 1000;
    const dt = Math.min(Math.max(rawDt, 0), 1 / 20);
    this.last = now;
    this.time += dt;
    const c0 = performance.now();
    this.update(dt);
    this.render(dt);
    const cpu = performance.now() - c0;

    this.stats.frames++;
    const ft = this.stats.frameTimes;
    const ct = this.stats.cpuTimes;
    ft.push(rawDt * 1000);
    ct.push(cpu);
    if (ft.length > 600) ft.shift();
    if (ct.length > 600) ct.shift();
    const downgrade = this.quality.sample(rawDt);
    if (downgrade) this.applyQuality(downgrade);
  };

  /** Deterministic frame for recordings / screenshots. */
  renderAt(t: number, state: { hover?: number; scroll?: number; pointer?: [number, number] } = {}) {
    this.time = t;
    this.hover = this.hoverTarget = state.hover ?? 0;
    this.scroll = this.scrollTarget = state.scroll ?? 0;
    if (state.pointer) {
      this.pointerActive = true;
      this.pointerNdc.set(state.pointer[0], state.pointer[1]);
      this.parallax.copy(this.pointerNdc);
    }
    this.update(0);
    this.render(0);
  }

  private applyQuality(tier: QualityTier) {
    const q = heroConfig.quality[tier];
    this.stats.tier = tier;
    this.particles.setCounts({ bright: q.brightParticles, dark: q.darkParticles, dust: q.dustParticles });
    this.env.setMistLayers(q.mistLayers);
    const shadows = q.shadowMapSize > 0;
    this.env.configureShadows(q.shadowMapSize);
    this.monolith.setShadows(shadows);
    this.debris.setShadows(shadows);
    this.post.setQuality(q.msaaSamples, q.bloomResolution);
    this.resize();
  }

  // ------------------------------------------------------------------ input
  private attachListeners() {
    const on = <K extends keyof WindowEventMap>(target: Window | Document, type: K, fn: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, o);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, o));
    };

    if (this.opts.finePointer && !this.opts.posterMode) {
      on(window, 'pointermove', (e) => {
        if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        const rect = this.canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        this.pointerNdc.set(x, y);
        this.pointerActive = y >= -1 && y <= 1;
        if (!this.raf) this.start();
      }, { passive: true });
      on(document, 'pointerleave' as keyof WindowEventMap, () => (this.pointerActive = false));
      on(window, 'blur', () => (this.pointerActive = false));
    }

    on(window, 'scroll', () => this.measureScroll(), { passive: true });
    on(document, 'visibilitychange' as keyof WindowEventMap, () => {
      this.pageVisible = !document.hidden;
      if (this.shouldRun) this.start();
      else this.stop();
    });

    const ro = new ResizeObserver(() => this.queueResize());
    ro.observe(this.opts.container);
    ro.observe(this.opts.stage);
    this.cleanup.push(() => ro.disconnect());

    const io = new IntersectionObserver(
      ([entry]) => {
        this.inView = entry.isIntersecting;
        if (this.shouldRun) this.start();
        else this.stop();
      },
      { rootMargin: '64px' },
    );
    io.observe(this.opts.container);
    this.cleanup.push(() => io.disconnect());

    const lost = (e: Event) => {
      e.preventDefault();
      this.stop();
      this.opts.onContextLost?.();
    };
    this.canvas.addEventListener('webglcontextlost', lost);
    this.cleanup.push(() => this.canvas.removeEventListener('webglcontextlost', lost));
  }

  private measureScroll() {
    const rect = this.opts.hero.getBoundingClientRect();
    const range = rect.height * heroConfig.scroll.range;
    this.scrollTarget = Math.min(1, Math.max(0, -rect.top / Math.max(1, range)));
    if (!this.raf) this.start();
  }

  private queueResize() {
    if (this.resizeQueued) return;
    this.resizeQueued = true;
    requestAnimationFrame(() => {
      this.resizeQueued = false;
      if (this.disposed) return;
      this.resize();
      if (!this.raf) this.render(0);
    });
  }

  // ------------------------------------------------------------------ framing
  private resize() {
    const q = heroConfig.quality[this.stats.tier];
    let f: StageFrame;
    let dpr: number;
    if (this.opts.posterMode) {
      f = { ...posterMeta };
      dpr = 1;
    } else {
      f = computeStageFrame(this.opts.container, this.opts.stage);
      dpr = Math.min(window.devicePixelRatio || 1, q.maxPixelRatio);
    }
    const w = Math.max(1, Math.round(f.width));
    const h = Math.max(1, Math.round(f.height));
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, dpr);

    const d = this.camBase.distanceTo(this.camTarget);
    const tanHalf = h / (2 * d * f.pxPerUnit);
    const fov = THREE.MathUtils.clamp((2 * Math.atan(tanHalf)) / DEG, 12, 70);
    this.camera.fov = fov;
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, -(f.cx - w / 2), -(f.cy - h / 2), w, h);
    this.camera.updateProjectionMatrix();
    this.particles.pixelScale.value = (h * dpr) / (2 * Math.tan((fov * DEG) / 2));

    this.stats.pixelRatio = dpr;
    this.stats.width = w;
    this.stats.height = h;
    this.measureScroll();
  }

  // ------------------------------------------------------------------ per-frame
  private update(dt: number) {
    const s = heroConfig.sculpture;
    const t = this.time;
    const damp = (k: number) => 1 - Math.exp(-k * dt);

    // Pointer / hover.
    const interactive = this.opts.finePointer && this.pointerActive;
    this.camera.updateMatrixWorld();
    if (interactive) {
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      this.root.updateMatrixWorld();
      this.hoverTarget = this.raycaster.intersectObject(this.monolith.hitProxy, false).length > 0 ? 1 : 0;
      // Pointer position on the sculpture's mid-plane, in sculpture space.
      this.tmpM.copy(this.root.matrixWorld).invert();
      if (this.raycaster.ray.intersectPlane(this.plane, this.tmpV)) {
        this.particles.pointer.uPointer.value.copy(this.tmpV.applyMatrix4(this.tmpM));
      }
    } else {
      this.hoverTarget = 0;
    }
    if (dt > 0) {
      this.hover += (this.hoverTarget - this.hover) * damp(s.hoverDamping);
      const px = interactive ? THREE.MathUtils.clamp(this.pointerNdc.x, -1, 1) : 0;
      const py = interactive ? THREE.MathUtils.clamp(this.pointerNdc.y, -1, 1) : 0;
      this.parallax.x += (px - this.parallax.x) * damp(s.parallaxDamping);
      this.parallax.y += (py - this.parallax.y) * damp(s.parallaxDamping);
      this.pointerAmount += ((interactive ? 1 : 0) - this.pointerAmount) * damp(2.5);
      this.scroll += (this.scrollTarget - this.scroll) * damp(heroConfig.scroll.damping);
    }
    this.particles.pointer.uPointerAmount.value = this.pointerAmount;
    const scroll = this.scroll;
    const fade = 1 - scroll;

    // Parallax: sculpture turns slightly, camera drifts a little. Text is DOM and never moves.
    this.root.rotation.set(-this.parallax.y * s.parallaxPitch * DEG * 0.6, this.parallax.x * s.parallaxYaw * DEG, 0);
    const [sx, sy] = heroConfig.camera.parallaxShift;
    this.camera.position.set(this.camBase.x + this.parallax.x * sx, this.camBase.y + this.parallax.y * sy, this.camBase.z);
    this.camera.lookAt(this.camTarget);

    // Sculpture systems.
    this.monolith.update(t, this.hover, scroll);
    this.debris.update(t, scroll);
    this.core.update(this.hover, fade);

    const f = this.flow;
    f.uTime.value = t;
    f.uActivity.value = this.hover * heroConfig.ribbons.hoverActivity * 1.8;
    f.uSpread.value = scroll;
    f.uCoreIntensity.value = this.core.intensity;
    f.uFade.value = 1 - scroll * 0.8;

    this.root.updateMatrixWorld();
    this.glow.uCorePos.value.setFromMatrixPosition(this.core.group.matrixWorld);
    this.glow.uCoreIntensity.value = this.core.intensity;

    this.env.update(this.camera, fade, this.core.intensity);
    this.renderer.toneMappingExposure = heroConfig.atmosphere.exposure * (1 - scroll * 0.35);
  }

  private render(dt: number) {
    this.renderer.info.reset();
    this.post.render(this.time, dt);
    const info = this.renderer.info.render;
    this.stats.drawCalls = info.calls;
    this.stats.triangles = info.triangles;
  }

  // ------------------------------------------------------------------ cleanup
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.cleanup.forEach((fn) => fn());
    this.cleanup.length = 0;
    this.post?.dispose();
    this.monolith?.dispose();
    this.core?.dispose();
    this.ribbons?.dispose();
    this.particles?.dispose();
    this.debris?.dispose();
    this.env?.dispose();
    this.stoneMaterial?.dispose();
    if (this.textures) Object.values(this.textures).forEach((t) => t.dispose());
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
