import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { heroConfig } from '../heroConfig';
import { buildMonolithGeometry } from './stoneGeometry';

const DEG = Math.PI / 180;

/** Mesh names expected in an authored GLB (see README). */
export const MONOLITH_MESH_NAMES = { upper: 'Stone_Upper', lower: 'Stone_Lower' } as const;

/**
 * The two stone masses and their idle / hover / scroll motion.
 * Geometry is either procedural (default) or taken from an authored GLB; the
 * animation only needs two objects whose origins sit at each piece's centre.
 */
export class StoneMonolith {
  readonly group = new THREE.Group();
  readonly upper: THREE.Object3D;
  readonly lower: THREE.Object3D;
  /** Invisible proxy used for sculpture hover detection. */
  readonly hitProxy: THREE.Mesh;
  private upperRest = new THREE.Vector3();
  private lowerRest = new THREE.Vector3();
  private disposables: { dispose(): void }[] = [];

  private constructor(upper: THREE.Object3D, lower: THREE.Object3D, upperRest: THREE.Vector3, lowerRest: THREE.Vector3) {
    this.group.name = 'StoneMonolith';
    this.upper = upper;
    this.lower = lower;
    this.upperRest.copy(upperRest);
    this.lowerRest.copy(lowerRest);
    this.group.add(upper, lower);

    const proxyGeo = new THREE.CylinderGeometry(0.95, 0.95, 3.5, 12);
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    this.hitProxy = new THREE.Mesh(proxyGeo, proxyMat);
    this.hitProxy.position.y = -0.05;
    this.group.add(this.hitProxy);
    this.disposables.push(proxyGeo, proxyMat);
    this.update(0, 0, 0);
  }

  static procedural(material: THREE.Material, detail: number, shadows: boolean): StoneMonolith {
    const g = buildMonolithGeometry(detail);
    const upper = new THREE.Mesh(g.upper, material);
    const lower = new THREE.Mesh(g.lower, material);
    upper.name = MONOLITH_MESH_NAMES.upper;
    lower.name = MONOLITH_MESH_NAMES.lower;
    for (const m of [upper, lower]) {
      m.castShadow = shadows;
      m.receiveShadow = shadows;
    }
    const s = new StoneMonolith(upper, lower, g.upperCenter, g.lowerCenter);
    s.disposables.push(g.upper, g.lower);
    return s;
  }

  /**
   * Load an authored model. Meshes named Stone_Upper / Stone_Lower are required;
   * if they carry no PBR maps, the shared triplanar stone material is applied.
   */
  static async fromGLB(url: string, fallbackMaterial: THREE.Material, shadows: boolean): Promise<StoneMonolith> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const find = (name: string) => {
      const obj = gltf.scene.getObjectByName(name);
      if (!obj) throw new Error(`Monolith GLB is missing a mesh named "${name}"`);
      return obj;
    };
    const upper = find(MONOLITH_MESH_NAMES.upper);
    const lower = find(MONOLITH_MESH_NAMES.lower);
    const rests: THREE.Vector3[] = [];
    for (const piece of [upper, lower]) {
      piece.updateWorldMatrix(true, true);
      const rest = new THREE.Vector3().setFromMatrixPosition(piece.matrixWorld);
      piece.removeFromParent();
      piece.position.set(0, 0, 0);
      rests.push(rest);
      piece.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = shadows;
        mesh.receiveShadow = shadows;
        const m = mesh.material as THREE.MeshStandardMaterial;
        if (!m || !('map' in m) || !m.map) mesh.material = fallbackMaterial;
      });
    }
    const s = new StoneMonolith(upper, lower, rests[0], rests[1]);
    s.disposables.push({
      dispose: () => {
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.geometry.dispose();
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((mm) => mm !== fallbackMaterial && mm.dispose());
          }
        });
      },
    });
    return s;
  }

  setShadows(enabled: boolean) {
    for (const piece of [this.upper, this.lower]) {
      piece.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = enabled;
          mesh.receiveShadow = enabled;
        }
      });
    }
  }

  /**
   * @param t      animation time (s)
   * @param hover  0..1 hover state
   * @param scroll 0..1 scroll-out progress
   */
  update(t: number, hover: number, scroll: number) {
    const c = heroConfig.sculpture;
    const gap = c.gap + hover * c.hoverGap + scroll * c.scrollGap;
    const [au, al] = c.floatAmplitude;
    const [pu, pl] = c.floatPeriod;
    const tau = Math.PI * 2;
    const r = c.idleRotation * DEG;

    const bobU = Math.sin((t * tau) / pu) * au + Math.sin((t * tau) / (pu * 2.71) + 0.8) * au * 0.35;
    const bobL = Math.sin((t * tau) / pl + 1.9) * al;

    this.upper.position.set(
      this.upperRest.x + 0.02 * Math.sin(t * 0.21 + 1.0),
      this.upperRest.y + gap * 0.5 + bobU,
      this.upperRest.z,
    );
    this.upper.rotation.set(
      r * 0.6 * Math.sin(t * 0.23 + 0.4),
      8 * DEG + r * Math.sin(t * 0.17) + scroll * 6 * DEG,
      -2.6 * DEG + r * 0.7 * Math.sin(t * 0.29 + 2.0) - scroll * 3 * DEG,
    );
    this.lower.position.set(this.lowerRest.x, this.lowerRest.y - gap * 0.5 + bobL - scroll * 0.06, this.lowerRest.z);
    this.lower.rotation.set(r * 0.25 * Math.sin(t * 0.19 + 3.1), r * 0.4 * Math.sin(t * 0.13 + 1.1), r * 0.25 * Math.sin(t * 0.21));
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
