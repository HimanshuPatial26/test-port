import * as THREE from 'three';
import { heroConfig } from '../heroConfig';
import { ribbonPath, simplexNoise } from './shaders/chunks';

/** Per-ribbon shape parameters (see ribbonPath in shaders/chunks.ts). */
export const RIBBON_PARAMS = {
  A: [
    new THREE.Vector4(1.1, 0.4, 0.0, 4.3),
    new THREE.Vector4(1.28, 0.3, 2.5, 3.5),
    new THREE.Vector4(0.98, 0.44, 4.4, 3.1),
  ],
  B: [
    new THREE.Vector4(0.0, 5.4, 0.78, 1.0),
    new THREE.Vector4(2.0, -4.2, 0.7, 0.82),
    new THREE.Vector4(4.1, 6.6, 0.85, 1.17),
  ],
  C: [
    new THREE.Vector4(0.1, -0.12, 0.0, 0.85),
    new THREE.Vector4(-0.07, 0.15, 1.7, 1.15),
    new THREE.Vector4(0.15, 0.04, 3.3, 0.7),
  ],
};

/** Uniforms shared by ribbons and particles so they move as one system. */
export function createFlowUniforms() {
  const c = heroConfig.ribbons;
  return {
    uTime: { value: 0 },
    uRibA: { value: RIBBON_PARAMS.A },
    uRibB: { value: RIBBON_PARAMS.B },
    uRibC: { value: RIBBON_PARAMS.C },
    uFlow: { value: c.flowSpeed },
    uTurbulence: { value: c.turbulence },
    uActivity: { value: 0 },
    uSpread: { value: 0 },
    uRibbonWidth: { value: c.width },
    uCoreIntensity: { value: 1 },
    uCoreColor: { value: new THREE.Color(heroConfig.core.color) },
    uFade: { value: 1 },
  };
}
export type FlowUniforms = ReturnType<typeof createFlowUniforms>;

const vertexShader = /* glsl */ `
${simplexNoise}
${ribbonPath}
uniform float uTime;
uniform int uIndex;
attribute vec2 aRibbon; // x: s along ribbon (0..1), y: v across (-1..1)
varying vec2 vRib;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vCoreDist;

void main() {
  float s = aRibbon.x;
  float v = aRibbon.y;
  vec3 P; vec3 T; vec3 W; vec3 N;
  ribbonFrame(uIndex, s, uTime, P, T, W, N);
  float w = ribbonWidth(uIndex, s, uTime);
  // Edges flutter more than the spine, but from the same coherent field.
  vec3 pos = P + W * v * w;
  pos += ribbonTurbulence(P, uTime, 1.0);
  pos += N * snoise(vec3(s * 7.0, v * 1.5, uTime * 0.23 + float(uIndex) * 5.0)) * 0.06 * abs(v) * (1.0 + uActivity);
  vRib = aRibbon;
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * N);
  vCoreDist = length(pos);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform int uIndex;
uniform float uOpacity;
uniform float uActivity;
uniform float uCoreIntensity;
uniform float uFade;
uniform vec3 uColor;
uniform vec3 uSheen;
uniform vec3 uCoreColor;
uniform sampler2D uNoise;
varying vec2 vRib;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vCoreDist;

void main() {
  float s = vRib.x;
  float v = vRib.y;
  float seed = float(uIndex) * 0.37;
  float flowT = uTime * (0.045 + uActivity * 0.02);

  // Streaks run along the flow direction (stretched along s).
  float streak = texture2D(uNoise, vec2(s * 1.6 - flowT, v * 1.35 + seed)).g;
  float streak2 = texture2D(uNoise, vec2(s * 3.2 - flowT * 1.7, v * 2.6 + seed + 0.5)).a;
  float erosion = texture2D(uNoise, vec2(s * 3.0 - flowT * 0.8, v * 0.5 + seed + 0.2)).b;
  float holes = texture2D(uNoise, vec2(s * 2.4 - flowT * 1.2 + seed, v * 1.1)).r;

  // Soft, noisy edges; ends dissolve (particles continue the trail).
  float edge = abs(v) + (erosion - 0.45) * 0.7;
  float body = 1.0 - smoothstep(0.28, 0.98, edge);
  // Thin lit rim just inside the eroded edge (light catching the lip of the sheet).
  float rim = smoothstep(0.45, 0.8, edge) * (1.0 - smoothstep(0.8, 1.0, edge));
  float ends = smoothstep(0.0, 0.16, s) * smoothstep(1.0, 0.66, s);
  float lace = smoothstep(0.12, 0.5, holes + streak * 0.35);
  float density = body * ends * lace * mix(0.7, 1.0, streak);
  float alpha = density * uOpacity * uFade;
  if (alpha < 0.004) discard;

  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(vWorldNormal);
  if (!gl_FrontFacing) N = -N;
  float facing = abs(dot(N, V));
  float fres = pow(1.0 - facing, 2.2);

  float nearCore = exp(-vCoreDist * 1.65) * uCoreIntensity;
  float hi = pow(streak, 3.0) * 0.7 + pow(streak2, 6.0) * 1.4;

  // Dark translucent body; glassy sheen on grazing angles; lit by the core nearby.
  float nearCore2 = exp(-vCoreDist * 3.2) * uCoreIntensity;
  vec3 col = uColor * (0.45 + 0.7 * streak);
  col += uSheen * fres * (0.04 + 0.22 * streak) * (0.4 + nearCore);
  col += uCoreColor * (nearCore * 0.35 + nearCore2 * 2.2) * (0.15 + 2.0 * hi);
  // Sparse glints along the streaks.
  float glint = smoothstep(0.84, 0.97, streak2) * (0.25 + nearCore * 2.0);
  col += uCoreColor * glint * 1.2;
  col += uSheen * rim * (0.2 + streak) * (0.25 + nearCore * 2.6);

  gl_FragColor = vec4(col, min(1.0, alpha * (0.8 + 0.25 * (1.0 - fres) + rim * 0.4)));
}
`;

export class EnergyRibbons {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private geometry: THREE.BufferGeometry;
  private materials: THREE.ShaderMaterial[] = [];

  constructor(flow: FlowUniforms, noiseTex: THREE.Texture, segments: number) {
    this.group.name = 'EnergyRibbons';
    this.geometry = EnergyRibbons.buildStrip(segments, 10);
    const c = heroConfig.ribbons;
    for (let i = 0; i < c.count; i++) {
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          ...flow,
          uIndex: { value: i },
          uOpacity: { value: c.opacity * (i === 2 ? 0.8 : 1) },
          uColor: { value: new THREE.Color(c.color) },
          uSheen: { value: new THREE.Color(c.sheenColor) },
          uNoise: { value: noiseTex },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false; // positions are generated in the shader
      mesh.renderOrder = 2 + i * 0.01;
      this.materials.push(material);
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  /** A flat strip with (s, v) coordinates; the vertex shader places it on the path. */
  static buildStrip(segments: number, across: number): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const count = (segments + 1) * (across + 1);
    const rib = new Float32Array(count * 2);
    const pos = new Float32Array(count * 3);
    let k = 0;
    for (let i = 0; i <= segments; i++) {
      for (let j = 0; j <= across; j++) {
        rib[k * 2] = i / segments;
        rib[k * 2 + 1] = (j / across) * 2 - 1;
        k++;
      }
    }
    const index: number[] = [];
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < across; j++) {
        const a = i * (across + 1) + j;
        const b = a + across + 1;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRibbon', new THREE.BufferAttribute(rib, 2));
    geo.setIndex(index);
    return geo;
  }

  dispose() {
    this.geometry.dispose();
    this.materials.forEach((m) => m.dispose());
  }
}
