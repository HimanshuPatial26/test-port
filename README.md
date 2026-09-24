# Deepanshu Thakur — portfolio hero

An interactive Three.js hero for a marketing, growth and brand-strategy portfolio. A fractured basalt monolith hangs in a blue-black haze. A white-blue core burns in the gap between its two halves, and dark, translucent ribbons circulate around the break.

![Desktop hero](docs/screenshots/desktop-1672x941.png)

| Mobile | Hover / scroll states |
| --- | --- |
| <img src="docs/screenshots/mobile-390x844.png" width="260" alt="Mobile hero" /> | <img src="docs/screenshots/states.png" width="520" alt="Idle, hover, 50% and 100% scroll-out" /> |

The repository was empty, so this is a **self-contained static site** (Vite + TypeScript + Three.js, no framework). It includes real destination sections for the navigation (Work, About, Contact) with clearly marked placeholder content. To move the hero into an existing site, see [Integrating into another site](#integrating-into-another-site).

---

## Run, build, deploy

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build → dist/
npm run preview    # serve dist/ at http://localhost:4173
```

`dist/` is plain static files with relative URLs (`base: './'`). It can be deployed to GitHub Pages, Netlify, Vercel, S3 or a sub-folder with no server or backend.

Requirements: Node 18+ (tested with Node 22). Browsers need WebGL2 for the 3D layer. Without it, the poster image and all content still work.

---

## What is where

```
index.html                     Page markup: header, hero (real HTML text), Work / About / Contact
src/main.ts                    Entry: font, CSS, HeroSection
src/styles/main.css            All styles (hero layout, responsive rules, reduced motion)
src/hero/
  heroConfig.ts                ← every art-direction and quality setting
  HeroSection.ts               DOM glue: poster placement (PosterFallback), motion toggle,
                               lazy-loading, crossfade, fallbacks
  framing.ts                   Shared camera/poster framing maths (+ poster metadata)
  scene/
    HeroScene.ts               Renderer, camera framing, input, scroll, frame loop, lifecycle
    QualityController.ts       Initial tier detection + runtime downgrade
    StoneMonolith.ts           Two stone masses: procedural or GLB, idle/hover/scroll motion
    stoneGeometry.ts           Procedural fractured column, debris chunks, baked curvature
    stoneMaterial.ts           Triplanar PBR basalt (MeshStandardMaterial + shader patch)
    EnergyCore.ts              Core billboard, halo, rim scatter, real point light
    EnergyRibbons.ts           Three shader-driven ribbons on a shared vortex-ring path
    ParticleField.ts           Bright specks, dark shed flecks, dust (GPU, 1 draw call each)
    FloatingDebris.ts          Instanced suspended fragments
    Environment.ts             Fog, lights, env map, backdrop, wet ground, mist, cairns
    PostFX.ts                  EffectComposer: bloom → ACES/sRGB → vignette + grain
    shaders/chunks.ts          Shared GLSL (simplex noise, ribbon path, sprites)
public/assets/
  textures/desktop|mobile/     stone_albedo / stone_normal / stone_orm (.webp)
  textures/noise_rgba.png      Shader noise
  posters/                     Poster captured from the live scene (1600 and 800 px)
scripts/
  generate-textures.py         Regenerates the texture set (numpy + pillow)
  capture.mjs                  Browser checks, screenshots, poster, recording, perf (Playwright)
docs/                          Screenshots, recording, measured results
```

---

## How the hero behaves

**Loading.** The HTML intro, buttons and nav render immediately; only 3.5 KB of gzipped JS is on the critical path. The poster image is preloaded and positioned with the same framing maths as the live camera. After `load` and an idle callback, three.js and the scene are fetched with a dynamic `import()`. Textures load and every shader is compiled before the canvas appears. The canvas then crossfades in over 1.4 s. The canvas area is reserved from the start, so nothing shifts.

**Fallbacks.** The hero never goes blank:

- No WebGL2 → `data-scene="unsupported"`, the poster stays and the motion toggle is hidden.
- Context creation fails, a texture 404s, a model fails, or the context is lost → the scene is disposed and the poster stays (`data-scene="fallback"`).

**Idle.** The two stone masses hover on different, non-harmonic periods: about 1% of the sculpture's height, with small wobbles and no spins. The core breathes over roughly 5 s. The ribbons circulate continuously and deform through one shared, coherent noise field. Debris drifts and slowly rotates. All motion is time-based, and `dt` is clamped so frame-rate changes or resuming never cause a jump.

**Pointer** (only on `(hover: hover) and (pointer: fine)` devices). Parallax turns the sculpture up to 4° yaw and 1.8° pitch, and the camera drifts slightly. Both are exponentially damped and ease back to neutral when the pointer leaves the window. The text never moves. Hovering the sculpture itself, detected by a raycast against an invisible proxy rather than the whole hero, widens the gap, brightens the core by up to 35% and raises ribbon activity. Particles are pushed away from the pointer only within a 0.6-unit radius, with a capped force. The canvas has `pointer-events: none`, so it never intercepts clicks. Nothing needs to be clicked or dragged.

**Scroll.** Tied directly to normal page scroll, with no pinning or hijacking. As the hero leaves the viewport, the stones separate, debris spreads, and the energy, halo and exposure fade. The transition is damped and fully reversible.

**Reduced motion.** With `prefers-reduced-motion: reduce`, the 3D scene is not loaded at all. The poster is a still frame of the same scene, and the CSS micro-animations are disabled. The toggle reads **Play motion** so a visitor can opt in.

**Motion toggle.** A small keyboard-accessible button in the hero footer (**Pause motion / Play motion**). Pausing stops the render loop and leaves a still frame. The choice is remembered for the session (`sessionStorage`).

**Performance hygiene.** Rendering pauses when the hero is off-screen (IntersectionObserver) or the tab is hidden, and resumes without a time jump. There are no per-frame allocations and no framework state updates. Pixel ratio is capped per tier. Every geometry, material, texture, render target, observer and listener is released in `HeroScene.dispose()`.

**Accessibility.** The canvas and poster are `aria-hidden`. The `h1` contains the name and headline. Focus states are visible, a skip link is included, and text sits on a scrim over the scene for contrast.

---

## Art-direction settings

Everything tunable lives in **`src/hero/heroConfig.ts`**:

| Group | Keys | What it does |
| --- | --- | --- |
| `assets` | `monolithModel`, `textureBase`, `noiseTexture` | Optional GLB path; texture folders |
| `sculpture` | `scale`, `position`, `yaw` | Placement of the whole sculpture |
| | `gap`, `hoverGap`, `scrollGap` | Fracture gap at rest / extra on hover / extra at full scroll |
| | `floatAmplitude`, `floatPeriod`, `idleRotation` | Idle hover per piece (keep amplitude ≈ 1–2% of height) |
| | `parallaxYaw`, `parallaxPitch`, `parallaxDamping`, `hoverDamping` | Pointer response limits (degrees) and weight |
| `stone` | `tint`, `textureScale`, `normalStrength`, `glowFalloff` | Basalt colour, texture density, relief, cavity glow reach |
| `camera` | `position`, `target`, `fitHeight`, `fitWidth`, `fill`, `parallaxShift` | Framing: the fit box is scaled into the `[data-hero-stage]` rectangle |
| `ribbons` | `count`, `width`, `turbulence`, `opacity`, `flowSpeed`, `hoverActivity`, `color`, `sheenColor` | Ribbon look and motion. Per-ribbon shape (radii, spans, tilt, twist) is in `RIBBON_PARAMS` in `EnergyRibbons.ts` |
| `particles` | `density`, `brightness`, `brightColor`, `darkColor`, `pointerRadius`, `pointerForce` | Particle look; `density` scales all tiers |
| `core` | `color`, `hotColor`, `intensity`, `pulse`, `pulsePeriod`, `hoverBoost`, `lightIntensity`, `lightDistance` | Core glow and the real light it casts |
| `bloom` | `strength`, `radius`, `threshold` | Bloom only picks up HDR values above `threshold` |
| `atmosphere` | `background`, `fogColor`, `fogDensity`, `hazeColor`, `exposure` | Colour and depth of the environment |
| `lights` | `key`, `rim`, `rimLeft`, `fill*`, `envIntensity` | Key / rim / fill / environment lighting |
| `scroll` | `range`, `damping` | How much hero height the exit transition spans |
| `quality.low/medium/high` | pixel ratio cap, MSAA, bloom resolution, shadow map, particle counts, mist layers, ribbon segments, stone detail, texture set | Quality tiers (mobile uses `low`/`medium`) |
| `performance` | `downgradeFrameMs`, `sampleWindow` | Runtime downgrade rule |

**Quality tiers.** The starting tier comes from device hints:

- **low:** software GPUs, or small or coarse-pointer devices with ≤ 4 GB of memory or ≤ 4 cores.
- **medium:** other phones and tablets, plus integrated Intel / low-end mobile GPUs.
- **high:** everything else.

At runtime, if the median frame time over a 2.5 s window exceeds 24 ms, the tier steps down once per window and never steps back up. A downgrade lowers the pixel ratio, MSAA, bloom resolution, shadows, particle counts and mist layers immediately. Stone subdivision and the texture set (desktop or mobile) are fixed when the scene starts.

**Where the sculpture sits** is decided by CSS, not by the 3D code. The empty `.hero__stage` box (right ~55% on desktop, below the intro on mobile) is the target rectangle. The camera's field of view and view offset are computed so the fit box fills `fill` of that box. Change the layout, and the sculpture and poster follow.

---

## Assets

| Asset | Path | Size |
| --- | --- | --- |
| Stone albedo / normal / ORM, desktop (1024²) | `public/assets/textures/desktop/stone_*.webp` | 115 + 761 + 384 KB |
| Stone albedo / normal / ORM, mobile (512²) | `public/assets/textures/mobile/stone_*.webp` | 25 + 173 + 96 KB |
| Shader noise (256² RGBA, linear) | `public/assets/textures/noise_rgba.png` | 194 KB |
| Poster (captured from the scene) | `public/assets/posters/hero-poster-1600.webp`, `-800.webp` | 116 KB / 30 KB |
| Font (Urbanist variable, OFL, self-hosted via `@fontsource-variable/urbanist`) | bundled | 28 KB (latin) |

### Transfer budget

| | Desktop (high/medium) | Mobile (low) |
| --- | --- | --- |
| Critical path: HTML + CSS + JS (gzip) | 9 KB | 9 KB |
| Font + poster | 28 + 116 KB | 28 + 30 KB |
| Lazy 3D JavaScript (three.js + scene, gzip) | **191 KB** | **191 KB** |
| Lazy textures | **1.45 MB** | **490 KB** |
| **Total hero** | **≈ 1.8 MB** (budget 5 MB) | **≈ 750 KB** |

The geometry costs no transfer: the monolith, debris and cairns are built on the client in ~50–150 ms, depending on tier. The textures are WebP-compressed for transfer but not GPU-compressed. KTX2/Basis would need the ~0.5 MB Basis transcoder, which outweighs the gain for three textures. Revisit this if an authored model brings more textures.

### Replacing the stone model

The procedural monolith is a stand-in (see [Missing assets](#missing-assets-and-visual-compromises)). To use an authored model:

1. Export a GLB with two meshes (or groups) named **`Stone_Upper`** and **`Stone_Lower`**.
   - Y-up, 1 unit ≈ 1 m. The finished sculpture should be ≈ 3.6 units tall with the fracture gap near `y = 0`. The lower piece's base should extend below `y = -1.74` (the ground).
   - Set each object's origin at that piece's centre. Its node position becomes the rest position, and the hover and rotation animate around it.
   - Model the pieces touching (gap closed). The code opens the gap (`sculpture.gap`).
   - Keep silhouette-level detail in geometry. Bake pores and fine grain into the textures. Base colour, normal and ORM maps are used if present. If a mesh has no base-colour map, the procedural triplanar basalt material is applied instead.
   - Meshopt compression is supported (`gltfpack -cc` or `gltf-transform meshopt`).
2. Put it under `public/assets/models/` and set `heroConfig.assets.monolithModel = 'assets/models/monolith.glb'`.

No animation code changes. Hover detection uses a proxy cylinder you can resize in `StoneMonolith.ts` if the silhouette changes a lot.

### Regenerating textures and poster

```bash
pip install numpy pillow
npm run textures                              # rewrites public/assets/textures/*
npm run dev &                                 # the capture script drives the dev server
npm run capture -- poster                     # re-shoots public/assets/posters/* from the live scene
```

Re-shoot the poster after any visual change so the poster → canvas crossfade stays seamless. The poster uses the fixed framing in `framing.ts` (`posterMeta`) and is placed on the page with the same maths as the camera.

---

## Integrating into another site

1. Copy `src/hero/`, `public/assets/`, the hero rules from `src/styles/main.css`, and the hero markup from `index.html`. The elements the code reads are `[data-hero]`, `[data-hero-visual]`, `[data-hero-stage]`, `[data-hero-poster]` and `[data-motion-toggle]` / `[data-motion-label]`.
2. Install `three` (the same version as `@types/three`).
3. Mount it: `new HeroSection(document.querySelector('[data-hero]')!).init()`. Call `.dispose()` on unmount.
4. **React:** render the same markup in a component. Call `init()` in `useEffect` and `dispose()` in its cleanup. The scene deliberately keeps all per-frame state outside React. React Three Fiber isn't needed; the imperative scene can be mounted as-is.
5. If assets live elsewhere, adjust `heroConfig.assets` (paths are relative to Vite's `BASE_URL`).

Development URL flags:

- `?quality=low|medium|high` forces a quality tier.
- `?debug=noparticles,nocore,noribbons,nodebris` isolates layers.
- `?perf` exposes `window.__hero.stats`.
- `?capture` gives deterministic frames via `window.__hero.renderAt(t, { hover, scroll, pointer })`.
- `?poster&t=7.5` renders the poster framing.

---

## Verification

Run in headless Chromium 140 (Playwright 1.56) with **SwiftShader software WebGL**, because this environment has no GPU. Reproduce with `npm run capture -- checks` (dev server running) or `-- checks --url http://localhost:4173/` against `npm run preview`. The results are in `docs/checks.json`:

- Hero text visible before 3D loads; the scene goes live and crossfades in.
- The canvas never intercepts pointer events. `#work`, `#about` and `#contact` exist, and **View projects** scrolls to Work.
- Resizing updates the drawing buffer; no horizontal overflow at 1440, 900, 600 or 390 px.
- The motion toggle works from the keyboard, and the choice survives a reload in the same session.
- No console errors or warnings. Chromium's “GPU stall due to ReadPixels” notices, which the screenshots themselves trigger, are ignored.
- `prefers-reduced-motion`: no canvas, poster shown, toggle offers **Play motion**.
- Texture 404 → fallback state with the poster, no canvas.
- WebGL disabled → unsupported state with the poster, toggle hidden.
- Mobile (390×844, touch): no overflow; touch scrolling moves the page.

Screenshots in `docs/screenshots/`: desktop 1672×941 (the mockup's size), 1440×900 and 1280×720, tablet 834×1112, mobile 390×844 at DPR 2, plus a states sheet (idle / hover / 50% / 100% scroll). `docs/media/hero-motion.mp4` is a deterministic 8 s recording. Frames are rendered at exact timestamps, so it shows the intended motion rather than software-rendering stutter, including a pointer drift and a hover.

### Measured performance

`npm run capture -- perf --url http://localhost:4173/` (production build) — the results are in `docs/perf.json`.

| Viewport | Tier | Canvas / DPR | Draw calls | Triangles | Main-thread CPU / frame (median, p95) | Frame rate |
| --- | --- | --- | --- | --- | --- | --- |
| 1440×900 | high | 1440×900 @1 | 46 | 168k | 2.3 ms, 5.0 ms | 0.5 fps* |
| 1440×900 | medium | 1440×900 @1 | 44 | 101k | 2.3 ms, 5.7 ms | 0.6 fps* |
| 1440×900 | low | 1440×900 @1 | 37 | 32k | 1.6 ms, 3.8 ms | 1.2 fps* |
| 390×844 | low | 390×844 @1 | 37 | 32k | 1.4 ms, 2.7 ms | 4.3 fps* |

Environment: cloud container with a 4-core Intel Xeon @ 2.8 GHz, **no GPU**, Chromium with SwiftShader.

\* The frame rates are CPU rasterisation and **say nothing about real hardware**. They only confirm the scene runs end to end on the slowest possible WebGL path. What does carry over is the main-thread cost: about 1.5–2.5 ms per frame for animation, uniform updates and draw submission, leaving most of a 16.7 ms budget for the GPU. The two targets, **60 fps on a representative laptop** and **30 fps or better on a mid-range phone**, **have not been validated**. Validate them on real devices: open `/?perf&quality=high` (or `medium` / `low`) and read `window.__hero.stats` (frame times, CPU times, draw calls). If a device can't hold about 42 fps, the quality controller steps down a tier automatically after a 2.5 s window.

---

## Missing assets and visual compromises

- **No authored stone model or scanned textures were supplied.** The monolith is procedural: an analytic column split along a jagged, stepped fracture surface, with bounded planar chips, ridged relief and baked vertex curvature. The basalt textures are procedurally generated (spectral noise, Worley pores, a crack network). The result reads as fractured, heavy stone, but it is less detailed than a sculpted or photogrammetry asset:
  - The upper block's top is fairly flat.
  - Close up, the chips look faceted rather than conchoidal.
  - The fracture faces lack the crystalline sparkle in the mockup.

  A GLB with baked maps drops in without code changes (see above).
- **The ribbons are a stylised interpretation.** They are dark, translucent, noise-eroded sheets with lit rims, riding a vortex-ring path. They catch the circulation, the depth and the front/back passage around the stone. They are more glassy-blue and less smoky-black than the mockup, and they don't reproduce the video's fluid-simulated splashes. The video's bursts were deliberately not replicated in the idle state.
- **Transparency sorting:** the ribbons don't write depth, so where two ribbons overlap each other the draw order is fixed per ribbon rather than per pixel. At these opacities this is rarely noticeable. Stone/ribbon intersections are correct because the stone is opaque.
- **Ground reflections are faked:** a wet roughness map, the environment map and a soft additive glow under the core. There are no real-time reflections, which would be expensive and add little at this darkness.
- **Real-time shadows on high/medium only.** The low tier relies on a baked contact shadow.
- **The poster is one fixed frame** (t = 7.5 s), re-framed per layout, so it matches the live scene's composition but not its exact moment.
- **Not identical to the mockup.** The composition, palette, typography and layout follow it closely: text left, sculpture right, horizon low, cairns in the fog, debris around the base. The stone and ribbons are clearly a different rendering of the same idea, not a match.
- **Demo content:** the Work, About and Contact sections, the case studies and the `hello@example.com` address are placeholders and are labelled as such on the page.

## Licences

Three.js (MIT). Urbanist font (SIL Open Font License, via Fontsource). The simplex noise GLSL is by Ashima Arts / Stefan Gustavson (MIT). All textures, posters and geometry here are generated by this project's code.
