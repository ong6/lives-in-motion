/**
 * pnpm video <slug> [--scenes s1,s4] [--dry]   (--dry renders but leaves story.json alone)
 *
 * Renders each illustrated scene as a short 2.5D film the site scrubs with scroll: a virtual
 * camera pushes in and trucks sideways, every layer moves by its own depth (the clean background
 * far, the SAM 3.1 cut-outs near), the subject settles into place, and a soft light passes over
 * a vignette. Scenes without cut-outs get a slow push-in on the plate alone. Everything is local
 * (node + sharp to decode, a small compositor here, ffmpeg to encode): no paid calls.
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

const ROOT = new URL("..", import.meta.url).pathname;
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
  const map = (v: number, f: number, sh: number) => 0.5 + lens * (f + (v - f + sh) * s - 0.5);
  const left = map(r.left, focal.x, shift);
  const top = map(r.top, focal.y, 0);
  return { left, top, width: r.width * s * lens, height: r.height * s * lens };
}

export const covers = (r: Rect, eps = 1e-9) => r.left <= eps && r.top <= eps && r.left + r.width >= 1 - eps && r.top + r.height >= 1 - eps;

/** The smallest lens zoom (≥ 1) that keeps a full-frame layer at `depth` covering the frame for the whole clip. */
export function lensFor(depth: number, dir: 1 | -1, focal: { x: number; y: number }, f = FILM, steps = 60): number {
  const full = { left: 0, top: 0, width: 1, height: 1 };
  let need = 1;
  for (let i = 0; i <= steps; i++) {
    const r = project(full, depth, cameraAt(i / steps, dir, f), focal, 1);
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

async function load(file: string, maxSide?: number, blur?: number): Promise<Img> {
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

/** The subject as its own premultiplied image: plate colours with the difference matte as alpha. */
async function separate(plateFile: string, cleanFile: string, side: number) {
  const sharp = (await import("sharp")).default;
  const W = 700;
  const rgb = (file: string) => sharp(file).removeAlpha().resize(W, W, { fit: "fill" }).blur(1.5).raw().toBuffer();
  const [a, b] = await Promise.all([rgb(plateFile), rgb(cleanFile)]);
  const diff = new Float32Array(W * W);
  for (let i = 0; i < diff.length; i++) diff[i] = Math.hypot(a[i * 3] - b[i * 3], a[i * 3 + 1] - b[i * 3 + 1], a[i * 3 + 2] - b[i * 3 + 2]);
  const m = matteFromDiff(diff, W, W);
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
  const ff = spawn(FFMPEG, [
    "-y", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${N}x${N}`, "-r", String(f.fps), "-i", "-",
    "-an", "-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", String(f.crf),
    "-g", "1", "-keyint_min", "1", "-sc_threshold", "0", "-bf", "0",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((res, rej) => ff.on("close", (code) => (code ? rej(new Error(`ffmpeg exited ${code}`)) : res())));

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
    if (!ff.stdin.write(out)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
  const bytes = await readFile(mp4);
  return { layered: Boolean(subject), bytes: bytes.length, hash: createHash("sha1").update(bytes).digest("hex").slice(0, 8) };
}

// ---------- CLI ----------

const storyFile = (slug: string) => join(ROOT, "stories", slug, "story.json");

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
    if (scene.treatment === "line" && !only) {
      console.log(`  ${scene.id}: line treatment draws itself, skipped`);
      continue;
    }
    const plan = planScene(scene, (url) => existsSync(fileOf(url)));
    if (!plan) {
      console.log(`  ${scene.id}: no plate yet, skipped`);
      continue;
    }
    const t = Date.now();
    const { layered, bytes, hash } = await renderScene(slug, scene, plan);
    const base = `/stories/${slug}/${scene.id}`;
    made[scene.id] = { video: `${base}/scene.mp4?v=${hash}`, poster: `${base}/scene.jpg?v=${hash}` };
    const kind = layered ? "subject on clean background" : plan.clean ? "no subject in the difference matte, plate push-in" : "plate push-in"
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
