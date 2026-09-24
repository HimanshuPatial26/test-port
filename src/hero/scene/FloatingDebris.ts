import * as THREE from 'three';
import { buildDebrisGeometry } from './stoneGeometry';
import { mulberry32 } from './utils/noise';

interface Piece {
  variant: number;
  slot: number;
  base: THREE.Vector3;
  scale: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  bob: number;
  phase: number;
}

/**
 * Suspended stone fragments. Three chunk shapes, each drawn as one InstancedMesh,
 * with non-uniform scale and hand-weighted placement so the scatter is uneven:
 * a dense cluster of grit near the base, a few mid-height chips, two larger stones.
 */
export class FloatingDebris {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private pieces: Piece[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();

  constructor(material: THREE.Material, detail: number, shadows: boolean, density = 1) {
    this.group.name = 'FloatingDebris';
    const rand = mulberry32(4242);
    const variants = 3;
    for (let v = 0; v < variants; v++) this.geometries.push(buildDebrisGeometry(101 + v * 37, detail));

    const add = (x: number, y: number, z: number, size: number) => {
      const variant = Math.floor(rand() * variants);
      const s = size * (0.8 + rand() * 0.4);
      this.pieces.push({
        variant,
        slot: 0,
        base: new THREE.Vector3(x, y, z),
        scale: new THREE.Vector3(s * (0.7 + rand() * 0.6), s * (0.7 + rand() * 0.6), s * (0.7 + rand() * 0.6)),
        rot: new THREE.Euler(rand() * 6.28, rand() * 6.28, rand() * 6.28),
        spin: new THREE.Vector3((rand() - 0.5) * 0.25, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.2),
        bob: 0.02 + rand() * 0.05,
        phase: rand() * 10,
      });
    };

    // Grit near the base (denser toward the front-left / right, sparse behind).
    const grit = Math.round(18 * density);
    for (let i = 0; i < grit; i++) {
      const side = rand() < 0.55 ? -1 : 1;
      const x = side * (0.85 + Math.pow(rand(), 0.8) * (side < 0 ? 1.2 : 1.6));
      const y = -1.62 + Math.pow(rand(), 1.6) * 0.95;
      const z = -0.9 + rand() * 2.1;
      add(x, y, z, 0.035 + Math.pow(rand(), 2.2) * 0.07);
    }
    // Mid-height chips caught in the flow.
    const chips = Math.round(7 * density);
    for (let i = 0; i < chips; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      add(side * (1.3 + rand() * (side < 0 ? 0.5 : 0.8)), -0.7 + rand() * 1.9, -0.8 + rand() * 1.4, 0.045 + rand() * 0.05);
    }
    // Two larger stones, off-centre and at different depths.
    add(2.05, 0.35, -1.1, 0.19);
    add(-1.7, -1.1, 0.4, 0.12);

    const counts = new Array(variants).fill(0);
    for (const piece of this.pieces) piece.slot = counts[piece.variant]++;
    for (let v = 0; v < variants; v++) {
      const mesh = new THREE.InstancedMesh(this.geometries[v], material, Math.max(1, counts[v]));
      mesh.count = counts[v];
      mesh.castShadow = shadows;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.update(0, 0);
  }

  setShadows(enabled: boolean) {
    this.meshes.forEach((m) => (m.castShadow = enabled));
  }

  update(t: number, scroll: number) {
    const spread = 1 + scroll * 0.75;
    for (const piece of this.pieces) {
      const b = piece.base;
      this.p.set(
        b.x * spread + Math.sin(t * 0.21 + piece.phase) * 0.04,
        b.y + Math.sin(t * 0.37 + piece.phase * 1.7) * piece.bob + scroll * (b.y + 1.8) * 0.25,
        b.z * (1 + scroll * 0.3) + Math.cos(t * 0.17 + piece.phase) * 0.03,
      );
      this.e.set(
        piece.rot.x + t * piece.spin.x,
        piece.rot.y + t * piece.spin.y,
        piece.rot.z + t * piece.spin.z,
      );
      this.q.setFromEuler(this.e);
      this.m.compose(this.p, this.q, piece.scale);
      this.meshes[piece.variant].setMatrixAt(piece.slot, this.m);
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.meshes.forEach((m) => m.dispose());
  }
}
