import { heroConfig, type QualitySettings, type QualityTier } from '../heroConfig';

const ORDER: QualityTier[] = ['low', 'medium', 'high'];

/**
 * Chooses an initial quality tier from device hints, then watches real frame
 * times and steps down when the average stays too slow. It never steps back up
 * during a session (avoids oscillating between tiers).
 */
export class QualityController {
  tier: QualityTier;
  private samples: number[] = [];
  private sampleTime = 0;
  private warmup = 3;
  private locked: boolean;

  constructor(initial: QualityTier, locked = false) {
    this.tier = initial;
    this.locked = locked;
  }

  get settings(): QualitySettings {
    return heroConfig.quality[this.tier];
  }

  /** Heuristic starting tier. `?quality=low|medium|high` overrides it (and locks it). */
  static detect(gl: WebGLRenderingContext | WebGL2RenderingContext | null): { tier: QualityTier; locked: boolean } {
    const forced = new URLSearchParams(location.search).get('quality');
    if (forced === 'low' || forced === 'medium' || forced === 'high') return { tier: forced, locked: true };

    const coarse = matchMedia('(pointer: coarse)').matches;
    const small = Math.min(screen.width, screen.height) < 820;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const memory = nav.deviceMemory ?? 8;
    const cores = navigator.hardwareConcurrency ?? 8;

    let gpu = '';
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    }
    if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return { tier: 'low', locked: false };
    if (coarse || small) return { tier: memory <= 4 || cores <= 4 ? 'low' : 'medium', locked: false };
    if (/intel|mali|adreno [1-5]/.test(gpu) || memory <= 4 || cores <= 4) return { tier: 'medium', locked: false };
    return { tier: 'high', locked: false };
  }

  /** Call after a pause so the first frames after resuming are not judged. */
  reset() {
    this.samples.length = 0;
    this.sampleTime = 0;
    this.warmup = 1.5;
  }

  /**
   * Feed a frame's duration (seconds). Returns the new tier when a downgrade is
   * warranted, otherwise null.
   */
  sample(dt: number): QualityTier | null {
    if (this.locked) return null;
    if (this.warmup > 0) {
      this.warmup -= dt;
      return null;
    }
    this.samples.push(dt * 1000);
    this.sampleTime += dt;
    if (this.sampleTime < heroConfig.performance.sampleWindow) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    // Median ignores one-off hitches (GC, tab switches).
    const median = sorted[Math.floor(sorted.length / 2)];
    this.samples.length = 0;
    this.sampleTime = 0;
    const i = ORDER.indexOf(this.tier);
    if (median > heroConfig.performance.downgradeFrameMs && i > 0) {
      this.tier = ORDER[i - 1];
      this.warmup = 1.5;
      return this.tier;
    }
    return null;
  }
}
