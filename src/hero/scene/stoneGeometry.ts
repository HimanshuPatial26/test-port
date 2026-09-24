import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simplex3, mulberry32 } from './utils/noise';

/**
 * Procedural fractured monolith.
 *
 * One continuous column is described analytically and split along a jagged
 * fracture surface. Both pieces are built from that same description, so their
 * silhouettes and break faces match: they read as one stone that cracked, not
 * two unrelated boxes. Geometry carries the silhouette, chips and fracture relief;
 * pores and fine grain come from the triplanar textures in stoneMaterial.ts.
 */

const noise = new Simplex3(7);
const noiseB = new Simplex3(19);

const COLUMN = {
  bottom: -2.45,
  top: 1.66,
  /** Superellipse exponent of the cross-section (higher = squarer). */
  squareness: 8,
};

/** Half-width of the column (x) at height y. */
function halfWidth(y: number): number {
  const base = 0.7 - 0.045 * y; // slight taper
  const neck = 0.09 * Math.exp(-(((y - 0.3) / 0.38) ** 2)); // eroded waist above the break
  const wobble = 0.035 * noise.noise(0.2, y * 0.85, 3.1);
  return base - neck + wobble;
}

/** Half-depth of the column (z) at height y. */
function halfDepth(y: number): number {
  return halfWidth(y) * 0.76 + 0.03 * noise.noise(4.2, y * 0.7, 1.3);
}

/** Height of the fracture surface at (x, z): jagged, stepped and slightly tilted. */
export function fractureHeight(x: number, z: number): number {
  const broad = 0.09 * noise.fbm(x * 0.9 + 2.3, 0.5, z * 0.9 - 1.2, 3);
  const jag = 0.085 * (noise.ridged(x * 2.1 + 7.7, 1.3, z * 2.1, 4) - 0.55);
  // Conchoidal steps: quantise a smooth field and soften the risers slightly.
  const stepSrc = noiseB.fbm(x * 1.4, 0.2, z * 1.4, 2) * 3.2;
  const step = (Math.floor(stepSrc) + smooth(stepSrc - Math.floor(stepSrc), 0.72)) * 0.035;
  return 0.06 * x - 0.035 * z + broad + jag + step;
}

function topHeight(x: number, z: number): number {
  return COLUMN.top - 0.1 * x + 0.05 * z + 0.05 * noise.fbm(x * 1.6, 9.1, z * 1.6, 3) + 0.03 * (noise.ridged(x * 3, 4, z * 3, 3) - 0.5);
}

function smooth(t: number, edge: number): number {
  // Hard step for most of the interval, short smooth riser at the end.
  if (t < edge) return 0;
  const k = (t - edge) / (1 - edge);
  return k * k * (3 - 2 * k);
}

interface Chip {
  n: THREE.Vector3;
  c: THREE.Vector3;
  /** Lateral reach of the cut along the plane (world units); Infinity = full plane. */
  r: number;
}

const tmpChip = new THREE.Vector3();
/** Push p back onto the chip plane, fading out beyond the chip's lateral reach. */
function applyChip(p: THREE.Vector3, chip: Chip, strength = 1) {
  const d = tmpChip.subVectors(p, chip.c).dot(chip.n);
  if (d <= 0) return;
  let w = strength;
  if (chip.r !== Infinity) {
    tmpChip.addScaledVector(chip.n, -d); // lateral offset within the plane
    const lat = tmpChip.length();
    const t = Math.min(1, Math.max(0, (chip.r - lat) / (chip.r * 0.45)));
    w *= t * t * (3 - 2 * t);
  }
  p.addScaledVector(chip.n, -d * w);
}

/**
 * Chip planes: anything beyond a plane is pushed back onto it, producing flat,
 * flaked facets on corners and along the broken rims.
 */
function makeChips(seed: number, yMin: number, yMax: number, rimYs: number[], count: number, long: number, flakes: number): Chip[] {
  const rand = mulberry32(seed);
  const chips: Chip[] = [];
  const add = (theta: number, y: number, tilt: number, inset: number, r: number) => {
    const hw = halfWidth(y);
    const hd = halfDepth(y);
    const n = new THREE.Vector3(Math.cos(theta) * Math.cos(tilt), Math.sin(tilt), Math.sin(theta) * Math.cos(tilt)).normalize();
    // Distance from the axis to the surface in that direction (approximate corner reach).
    const reach = Math.hypot(Math.cos(theta) * hw, Math.sin(theta) * hd) * 1.18;
    const c = new THREE.Vector3(Math.cos(theta) * (reach - inset), y, Math.sin(theta) * (reach - inset));
    chips.push({ n, c, r });
  };
  // Long, near-vertical facets along the column edges.
  for (let i = 0; i < long; i++) {
    const theta = (Math.floor(rand() * 4) + 0.5) * (Math.PI / 2) + (rand() - 0.5) * 0.7;
    add(theta, yMin + rand() * (yMax - yMin), (rand() - 0.5) * 0.3, 0.08 + rand() * 0.12, 0.7 + rand() * 0.6);
  }
  // Conchoidal flakes scattered over the sides (moderate tilt, shallow).
  for (let i = 0; i < flakes; i++) {
    const theta = rand() * Math.PI * 2;
    const tilt = (rand() - 0.5) * 1.3;
    add(theta, yMin + 0.15 + rand() * (yMax - yMin - 0.3), tilt, 0.1 + rand() * 0.08, 0.22 + rand() * 0.25);
  }
  // Chips biting into the broken rims.
  for (let i = 0; i < count; i++) {
    const rimY = rimYs[i % rimYs.length];
    const dir = rimY > (yMin + yMax) / 2 ? 1 : -1;
    const theta = rand() * Math.PI * 2;
    add(theta, rimY - dir * (0.02 + rand() * 0.2), dir * (0.4 + rand() * 0.6), 0.06 + rand() * 0.18, 0.35 + rand() * 0.35);
  }
  return chips;
}

interface PieceOptions {
  lowerY: (x: number, z: number) => number;
  upperY: (x: number, z: number) => number;
  yMin: number;
  yMax: number;
  chips: Chip[];
  segments: [number, number, number];
  seed: number;
}

function buildPiece(opts: PieceOptions): THREE.BufferGeometry {
  const [sx, sy, sz] = opts.segments;
  const geo = new THREE.BoxGeometry(1, 1, 1, sx, sy, sz);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const e = COLUMN.squareness;
  const o = opts.seed * 3.17;

  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) * 2; // -1..1
    const t = pos.getY(i) + 0.5; // 0..1
    const v = pos.getZ(i) * 2;

    // Superellipse cross-section: round the box corners a little.
    const m = Math.max(Math.abs(u), Math.abs(v));
    const se = Math.pow(Math.pow(Math.abs(u), e) + Math.pow(Math.abs(v), e), 1 / e);
    const k = se > 1e-6 ? m / se : 1;

    const yNominal = opts.yMin + t * (opts.yMax - opts.yMin);
    const hw = halfWidth(yNominal);
    const hd = halfDepth(yNominal);
    const twist = 0.14 * Math.sin(yNominal * 0.8 + 0.6);
    let x = u * k * hw;
    let z = v * k * hd;
    const ct = Math.cos(twist);
    const st = Math.sin(twist);
    [x, z] = [x * ct - z * st, x * st + z * ct];

    // Vertical placement between the (possibly jagged) end surfaces.
    const y0 = opts.lowerY(x, z);
    const y1 = opts.upperY(x, z);
    let y = y0 + t * (y1 - y0);

    // Silhouette relief: radial displacement, stronger on the sides than on faces.
    const radial =
      0.09 * noise.fbm(x * 0.75 + o, y * 0.5, z * 0.75, 4) +
      0.045 * (noise.ridged(x * 2.1, y * 0.7 + o, z * 2.1, 3) - 0.5) +
      0.02 * noiseB.fbm(x * 4.5, y * 4.5, z * 4.5, 3);
    const sideWeight = Math.min(1, m * 1.15);
    x *= 1 + (radial / hw) * sideWeight;
    z *= 1 + (radial / hd) * sideWeight;
    // Faint horizontal strata.
    y += 0.012 * noise.noise(x * 1.2, y * 6.5, z * 1.2);

    p.set(x, y, z);
    for (const chip of opts.chips) applyChip(p, chip, 0.97);
    // Micro-variation so chip facets are not perfectly flat.
    const micro = 0.007 * noiseB.noise(p.x * 9, p.y * 9, p.z * 9);
    p.x += micro;
    p.z -= micro * 0.6;
    pos.setXYZ(i, p.x, p.y, p.z);
  }

  const merged = mergeVertices(geo, 1e-5);
  geo.dispose();
  merged.computeVertexNormals();
  computeCavity(merged);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Per-vertex curvature baked into `aCavity` (x = occlusion 0..1, y = convexity 0..1).
 * The stone shader darkens creases and lifts worn edges with it, so recesses stay
 * dark but readable and chipped rims catch light. Works on any indexed mesh
 * (authored GLBs get it too, see StoneMonolith.fromGLB).
 */
export function computeCavity(geo: THREE.BufferGeometry, strength = 1) {
  if (!geo.index) {
    const merged = mergeVertices(geo);
    geo.setIndex(merged.index);
    geo.setAttribute('position', merged.attributes.position);
    geo.computeVertexNormals();
  }
  const pos = geo.attributes.position as THREE.BufferAttribute;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const idx = geo.index!.array;
  const n = pos.count;
  const sum = new Float32Array(n * 3);
  const len = new Float32Array(n);
  const cnt = new Uint16Array(n);
  const link = (a: number, b: number) => {
    const dx = pos.getX(b) - pos.getX(a);
    const dy = pos.getY(b) - pos.getY(a);
    const dz = pos.getZ(b) - pos.getZ(a);
    sum[a * 3] += dx;
    sum[a * 3 + 1] += dy;
    sum[a * 3 + 2] += dz;
    len[a] += Math.sqrt(dx * dx + dy * dy + dz * dz);
    cnt[a]++;
  };
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b);
  }
  let curv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!cnt[i]) continue;
    const k = 1 / cnt[i];
    const d = (sum[i * 3] * nor.getX(i) + sum[i * 3 + 1] * nor.getY(i) + sum[i * 3 + 2] * nor.getZ(i)) * k;
    curv[i] = d / Math.max(1e-5, len[i] * k); // >0 concave, <0 convex
  }
  // Two smoothing passes over the 1-ring so the signal spans a few vertices.
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(n);
    const w = new Float32Array(n);
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      next[a] += curv[b] + curv[c]; w[a] += 2;
      next[b] += curv[a] + curv[c]; w[b] += 2;
      next[c] += curv[a] + curv[b]; w[c] += 2;
    }
    for (let i = 0; i < n; i++) next[i] = (next[i] + curv[i] * 2) / (w[i] + 2);
    curv = next;
  }
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const c = curv[i] * strength;
    out[i * 2] = Math.min(1, Math.max(0.3, 1 - Math.max(0, c) * 2.6));
    out[i * 2 + 1] = Math.min(1, Math.max(0, -c * 3.2));
  }
  geo.setAttribute('aCavity', new THREE.BufferAttribute(out, 2));
}

export interface MonolithGeometry {
  upper: THREE.BufferGeometry;
  lower: THREE.BufferGeometry;
  /** Resting centre of each piece (the geometry is centred on it). */
  upperCenter: THREE.Vector3;
  lowerCenter: THREE.Vector3;
}

/** @param detail 1 = high, lower values reduce subdivision proportionally. */
export function buildMonolithGeometry(detail = 1): MonolithGeometry {
  const d = Math.max(0.35, detail);
  const seg = (n: number) => Math.max(8, Math.round(n * d));

  const upperChips = makeChips(11, 0.1, COLUMN.top, [0.05, COLUMN.top], 16, 4, 10);
  const lowerChips = makeChips(23, -1.8, 0, [0.02], 12, 4, 12);

  const upper = buildPiece({
    lowerY: fractureHeight,
    upperY: topHeight,
    yMin: 0,
    yMax: COLUMN.top,
    chips: upperChips,
    segments: [seg(46), seg(62), seg(36)],
    seed: 1,
  });
  const lower = buildPiece({
    lowerY: () => COLUMN.bottom,
    upperY: fractureHeight,
    yMin: COLUMN.bottom,
    yMax: 0,
    chips: lowerChips,
    segments: [seg(50), seg(84), seg(40)],
    seed: 2,
  });

  // Centre each piece on its own bounding box so hover rotations pivot naturally.
  const upperCenter = new THREE.Vector3();
  const lowerCenter = new THREE.Vector3();
  upper.boundingBox!.getCenter(upperCenter);
  lower.boundingBox!.getCenter(lowerCenter);
  upperCenter.x = upperCenter.z = 0;
  lowerCenter.x = lowerCenter.z = 0;
  upper.translate(0, -upperCenter.y, 0);
  lower.translate(0, -lowerCenter.y, 0);
  upper.computeBoundingBox();
  lower.computeBoundingBox();
  upper.computeBoundingSphere();
  lower.computeBoundingSphere();
  return { upper, lower, upperCenter, lowerCenter };
}

/** Irregular chunk for floating debris; `seed` changes the silhouette. */
export function buildDebrisGeometry(seed: number, detail = 1): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const geo = new THREE.IcosahedronGeometry(1, detail >= 0.7 ? 3 : 2);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const stretch = new THREE.Vector3(0.75 + rand() * 0.6, 0.6 + rand() * 0.9, 0.7 + rand() * 0.5);
  const chips: Chip[] = [];
  for (let i = 0; i < 9; i++) {
    const n = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    chips.push({ n, c: n.clone().multiplyScalar(0.45 + rand() * 0.35), r: Infinity });
  }
  const p = new THREE.Vector3();
  const o = seed * 1.7;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const r = 1 + 0.22 * noise.fbm(p.x * 1.3 + o, p.y * 1.3, p.z * 1.3, 3) + 0.06 * noiseB.noise(p.x * 4, p.y * 4 + o, p.z * 4);
    p.multiplyScalar(r).multiply(stretch);
    for (const chip of chips) applyChip(p, chip);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  const merged = mergeVertices(geo, 1e-5);
  geo.dispose();
  merged.computeVertexNormals();
  computeCavity(merged);
  merged.computeBoundingSphere();
  return merged;
}
