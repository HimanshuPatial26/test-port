#!/usr/bin/env node
/**
 * Browser checks + media capture for the hero (Playwright / Chromium).
 *
 *   node scripts/capture.mjs <task> [--url http://localhost:5173/] [--out captures]
 *
 * Tasks:
 *   shots     desktop + mobile screenshots (live scene; add --t 7.5 for a deterministic frame)
 *   states    idle / hover / 50% / 100% scroll-out frames (deterministic)
 *   poster    capture the poster images into public/assets/posters/ (needs python3 + pillow)
 *   record    deterministic frame capture → captures/hero-motion.mp4 (needs imageio-ffmpeg)
 *   perf      run the live scene per quality tier and report frame times
 *   checks    reduced motion, asset failure, no-WebGL, resize, nav links, console errors
 *
 * Environment:
 *   PLAYWRIGHT_MODULE   path to a playwright package (defaults to "playwright")
 *   CHROME_PATH         Chromium executable (defaults to Playwright's bundled browser)
 *   GL=gpu              use the system GPU instead of SwiftShader
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const args = process.argv.slice(2);
const task = args[0] || 'shots';
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = opt('url', 'http://localhost:5173/');
const OUT = path.resolve(opt('out', 'captures'));
fs.mkdirSync(OUT, { recursive: true });

const glArgs =
  process.env.GL === 'gpu'
    ? ['--enable-gpu', '--ignore-gpu-blocklist']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

async function launch(extra = []) {
  return chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: [...glArgs, ...extra],
  });
}

function url(q = '') {
  const u = new URL(BASE);
  if (q) u.search = q;
  return u.toString();
}

async function waitReady(page, timeout = 120000) {
  await page.waitForFunction(() => document.documentElement.dataset.heroReady, null, { timeout });
  return page.evaluate(() => document.documentElement.dataset.heroReady);
}

function collectConsole(page, bucket) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') bucket.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => bucket.push(`[pageerror] ${e.message}`));
}

// ---------------------------------------------------------------------------
async function shots() {
  const browser = await launch();
  const cases = [
    { name: 'desktop-1672x941', viewport: { width: 1672, height: 941 }, dpr: 1 },
    { name: 'desktop-1440x900', viewport: { width: 1440, height: 900 }, dpr: 1 },
    { name: 'laptop-1280x720', viewport: { width: 1280, height: 720 }, dpr: 1 },
    { name: 'tablet-834x1112', viewport: { width: 834, height: 1112 }, dpr: 1, mobile: true },
    { name: 'mobile-390x844', viewport: { width: 390, height: 844 }, dpr: 2, mobile: true },
  ];
  const t = opt('t', null);
  const q = [t !== null ? 'capture' : '', opt('query', '')].filter(Boolean).join('&');
  for (const c of cases) {
    const ctx = await browser.newContext({
      viewport: c.viewport,
      deviceScaleFactor: c.dpr,
      isMobile: !!c.mobile,
      hasTouch: !!c.mobile,
    });
    const page = await ctx.newPage();
    const logs = [];
    collectConsole(page, logs);
    await page.goto(url(q), { waitUntil: 'load' });
    const state = await waitReady(page);
    if (t !== null) await page.evaluate((tt) => window.__hero?.renderAt(Number(tt)), t);
    await page.waitForTimeout(Number(opt('settle', 2500)));
    const file = path.join(OUT, `${c.name}.png`);
    await page.screenshot({ path: file });
    if (c.mobile) await page.screenshot({ path: path.join(OUT, `${c.name}-full.png`), fullPage: true });
    const stats = await page.evaluate(() => {
      const h = window.__hero;
      return h ? { tier: h.stats.tier, calls: h.stats.drawCalls, tris: h.stats.triangles, dpr: h.stats.pixelRatio } : null;
    });
    console.log(`${c.name}: state=${state} ${JSON.stringify(stats)} → ${path.relative(process.cwd(), file)}`);
    if (logs.length) console.log('  console:', logs.join('\n  '));
    await ctx.close();
  }
  await browser.close();
}

// ---------------------------------------------------------------------------
async function states() {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url(`capture&quality=${opt('quality', 'high')}`), { waitUntil: 'load' });
  await waitReady(page);
  const t = Number(opt('t', 7.5));
  const files = [];
  for (const [name, st] of [
    ['idle', {}],
    ['hover', { hover: 1, pointer: [0.35, 0.0] }],
    ['scroll-50', { scroll: 0.5 }],
    ['scroll-100', { scroll: 1 }],
  ]) {
    await page.evaluate(([tt, s]) => window.__hero.renderAt(tt, s), [t, st]);
    await page.waitForTimeout(400);
    const file = path.join(OUT, `state-${name}.png`);
    await page.screenshot({ path: file, clip: { x: 560, y: 40, width: 720, height: 640 } });
    files.push(file);
    console.log(file);
  }
  await browser.close();
  try {
    execFileSync('python3', [
      '-c',
      `
from PIL import Image, ImageDraw
names = ['Idle', 'Hover', 'Scroll 50%', 'Scroll 100%']
ims = [Image.open(f).convert('RGB').resize((480, 427)) for f in ${JSON.stringify(files)}]
W = Image.new('RGB', (960, 854))
d = ImageDraw.Draw(W)
for i, im in enumerate(ims):
    x, y = (i % 2) * 480, (i // 2) * 427
    W.paste(im, (x, y))
    d.text((x + 14, y + 12), names[i], fill=(220, 228, 240))
W.save(${JSON.stringify(path.join(OUT, 'states.png'))})
`,
    ]);
  } catch {
    console.log('(python3 + pillow not available: skipped the combined sheet)');
  }
}

// ---------------------------------------------------------------------------
async function poster() {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const t = opt('t', '7.5');
  await page.goto(url(`poster&t=${t}`), { waitUntil: 'load' });
  await waitReady(page);
  await page.waitForTimeout(500);
  const png = path.join(OUT, 'poster-1600.png');
  await page.locator('.hero__canvas').screenshot({ path: png });
  await browser.close();
  const dest = path.resolve('public/assets/posters');
  fs.mkdirSync(dest, { recursive: true });
  execFileSync('python3', [
    '-c',
    `
from PIL import Image
im = Image.open(${JSON.stringify(png)}).convert('RGB')
im.save(${JSON.stringify(path.join(dest, 'hero-poster-1600.webp'))}, quality=80, method=6)
im.resize((800, 600), Image.LANCZOS).save(${JSON.stringify(path.join(dest, 'hero-poster-800.webp'))}, quality=78, method=6)
`,
  ]);
  for (const f of fs.readdirSync(dest)) console.log(`${f}: ${(fs.statSync(path.join(dest, f)).size / 1024).toFixed(0)} KB`);
}

// ---------------------------------------------------------------------------
async function record() {
  const w = Number(opt('width', 1280));
  const h = Number(opt('height', 720));
  const fps = Number(opt('fps', 30));
  const seconds = Number(opt('seconds', 8));
  const start = Number(opt('start', 4));
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url(`capture&quality=${opt('quality', 'high')}`), { waitUntil: 'load' });
  await waitReady(page);
  const dir = path.join(OUT, 'frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(seconds * fps);
  // Script: idle, then pointer drifts in and hovers the sculpture, then leaves.
  for (let i = 0; i < n; i++) {
    const t = start + i / fps;
    const k = i / n;
    const hover = k > 0.45 && k < 0.8 ? Math.min(1, (k - 0.45) * 8) * Math.min(1, (0.8 - k) * 8) : 0;
    const px = Math.sin(k * Math.PI) * 0.35;
    await page.evaluate(([tt, hv, x]) => window.__hero.renderAt(tt, { hover: hv, pointer: [x, 0.05] }), [t, hover, px]);
    await page.locator('.hero').screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`) });
    if (i % 30 === 0) console.log(`frame ${i}/${n}`);
  }
  await browser.close();
  const ffmpeg = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  const mp4 = path.join(OUT, 'hero-motion.mp4');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  console.log(`wrote ${mp4} (${(fs.statSync(mp4).size / 1024).toFixed(0)} KB)`);
}

// ---------------------------------------------------------------------------
async function perf() {
  const browser = await launch();
  const seconds = Number(opt('seconds', 12));
  const results = [];
  for (const [label, viewport, tier] of [
    ['desktop 1440x900', { width: 1440, height: 900 }, 'high'],
    ['desktop 1440x900', { width: 1440, height: 900 }, 'medium'],
    ['desktop 1440x900', { width: 1440, height: 900 }, 'low'],
    ['mobile 390x844', { width: 390, height: 844 }, 'low'],
  ]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(url(`perf&quality=${tier}`), { waitUntil: 'load' });
    await waitReady(page);
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      window.__hero.stats.frameTimes.length = 0;
      window.__hero.stats.cpuTimes.length = 0;
    });
    await page.waitForTimeout(seconds * 1000);
    const s = await page.evaluate(() => ({ ...window.__hero.stats, frameTimes: [...window.__hero.stats.frameTimes], cpuTimes: [...window.__hero.stats.cpuTimes] }));
    const ft = s.frameTimes.sort((a, b) => a - b);
    const ct = s.cpuTimes.sort((a, b) => a - b);
    const q = (arr, k) => arr[Math.min(arr.length - 1, Math.floor(arr.length * k))];
    const med = q(ft, 0.5);
    const r = {
      label, tier, frames: ft.length,
      medianFrameMs: +med.toFixed(1), p95FrameMs: +q(ft, 0.95).toFixed(1), fps: +(1000 / med).toFixed(1),
      medianCpuMs: +q(ct, 0.5).toFixed(2), p95CpuMs: +q(ct, 0.95).toFixed(2),
      drawCalls: s.drawCalls, triangles: s.triangles, dpr: s.pixelRatio, canvas: `${s.width}x${s.height}`,
    };
    results.push(r);
    console.log(JSON.stringify(r));
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(results, null, 2));
}

// ---------------------------------------------------------------------------
async function checks() {
  const report = [];
  const ok = (name, pass, detail = '') => {
    report.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // 1. Normal load: no console errors, nav links resolve, canvas never blocks clicks.
  {
    const browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const logs = [];
    collectConsole(page, logs);
    await page.goto(url(), { waitUntil: 'load' });
    const firstText = await page.locator('#hero-title').isVisible();
    ok('Hero text visible before 3D loads', firstText);
    const state = await waitReady(page);
    ok('Scene goes live', state === 'true', state);
    const pe = await page.evaluate(() => getComputedStyle(document.querySelector('.hero__canvas')).pointerEvents);
    ok('Canvas does not intercept pointer events', pe === 'none', pe);
    for (const href of ['#work', '#about', '#contact']) {
      const exists = await page.evaluate((h) => !!document.querySelector(h), href);
      ok(`Link target ${href} exists`, exists);
    }
    await page.locator('.hero__actions a', { hasText: 'View projects' }).click();
    const scrolled = await page
      .waitForFunction(() => Math.abs(document.querySelector('#work').getBoundingClientRect().top) < 40, null, { timeout: 15000 })
      .then(() => true, () => false);
    const workTop = await page.evaluate(() => Math.round(document.querySelector('#work').getBoundingClientRect().top));
    ok('“View projects” scrolls to #work', scrolled, `top=${workTop} hash=${await page.evaluate(() => location.hash)}`);
    // Scroll back up and resize.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(600);
    await page.setViewportSize({ width: 600, height: 900 });
    await page
      .waitForFunction(() => document.querySelector('.hero__canvas').width === Math.round(innerWidth * Math.min(devicePixelRatio, 1.75)), null, { timeout: 20000 })
      .catch(() => {});
    const size = await page.evaluate(() => {
      const c = document.querySelector('.hero__canvas');
      const r = c.getBoundingClientRect();
      return { cw: c.width, rw: Math.round(r.width), sw: document.documentElement.scrollWidth, vw: innerWidth };
    });
    ok('Canvas drawing buffer follows resize', size.cw === size.vw && size.rw === size.vw, JSON.stringify(size));
    ok('No horizontal overflow after resize', size.sw <= size.vw, JSON.stringify(size));
    // Keyboard: tab order reaches the motion toggle and it toggles.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.focus('[data-motion-toggle]');
    await page.keyboard.press('Enter');
    const label = await page.locator('[data-motion-label]').textContent();
    ok('Motion toggle works from keyboard', label === 'Play motion', label);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(300);
    const label2 = await page.locator('[data-motion-label]').textContent();
    ok('Motion choice remembered for the session', label2 === 'Play motion', label2);
    ok('No console errors', logs.filter((l) => !l.includes('GPU stall') && !l.includes('WebGL')).length === 0, logs.join(' | '));
    await page.screenshot({ path: path.join(OUT, 'check-paused.png') });
    await browser.close();
  }

  // 2. Reduced motion: poster only, content intact, toggle offers opt-in.
  {
    const browser = await launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(url(), { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.hero__poster')).opacity === '1', null, { timeout: 5000 }).catch(() => {});
    const canvas = await page.locator('.hero__canvas').count();
    const posterVis = await page.evaluate(() => getComputedStyle(document.querySelector('.hero__poster')).opacity);
    const label = await page.locator('[data-motion-label]').textContent();
    ok('Reduced motion: no live canvas', canvas === 0);
    ok('Reduced motion: poster shown', posterVis === '1', `opacity=${posterVis}`);
    ok('Reduced motion: toggle offers “Play motion”', label === 'Play motion', label);
    await page.screenshot({ path: path.join(OUT, 'check-reduced-motion.png') });
    await browser.close();
  }

  // 3. Asset failure: textures 404 → poster retained, no blank hero.
  {
    const browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/assets/textures/**', (r) => r.fulfill({ status: 404, body: 'missing' }));
    await page.goto(url(), { waitUntil: 'load' });
    const state = await waitReady(page);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.hero__poster')).opacity === '1', null, { timeout: 5000 }).catch(() => {});
    const posterVis = await page.evaluate(() => getComputedStyle(document.querySelector('.hero__poster')).opacity);
    const canvas = await page.locator('.hero__canvas').count();
    ok('Asset failure → fallback state', state === 'fallback', state);
    ok('Asset failure → poster kept, no canvas', posterVis === '1' && canvas === 0, `opacity=${posterVis} canvas=${canvas}`);
    await page.screenshot({ path: path.join(OUT, 'check-asset-failure.png') });
    await browser.close();
  }

  // 4. No WebGL at all.
  {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--disable-webgl', '--disable-3d-apis'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url(), { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => document.querySelector('[data-hero]').dataset.scene);
    const toggleHidden = await page.locator('[data-motion-toggle]').isHidden();
    ok('No WebGL → unsupported state with poster', state === 'unsupported', state);
    ok('No WebGL → motion toggle hidden', toggleHidden);
    await page.screenshot({ path: path.join(OUT, 'check-no-webgl.png') });
    await browser.close();
  }

  // 5. Mobile: touch scrolling works, no overflow, no hover effects.
  {
    const browser = await launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(url(), { waitUntil: 'load' });
    await waitReady(page);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok('Mobile: no horizontal overflow', sw[0] <= sw[1], JSON.stringify(sw));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.synthesizeScrollGesture', { x: 200, y: 600, yDistance: -500, speed: 1200, gestureSource: 'touch' });
    await page.waitForTimeout(500);
    const y = await page.evaluate(() => scrollY);
    ok('Mobile: touch scroll moves the page', y > 200, `scrollY=${y}`);
    await browser.close();
  }

  fs.writeFileSync(path.join(OUT, 'checks.json'), JSON.stringify(report, null, 2));
  if (report.some((r) => !r.pass)) process.exitCode = 1;
}

const tasks = { shots, states, poster, record, perf, checks };
if (!tasks[task]) {
  console.error(`Unknown task "${task}". Use one of: ${Object.keys(tasks).join(', ')}`);
  process.exit(1);
}
await tasks[task]();
