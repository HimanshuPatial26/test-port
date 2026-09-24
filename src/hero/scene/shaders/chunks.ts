/**
 * Shared GLSL. The ribbon path is used by the ribbons *and* by both particle
 * systems, so particles trail the same flow instead of floating independently.
 */

/** 3D simplex noise – Ashima Arts / Stefan Gustavson (MIT). */
export const simplexNoise = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

/** Smooth, divergence-light vector field built from offset simplex samples. */
vec3 flowNoise(vec3 p) {
  return vec3(
    snoise(p),
    snoise(p + vec3(31.4, 17.2, -8.3)),
    snoise(p + vec3(-12.7, 44.1, 23.9))
  );
}
`;

/**
 * Ribbon path. Each ribbon is a partial spiral wound around a flattened
 * vortex ring centred on the stone gap: it travels around the stone (phi) while
 * rolling around the ring's cross-section (psi). The whole arc drifts with time,
 * which makes the material circulate in front of and behind the stone.
 *
 *  uRibA[i] = (majorRadius, minorRadius, phi0, phiSpan)
 *  uRibB[i] = (psi0, psiSpan, verticalScale, flowMultiplier)
 *  uRibC[i] = (tiltX, tiltZ, phase, twist)
 */
export const ribbonPath = /* glsl */ `
#define RIBBON_COUNT 3
uniform vec4 uRibA[RIBBON_COUNT];
uniform vec4 uRibB[RIBBON_COUNT];
uniform vec4 uRibC[RIBBON_COUNT];
uniform float uFlow;       // revolutions per second (base)
uniform float uTurbulence; // world units
uniform float uActivity;   // 0..1 hover excitement
uniform float uSpread;     // 0..1 scroll-out
uniform float uRibbonWidth;

mat3 rotXZ(float ax, float az) {
  float cx = cos(ax), sx = sin(ax), cz = cos(az), sz = sin(az);
  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  mat3 rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
  return rz * rx;
}

// Ring-space position and ring surface normal for ribbon i at parameter s, time t.
vec3 ribbonRing(int i, float s, float t, out vec3 surfN) {
  vec4 A = uRibA[i];
  vec4 B = uRibB[i];
  vec4 C = uRibC[i];
  float flow = t * uFlow * B.w * (1.0 + uActivity * 0.35);
  float phi = A.z + s * A.w + flow * 6.28318;
  float psi = B.x + s * B.y + flow * 3.1 + C.z;
  float breathe = 1.0 + 0.06 * sin(t * 0.31 + C.z) + uSpread * 0.4 + uActivity * 0.05;
  float R = A.x * breathe * (1.0 + 0.09 * sin(s * 6.28318 + t * 0.19 + C.z));
  float r = A.y * (1.0 + 0.28 * sin(s * 8.3 + t * 0.27 + C.z * 2.0)) * (1.0 + uSpread * 0.3);
  float cp = cos(psi), sp = sin(psi);
  vec3 p = vec3((R + r * cp) * cos(phi), r * sp * B.z, (R + r * cp) * sin(phi));
  vec3 n = vec3(cp * cos(phi), sp / max(B.z, 0.25), cp * sin(phi));
  mat3 tilt = rotXZ(C.x, C.y);
  surfN = normalize(tilt * n);
  return tilt * p;
}

// Full frame: centre point, tangent, width direction and surface normal.
void ribbonFrame(int i, float s, float t, out vec3 P, out vec3 T, out vec3 W, out vec3 N) {
  vec3 n0; vec3 n1;
  P = ribbonRing(i, s, t, N);
  vec3 pa = ribbonRing(i, s - 0.004, t, n0);
  vec3 pb = ribbonRing(i, s + 0.004, t, n1);
  T = normalize(pb - pa);
  W = normalize(cross(N, T));
  float twist = uRibC[i].w * sin(s * 6.28318 * 1.3 + t * 0.35 + uRibC[i].z) ;
  W = normalize(cos(twist) * W + sin(twist) * N);
  N = normalize(cross(T, W));
}

float ribbonWidth(int i, float s, float t) {
  float taper = pow(clamp(sin(3.14159 * s), 0.0, 1.0), 0.65);
  float swell = 0.72 + 0.5 * (0.5 + 0.5 * sin(s * 11.0 - t * 0.4 + uRibC[i].z * 3.0));
  return uRibbonWidth * taper * swell * (1.0 + uActivity * 0.12);
}

// Coherent turbulence: one smooth field shared by all ribbons/particles.
vec3 ribbonTurbulence(vec3 p, float t, float amount) {
  float k = uTurbulence * amount * (1.0 + uActivity * 0.9);
  return flowNoise(p * 1.25 + vec3(0.0, t * 0.16, t * 0.07)) * k;
}
`;

/** Soft sprite used by point particles. */
export const pointSprite = /* glsl */ `
float spriteMask(vec2 pc, float hardness) {
  float d = length(pc - 0.5) * 2.0;
  return 1.0 - smoothstep(hardness, 1.0, d);
}
`;
