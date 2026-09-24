import { computeStageFrame, posterMeta } from './framing';
import type { HeroScene } from './scene/HeroScene';

const MOTION_KEY = 'dt-hero-motion';

function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ok = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

function readMotionChoice(): 'on' | 'off' | null {
  try {
    const v = sessionStorage.getItem(MOTION_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

function storeMotionChoice(v: 'on' | 'off') {
  try {
    sessionStorage.setItem(MOTION_KEY, v);
  } catch {
    /* storage unavailable: the choice simply is not remembered */
  }
}

/**
 * DOM side of the hero: poster placement, motion preference + toggle, lazy
 * loading of the 3D scene, crossfade, and fallbacks. The HTML content is
 * already rendered by the page; nothing here blocks it.
 *
 * States (on the section as data-scene): poster → loading → live, or fallback / unsupported.
 */
export class HeroSection {
  private hero: HTMLElement;
  private visual: HTMLElement;
  private stage: HTMLElement;
  private poster: HTMLImageElement | null;
  private toggle: HTMLButtonElement | null;
  private toggleLabel: HTMLElement | null;
  private scene: HeroScene | null = null;
  private loading: Promise<void> | null = null;
  private motion: boolean;
  private params = new URLSearchParams(location.search);
  private reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  private cleanup: (() => void)[] = [];

  constructor(root: HTMLElement) {
    this.hero = root;
    this.visual = root.querySelector<HTMLElement>('[data-hero-visual]')!;
    this.stage = root.querySelector<HTMLElement>('[data-hero-stage]')!;
    this.poster = root.querySelector<HTMLImageElement>('[data-hero-poster]');
    this.toggle = root.querySelector<HTMLButtonElement>('[data-motion-toggle]');
    this.toggleLabel = this.toggle?.querySelector<HTMLElement>('[data-motion-label]') ?? null;

    const choice = readMotionChoice();
    this.motion = choice ? choice === 'on' : !this.reducedQuery.matches;
  }

  init() {
    const posterMode = this.params.has('poster');
    const captureMode = this.params.has('capture');
    if (posterMode) document.documentElement.classList.add('poster-mode');

    this.placePoster();
    const ro = new ResizeObserver(() => this.placePoster());
    ro.observe(this.visual);
    ro.observe(this.stage);
    this.cleanup.push(() => ro.disconnect());
    if (this.poster && !this.poster.complete) {
      this.poster.addEventListener('load', () => this.poster?.classList.add('is-ready'), { once: true });
    } else {
      this.poster?.classList.add('is-ready');
    }

    if (!hasWebGL2()) {
      this.setState('unsupported');
      return;
    }

    const onToggle = () => this.setMotion(!this.motion, true);
    const onReduced = (e: MediaQueryListEvent) => {
      if (readMotionChoice() === null) this.setMotion(!e.matches, false);
    };
    this.toggle?.addEventListener('click', onToggle);
    this.reducedQuery.addEventListener('change', onReduced);
    this.cleanup.push(
      () => this.toggle?.removeEventListener('click', onToggle),
      () => this.reducedQuery.removeEventListener('change', onReduced),
    );
    this.updateToggle();

    if (posterMode || captureMode) {
      void this.load({ posterMode, captureMode });
    } else if (this.motion) {
      this.whenIdle(() => void this.load());
    }
  }

  private whenIdle(fn: () => void) {
    const go = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(fn, { timeout: 1200 });
      else setTimeout(fn, 200);
    };
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  }

  private setMotion(on: boolean, remember: boolean) {
    this.motion = on;
    if (remember) storeMotionChoice(on ? 'on' : 'off');
    this.updateToggle();
    if (this.scene) this.scene.setPlaying(on);
    else if (on) void this.load();
  }

  private updateToggle() {
    if (!this.toggle) return;
    this.toggle.hidden = false;
    this.toggle.dataset.state = this.motion ? 'playing' : 'paused';
    if (this.toggleLabel) this.toggleLabel.textContent = this.motion ? 'Pause motion' : 'Play motion';
  }

  private setState(state: 'poster' | 'loading' | 'live' | 'fallback' | 'unsupported') {
    this.hero.dataset.scene = state;
    if (state === 'fallback' || state === 'unsupported') {
      if (this.toggle) this.toggle.hidden = true;
    }
  }

  private load(mode: { posterMode?: boolean; captureMode?: boolean } = {}): Promise<void> {
    if (this.loading) return this.loading;
    this.setState('loading');
    this.loading = (async () => {
      try {
        const { HeroScene } = await import('./scene/HeroScene');
        this.scene = await HeroScene.create({
          hero: this.hero,
          container: this.visual,
          stage: this.stage,
          playing: this.motion,
          finePointer: matchMedia('(hover: hover) and (pointer: fine)').matches,
          posterMode: mode.posterMode,
          captureMode: mode.captureMode,
          onContextLost: () => this.fail(new Error('WebGL context lost')),
        });
        this.setState('live');
        const w = window as Window & { __hero?: unknown };
        if (mode.captureMode || mode.posterMode || this.params.has('perf')) w.__hero = this.scene;
        document.documentElement.dataset.heroReady = 'true';
      } catch (err) {
        this.fail(err);
      }
    })();
    return this.loading;
  }

  private fail(err: unknown) {
    console.warn('[hero] 3D scene unavailable, keeping the poster.', err);
    this.scene?.dispose();
    this.scene = null;
    this.setState('fallback');
    document.documentElement.dataset.heroReady = 'fallback';
  }

  /** Place the poster so its sculpture lines up with where the live camera frames it. */
  private placePoster() {
    if (!this.poster) return;
    const f = computeStageFrame(this.visual, this.stage);
    const s = f.pxPerUnit / posterMeta.pxPerUnit;
    const st = this.poster.style;
    st.width = `${posterMeta.width * s}px`;
    st.height = `${posterMeta.height * s}px`;
    st.left = `${f.cx - posterMeta.cx * s}px`;
    st.top = `${f.cy - posterMeta.cy * s}px`;
  }

  dispose() {
    this.cleanup.forEach((fn) => fn());
    this.cleanup.length = 0;
    this.scene?.dispose();
    this.scene = null;
  }
}
