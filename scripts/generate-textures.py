#!/usr/bin/env python3
"""
Generate the tileable stone texture set and the shader noise texture used by the
hero scene.

These are *procedural stand-ins* for a scanned / hand-authored basalt texture set.
They are fully tileable (all noise is built in the frequency domain, so it wraps)
and are sampled triplanar by the stone shader, so the monolith does not need UVs.

Outputs (committed to the repo, regenerate with `npm run textures`):

  public/assets/textures/desktop/stone_albedo.webp   1024^2  sRGB base colour
  public/assets/textures/desktop/stone_normal.webp   1024^2  tangent-space normal (OpenGL, +Y up)
  public/assets/textures/desktop/stone_orm.webp      1024^2  R = AO, G = roughness, B = metalness (0)
  public/assets/textures/mobile/*                    512^2   same set, downsampled
  public/assets/textures/noise_rgba.png              256^2   linear shader noise (R smooth, G mid, B ridged, A fine)

Requires: numpy, pillow  (pip install numpy pillow)
"""
from __future__ import annotations

import os
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "public", "assets", "textures")
RNG = np.random.default_rng(20260924)


# --------------------------------------------------------------------------- helpers
def freq_grid(n: int) -> np.ndarray:
    f = np.fft.fftfreq(n) * n
    fx, fy = np.meshgrid(f, f)
    return np.sqrt(fx * fx + fy * fy)


def spectral_noise(n: int, lo: float, hi: float, beta: float) -> np.ndarray:
    """Periodic band-limited 1/f^beta noise, normalised to zero mean / unit std."""
    white = RNG.standard_normal((n, n))
    spec = np.fft.fft2(white)
    f = freq_grid(n)
    f[0, 0] = 1.0
    amp = f ** (-beta / 2.0)
    band = np.clip((f - lo) / max(lo * 0.5, 1.0), 0, 1) * np.clip((hi - f) / max(hi * 0.25, 1.0), 0, 1)
    out = np.real(np.fft.ifft2(spec * amp * band))
    out -= out.mean()
    return out / (out.std() + 1e-8)


def blur(img: np.ndarray, sigma: float) -> np.ndarray:
    """Periodic gaussian blur in the frequency domain."""
    n = img.shape[0]
    f = np.fft.fftfreq(n)
    fx, fy = np.meshgrid(f, f)
    g = np.exp(-2.0 * (np.pi ** 2) * (sigma ** 2) * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(img) * g))


def worley_f1(n: int, cells: int) -> np.ndarray:
    """Periodic Worley F1 distance (in cell units) using a jittered grid."""
    pts = RNG.random((cells, cells, 2))
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float64)
    u = xs / n * cells
    v = ys / n * cells
    ci = np.floor(u).astype(int)
    cj = np.floor(v).astype(int)
    best = np.full((n, n), 10.0)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ni = ci + di
            nj = cj + dj
            p = pts[nj % cells, ni % cells]
            px = ni + p[..., 0]
            py = nj + p[..., 1]
            d = np.sqrt((u - px) ** 2 + (v - py) ** 2)
            best = np.minimum(best, d)
    return best


def norm01(a: np.ndarray) -> np.ndarray:
    lo, hi = np.percentile(a, 0.5), np.percentile(a, 99.5)
    return np.clip((a - lo) / (hi - lo + 1e-8), 0, 1)


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def save(img: np.ndarray, path: str, mode: str = "RGB", **kw) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    arr = np.clip(img * 255.0 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(arr, mode).save(path, **kw)
    print(f"  wrote {os.path.relpath(path, ROOT)}  ({os.path.getsize(path) / 1024:.0f} KB)")


# --------------------------------------------------------------------------- stone
def build_stone(n: int = 1024):
    macro = spectral_noise(n, 1, 10, 2.2)
    mid = spectral_noise(n, 6, 48, 1.6)
    fine = spectral_noise(n, 40, 360, 0.9)
    grain = spectral_noise(n, 180, 512, 0.2)

    # Crack network: zero-crossings of mid-frequency noise, thin and slightly wobbly.
    crack_src = spectral_noise(n, 3, 18, 1.8) + 0.25 * spectral_noise(n, 20, 60, 1.2)
    cracks = np.exp(-np.abs(crack_src) * 11.0)
    cracks *= smoothstep(-0.2, 0.9, spectral_noise(n, 1, 6, 2.0))  # cracks come and go

    # Vesicles / pores typical of basalt: small Worley pits of varied size.
    pores_a = 1.0 - smoothstep(0.08, 0.2, worley_f1(n, 48))
    pores_b = 1.0 - smoothstep(0.05, 0.14, worley_f1(n, 110))
    pores = np.clip(pores_a * 0.8 + pores_b * 0.6, 0, 1)
    pores *= smoothstep(-0.6, 0.8, spectral_noise(n, 2, 12, 2.0))  # clustered, not uniform

    # Faceted, flaky mid-scale relief (terraced to feel like chipped strata).
    flakes = np.floor(norm01(mid) * 6.0) / 6.0
    flakes = blur(flakes, 1.2)

    h = (
        0.42 * norm01(macro)
        + 0.22 * flakes
        + 0.16 * norm01(mid)
        + 0.10 * norm01(fine)
        + 0.03 * norm01(grain)
        - 0.30 * cracks
        - 0.26 * pores
    )
    h = norm01(h)

    # Normal map (tangent space, OpenGL / +Y up; rows run downward in the image).
    strength = 5.5
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * n / 256.0
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * n / 256.0
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5

    # Ambient occlusion from cavity (small + medium scale).
    cav_s = h - blur(h, 3.0)
    cav_m = h - blur(h, 14.0)
    ao = np.clip(1.0 + cav_s * 3.2 + cav_m * 1.6, 0.28, 1.0)
    ao = np.clip(ao - cracks * 0.35 - pores * 0.3, 0.18, 1.0)

    # Roughness: basalt is matte; a few mineral flecks catch highlights.
    flecks = smoothstep(2.1, 2.9, spectral_noise(n, 120, 512, 0.0)) * smoothstep(-0.2, 0.6, norm01(macro) - 0.3)
    rough = 0.84 + 0.08 * (norm01(fine) - 0.5) - 0.1 * norm01(macro) * 0.5
    rough = np.clip(rough - flecks * 0.5 + cracks * 0.08, 0.22, 1.0)

    # Albedo: cool charcoal with subtle tonal variation, darker in recesses.
    dark = np.array([0.070, 0.078, 0.092])
    mid_c = np.array([0.150, 0.160, 0.178])
    cool = np.array([0.105, 0.128, 0.160])
    t = norm01(macro * 0.7 + mid * 0.3)[..., None]
    col = dark * (1 - t) + mid_c * t
    tint = smoothstep(0.2, 1.4, spectral_noise(n, 2, 10, 2.0))[..., None]
    col = col * (1 - tint * 0.45) + cool * (tint * 0.45)
    col *= (0.82 + 0.3 * norm01(fine))[..., None]
    col *= (0.55 + 0.45 * ao)[..., None]
    col += flecks[..., None] * np.array([0.10, 0.11, 0.13])
    albedo = np.clip(col, 0, 1) ** (1 / 2.2)  # linear-ish values -> sRGB

    orm = np.stack([ao, rough, np.zeros_like(h)], axis=-1)
    return albedo, normal, orm


def build_noise(n: int = 256) -> np.ndarray:
    r = norm01(spectral_noise(n, 1, 8, 2.0))
    g = norm01(spectral_noise(n, 4, 28, 1.4))
    ridge = np.abs(spectral_noise(n, 3, 16, 1.6))
    b = norm01(1.0 - np.clip(ridge, 0, 2.5) / 2.5) ** 2.2
    a = norm01(spectral_noise(n, 20, 128, 0.6))
    return np.stack([r, g, b, a], axis=-1)


def main() -> None:
    print("Generating stone textures (1024^2)…")
    albedo, normal, orm = build_stone(1024)
    d = os.path.join(OUT, "desktop")
    m = os.path.join(OUT, "mobile")
    save(albedo, os.path.join(d, "stone_albedo.webp"), quality=86, method=6)
    save(normal, os.path.join(d, "stone_normal.webp"), quality=92, method=6)
    save(orm, os.path.join(d, "stone_orm.webp"), quality=88, method=6)

    print("Downsampling mobile set (512^2)…")
    for name, q in (("stone_albedo", 84), ("stone_normal", 90), ("stone_orm", 86)):
        img = Image.open(os.path.join(d, f"{name}.webp")).convert("RGB").resize((512, 512), Image.LANCZOS)
        os.makedirs(m, exist_ok=True)
        p = os.path.join(m, f"{name}.webp")
        img.save(p, quality=q, method=6)
        print(f"  wrote {os.path.relpath(p, ROOT)}  ({os.path.getsize(p) / 1024:.0f} KB)")

    print("Generating shader noise (256^2 RGBA)…")
    save(build_noise(256), os.path.join(OUT, "noise_rgba.png"), mode="RGBA", optimize=True)


if __name__ == "__main__":
    main()
