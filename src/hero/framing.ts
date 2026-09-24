import { heroConfig } from './heroConfig';

/**
 * Shared framing maths.
 *
 * The page layout decides where the sculpture should sit through an empty
 * `[data-hero-stage]` element (right column on desktop, below the intro on
 * mobile). Both the live camera and the static poster use this to place the
 * sculpture, which keeps the poster → canvas crossfade aligned.
 */
export interface StageFrame {
  /** Hero-local CSS pixel position of the sculpture's centre. */
  cx: number;
  cy: number;
  /** CSS pixels per world unit at the sculpture's depth. */
  pxPerUnit: number;
  /** Size of the hero (and of the canvas) in CSS pixels. */
  width: number;
  height: number;
}

export function computeStageFrame(hero: HTMLElement, stage: HTMLElement): StageFrame {
  const h = hero.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  const { fitHeight, fitWidth, fill } = heroConfig.camera;
  const pxPerUnit = Math.max(
    40,
    Math.min((s.height * fill) / fitHeight, (s.width * fill) / fitWidth),
  );
  return {
    cx: s.left - h.left + s.width / 2,
    cy: s.top - h.top + s.height / 2,
    pxPerUnit,
    width: h.width,
    height: h.height,
  };
}

/**
 * Metadata for the poster images in /assets/posters. They were captured from
 * the live scene (`npm run capture -- poster`) with this exact framing.
 */
export const posterMeta = {
  width: 1600,
  height: 1200,
  cx: 800,
  cy: 600,
  pxPerUnit: 262,
};
