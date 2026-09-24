import * as THREE from 'three';
import { heroConfig } from '../heroConfig';

/**
 * The luminous source inside the fracture gap:
 *  - core: depth-tested billboard (hot centre, horizontal streak, flickering filaments)
 *    so the stone rims above and below properly occlude it
 *  - backHalo: large faint glow behind the monolith that separates its silhouette
 *  - frontGlow: small, soft, non-depth-tested scatter so light spills over the rims
 *  - light: real point light that illuminates the fracture faces (bloom is not lighting)
 */

const billboardVertex = /* glsl */ `
uniform vec2 uSize;
varying vec2 vUv;
void main() {
  vUv = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;

const coreFragment = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor;
uniform vec3 uHot;
uniform sampler2D uNoise;
varying vec2 vUv;
void main() {
  vec2 p = vUv; // -0.5..0.5, quad is wide
  float r = length(p * vec2(1.0, 2.2));
  float hot = exp(-r * r * 60.0);
  float core = exp(-r * r * 12.0);
  float glow = exp(-r * 5.2);
  float streak = exp(-abs(p.y) * 38.0) * exp(-p.x * p.x * 30.0);

  float ang = atan(p.y * 2.6, p.x);
  float n1 = texture2D(uNoise, vec2(ang * 0.32 + uTime * 0.018, r * 0.9 - uTime * 0.09)).b;
  float n2 = texture2D(uNoise, vec2(ang * 0.21 - uTime * 0.013, r * 1.7 - uTime * 0.14)).b;
  float filaments = pow(n1 * n2, 1.6) * exp(-r * 3.3) * 2.6;

  float flicker = 0.92 + 0.08 * texture2D(uNoise, vec2(uTime * 0.21, 0.37)).r;
  vec3 c = uHot * (hot * 3.4 + streak * 0.6) + uColor * (core * 1.1 + glow * 0.25 + filaments * 1.3);
  float edgeFade = smoothstep(0.5, 0.3, abs(p.x)) * smoothstep(0.5, 0.25, abs(p.y));
  gl_FragColor = vec4(c * uIntensity * flicker * edgeFade, 1.0);
}
`;

const haloFragment = /* glsl */ `
uniform float uIntensity;
uniform vec3 uColor;
uniform float uFalloff;
varying vec2 vUv;
void main() {
  vec2 p = vUv * vec2(1.0, 1.25);
  float r = length(p);
  float g = exp(-r * uFalloff) * smoothstep(0.5, 0.2, r);
  gl_FragColor = vec4(uColor * g * uIntensity, 1.0);
}
`;

export class EnergyCore {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;
  private core: THREE.Mesh;
  private backHalo: THREE.Mesh;
  private frontGlow: THREE.Mesh;
  private geometry = new THREE.PlaneGeometry(1, 1);
  private coreMat: THREE.ShaderMaterial;
  private haloMat: THREE.ShaderMaterial;
  private glowMat: THREE.ShaderMaterial;
  /** Current effective intensity (after pulse / hover / scroll); read by other systems. */
  intensity = 1;

  constructor(noiseTex: THREE.Texture, private time: { value: number }) {
    const c = heroConfig.core;
    this.group.name = 'EnergyCore';
    const color = new THREE.Color(c.color);
    const hot = new THREE.Color(c.hotColor);

    this.coreMat = new THREE.ShaderMaterial({
      vertexShader: billboardVertex,
      fragmentShader: coreFragment,
      uniforms: {
        uSize: { value: new THREE.Vector2(1.5, 0.66) },
        uTime: time,
        uIntensity: { value: 1 },
        uColor: { value: color },
        uHot: { value: hot },
        uNoise: { value: noiseTex },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.core = new THREE.Mesh(this.geometry, this.coreMat);
    this.core.renderOrder = 1;
    this.core.frustumCulled = false;

    this.haloMat = new THREE.ShaderMaterial({
      vertexShader: billboardVertex,
      fragmentShader: haloFragment,
      uniforms: {
        uSize: { value: new THREE.Vector2(7.5, 7.5) },
        uIntensity: { value: 0.45 },
        uColor: { value: new THREE.Color(heroConfig.atmosphere.hazeColor) },
        uFalloff: { value: 3.2 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.backHalo = new THREE.Mesh(this.geometry, this.haloMat);
    this.backHalo.position.set(0, 0.1, -1.6);
    this.backHalo.renderOrder = 0;
    this.backHalo.frustumCulled = false;

    this.glowMat = new THREE.ShaderMaterial({
      vertexShader: billboardVertex,
      fragmentShader: haloFragment,
      uniforms: {
        uSize: { value: new THREE.Vector2(2.0, 0.9) },
        uIntensity: { value: 0.22 },
        uColor: { value: color.clone() },
        uFalloff: { value: 7.5 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.frontGlow = new THREE.Mesh(this.geometry, this.glowMat);
    this.frontGlow.renderOrder = 10;
    this.frontGlow.frustumCulled = false;

    this.light = new THREE.PointLight(color, c.lightIntensity, c.lightDistance, 1.6);
    this.light.position.set(0, 0, 0.18);

    this.group.add(this.backHalo, this.core, this.frontGlow, this.light);
  }

  /**
   * @param hover 0..1 pointer hover over the sculpture
   * @param fade  0..1 remaining energy (scroll-out)
   */
  update(hover: number, fade: number) {
    const c = heroConfig.core;
    const t = this.time.value;
    const w = (Math.PI * 2) / c.pulsePeriod;
    const pulse = 1 + c.pulse * Math.sin(t * w) + c.pulse * 0.4 * Math.sin(t * w * 2.37 + 1.3);
    this.intensity = c.intensity * pulse * (1 + hover * c.hoverBoost) * (0.2 + 0.8 * fade);
    this.coreMat.uniforms.uIntensity.value = this.intensity;
    this.glowMat.uniforms.uIntensity.value = 0.12 * this.intensity;
    this.haloMat.uniforms.uIntensity.value = 0.45 * (0.75 + 0.25 * this.intensity) * (0.4 + 0.6 * fade);
    this.light.intensity = c.lightIntensity * this.intensity;
  }

  dispose() {
    this.geometry.dispose();
    this.coreMat.dispose();
    this.haloMat.dispose();
    this.glowMat.dispose();
    this.light.dispose();
  }
}
