/**
 * Art-direction settings for the hero sculpture.
 *
 * Everything that shapes the look or feel of the scene lives here so it can be
 * tuned without touching the rendering code. Units are Three.js world units
 * (the finished monolith is ~3.6 units tall); angles are in degrees unless noted.
 */

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  /** Upper bound for devicePixelRatio. */
  maxPixelRatio: number;
  /** Multisample anti-aliasing samples on the main render target (WebGL2). */
  msaaSamples: number;
  /** Bloom is rendered at this fraction of the drawing buffer. */
  bloomResolution: number;
  /** 0 disables real-time shadows (a baked contact shadow is always present). */
  shadowMapSize: number;
  brightParticles: number;
  darkParticles: number;
  dustParticles: number;
  /** Low-lying mist cards. */
  mistLayers: number;
  /** Segments along each ribbon. */
  ribbonSegments: number;
  /** Subdivision density for the procedural monolith (1 = high). */
  stoneDetail: number;
  /** Texture set folder under /assets/textures/. */
  textureSet: 'desktop' | 'mobile';
}

export const heroConfig = {
  /**
   * Optional authored model. Leave null to use the procedural monolith.
   * The GLB must contain meshes named `Stone_Upper` and `Stone_Lower`
   * (see README → “Replacing the stone model”).
   */
  assets: {
    monolithModel: null as string | null,
    textureBase: 'assets/textures',
    noiseTexture: 'assets/textures/noise_rgba.png',
  },

  sculpture: {
    /** Uniform scale applied to the whole sculpture group. */
    scale: 1,
    /** Offset of the sculpture group in world space. */
    position: [0, 0, 0] as [number, number, number],
    /** Resting yaw (degrees) so a fracture corner faces the camera. */
    yaw: -24,
    /** Vertical gap between the two stone masses at rest. */
    gap: 0.2,
    /** Extra gap while the pointer hovers the sculpture. */
    hoverGap: 0.08,
    /** Extra gap at the end of the scroll-out transition. */
    scrollGap: 0.42,
    /** Idle hover amplitude (world units) for the upper / lower sections. */
    floatAmplitude: [0.036, 0.022] as [number, number],
    /** Idle hover periods in seconds (deliberately not multiples of each other). */
    floatPeriod: [6.4, 8.1] as [number, number],
    /** Maximum idle wobble (degrees). */
    idleRotation: 1.2,
    /** Pointer parallax limits (degrees) and damping (higher = snappier). */
    parallaxYaw: 4,
    parallaxPitch: 3,
    parallaxDamping: 2.4,
    /** How quickly hover state eases in / out (per second). */
    hoverDamping: 3.2,
  },

  stone: {
    /** Tint multiplied with the albedo texture (keep dark: basalt reflects ~5–8%). */
    tint: '#8a93a3',
    /** Texture repeats per world unit and normal-map strength. */
    textureScale: 0.55,
    normalStrength: 0.75,
    /** Faint light seeping from cavities near the core. */
    glowFalloff: 2.8,
  },

  camera: {
    /** Camera position relative to the sculpture, before framing. */
    position: [0, -0.92, 9.6] as [number, number, number],
    target: [0, -0.02, 0] as [number, number, number],
    /** World-space box that must fit inside the stage element. */
    fitHeight: 3.62,
    fitWidth: 3.25,
    /** Fraction of the stage the fit box may occupy. */
    fill: 0.86,
    /** Maximum camera drift (world units) from pointer parallax. */
    parallaxShift: [0.16, 0.08] as [number, number],
  },

  ribbons: {
    count: 3,
    width: 0.52,
    turbulence: 0.11,
    opacity: 0.9,
    flowSpeed: 0.075,
    /** Multiplier on turbulence / flow while hovering. */
    hoverActivity: 0.55,
    color: '#08101d',
    sheenColor: '#5f88c4',
  },

  particles: {
    /** Global density multiplier on top of the quality tier counts. */
    density: 1,
    brightness: 1,
    brightColor: '#bfe0ff',
    darkColor: '#03060b',
    /** Pointer influence radius (world units) and max displacement. */
    pointerRadius: 0.6,
    pointerForce: 0.16,
  },

  core: {
    color: '#9cc8ff',
    hotColor: '#f2f8ff',
    intensity: 1,
    /** Relative pulse amount and period (seconds). */
    pulse: 0.16,
    pulsePeriod: 5.2,
    hoverBoost: 0.35,
    lightIntensity: 7.5,
    lightDistance: 5.5,
  },

  bloom: {
    strength: 0.5,
    radius: 0.5,
    threshold: 1.0,
  },

  atmosphere: {
    background: '#04070d',
    fogColor: '#0b1422',
    fogDensity: 0.034,
    hazeColor: '#1d3558',
    exposure: 1.04,
  },

  lights: {
    key: { color: '#9fb8e0', intensity: 0.85, position: [-3, 5, 4] as [number, number, number] },
    rim: { color: '#7eaaf0', intensity: 3.2, position: [4, 2.5, -5] as [number, number, number] },
    rimLeft: { color: '#4d73b8', intensity: 1.8, position: [-5, 1.5, -4] as [number, number, number] },
    fillSky: '#1b2a44',
    fillGround: '#020305',
    fillIntensity: 0.22,
    envIntensity: 0.22,
  },

  scroll: {
    /** Fraction of the hero height over which the exit transition runs. */
    range: 0.85,
    damping: 6,
  },

  /** Quality tiers. The QualityController picks one and may step down at runtime. */
  quality: {
    high: {
      maxPixelRatio: 1.75,
      msaaSamples: 4,
      bloomResolution: 0.5,
      shadowMapSize: 2048,
      brightParticles: 2200,
      darkParticles: 4200,
      dustParticles: 420,
      mistLayers: 6,
      ribbonSegments: 260,
      stoneDetail: 1,
      textureSet: 'desktop',
    },
    medium: {
      maxPixelRatio: 1.35,
      msaaSamples: 2,
      bloomResolution: 0.4,
      shadowMapSize: 1024,
      brightParticles: 1600,
      darkParticles: 2600,
      dustParticles: 260,
      mistLayers: 4,
      ribbonSegments: 190,
      stoneDetail: 0.72,
      textureSet: 'desktop',
    },
    low: {
      maxPixelRatio: 1,
      msaaSamples: 0,
      bloomResolution: 0.32,
      shadowMapSize: 0,
      brightParticles: 1000,
      darkParticles: 1300,
      dustParticles: 120,
      mistLayers: 2,
      ribbonSegments: 130,
      stoneDetail: 0.5,
      textureSet: 'mobile',
    },
  } satisfies Record<QualityTier, QualitySettings>,

  performance: {
    /** Step down a tier when the rolling average frame time exceeds this (ms). */
    downgradeFrameMs: 24,
    /** Seconds of samples per evaluation window. */
    sampleWindow: 2.5,
  },
};

export type HeroConfig = typeof heroConfig;
