import * as THREE from 'three';
import { heroConfig } from '../heroConfig';
import { pointSprite, ribbonPath, simplexNoise } from './shaders/chunks';
import type { FlowUniforms } from './EnergyRibbons';
import { mulberry32 } from './utils/noise';

/**
 * GPU particles in three layers, each a single draw call:
 *  - bright: fine specks riding the ribbon paths + a tight swirl in the gap
 *  - dark:   flecks shed from ribbon edges that disperse and fade (some form long sprays)
 *  - dust:   sparse, slow atmospheric motes around the sculpture
 * All motion is computed in the vertex shader from time; nothing is simulated on the CPU.
 */

const pointerChunk = /* glsl */ `
uniform vec3 uPointer;
uniform float uPointerAmount;
uniform float uPointerRadius;
uniform float uPointerForce;
vec3 applyPointer(vec3 p) {
  vec3 d = p - uPointer;
  float l = length(d) + 1e-4;
  float f = 1.0 - smoothstep(0.0, uPointerRadius, l);
  return p + (d / l) * f * f * uPointerForce * uPointerAmount;
}
`;

const brightVertex = /* glsl */ `
${simplexNoise}
${ribbonPath}
${pointerChunk}
uniform float uTime;
uniform float uPixelScale;
uniform float uSize;
uniform float uCoreIntensity;
uniform float uFade;
attribute vec4 aSeed;  // ribbon index, s0, v, normal offset
attribute vec4 aRand;  // speed, size, phase, kind
varying float vAlpha;
varying float vHeat;

void main() {
  int ribbon = int(aSeed.x + 0.5);
  float kind = aRand.w;
  vec3 pos;
  float alpha;
  if (kind < 0.16) {
    // Tight swirl inside the fracture gap.
    float ang = aSeed.y * 6.28318 + uTime * (0.9 + aRand.x * 1.6) * (1.0 + uActivity * 0.6);
    float rad = 0.1 + aRand.y * 0.5 + 0.04 * sin(uTime * 0.7 + aRand.z * 9.0);
    pos = vec3(cos(ang) * rad, (aSeed.z * 0.07) * (1.0 + rad), sin(ang) * rad * 0.8);
    pos += flowNoise(pos * 2.0 + uTime * 0.2) * 0.05;
    alpha = 0.55 + 0.45 * sin(uTime * (2.0 + aRand.x * 3.0) + aRand.z * 20.0);
  } else {
    float s = fract(aSeed.y + uTime * uFlow * (0.35 + aRand.x * 0.65) * 0.6);
    vec3 P; vec3 T; vec3 W; vec3 N;
    ribbonFrame(ribbon, s, uTime, P, T, W, N);
    float w = ribbonWidth(ribbon, s, uTime);
    pos = P + W * aSeed.z * w + N * aSeed.w * 0.22;
    pos += ribbonTurbulence(P, uTime, 1.15);
    alpha = smoothstep(0.0, 0.12, s) * smoothstep(1.0, 0.8, s);
    alpha *= 0.45 + 0.55 * sin(uTime * (1.2 + aRand.x * 2.5) + aRand.z * 30.0) * 0.5 + 0.275;
  }
  pos *= 1.0 + uSpread * 0.25;
  pos = applyPointer(pos);

  float coreProx = exp(-length(pos) * 1.4);
  vHeat = coreProx;
  vAlpha = alpha * (0.22 + coreProx * 0.9 * uCoreIntensity) * uFade;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = uSize * (0.45 + aRand.y * 1.1) * (1.0 + coreProx * 0.5);
  gl_PointSize = max(1.0, size * uPixelScale / -mv.z);
}
`;

const brightFragment = /* glsl */ `
${pointSprite}
uniform vec3 uColor;
uniform vec3 uHotColor;
uniform float uBrightness;
varying float vAlpha;
varying float vHeat;
void main() {
  float m = spriteMask(gl_PointCoord, 0.0);
  m *= m;
  vec3 c = mix(uColor, uHotColor, clamp(vHeat * 1.5, 0.0, 1.0));
  gl_FragColor = vec4(c * uBrightness * (1.0 + vHeat * 1.6) * m * vAlpha, 1.0);
}
`;

const darkVertex = /* glsl */ `
${simplexNoise}
${ribbonPath}
${pointerChunk}
uniform float uTime;
uniform float uPixelScale;
uniform float uSize;
uniform float uFade;
attribute vec4 aSeed;  // ribbon index, s, side (-1/1), lifetime (s)
attribute vec4 aRand;  // travel, size, phase, kind
varying float vAlpha;
varying float vHeat;

void main() {
  int ribbon = int(aSeed.x + 0.5);
  float life = aSeed.w;
  float age = fract(uTime / life + aRand.z);
  float born = uTime - age * life;
  vec3 P; vec3 T; vec3 W; vec3 N;
  ribbonFrame(ribbon, aSeed.y, born, P, T, W, N);
  float w = ribbonWidth(ribbon, aSeed.y, born);
  vec3 spawn = P + W * aSeed.z * w * 0.95 + ribbonTurbulence(P, born, 1.0);

  float kind = aRand.w;
  float travel = aRand.x * (0.35 + uActivity * 0.25);
  vec3 dir = normalize(W * aSeed.z * 0.9 + N * 0.35 + T * 0.55);
  vec3 pos = spawn + dir * travel * age;
  if (kind > 0.86) {
    // Long sprays drifting away from the sculpture (upper right / lower left).
    vec3 wind = spawn.x > 0.0 ? vec3(1.0, 0.62, -0.25) : vec3(-1.0, -0.12, 0.35);
    pos += normalize(wind) * age * age * (1.4 + aRand.x * 2.4);
  }
  pos += flowNoise(spawn * 1.7 + vec3(age * 1.3)) * 0.12 * age;
  pos *= 1.0 + uSpread * 0.35;
  pos = applyPointer(pos);

  vAlpha = smoothstep(0.0, 0.06, age) * pow(1.0 - age, 1.3) * uFade;
  vHeat = exp(-length(pos) * 1.8);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = uSize * (0.45 + aRand.y * 1.3) * (1.0 - age * 0.45);
  gl_PointSize = max(1.0, size * uPixelScale / -mv.z);
}
`;

const darkFragment = /* glsl */ `
${pointSprite}
uniform vec3 uColor;
uniform vec3 uRimColor;
varying float vAlpha;
varying float vHeat;
void main() {
  float m = spriteMask(gl_PointCoord, 0.35);
  vec3 c = uColor + uRimColor * vHeat * 0.35;
  gl_FragColor = vec4(c, m * vAlpha * 0.9);
}
`;

const dustVertex = /* glsl */ `
${pointerChunk}
uniform float uTime;
uniform float uPixelScale;
uniform float uSize;
uniform float uFade;
uniform float uSpread;
attribute vec4 aSeed; // base position xyz, phase
varying float vAlpha;
void main() {
  vec3 p = aSeed.xyz;
  float ph = aSeed.w;
  p.y = mod(p.y + uTime * (0.03 + fract(ph * 7.3) * 0.05) + 2.0, 4.6) - 2.0;
  p.x += sin(uTime * 0.11 + ph * 6.0) * 0.25;
  p.z += cos(uTime * 0.09 + ph * 4.0) * 0.2;
  p *= 1.0 + uSpread * 0.2;
  p = applyPointer(p);
  float edge = smoothstep(-2.0, -1.4, p.y) * smoothstep(2.6, 1.9, p.y);
  vAlpha = edge * (0.25 + 0.75 * fract(ph * 13.1)) * uFade;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uSize * (0.6 + fract(ph * 3.7)) * uPixelScale / -mv.z);
}
`;

const dustFragment = /* glsl */ `
${pointSprite}
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float m = spriteMask(gl_PointCoord, 0.0);
  gl_FragColor = vec4(uColor * m * vAlpha, 1.0);
}
`;

export interface PointerUniforms {
  uPointer: { value: THREE.Vector3 };
  uPointerAmount: { value: number };
  uPointerRadius: { value: number };
  uPointerForce: { value: number };
}

export interface ParticleCounts {
  bright: number;
  dark: number;
  dust: number;
}

export class ParticleField {
  readonly group = new THREE.Group();
  readonly pixelScale = { value: 600 };
  readonly pointer: PointerUniforms = {
    uPointer: { value: new THREE.Vector3(99, 99, 99) },
    uPointerAmount: { value: 0 },
    uPointerRadius: { value: heroConfig.particles.pointerRadius },
    uPointerForce: { value: heroConfig.particles.pointerForce },
  };
  private bright: THREE.Points;
  private dark: THREE.Points;
  private dust: THREE.Points;
  private max: ParticleCounts;

  constructor(flow: FlowUniforms, counts: ParticleCounts) {
    const p = heroConfig.particles;
    const density = p.density;
    this.max = {
      bright: Math.round(counts.bright * density),
      dark: Math.round(counts.dark * density),
      dust: Math.round(counts.dust * density),
    };
    const rand = mulberry32(99);
    const common = { ...flow, ...this.pointer, uPixelScale: this.pixelScale };

    // Bright specks.
    {
      const n = this.max.bright;
      const seed = new Float32Array(n * 4);
      const rnd = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        seed.set([Math.floor(rand() * 3), rand(), (rand() * 2 - 1) * 1.15, rand() * 2 - 1], i * 4);
        rnd.set([rand(), Math.pow(rand(), 2.5), rand(), rand()], i * 4);
      }
      this.bright = this.makePoints(seed, rnd, brightVertex, brightFragment, {
        ...common,
        uSize: { value: 0.017 },
        uColor: { value: new THREE.Color(p.brightColor) },
        uHotColor: { value: new THREE.Color(heroConfig.core.hotColor) },
        uBrightness: { value: 1.1 * p.brightness },
      }, THREE.AdditiveBlending);
      this.bright.renderOrder = 3;
    }

    // Dark flecks shed from ribbon edges.
    {
      const n = this.max.dark;
      const seed = new Float32Array(n * 4);
      const rnd = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        seed.set([Math.floor(rand() * 3), 0.08 + rand() * 0.84, rand() < 0.5 ? -1 : 1, 5 + rand() * 7], i * 4);
        rnd.set([0.2 + rand() * 0.9, Math.pow(rand(), 2), rand(), rand()], i * 4);
      }
      this.dark = this.makePoints(seed, rnd, darkVertex, darkFragment, {
        ...common,
        uSize: { value: 0.036 },
        uColor: { value: new THREE.Color(p.darkColor) },
        uRimColor: { value: new THREE.Color(heroConfig.core.color) },
      }, THREE.NormalBlending);
      this.dark.renderOrder = 2.5;
    }

    // Atmospheric dust.
    {
      const n = this.max.dust;
      const seed = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const r = 0.9 + Math.pow(rand(), 0.7) * 3.4;
        seed.set([Math.cos(a) * r, rand() * 4.6 - 2, Math.sin(a) * r * 0.8 - 0.3, rand()], i * 4);
      }
      this.dust = this.makePoints(seed, new Float32Array(n * 4), dustVertex, dustFragment, {
        ...common,
        uSize: { value: 0.02 },
        uColor: { value: new THREE.Color('#7fa6d8').multiplyScalar(0.5) },
      }, THREE.AdditiveBlending);
      this.dust.renderOrder = 1;
    }

    this.group.add(this.dust, this.dark, this.bright);
  }

  private makePoints(
    seed: Float32Array,
    rnd: Float32Array,
    vertexShader: string,
    fragmentShader: string,
    uniforms: Record<string, THREE.IUniform>,
    blending: THREE.Blending,
  ): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seed.length / 4 * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  /** Scale particle counts at runtime (quality changes) without reallocating. */
  setCounts(counts: ParticleCounts) {
    const d = heroConfig.particles.density;
    this.bright.geometry.setDrawRange(0, Math.min(this.max.bright, Math.round(counts.bright * d)));
    this.dark.geometry.setDrawRange(0, Math.min(this.max.dark, Math.round(counts.dark * d)));
    this.dust.geometry.setDrawRange(0, Math.min(this.max.dust, Math.round(counts.dust * d)));
  }

  dispose() {
    for (const p of [this.bright, this.dark, this.dust]) {
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
  }
}
