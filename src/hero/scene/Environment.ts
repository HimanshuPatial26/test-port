import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heroConfig } from '../heroConfig';
import { buildDebrisGeometry } from './stoneGeometry';
import type { StoneTextures } from './stoneMaterial';
import { mulberry32 } from './utils/noise';

export const GROUND_Y = -1.74;

const backdropVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const backdropFragment = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uGlowAmount;
uniform float uTime;
uniform sampler2D uNoise;
varying vec3 vWorld;
void main() {
  float h = smoothstep(${GROUND_Y.toFixed(2)}, 16.0, vWorld.y);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
  vec2 g = (vWorld.xy - vec2(0.0, 1.2)) / vec2(15.0, 11.0);
  float glow = exp(-dot(g, g) * 2.4);
  float clouds = texture2D(uNoise, vWorld.xy * 0.012 + vec2(uTime * 0.0018, 0.0)).r;
  clouds = smoothstep(0.3, 0.85, clouds * 0.7 + texture2D(uNoise, vWorld.xy * 0.03 - vec2(uTime * 0.003, 0.0)).g * 0.45);
  col += uGlow * glow * uGlowAmount * (0.75 + 0.5 * clouds);
  col += uGlow * clouds * 0.06 * (1.0 - h);
  gl_FragColor = vec4(col, 1.0);
}
`;

const mistVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const mistFragment = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uSeed;
uniform vec3 uColor;
uniform sampler2D uNoise;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vec2 q = vUv * vec2(1.6, 0.5) + vec2(uTime * 0.006 + uSeed, uSeed * 0.3);
  float n = texture2D(uNoise, q).r * 0.65 + texture2D(uNoise, q * 2.3 - vec2(uTime * 0.01, 0.0)).g * 0.45;
  float shape = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
  shape *= smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
  float a = smoothstep(0.35, 0.95, n) * shape * uOpacity;
  // Keep the mist low: fade as it rises toward the text line.
  a *= smoothstep(0.6, -1.2, vWorld.y);
  gl_FragColor = vec4(uColor, a);
}
`;

export class Environment {
  readonly group = new THREE.Group();
  readonly keyLight: THREE.DirectionalLight;
  private disposables: { dispose(): void }[] = [];
  private mist: THREE.Mesh[] = [];
  private backdropMat: THREE.ShaderMaterial;
  private groundSheen!: THREE.ShaderMaterial;
  envTexture: THREE.Texture | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    tex: StoneTextures,
    stoneMaterial: THREE.Material,
    time: { value: number },
    opts: { shadowMapSize: number; mistLayers: number; detail: number },
  ) {
    const a = heroConfig.atmosphere;
    const l = heroConfig.lights;
    scene.background = new THREE.Color(a.background);
    scene.fog = new THREE.FogExp2(a.fogColor, a.fogDensity);

    // ---------------------------------------------------------------- lighting
    const hemi = new THREE.HemisphereLight(l.fillSky, l.fillGround, l.fillIntensity);
    const key = new THREE.DirectionalLight(l.key.color, l.key.intensity);
    key.position.set(...l.key.position);
    this.keyLight = key;
    this.configureShadows(opts.shadowMapSize);
    const rim = new THREE.DirectionalLight(l.rim.color, l.rim.intensity);
    rim.position.set(...l.rim.position);
    const rimLeft = new THREE.DirectionalLight(l.rimLeft.color, l.rimLeft.intensity);
    rimLeft.position.set(...l.rimLeft.position);
    this.group.add(hemi, key, key.target, rim, rimLeft);

    // Soft environmental fill so recesses keep some detail.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = this.buildEnvScene();
    this.envTexture = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = this.envTexture;
    scene.environmentIntensity = l.envIntensity;
    envScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    pmrem.dispose();

    // ---------------------------------------------------------------- backdrop
    this.backdropMat = new THREE.ShaderMaterial({
      vertexShader: backdropVertex,
      fragmentShader: backdropFragment,
      uniforms: {
        uTop: { value: new THREE.Color('#030509') },
        uHorizon: { value: new THREE.Color(a.fogColor) },
        uGlow: { value: new THREE.Color(a.hazeColor) },
        uGlowAmount: { value: 0.95 },
        uTime: time,
        uNoise: { value: tex.noise },
      },
      depthWrite: false,
      fog: false,
    });
    const backdropGeo = new THREE.PlaneGeometry(220, 90);
    const backdrop = new THREE.Mesh(backdropGeo, this.backdropMat);
    backdrop.position.set(0, 35, -34);
    backdrop.renderOrder = -10;
    this.group.add(backdrop);
    this.disposables.push(backdropGeo, this.backdropMat);

    // ---------------------------------------------------------------- ground
    const groundTexAlbedo = tex.albedo.clone();
    const groundTexNormal = tex.normal.clone();
    for (const t of [groundTexAlbedo, groundTexNormal]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(16, 12);
      t.needsUpdate = true;
    }
    const groundRough = tex.noise.clone();
    groundRough.wrapS = groundRough.wrapT = THREE.RepeatWrapping;
    groundRough.repeat.set(5, 4);
    groundRough.needsUpdate = true;
    const groundMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#5d6778'),
      map: groundTexAlbedo,
      normalMap: groundTexNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.62,
      roughnessMap: groundRough, // wet / dry patches (G channel)
      metalness: 0,
      envMapIntensity: 1.4,
    });
    // Remap the noise to a wet-but-not-mirror range (avoids sparkling glints up close).
    groundMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor = mix(0.42, 0.92, texture2D(roughnessMap, vRoughnessMapUv).g);
        #endif`,
      );
    };
    groundMat.customProgramCacheKey = () => 'wet-ground-v1';
    const groundGeo = new THREE.PlaneGeometry(90, 70, 1, 1);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, GROUND_Y, -20);
    ground.receiveShadow = true;
    this.group.add(ground);
    this.disposables.push(groundGeo, groundMat, groundTexAlbedo, groundTexNormal, groundRough);

    // Baked contact shadow, present on every tier (real-time shadows are optional).
    const contactTex = Environment.radialTexture();
    const contactMat = new THREE.MeshBasicMaterial({
      map: contactTex,
      color: 0x000000,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const contactGeo = new THREE.PlaneGeometry(4.2, 3.2);
    const contact = new THREE.Mesh(contactGeo, contactMat);
    contact.rotation.x = -Math.PI / 2;
    contact.position.set(0.05, GROUND_Y + 0.005, 0.05);
    contact.renderOrder = -1;
    this.group.add(contact);
    this.disposables.push(contactTex, contactMat, contactGeo);

    // Wet-ground sheen: soft reflected glow of the core under the sculpture.
    const sheenMat = new THREE.ShaderMaterial({
      vertexShader: mistVertex,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uIntensity;
        uniform sampler2D uNoise;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * vec2(1.0, 1.6);
          float g = exp(-dot(p, p) * 9.0);
          float wet = smoothstep(0.35, 0.75, texture2D(uNoise, vUv * 3.0).g);
          gl_FragColor = vec4(uColor * g * (0.35 + wet) * uIntensity, 1.0);
        }`,
      uniforms: {
        uColor: { value: new THREE.Color(heroConfig.core.color) },
        uIntensity: { value: 0.16 },
        uNoise: { value: tex.noise },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sheenGeo = new THREE.PlaneGeometry(9, 6);
    const sheen = new THREE.Mesh(sheenGeo, sheenMat);
    sheen.rotation.x = -Math.PI / 2;
    sheen.position.set(0, GROUND_Y + 0.01, 0.6);
    sheen.renderOrder = -0.5;
    this.group.add(sheen);
    this.groundSheen = sheenMat;
    this.disposables.push(sheenGeo, sheenMat);

    // Distant rocks and two small cairns for depth (merged: one draw call).
    this.group.add(this.buildLandscape(stoneMaterial, opts.detail));

    // Horizon band: hides the seam where the fogged ground meets the backdrop.
    const bandGeo = new THREE.PlaneGeometry(160, 9);
    const bandMat = new THREE.ShaderMaterial({
      vertexShader: mistVertex,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float a = exp(-pow((vUv.y - 0.34) * 4.2, 2.0));
          gl_FragColor = vec4(uColor, a * 0.85);
        }`,
      uniforms: { uColor: { value: new THREE.Color(a.fogColor).lerp(new THREE.Color(a.hazeColor), 0.35) } },
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(0, GROUND_Y + 1.2, -26);
    band.renderOrder = -5;
    this.group.add(band);
    this.disposables.push(bandGeo, bandMat);

    // Low-lying mist cards.
    const mistGeo = new THREE.PlaneGeometry(1, 1);
    this.disposables.push(mistGeo);
    const rand = mulberry32(77);
    const mistSpots: [number, number, number, number, number][] = [
      // x, y, z, width, height
      [-2.6, -1.25, 1.4, 9, 1.6],
      [2.8, -1.3, -1.6, 10, 1.9],
      [0.2, -1.35, -3.4, 14, 2.4],
      [-3.5, -1.05, -5.5, 12, 2.6],
      [4.2, -1.1, 1.3, 7, 1.3],
      [-0.6, -1.4, 2.4, 8, 1.2],
    ];
    for (let i = 0; i < mistSpots.length; i++) {
      const [x, y, z, w, h] = mistSpots[i];
      const mat = new THREE.ShaderMaterial({
        vertexShader: mistVertex,
        fragmentShader: mistFragment,
        uniforms: {
          uTime: time,
          uOpacity: { value: 0.13 + rand() * 0.07 },
          uSeed: { value: rand() * 10 },
          uColor: { value: new THREE.Color(a.hazeColor).lerp(new THREE.Color('#6d8fbf'), 0.25) },
          uNoise: { value: tex.noise },
        },
        transparent: true,
        depthWrite: false,
      });
      const m = new THREE.Mesh(mistGeo, mat);
      m.position.set(x, y, z);
      m.scale.set(w, h, 1);
      m.renderOrder = 0.5;
      this.mist.push(m);
      this.group.add(m);
      this.disposables.push(mat);
    }
    this.setMistLayers(opts.mistLayers);
  }

  configureShadows(size: number) {
    const key = this.keyLight;
    key.castShadow = size > 0;
    if (size > 0) {
      key.shadow.mapSize.set(size, size);
      const cam = key.shadow.camera as THREE.OrthographicCamera;
      cam.left = -3.4;
      cam.right = 3.4;
      cam.top = 3.2;
      cam.bottom = -3.2;
      cam.near = 1;
      cam.far = 20;
      key.shadow.bias = -0.0004;
      key.shadow.normalBias = 0.025;
      key.shadow.radius = 4;
      key.shadow.map?.dispose();
      key.shadow.map = null;
      key.shadow.camera.updateProjectionMatrix();
    }
  }

  setMistLayers(n: number) {
    this.mist.forEach((m, i) => (m.visible = i < n));
  }

  /** Mist cards face the camera around the vertical axis. */
  update(camera: THREE.Camera, fade: number, coreIntensity = 1) {
    this.groundSheen.uniforms.uIntensity.value = 0.16 * coreIntensity;
    for (const m of this.mist) {
      m.rotation.y = Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z);
    }
    this.backdropMat.uniforms.uGlowAmount.value = 0.95 * (0.55 + 0.45 * fade);
  }

  private buildEnvScene(): THREE.Scene {
    const s = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float y = vDir.y;
          vec3 sky = mix(vec3(0.05, 0.08, 0.14), vec3(0.11, 0.17, 0.28), smoothstep(-0.05, 0.6, y));
          vec3 ground = vec3(0.008, 0.01, 0.014);
          vec3 c = mix(ground, sky, smoothstep(-0.25, 0.05, y));
          // Cool light behind / right of the sculpture (matches the rim light).
          float spot = pow(max(dot(vDir, normalize(vec3(0.55, 0.35, -0.75))), 0.0), 12.0);
          c += vec3(0.45, 0.65, 1.0) * spot * 1.6;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    s.add(new THREE.Mesh(geo, mat));
    return s;
  }

  private buildLandscape(material: THREE.Material, detail: number): THREE.Mesh {
    const rand = mulberry32(5150);
    const parts: THREE.BufferGeometry[] = [];
    const base = [0, 1, 2, 3].map((i) => buildDebrisGeometry(300 + i * 11, Math.min(detail, 0.6)));
    const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number) => {
      const c = g.clone();
      c.scale(sx, sy, sz);
      c.rotateY(ry);
      c.translate(x, y, z);
      parts.push(c);
      return c;
    };
    // Cairns: stones balanced on each other at mid distance, left and right of the sculpture.
    const box = new THREE.Box3();
    const cairn = (x: number, z: number, h: number, count: number) => {
      let top = GROUND_Y - 0.05;
      for (let i = 0; i < count; i++) {
        const sy = h * (0.32 - i * 0.05);
        const sx = h * (0.24 - i * 0.03);
        const g = place(base[(i + 1) % base.length], x + (rand() - 0.5) * 0.08, 0, z, sx, sy, sx * 0.9, rand() * 6);
        g.computeBoundingBox();
        box.copy(g.boundingBox!);
        g.translate(0, top - box.min.y - 0.02, 0); // rest on the stone below
        top += box.max.y - box.min.y - 0.05;
      }
    };
    cairn(-3.3, -9.5, 1.25, 3);
    cairn(3.9, -9, 1.4, 3);
    cairn(-5.4, -13, 1.6, 2);
    cairn(6.5, -14, 1.4, 3);
    // Low distant ridges / boulders on the horizon.
    for (let i = 0; i < 12; i++) {
      const x = -22 + i * 4 + (rand() - 0.5) * 3;
      const z = -18 - rand() * 12;
      const s = 1.2 + rand() * 2.4;
      place(base[i % base.length], x, GROUND_Y - s * 0.25, z, s * (1.2 + rand()), s * (0.4 + rand() * 0.5), s, rand() * 6);
    }
    // Foreground rocks at the frame edges.
    place(base[1], 4.4, GROUND_Y - 0.05, 1.4, 0.9, 0.45, 0.7, 1.2);
    place(base[3], 1.9, GROUND_Y - 0.08, 1.6, 0.32, 0.14, 0.28, 0.2);
    place(base[0], -1.5, GROUND_Y - 0.06, 1.3, 0.26, 0.11, 0.3, 2.2);

    const merged = mergeGeometries(parts, false)!;
    parts.forEach((p) => p.dispose());
    base.forEach((b) => b.dispose());
    const mesh = new THREE.Mesh(merged, material);
    mesh.receiveShadow = true;
    this.disposables.push(merged);
    return mesh;
  }

  private static radialTexture(): THREE.Texture {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    // The map is used as alpha via its red channel (MeshBasic uses map.a * rgb); we
    // rely on map alpha here, which the gradient provides.
    return t;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.envTexture?.dispose();
    this.keyLight.shadow.map?.dispose();
  }
}
