/**
 * The compositor: images as premultiplied float RGBA, bilinear drawing into an N×N frame, the
 * frame's finish (light, ambient grading, vignette) and the ffmpeg encoder. Local only.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "../root";
import { FILM, easeInOutSine, lerp, type Rect } from "./camera";
import type { Ambient } from "./motion";

export const FFMPEG = process.env.FFMPEG ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");

/** A public URL ("/stories/…?v=hash") → its file under public/. */
export const fileOf = (url: string) => join(ROOT, "public", url.split("?")[0]);

export interface Img {
  w: number;
  h: number;
  /** Premultiplied RGBA, 0..1. */
  px: Float32Array;
}

export async function load(file: string | Buffer, maxSide?: number, blur?: number): Promise<Img> {
  const sharp = (await import("sharp")).default;
  let img = sharp(file).ensureAlpha();
  if (maxSide) img = img.resize(maxSide, maxSide, { fit: "inside", kernel: "lanczos3" });
  if (blur) img = img.blur(blur);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const px = new Float32Array(info.width * info.height * 4);
  for (let i = 0; i < px.length; i += 4) {
    const a = data[i + 3] / 255;
    px[i] = (data[i] / 255) * a;
    px[i + 1] = (data[i + 1] / 255) * a;
    px[i + 2] = (data[i + 2] / 255) * a;
    px[i + 3] = a;
  }
  return { w: info.width, h: info.height, px };
}

/** Draw `src` into the N×N premultiplied RGB frame `dst` over rectangle r (frame units), bilinear, with opacity. */
export function draw(dst: Float32Array, N: number, src: Img, r: Rect, opacity = 1) {
  const x0 = Math.max(0, Math.floor(r.left * N)), x1 = Math.min(N, Math.ceil((r.left + r.width) * N));
  const y0 = Math.max(0, Math.floor(r.top * N)), y1 = Math.min(N, Math.ceil((r.top + r.height) * N));
  const sx = src.w / (r.width * N), sy = src.h / (r.height * N);
  const ox = r.left * N, oy = r.top * N;
  const { px, w, h } = src;
  for (let y = y0; y < y1; y++) {
    const v = (y + 0.5 - oy) * sy - 0.5;
    if (v < -0.5 || v > h - 0.5) continue;
    const vy = Math.min(h - 1, Math.max(0, v));
    const j0 = Math.floor(vy), j1 = Math.min(h - 1, j0 + 1), fy = vy - j0;
    for (let x = x0; x < x1; x++) {
      const u = (x + 0.5 - ox) * sx - 0.5;
      if (u < -0.5 || u > w - 0.5) continue;
      const ux = Math.min(w - 1, Math.max(0, u));
      const i0 = Math.floor(ux), i1 = Math.min(w - 1, i0 + 1), fx = ux - i0;
      const a = (j0 * w + i0) * 4, b = (j0 * w + i1) * 4, c = (j1 * w + i0) * 4, d = (j1 * w + i1) * 4;
      const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
      const al = (px[a + 3] * wa + px[b + 3] * wb + px[c + 3] * wc + px[d + 3] * wd) * opacity;
      if (al <= 0) continue;
      const o = (y * N + x) * 3;
      const k = 1 - al;
      dst[o] = dst[o] * k + (px[a] * wa + px[b] * wb + px[c] * wc + px[d] * wd) * opacity;
      dst[o + 1] = dst[o + 1] * k + (px[a + 1] * wa + px[b + 1] * wb + px[c + 1] * wc + px[d + 1] * wd) * opacity;
      dst[o + 2] = dst[o + 2] * k + (px[a + 2] * wa + px[b + 2] * wb + px[c + 2] * wc + px[d + 2] * wd) * opacity;
    }
  }
}

/** Vignette multiplier, darker toward the corners. */
export function vignette(N: number, strength: number) {
  const m = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) / Math.SQRT1_2;
      m[y * N + x] = 1 - strength * r ** 2.4;
    }
  return m;
}

/** Finish a frame: soft warm light passing across (screen blend), vignette, to 8-bit RGB. */
export function finish(frame: Float32Array, N: number, vig: Float32Array, t: number, out: Buffer, f = FILM) {
  const lx = lerp(0.15, 0.85, easeInOutSine(t)), ly = 0.28;
  const inv = 1 / (2 * 0.32 * 0.32);
  const warm = [1, 0.9, 0.72];
  for (let y = 0; y < N; y++) {
    const dy = (y + 0.5) / N - ly;
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - lx;
      const g = f.light * Math.exp(-(dx * dx + dy * dy) * inv);
      const i = y * N + x, o = i * 3;
      for (let c = 0; c < 3; c++) {
        const v = 1 - (1 - frame[o + c]) * (1 - g * warm[c]);
        out[o + c] = Math.max(0, Math.min(255, Math.round(v * vig[i] * 255)));
      }
    }
  }
}

/**
 * Soft dot over the RGB frame. The colour reads against what is under it: a light speck on dark
 * paper, an ink speck on light paper (most plates are printed on pale stock).
 */
function mote(frame: Float32Array, N: number, cx: number, cy: number, radius: number, light: number[], dark: number[], alpha: number) {
  const ix = Math.min(N - 1, Math.max(0, Math.round(cx))), iy = Math.min(N - 1, Math.max(0, Math.round(cy)));
  const o0 = (iy * N + ix) * 3;
  const rgb = 0.3 * frame[o0] + 0.59 * frame[o0 + 1] + 0.11 * frame[o0 + 2] > 0.6 ? dark : light;
  const r = Math.ceil(radius * 2);
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(N - 1, Math.ceil(cy + r));
  const inv = 1 / (2 * radius * radius);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const g = alpha * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) * inv);
      if (g < 0.003) continue;
      const o = (y * N + x) * 3;
      for (let c = 0; c < 3; c++) frame[o + c] = frame[o + c] * (1 - g) + rgb[c] * g;
    }
}

export interface Particle {
  x: number;
  y: number;
  r: number;
  a: number;
  ph: number;
}

/** Draw the plan's ambient particles (dust, rain) onto the frame before it is finished. */
export function particles(frame: Float32Array, N: number, ambient: Ambient, set: Particle[], t: number) {
  if (ambient === "dust")
    for (const p of set) {
      const x = ((p.x + 0.015 * Math.sin(2 * Math.PI * (t + p.ph))) % 1) * N;
      const y = (((p.y - 0.1 * t) % 1) + 1) % 1;
      const twinkle = 0.6 + 0.4 * Math.sin(2 * Math.PI * (2 * t + p.ph));
      mote(frame, N, x, y * N, p.r * 1.4, [1, 0.96, 0.86], [0.32, 0.27, 0.22], p.a * twinkle * 1.6);
    }
  else if (ambient === "rain")
    for (const p of set) {
      // Streaks fall the full frame height about 1.5 times over the clip, slanting slightly.
      const y0 = (((p.y + 1.5 * t) % 1.2) - 0.1) * N, x0 = (p.x + 0.12 * t) * N;
      const len = 0.035 * N * (0.6 + p.r / 3);
      for (let s = 0; s < len; s += 1.2) mote(frame, N, (x0 + s * 0.2) % N, y0 + s, 0.8, [0.86, 0.9, 0.95], [0.36, 0.42, 0.5], p.a * 1.1);
    }
}

/** Finish a directed frame: light, ambient grading, vignette, to 8-bit RGB. */
export function finishPlanned(frame: Float32Array, N: number, vig: Float32Array, t: number, out: Buffer, ambient: Ambient, f = FILM) {
  const sweep = ambient === "light-sweep";
  const lx = sweep ? lerp(-0.1, 1.1, easeInOutSine(t)) : lerp(0.15, 0.85, easeInOutSine(t)), ly = sweep ? 0.35 : 0.28;
  const radius = sweep ? 0.22 : 0.32;
  const inv = 1 / (2 * radius * radius);
  const strength = sweep ? 0.16 : f.light;
  const warm = [1, 0.9, 0.72];
  const phase = 2 * Math.PI * t, period = 9;
  for (let y = 0; y < N; y++) {
    const dy = (y + 0.5) / N - ly;
    const hazeY = ambient === "haze" ? 0.1 * Math.exp(-(((y + 0.5) / N - lerp(0.75, 0.55, t)) ** 2) / 0.02) : 0;
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - lx;
      const g = strength * Math.exp(-(sweep ? dx * dx * 0.5 + dy * dy * 2 : dx * dx + dy * dy) * inv) + hazeY;
      const i = y * N + x, o = i * 3;
      const ht = ambient === "halftone-shimmer" ? 1 + 0.035 * Math.cos((2 * Math.PI * x) / period + phase) * Math.cos((2 * Math.PI * y) / period - phase) : 1;
      for (let c = 0; c < 3; c++) {
        const v = (1 - (1 - frame[o + c]) * (1 - g * warm[c])) * ht;
        out[o + c] = Math.max(0, Math.min(255, Math.round(v * vig[i] * 255)));
      }
    }
  }
}

/** An ffmpeg H.264 encoder fed raw RGB frames: every frame a keyframe, so any scroll position seeks instantly. */
export function encoder(mp4: string, N: number, f = FILM) {
  const ff = spawn(FFMPEG, [
    "-y", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${N}x${N}`, "-r", String(f.fps), "-i", "-",
    "-an", "-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", String(f.crf),
    "-g", "1", "-keyint_min", "1", "-sc_threshold", "0", "-bf", "0",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((res, rej) => ff.on("close", (code) => (code ? rej(new Error(`ffmpeg exited ${code}`)) : res())));
  return {
    async write(frame: Buffer) {
      if (!ff.stdin.write(frame)) await new Promise((r) => ff.stdin.once("drain", r));
    },
    async close() {
      ff.stdin.end();
      await done;
      const bytes = await readFile(mp4);
      return { bytes: bytes.length, hash: createHash("sha1").update(bytes).digest("hex").slice(0, 8) };
    },
  };
}

/** Encode frames, raising CRF if the film comes out over the size budget (the site loads the whole clip). */
export async function encodeSized(mp4: string, frames: Buffer[], N: number, f = FILM, maxBytes = 3.3e6) {
  let r = { bytes: 0, hash: "" }, crf = f.crf;
  for (; crf <= f.crf + 6; crf += 2) {
    const enc = encoder(mp4, N, { ...f, crf });
    for (const fr of frames) await enc.write(fr);
    r = await enc.close();
    if (r.bytes <= maxBytes) break;
  }
  return { ...r, crf: Math.min(crf, f.crf + 6) };
}
