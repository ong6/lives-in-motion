/**
 * pnpm video <slug> [--scenes s1,s4] [--dry]   (--dry renders but leaves story.json alone)
 *
 * Renders each illustrated scene as a short 2.5D film the site scrubs with scroll: a virtual
 * camera pushes in and trucks sideways, every layer moves by its own depth (the clean background
 * far, the SAM 3.1 cut-outs near), the subject settles into place, and a soft light passes over
 * a vignette. Scenes without cut-outs get a slow push-in on the plate alone. Line-treatment scenes
 * film their line drawing drawing itself while the plate develops underneath it. Everything is local
 * (node + sharp to decode, a small compositor here, ffmpeg to encode): no paid calls.
 *
 * A scene with a motion.json (written by `pnpm wonder`, Muse Wonder's motion plan) is filmed from
 * that plan instead: its camera path, a move per SAM layer and one ambient effect (see
 * "Directed films" below).
 *
 * Output per scene: public/stories/<slug>/<sN>/scene.mp4 (H.264, every frame a keyframe so any
 * scroll position seeks instantly) and scene.jpg (first frame, the poster). The scene's `video`
 * and `poster` URLs are written into story.json by a read-modify-write of the raw file.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Story, type Scene } from "../lib/schema";
import { eraFor } from "../lib/eras";
import { ROOT } from "./root";

const FFMPEG = process.env.FFMPEG ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");

/** Film settings. Scroll maps 0..1 onto the whole clip, so fps only sets how finely it scrubs. */
export const FILM = {
  size: 960,
  fps: 24,
  seconds: 3.5,
  /** Camera travel toward the scene, in units where the nearest layer sits at distance 1. */
  push: 0.2,
  /** Sideways camera travel each way, as a fraction of the frame at distance 1. */
  truck: 0.06,
  /** Subject settle: starts this far low (fraction of frame) and this much smaller. */
  settleDrop: 0.012,
  settleShrink: 0.015,
  /** Fraction of the clip the settle takes. */
  settleSpan: 0.4,
  /** Depth given to the plate when it is the only layer, so the push-in reads. */
  plateDepth: 0.55,
  vignette: 0.28,
  light: 0.07,
  crf: 28,
};

// ---------- Timing curves (pure) ----------

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const easeInOutSine = (t: number) => (1 - Math.cos(Math.PI * clamp01(t))) / 2;
export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Distance of a layer from the camera at rest: depth 1 (near) is 1, depth 0 (far) is 3.5. */
export const distance = (depth: number) => 1 + 2.5 * (1 - clamp01(depth));

export interface Camera {
  /** Forward travel. */
  z: number;
  /** Sideways travel (screen fraction at distance 1). */
  x: number;
  /** Subject settle, 1 at the start falling to 0. */
  settle: number;
  /** Vertical travel (screen fraction at distance 1); only directed films use it. */
  y?: number;
}

/**
 * The camera at clip time t (0..1). Mostly an ease-in-out so each scene opens and closes on a
 * near-still frame, with a little linear travel mixed in so scroll never feels dead mid-scene.
 * `dir` is ±1, the side the camera trucks toward.
 */
export function cameraAt(t: number, dir: 1 | -1 = 1, f = FILM): Camera {
  const travel = 0.2 * clamp01(t) + 0.8 * easeInOutSine(t);
  return {
    z: f.push * travel,
    x: dir * f.truck * (travel * 2 - 1),
    settle: 1 - easeOutCubic(t / f.settleSpan),
  };
}

// ---------- Placement (pure) ----------

/** A rectangle in frame units (0..1 is the whole square frame). */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a rectangle at `depth` lands on screen. The camera moves forward by cam.z (things at
 * distance Z grow by Z / (Z - z), about the focal point) and sideways by cam.x (things shift by
 * x / Z, so near layers slide further). `lens` is a fixed zoom about the frame centre that gives
 * the far layers enough overscan to keep the frame covered.
 */
export function project(r: Rect, depth: number, cam: Camera, focal: { x: number; y: number }, lens = 1): Rect {
  const Z = distance(depth);
  const s = Z / (Z - cam.z);
  const shift = -cam.x / Z;
  const shiftY = -(cam.y ?? 0) / Z;
  const map = (v: number, f: number, sh: number) => 0.5 + lens * (f + (v - f + sh) * s - 0.5);
  const left = map(r.left, focal.x, shift);
  const top = map(r.top, focal.y, shiftY);
  return { left, top, width: r.width * s * lens, height: r.height * s * lens };
}

export const covers = (r: Rect, eps = 1e-9) => r.left <= eps && r.top <= eps && r.left + r.width >= 1 - eps && r.top + r.height >= 1 - eps;

/** The smallest lens zoom (≥ 1) that keeps a full-frame layer at `depth` covering the frame for the whole clip. */
export function lensFor(depth: number, dir: 1 | -1, focal: { x: number; y: number }, f = FILM, steps = 60): number {
  return lensForPath(depth, Array.from({ length: steps + 1 }, (_, i) => cameraAt(i / steps, dir, f)), focal);
}

/** The same for any camera path, given as samples. */
export function lensForPath(depth: number, cams: Camera[], focal: { x: number; y: number }): number {
  const full = { left: 0, top: 0, width: 1, height: 1 };
  let need = 1;
  for (const cam of cams) {
    const r = project(full, depth, cam, focal, 1);
    // Zooming by L about the centre maps an edge e to 0.5 + L (e - 0.5); solve for each edge.
    const right = r.left + r.width, bottom = r.top + r.height;
    if (r.left > 0) need = Math.max(need, 0.5 / (0.5 - r.left));
    if (r.top > 0) need = Math.max(need, 0.5 / (0.5 - r.top));
    if (right < 1) need = Math.max(need, 0.5 / (right - 0.5));
    if (bottom < 1) need = Math.max(need, 0.5 / (bottom - 0.5));
  }
  return need * 1.002;
}

/** Subject settle on top of the camera: a small rise and grow into place about `anchor` (the subject's foot). */
export function settled(r: Rect, settle: number, anchor: { x: number; y: number }, f = FILM): Rect {
  const k = 1 - f.settleShrink * settle;
  return {
    left: anchor.x + (r.left - anchor.x) * k,
    top: anchor.y + (r.top - anchor.y) * k + f.settleDrop * settle,
    width: r.width * k,
    height: r.height * k,
  };
}

export interface Plan {
  /** The plate (full-size PNG when there is one). */
  plate: string;
  /** Clean background (the plate with the cut objects removed); null films the plate alone. */
  clean: string | null;
  /** Depth the separated subject moves at. */
  depth: number;
  /** Side the camera trucks toward when there is no subject to decide it. */
  dir: 1 | -1;
}

/** What to film for a scene, from what exists on disk; null when there is no plate. */
export function planScene(scene: Scene, exists: (url: string) => boolean): Plan | null {
  const png = scene.plate?.replace(/\.webp$/, ".png");
  const plate = png && exists(png) ? png : scene.plate && exists(scene.plate) ? scene.plate : null;
  if (!plate) return null;
  const cuts = scene.layers.filter((l) => l.src && exists(l.src));
  const clean = cuts.length && scene.background && exists(scene.background) ? scene.background : null;
  const n = Number(scene.id.slice(1)) || 1;
  return { plate, clean, depth: clean ? Math.max(...cuts.map((l) => l.depth)) : FILM.plateDepth, dir: n % 2 ? 1 : -1 };
}

// ---------- Subject matte (pure) ----------
// The subject is whatever the clean background removed: plate and background differ there. This
// is exact to the clean plate by construction (so the hole it leaves is always covered) and does
// not depend on the SAM mask raster.

/** Box blur of a w×h single-channel image, radius r, two passes (close to a Gaussian). */
export function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice();
  let a = src.slice(), b = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[y * w + x] = sum / n;
        sum += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / n;
        sum += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

/** Holes the subject encloses (pixels that can't reach the border through background) become subject. */
export function fillEnclosed(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h), stack: number[] = [];
  const push = (i: number) => {
    if (!m[i] && !out[i]) {
      out[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
  for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!, x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return Uint8Array.from(out, (v) => 1 - v);
}

/**
 * Soft 0..1 matte from a per-pixel colour distance (0..441). Thresholds out the clean plate's
 * re-rendering noise, opens away thin edge lines, fills enclosed holes and feathers the edge.
 */
export function matteFromDiff(diff: Float32Array, w: number, h: number, threshold = 30): Float32Array {
  const r = Math.max(1, Math.round(w / 175));
  const hit = Float32Array.from(diff, (d) => (d >= threshold ? 1 : 0));
  const core = Float32Array.from(blur(hit, w, h, r), (v) => (v > 0.65 ? 1 : 0));
  const grown = Uint8Array.from(blur(core, w, h, r), (v) => (v > 0.12 ? 1 : 0));
  return blur(Float32Array.from(fillEnclosed(grown, w, h)), w, h, Math.max(1, r >> 2));
}

/** Bounding box (frame units) of the matte above `min`, or null if it covers almost nothing. */
export function bboxOf(m: Float32Array, w: number, h: number, min = 0.5, minArea = 0.002): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (m[y * w + x] > min) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (n < minArea * w * h) return null;
  return { left: x0 / w, top: y0 / h, width: (x1 + 1 - x0) / w, height: (y1 + 1 - y0) / h };
}

/** Push toward a point between the frame centre and the subject, so it stays framed; truck toward its side. */
export function aimAt(box: Rect) {
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  return { focal: { x: lerp(0.5, cx, 0.6), y: lerp(0.5, cy, 0.4) }, dir: (cx >= 0.5 ? 1 : -1) as 1 | -1 };
}

// ---------- Compositor ----------

interface Img {
  w: number;
  h: number;
  /** Premultiplied RGBA, 0..1. */
  px: Float32Array;
}

async function load(file: string | Buffer, maxSide?: number, blur?: number): Promise<Img> {
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
function draw(dst: Float32Array, N: number, src: Img, r: Rect, opacity = 1) {
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
function vignette(N: number, strength: number) {
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
function finish(frame: Float32Array, N: number, vig: Float32Array, t: number, out: Buffer, f = FILM) {
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

const fileOf = (url: string) => join(ROOT, "public", url.split("?")[0]);

/** Matte resolution: the plate/background difference is measured on a W×W grid. */
const MATTE = 700;

/** Soft matte of everything the clean background removed, on the MATTE grid. */
async function diffMatte(plateFile: string, cleanFile: string) {
  const sharp = (await import("sharp")).default;
  const W = MATTE;
  const rgb = (file: string) => sharp(file).removeAlpha().resize(W, W, { fit: "fill" }).blur(1.5).raw().toBuffer();
  const [a, b] = await Promise.all([rgb(plateFile), rgb(cleanFile)]);
  const diff = new Float32Array(W * W);
  for (let i = 0; i < diff.length; i++) diff[i] = Math.hypot(a[i * 3] - b[i * 3], a[i * 3 + 1] - b[i * 3 + 1], a[i * 3 + 2] - b[i * 3 + 2]);
  return matteFromDiff(diff, W, W);
}

/** Plate colours with a MATTE-grid alpha, as a side×side premultiplied image. */
async function cutOut(plateFile: string, m: Float32Array, side: number): Promise<Img> {
  const sharp = (await import("sharp")).default;
  const W = MATTE;
  const alpha = await sharp(Buffer.from(m.map((v) => Math.round(Math.min(1, v) * 255))), { raw: { width: W, height: W, channels: 1 } })
    .resize(side, side, { kernel: "cubic" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  const plate = await sharp(plateFile).removeAlpha().resize(side, side, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  const px = new Float32Array(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    const al = alpha[i] / 255;
    px[i * 4] = (plate[i * 3] / 255) * al;
    px[i * 4 + 1] = (plate[i * 3 + 1] / 255) * al;
    px[i * 4 + 2] = (plate[i * 3 + 2] / 255) * al;
    px[i * 4 + 3] = al;
  }
  return { w: side, h: side, px };
}

/** The subject as its own premultiplied image: plate colours with the difference matte as alpha. */
async function separate(plateFile: string, cleanFile: string, side: number) {
  const sharp = (await import("sharp")).default;
  const W = MATTE;
  const m = await diffMatte(plateFile, cleanFile);
  const box = bboxOf(m, W, W);
  if (!box) return null;
  const alpha = await sharp(Buffer.from(m.map((v) => Math.round(Math.min(1, v) * 255))), { raw: { width: W, height: W, channels: 1 } })
    .resize(side, side, { kernel: "cubic" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  const plate = await sharp(plateFile).removeAlpha().resize(side, side, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  const px = new Float32Array(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    const al = alpha[i] / 255;
    px[i * 4] = (plate[i * 3] / 255) * al;
    px[i * 4 + 1] = (plate[i * 3 + 1] / 255) * al;
    px[i * 4 + 2] = (plate[i * 3 + 2] / 255) * al;
    px[i * 4 + 3] = al;
  }
  return { img: { w: side, h: side, px } as Img, box };
}

/** Render and encode one scene. Returns what was filmed and the bytes written. */
export async function renderScene(slug: string, scene: Scene, plan: Plan, f = FILM) {
  const N = f.size, frames = Math.round(f.fps * f.seconds);
  const dir = join(ROOT, "public/stories", slug, scene.id);
  const side = Math.round(N * 1.25);
  const subject = plan.clean ? await separate(fileOf(plan.plate), fileOf(plan.clean), side) : null;
  const aim = subject ? aimAt(subject.box) : { focal: { x: 0.5, y: 0.5 }, dir: plan.dir };
  const backDepth = subject ? 0 : plan.depth;
  const lens = lensFor(backDepth, aim.dir, aim.focal, f);
  const back = await load(fileOf(subject ? plan.clean! : plan.plate), side);
  // A defocused copy of the background fades in as the camera closes on the subject.
  const soft = subject ? await load(fileOf(plan.clean!), side, 2.2) : null;
  const vig = vignette(N, f.vignette);
  const frame = new Float32Array(N * N * 3);
  const out = Buffer.alloc(N * N * 3);

  const mp4 = join(dir, "scene.mp4");
  const enc = encoder(mp4, N, f);

  const sharp = (await import("sharp")).default;
  const full = { left: 0, top: 0, width: 1, height: 1 };
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const cam = cameraAt(t, aim.dir, f);
    frame.fill(0);
    const br = project(full, backDepth, cam, aim.focal, lens);
    draw(frame, N, back, br);
    if (soft) draw(frame, N, soft, br, 0.5 * easeInOutSine(t));
    if (subject) {
      const b = project(subject.box, plan.depth, cam, aim.focal, lens);
      const foot = { x: b.left + b.width / 2, y: b.top + b.height };
      draw(frame, N, subject.img, settled(project(full, plan.depth, cam, aim.focal, lens), cam.settle, foot, f));
    }
    finish(frame, N, vig, t, out, f);
    if (i === 0) await sharp(out, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(dir, "scene.jpg"));
    await enc.write(out);
  }
  return { layered: Boolean(subject), ...(await enc.close()) };
}

/** An ffmpeg H.264 encoder fed raw RGB frames: every frame a keyframe, so any scroll position seeks instantly. */
function encoder(mp4: string, N: number, f = FILM) {
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

// ---------- Directed films ----------
// Muse Wonder (pipeline/wonder.ts) looks at a scene's plate and its SAM 3.1 layers and writes a
// motion plan: a keyframed camera, a move per layer and one ambient effect. The plan is stored at
// public/stories/<slug>/<sN>/motion.json and, when present, the film is rendered from it instead
// of the fixed move above. Everything a model writes passes through sanitizePlan (types, ranges,
// known layer ids) and fitPlan (no layer pushed off-frame, background always covers the frame).

export const AMBIENTS = ["none", "light-sweep", "dust", "halftone-shimmer", "rain", "haze"] as const;
export const EASES = ["linear", "in-out", "in", "out"] as const;
export const ENTRANCES = ["none", "fade", "rise", "settle", "scale-in"] as const;
export type Ambient = (typeof AMBIENTS)[number];
export type Ease = (typeof EASES)[number];
export type Entrance = (typeof ENTRANCES)[number];

/** The ranges the renderer accepts; anything outside is clamped. */
export const LIMITS = {
  keys: { min: 2, max: 6 },
  /** Camera magnification of the nearest layer (distance 1); far layers grow less. */
  zoom: { min: 1, max: 1.5 },
  /** Camera travel each way, as a fraction of the frame at distance 1. */
  pan: 0.12,
  /** Point the camera zooms about. */
  focus: { min: 0.2, max: 0.8 },
  depth: { min: 0.3, max: 1 },
  /** A layer's own travel over the clip, frame fractions. */
  drift: 0.08,
  /** A layer's scale at the end of the clip, about its foot. */
  scale: { min: 0.85, max: 1.2 },
  enterAt: { min: 0, max: 0.6 },
  enterFor: { min: 0.1, max: 0.5 },
  /** Every entrance has finished by this clip time. */
  enterEnd: 0.8,
  /** Keyframes closer than this are merged. */
  keyGap: 0.05,
  /** A layer may lose at most this much more of its area off-frame than it shows at rest. */
  offFrame: 0.1,
  /** Most overscan the background may need; past it the plate softens visibly. */
  lens: 1.15,
};

export interface CameraKey {
  t: number;
  zoom: number;
  panX: number;
  panY: number;
  /** Easing of the segment arriving at this key (ignored on the first key). */
  ease: Ease;
}

export interface LayerMove {
  id: string;
  depth: number;
  driftX: number;
  driftY: number;
  scale: number;
  enter: Entrance;
  enterAt: number;
  enterFor: number;
}

export interface MotionPlan {
  focusX: number;
  focusY: number;
  camera: CameraKey[];
  layers: LayerMove[];
  ambient: Ambient;
  rationale: string;
}

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
  return Math.min(hi, Math.max(lo, n));
};
const pick = <T extends string>(v: unknown, all: readonly T[], dflt: T): T => (all.includes(v as T) ? (v as T) : dflt);

/** The fixed-move equivalent, used for anything a plan leaves out. */
export const defaultCamera = (): CameraKey[] => [
  { t: 0, zoom: 1, panX: -0.04, panY: 0, ease: "linear" },
  { t: 1, zoom: 1.2, panX: 0.04, panY: 0, ease: "in-out" },
];

/**
 * Coerce whatever a model returned into a plan the renderer can draw: numbers clamped to LIMITS,
 * unknown enums replaced, keyframes sorted with the first at t=0 and the last at t=1, layer moves
 * only for layers that exist (each exactly once, missing ones filled with a still default).
 * Returns the plan and a list of what was changed.
 */
export function sanitizePlan(raw: unknown, layers: { id: string; depth: number }[]): { plan: MotionPlan; fixes: string[] } {
  const fixes: string[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const L = LIMITS;
  const clampNote = (name: string, v: unknown, out: number) => {
    if (typeof v !== "number" || Math.abs(v - out) > 1e-9) fixes.push(`${name} ${typeof v === "number" ? v.toFixed(3) : String(v)} → ${out.toFixed(3)}`);
    return out;
  };

  const rawKeys = (Array.isArray(r.camera) ? r.camera : []).filter((k: unknown) => k && typeof k === "object");
  // Models sometimes give key times in seconds (0, 1.75, 3.5) despite the schema: rescale those to 0..1.
  const tMax = Math.max(0, ...rawKeys.map((k: any) => (typeof k.t === "number" && Number.isFinite(k.t) ? k.t : 0)));
  const tScale = tMax > 1 && tMax <= 60 ? 1 / tMax : 1;
  if (tScale !== 1) fixes.push(`camera times rescaled from 0..${tMax} to 0..1`);
  let keys: CameraKey[] = rawKeys
    .map((k: any) => (typeof k.t === "number" ? { ...k, t: k.t * tScale } : k))
    .map((k: any, i: number) => ({
      t: clampNote(`camera[${i}].t`, k.t, num(k.t, 0, 1, 0)),
      zoom: clampNote(`camera[${i}].zoom`, k.zoom, num(k.zoom, L.zoom.min, L.zoom.max, 1)),
      panX: clampNote(`camera[${i}].panX`, k.panX, num(k.panX, -L.pan, L.pan, 0)),
      panY: clampNote(`camera[${i}].panY`, k.panY, num(k.panY, -L.pan, L.pan, 0)),
      ease: pick(k.ease, EASES, "in-out"),
    }))
    .sort((a: CameraKey, b: CameraKey) => a.t - b.t);
  const merged: CameraKey[] = [];
  for (const k of keys) {
    const last = merged[merged.length - 1];
    if (last && k.t - last.t < L.keyGap) {
      fixes.push(`camera key at t=${k.t.toFixed(2)} merged`);
      continue;
    }
    merged.push(k);
  }
  keys = merged;
  if (keys.length > L.keys.max) {
    fixes.push(`camera keys ${keys.length} → ${L.keys.max}`);
    keys = [...keys.slice(0, L.keys.max - 1), keys[keys.length - 1]];
  }
  if (keys.length < L.keys.min) {
    fixes.push("camera path missing: default move");
    keys = defaultCamera();
  }
  if (keys[0].t !== 0) (fixes.push("first camera key moved to t=0"), (keys[0] = { ...keys[0], t: 0 }));
  if (keys[keys.length - 1].t !== 1) (fixes.push("last camera key moved to t=1"), (keys[keys.length - 1] = { ...keys[keys.length - 1], t: 1 }));

  const given = new Map<string, any>();
  for (const m of Array.isArray(r.layers) ? r.layers : []) {
    if (!m || typeof m !== "object") continue;
    if (!layers.some((l) => l.id === m.id)) fixes.push(`unknown layer ${String(m.id)} dropped`);
    else if (given.has(m.id)) fixes.push(`duplicate layer ${m.id} dropped`);
    else given.set(m.id, m);
  }
  const moves: LayerMove[] = layers.map((l) => {
    const m = given.get(l.id);
    if (!m) {
      fixes.push(`layer ${l.id} missing: held still`);
      return { id: l.id, depth: num(l.depth, L.depth.min, L.depth.max, 0.6), driftX: 0, driftY: 0, scale: 1, enter: "none", enterAt: 0, enterFor: 0.3 };
    }
    const enter = pick(m.enter, ENTRANCES, "none");
    // Entrance timing only matters when there is an entrance; clamp it quietly otherwise.
    const note = enter === "none" ? (_: string, __: unknown, out: number) => out : clampNote;
    const enterAt = note(`${l.id}.enterAt`, m.enterAt, num(m.enterAt, L.enterAt.min, L.enterAt.max, 0));
    let enterFor = note(`${l.id}.enterFor`, m.enterFor, num(m.enterFor, L.enterFor.min, L.enterFor.max, 0.3));
    if (enterAt + enterFor > L.enterEnd) enterFor = note(`${l.id}.enterFor`, enterFor, Math.max(0.05, L.enterEnd - enterAt));
    return {
      id: l.id,
      depth: clampNote(`${l.id}.depth`, m.depth, num(m.depth, L.depth.min, L.depth.max, l.depth)),
      driftX: clampNote(`${l.id}.driftX`, m.driftX, num(m.driftX, -L.drift, L.drift, 0)),
      driftY: clampNote(`${l.id}.driftY`, m.driftY, num(m.driftY, -L.drift, L.drift, 0)),
      scale: clampNote(`${l.id}.scale`, m.scale, num(m.scale, L.scale.min, L.scale.max, 1)),
      enter,
      enterAt,
      enterFor,
    };
  });

  return {
    plan: {
      focusX: clampNote("focusX", r.focusX, num(r.focusX, L.focus.min, L.focus.max, 0.5)),
      focusY: clampNote("focusY", r.focusY, num(r.focusY, L.focus.min, L.focus.max, 0.5)),
      camera: keys,
      layers: moves,
      ambient: pick(r.ambient, AMBIENTS, "light-sweep"),
      rationale: typeof r.rationale === "string" ? r.rationale.slice(0, 400) : "",
    },
    fixes,
  };
}

const EASE_FN: Record<Ease, (t: number) => number> = {
  linear: clamp01,
  "in-out": easeInOutSine,
  in: (t) => clamp01(t) ** 2,
  out: easeOutCubic,
};

/** The camera of a plan at clip time t (0..1): keyframes interpolated with each segment's easing. */
export function planCamera(plan: MotionPlan, t: number): Camera {
  const keys = plan.camera;
  let k = 1;
  while (k < keys.length - 1 && keys[k].t < t) k++;
  const a = keys[k - 1], b = keys[k];
  const e = EASE_FN[b.ease]((t - a.t) / (b.t - a.t || 1));
  const zoom = lerp(a.zoom, b.zoom, e);
  return { z: 1 - 1 / zoom, x: lerp(a.panX, b.panX, e), y: lerp(a.panY, b.panY, e), settle: 0 };
}

/** A layer's own move at clip time t: opacity, offset and scale about its foot. */
export function layerAt(m: LayerMove, t: number, f = FILM) {
  const e = easeInOutSine(t);
  const u = easeOutCubic((t - m.enterAt) / m.enterFor);
  let scale = lerp(1, m.scale, e), dx = m.driftX * e, dy = m.driftY * e, opacity = 1;
  if (m.enter === "fade") opacity = u;
  else if (m.enter === "rise") (opacity = u), (dy += 0.03 * (1 - u));
  else if (m.enter === "settle") (dy += f.settleDrop * (1 - u)), (scale *= 1 - f.settleShrink * (1 - u));
  else if (m.enter === "scale-in") (opacity = u), (scale *= lerp(0.9, 1, u));
  return { opacity, dx, dy, scale };
}

/** Apply a layer move to a projected rectangle, scaling about `anchor`. */
export const moved = (r: Rect, anchor: { x: number; y: number }, la: { dx: number; dy: number; scale: number }): Rect => ({
  left: anchor.x + (r.left - anchor.x) * la.scale + la.dx,
  top: anchor.y + (r.top - anchor.y) * la.scale + la.dy,
  width: r.width * la.scale,
  height: r.height * la.scale,
});

/** Share (0..1) of a rectangle's area inside the frame. */
export function visibleShare(r: Rect): number {
  const w = Math.max(0, Math.min(1, r.left + r.width) - Math.max(0, r.left));
  const h = Math.max(0, Math.min(1, r.top + r.height) - Math.max(0, r.top));
  return r.width > 0 && r.height > 0 ? (w * h) / (r.width * r.height) : 0;
}

export const focusOf = (plan: MotionPlan) => ({ x: plan.focusX, y: plan.focusY });
const pathOf = (plan: MotionPlan, steps = 40) => Array.from({ length: steps + 1 }, (_, i) => planCamera(plan, i / steps));

/** Where a layer's box lands on screen at clip time t. */
export function layerBox(plan: MotionPlan, m: LayerMove, box: Rect, t: number, lens: number, f = FILM): Rect {
  const p = project(box, m.depth, planCamera(plan, t), focusOf(plan), lens);
  return moved(p, { x: p.left + p.width / 2, y: p.top + p.height }, layerAt(m, t, f));
}

/** What breaks a plan: layers pushed off-frame, or a background needing too much overscan. */
export function planProblems(plan: MotionPlan, boxes: Record<string, Rect>, backDepth = 0, steps = 40): string[] {
  const out: string[] = [];
  const lens = lensForPath(backDepth, pathOf(plan, steps), focusOf(plan));
  if (lens > LIMITS.lens) out.push(`background needs ${lens.toFixed(3)} overscan`);
  for (const m of plan.layers) {
    const box = boxes[m.id];
    if (!box) continue;
    const rest = visibleShare(box);
    for (let i = 0; i <= steps; i++) {
      // A layer that hasn't made its entrance yet is invisible, so it can't clip the frame.
      if (layerAt(m, i / steps).opacity <= 0) continue;
      const v = visibleShare(layerBox(plan, m, box, i / steps, lens));
      if (v < rest - LIMITS.offFrame) {
        out.push(`${m.id} ${Math.round((1 - v) * 100)}% off-frame at t=${(i / steps).toFixed(2)}`);
        break;
      }
    }
  }
  return out;
}

/** Scale every excursion of a plan (zoom, pan, drift, end scale) toward rest by k. */
export function damp(plan: MotionPlan, k: number): MotionPlan {
  return {
    ...plan,
    camera: plan.camera.map((c) => ({ ...c, zoom: 1 + (c.zoom - 1) * k, panX: c.panX * k, panY: c.panY * k })),
    layers: plan.layers.map((m) => ({ ...m, driftX: m.driftX * k, driftY: m.driftY * k, scale: 1 + (m.scale - 1) * k })),
  };
}

/**
 * Make a sanitized plan safe to film: while any layer would leave the frame (or the background
 * would need too much overscan), damp the whole move; as a last resort hold everything still and
 * turn rises into fades, which never leave the frame.
 */
export function fitPlan(plan: MotionPlan, boxes: Record<string, Rect>, backDepth = 0): { plan: MotionPlan; fixes: string[] } {
  let p = plan;
  for (let i = 0; i < 8; i++) {
    const problems = planProblems(p, boxes, backDepth);
    if (!problems.length) return { plan: p, fixes: i ? [`move damped to ${Math.round(0.75 ** i * 100)}% (${planProblems(plan, boxes, backDepth).join("; ")})`] : [] };
    p = damp(plan, 0.75 ** (i + 1));
  }
  const still = damp(plan, 0);
  const safe = { ...still, focusX: 0.5, focusY: 0.5, layers: still.layers.map((m) => ({ ...m, enter: (m.enter === "rise" ? "fade" : m.enter) as Entrance })) };
  return { plan: safe, fixes: [`move could not be fitted (${planProblems(plan, boxes, backDepth).join("; ")}): held still`] };
}

/** A small deterministic PRNG, so a plan always renders the same film. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

interface Particle {
  x: number;
  y: number;
  r: number;
  a: number;
  ph: number;
}

/** Draw the plan's ambient particles (dust, rain) onto the frame before it is finished. */
function particles(frame: Float32Array, N: number, ambient: Ambient, set: Particle[], t: number) {
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
function finishPlanned(frame: Float32Array, N: number, vig: Float32Array, t: number, out: Buffer, ambient: Ambient, f = FILM) {
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

/** The square box (frame units) a schema layer occupies: x centre and y bottom in percent, height from the cut's aspect. */
export const layerRect = (l: { x: number; y: number; w: number }, aspect: number): Rect => {
  const w = l.w / 100, h = w * aspect;
  return { left: l.x / 100 - w / 2, top: l.y / 100 - h, width: w, height: h };
};

/**
 * Split the difference matte between the SAM cut-outs, so each layer can move on its own: every
 * matte pixel goes to the cut whose (dilated) mask is strongest there; pixels no cut claims go
 * to the largest layer, so the hole in the clean background is always covered by something.
 */
async function separateLayers(plateFile: string, cleanFile: string, side: number, layers: { id: string; rect: Rect; cut: string }[]) {
  const sharp = (await import("sharp")).default;
  const W = MATTE;
  const m = await diffMatte(plateFile, cleanFile);
  const regions: Float32Array[] = [];
  for (const l of layers) {
    const reg = new Float32Array(W * W);
    const rw = Math.max(1, Math.round(l.rect.width * W)), rh = Math.max(1, Math.round(l.rect.height * W));
    const a = await sharp(l.cut).ensureAlpha().extractChannel(3).resize(rw, rh, { fit: "fill" }).raw().toBuffer();
    const ox = Math.round(l.rect.left * W), oy = Math.round(l.rect.top * W);
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) {
        const X = ox + x, Y = oy + y;
        if (X >= 0 && X < W && Y >= 0 && Y < W) reg[Y * W + X] = a[y * rw + x] / 255;
      }
    regions.push(blur(reg, W, W, Math.round(W / 60)));
  }
  const owner = new Int8Array(W * W).fill(-1);
  const count = layers.map(() => 0);
  for (let i = 0; i < W * W; i++) {
    if (m[i] <= 0.01) continue;
    let best = -1, bv = 0.02;
    for (let k = 0; k < layers.length; k++) if (regions[k][i] > bv) (bv = regions[k][i]), (best = k);
    owner[i] = best;
    if (best >= 0) count[best]++;
  }
  const main = count.indexOf(Math.max(...count));
  const out: { id: string; img: Img; box: Rect }[] = [];
  for (let k = 0; k < layers.length; k++) {
    const a = Float32Array.from(m, (v, i) => (owner[i] === k || (owner[i] === -1 && k === main) ? v : 0));
    const box = bboxOf(a, W, W, 0.5, 0.0005);
    if (!box) continue;
    out.push({ id: layers[k].id, img: await cutOut(plateFile, a, side), box });
  }
  return out;
}

/** Encode frames, raising CRF if the film comes out over the size budget (the site loads the whole clip). */
async function encodeSized(mp4: string, frames: Buffer[], N: number, f = FILM, maxBytes = 3.3e6) {
  let r = { bytes: 0, hash: "" }, crf = f.crf;
  for (; crf <= f.crf + 6; crf += 2) {
    const enc = encoder(mp4, N, { ...f, crf });
    for (const fr of frames) await enc.write(fr);
    r = await enc.close();
    if (r.bytes <= maxBytes) break;
  }
  return { ...r, crf: Math.min(crf, f.crf + 6) };
}

/**
 * Render a scene from a motion plan. `outDir` defaults to the scene folder (scene.mp4 and
 * scene.jpg); wonder.ts renders candidate rounds elsewhere first. The plan is fitted again here,
 * so even a hand-edited motion.json can't push a layer off-frame.
 */
export async function renderDirected(slug: string, scene: Scene, base: Plan, motion: MotionPlan, outDir?: string, f = FILM) {
  const sharp = (await import("sharp")).default;
  const N = f.size, count = Math.round(f.fps * f.seconds);
  const dir = outDir ?? join(ROOT, "public/stories", slug, scene.id);
  const side = Math.round(N * 1.25);
  const cuts = base.clean ? scene.layers.filter((l) => l.src && existsSync(fileOf(l.src))) : [];
  const specs = [];
  for (const l of cuts) {
    const meta = await sharp(fileOf(l.src!)).metadata();
    specs.push({ id: l.id, rect: layerRect(l, (meta.height ?? 1) / (meta.width ?? 1)), cut: fileOf(l.src!) });
  }
  const parts = base.clean && specs.length ? await separateLayers(fileOf(base.plate), fileOf(base.clean), side, specs) : [];
  const layered = parts.length > 0;
  const backDepth = layered ? 0 : base.depth;
  const ids = layered ? parts.map((p) => ({ id: p.id, depth: motion.layers.find((m) => m.id === p.id)?.depth ?? 0.6 })) : [];
  const sane = sanitizePlan(motion, ids);
  const boxes = Object.fromEntries(parts.map((p) => [p.id, p.box]));
  const fitted = fitPlan(sane.plan, boxes, backDepth);
  const plan = fitted.plan, fixes = [...sane.fixes, ...fitted.fixes];
  const focal = focusOf(plan);
  const lens = lensForPath(backDepth, pathOf(plan, 60), focal);
  const back = await load(fileOf(layered ? base.clean! : base.plate), side);
  const vig = vignette(N, f.vignette);
  const frame = new Float32Array(N * N * 3);
  const full = { left: 0, top: 0, width: 1, height: 1 };
  const rand = rng(createHash("sha1").update(`${slug}/${scene.id}`).digest().readUInt32LE(0));
  const set: Particle[] = Array.from({ length: plan.ambient === "rain" ? 140 : 70 }, () => ({ x: rand(), y: rand(), r: 1 + rand() * 1.8, a: 0.12 + rand() * 0.22, ph: rand() }));
  // Draw far to near so nearer layers overlap farther ones.
  const order = parts.map((p) => ({ p, m: plan.layers.find((m) => m.id === p.id)! })).sort((a, b) => a.m.depth - b.m.depth);
  const frames: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const cam = planCamera(plan, t);
    frame.fill(0);
    draw(frame, N, back, project(full, backDepth, cam, focal, lens));
    for (const { p, m } of order) {
      const la = layerAt(m, t, f);
      if (la.opacity <= 0) continue;
      const b = project(p.box, m.depth, cam, focal, lens);
      draw(frame, N, p.img, moved(project(full, m.depth, cam, focal, lens), { x: b.left + b.width / 2, y: b.top + b.height }, la), la.opacity);
    }
    particles(frame, N, plan.ambient, set, t);
    const out = Buffer.alloc(N * N * 3);
    finishPlanned(frame, N, vig, t, out, plan.ambient, f);
    frames.push(out);
  }
  await sharp(frames[0], { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(dir, "scene.jpg"));
  const enc = await encodeSized(join(dir, "scene.mp4"), frames, N, f);
  return { layered, layers: parts.length, plan, fixes, ...enc };
}

// ---------- Line scenes ----------
// A line-treatment scene films its own making: the pen-plotter line traced from the plate draws
// itself stroke by stroke over the era's paper, the plate develops underneath it (from a faint
// print to full colour), the lines soften as the picture takes over, and the camera pushes in slowly.

export const LINE = {
  /** Clip time by which every stroke has landed. */
  drawEnd: 0.72,
  /** Plate opacity: a faint print at the start, full by `developEnd`. */
  ghost: 0.18,
  developStart: 0.18,
  developEnd: 0.86,
  /** Line opacity once the plate has developed. */
  lineRest: 0.4,
  /** Stroke width in drawing units (the drawing is 1000 wide). */
  stroke: 2.2,
  /** Gentler sideways travel than the layered films: the move is mostly a push-in. */
  truck: 0.025,
};

export interface LineData {
  aspect: number;
  strokes: number[][];
}

/** Cumulative pen travel after each stroke (the pen lifts between strokes, so jumps don't count). */
export function strokeLengths(strokes: number[][]): number[] {
  let total = 0;
  return strokes.map((s) => {
    for (let i = 2; i < s.length; i += 2) total += Math.hypot(s[i] - s[i - 2], s[i + 1] - s[i - 1]);
    return total;
  });
}

/** The strokes drawn once the pen has covered `frac` (0..1) of its travel; the last one cut mid-segment. */
export function drawnStrokes(strokes: number[][], frac: number, cum = strokeLengths(strokes)): number[][] {
  const total = cum[cum.length - 1] ?? 0;
  if (frac >= 1 || !total) return frac >= 1 ? strokes : [];
  const target = clamp01(frac) * total;
  if (target <= 0) return [];
  const out: number[][] = [];
  for (let k = 0; k < strokes.length; k++) {
    if (cum[k] <= target) {
      out.push(strokes[k]);
      continue;
    }
    const s = strokes[k];
    let run = k ? cum[k - 1] : 0;
    const part = [s[0], s[1]];
    for (let i = 2; i < s.length; i += 2) {
      const seg = Math.hypot(s[i] - s[i - 2], s[i + 1] - s[i - 1]);
      if (run + seg >= target) {
        const u = seg ? (target - run) / seg : 0;
        part.push(lerp(s[i - 2], s[i], u), lerp(s[i - 1], s[i + 1], u));
        break;
      }
      part.push(s[i], s[i + 1]);
      run += seg;
    }
    if (part.length >= 4) out.push(part);
    break;
  }
  return out;
}

/** Pen progress, plate opacity and line opacity at clip time t (0..1). */
export function lineAt(t: number, l = LINE) {
  const develop = easeInOutSine((t - l.developStart) / (l.developEnd - l.developStart));
  return {
    pen: easeOutCubic(t / l.drawEnd) * 0.35 + clamp01(t / l.drawEnd) * 0.65,
    plate: lerp(l.ghost, 1, develop),
    ink: lerp(1, l.lineRest, develop),
  };
}

const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** Render and encode a line scene. */
export async function renderLineScene(slug: string, scene: Scene, plate: string, line: LineData, f = FILM, l = LINE) {
  const sharp = (await import("sharp")).default;
  const N = f.size, frames = Math.round(f.fps * f.seconds);
  const dir = join(ROOT, "public/stories", slug, scene.id);
  const era = eraFor(scene.year);
  const paper = hexRgb(era.paper), ink = era.ink;
  const cam = { ...f, truck: l.truck };
  const n = Number(scene.id.slice(1)) || 1;
  const turn: 1 | -1 = n % 2 ? 1 : -1;
  const focal = { x: 0.5, y: 0.5 };
  const lens = lensFor(f.plateDepth, turn, focal, cam);
  const side = Math.round(N * 1.25);
  const img = await load(fileOf(plate), side);
  const vig = vignette(N, f.vignette);
  const frame = new Float32Array(N * N * 3);
  const out = Buffer.alloc(N * N * 3);
  const cum = strokeLengths(line.strokes);
  const U = 1000, H = Math.round(line.aspect * U);
  const path = (s: number[]) => {
    let d = "";
    for (let i = 0; i < s.length; i += 2) d += `${i ? "L" : "M"}${(s[i] * U).toFixed(1)} ${(s[i + 1] * U).toFixed(1)}`;
    return d;
  };
  const full = { left: 0, top: 0, width: 1, height: 1 };
  const enc = encoder(join(dir, "scene.mp4"), N, f);

  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const at = lineAt(t, l);
    const r = project(full, f.plateDepth, cameraAt(t, turn, cam), focal, lens);
    for (let o = 0; o < frame.length; o += 3) (frame[o] = paper[0]), (frame[o + 1] = paper[1]), (frame[o + 2] = paper[2]);
    draw(frame, N, img, r, at.plate);
    const drawn = drawnStrokes(line.strokes, at.pen, cum);
    if (drawn.length) {
      // The drawing sits exactly on the plate it was traced from, so it moves with it.
      const k = (r.width * N) / U;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}"><g transform="translate(${(r.left * N).toFixed(2)} ${(r.top * N).toFixed(2)}) scale(${k.toFixed(5)} ${((r.height * N) / H).toFixed(5)})" fill="none" stroke="${ink}" stroke-width="${l.stroke}" stroke-linecap="round" stroke-linejoin="round" opacity="${at.ink.toFixed(3)}"><path d="${drawn.map(path).join("")}"/></g></svg>`;
      draw(frame, N, await load(Buffer.from(svg)), full);
    }
    finish(frame, N, vig, t, out, f);
    if (i === 0) await sharp(out, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(dir, "scene.jpg"));
    await enc.write(out);
  }
  return enc.close();
}

// ---------- CLI ----------

const storyFile = (slug: string) => join(ROOT, "stories", slug, "story.json");
/** A Muse Wonder motion plan for the scene (pnpm wonder); when present the film follows it. */
export const motionFile = (slug: string, id: string) => join(ROOT, "public/stories", slug, id, "motion.json");

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { scenes: { type: "string" }, dry: { type: "boolean" } } });
  const slug = positionals[0];
  if (!slug) {
    console.log("usage: pnpm video <slug> [--scenes s1,s4] [--dry]");
    process.exit(1);
  }
  const only = values.scenes?.split(",");
  const story = Story.parse(JSON.parse(await readFile(storyFile(slug), "utf8")));
  const made: Record<string, { video: string; poster: string }> = {};
  for (const scene of story.scenes) {
    if (only && !only.includes(scene.id)) continue;
    const plan = planScene(scene, (url) => existsSync(fileOf(url)));
    if (!plan) {
      console.log(`  ${scene.id}: no plate yet, skipped`);
      continue;
    }
    const t = Date.now();
    let bytes: number, hash: string, kind: string;
    if (scene.treatment === "line") {
      if (!scene.line || !existsSync(fileOf(scene.line))) {
        console.log(`  ${scene.id}: line treatment without a line drawing yet, skipped`);
        continue;
      }
      ({ bytes, hash } = await renderLineScene(slug, scene, plan.plate, JSON.parse(await readFile(fileOf(scene.line), "utf8"))));
      kind = "line drawing over the developing plate";
    } else if (existsSync(motionFile(slug, scene.id))) {
      const motion = JSON.parse(await readFile(motionFile(slug, scene.id), "utf8"));
      const r = await renderDirected(slug, scene, plan, motion.plan);
      ({ bytes, hash } = r);
      kind = `directed by ${motion.model ?? "Muse Wonder"} (${r.layers} layer${r.layers === 1 ? "" : "s"}, ${r.plan.ambient}${r.fixes.length ? `; ${r.fixes.join("; ")}` : ""})`;
    } else {
      const r = await renderScene(slug, scene, plan);
      ({ bytes, hash } = r);
      kind = r.layered ? "subject on clean background" : plan.clean ? "no subject in the difference matte, plate push-in" : "plate push-in";
    }
    const base = `/stories/${slug}/${scene.id}`;
    made[scene.id] = { video: `${base}/scene.mp4?v=${hash}`, poster: `${base}/scene.jpg?v=${hash}` };
    console.log(`  ${scene.id}: ${kind}, ${(bytes / 1e6).toFixed(2)} MB in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  if (!Object.keys(made).length || values.dry) return;
  // Read-modify-write the raw file right before writing, touching only these two fields, so a
  // pipeline that wrote meanwhile keeps its changes.
  const raw = JSON.parse(await readFile(storyFile(slug), "utf8"));
  for (const sc of raw.scenes) if (made[sc.id]) Object.assign(sc, made[sc.id]);
  Story.parse(raw);
  await writeFile(storyFile(slug), JSON.stringify(raw, null, 2) + "\n");
  console.log(`  story.json: video on ${Object.keys(made).join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
