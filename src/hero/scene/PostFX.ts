import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { heroConfig } from '../heroConfig';

/**
 * Post-processing: three's own EffectComposer pipeline (versions always match the
 * installed three). HDR half-float targets → bloom on bright values only →
 * ACES tone mapping + sRGB (OutputPass) → subtle vignette and film grain.
 */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGrain: { value: 0.028 },
    uVignette: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(d * vec2(1.1, 1.0)));
      float g = hash(gl_FragCoord.xy + fract(uTime * 13.7) * 91.0) - 0.5;
      c.rgb += g * uGrain;
      gl_FragColor = c;
    }
  `,
};

export class PostFX {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private bloomScale: number;
  private target: THREE.WebGLRenderTarget;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    opts: { samples: number; bloomResolution: number },
  ) {
    this.bloomScale = opts.bloomResolution;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: opts.samples,
    });
    this.composer = new EffectComposer(renderer, this.target);
    this.composer.addPass(new RenderPass(scene, camera));

    const b = heroConfig.bloom;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), b.strength, b.radius, b.threshold);
    const setSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w: number, h: number) =>
      setSize(Math.max(2, Math.round(w * this.bloomScale * 2)), Math.max(2, Math.round(h * this.bloomScale * 2)));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
  }

  setQuality(samples: number, bloomResolution: number) {
    this.bloomScale = bloomResolution;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) {
        rt.samples = samples;
        rt.dispose();
      }
    }
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(time: number, dt: number) {
    this.finish.uniforms.uTime.value = time;
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
    this.finish.dispose?.();
    this.target.dispose();
  }
}
