/**
 * pnpm portrait <slug> [--sam] [--hatch 24] [--preview <png>]: the credited photo in
 * pipeline/portraits → a pen-plotter line drawing in public/lines/<slug>.json.
 *
 * The drawing itself is LingDong-'s linedraw (MIT, vendored in pipeline/vendor/linedraw at
 * 3aedc2f): Canny contours plus Perlin-wobbled hatching, strokes sorted in plotter order, which
 * is also the order the site draws them in. With --sam, SAM 3.1 cuts out the person first
 * (one $0.0025 call through the budget guard) so the background doesn't get hatched.
 * Needs `uv` (it runs linedraw with OpenCV in a throwaway environment).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { ROOT } from "./root";
import { conceptMask, fillHoles, personMask } from "./sam";

const LINEDRAW = join(ROOT, "pipeline/vendor/linedraw/linedraw.py");
/** linedraw draws on a 1024-wide canvas and writes the SVG at half scale. */
const SVG_WIDTH = 512;

export interface Portrait {
  /** height / width */
  aspect: number;
  /** Polylines in plotter order, x and y as flat pairs in a box 1 wide and `aspect` tall. */
  strokes: number[][];
  /** The photo the drawing was traced from, cut out by SAM and toned to ink; fades in as the drawing finishes. */
  photo?: string;
  credit: Record<string, unknown>;
}

/** <polyline points="x,y,x,y…"> → flat number arrays scaled to a unit-width box. */
export function parsePolylines(svg: string, width = SVG_WIDTH): number[][] {
  return [...svg.matchAll(/points="([^"]+)"/g)]
    .map((m) => m[1].split(",").map((v) => +(Number(v) / width).toFixed(4)))
    .filter((pts) => pts.length >= 4);
}

/**
 * An image → pen-plotter strokes with the vendored linedraw (hatch: patch size; light: lightest
 * hatched tone). Runs in a child process, so a server keeps answering while it draws.
 */
export async function drawLines(png: Buffer, opts: { hatch?: number; light?: number } = {}): Promise<number[][]> {
  const dir = mkdtempSync(join(tmpdir(), "lim-lines-"));
  const [input, svg] = [join(dir, "in.png"), join(dir, "out.svg")];
  writeFileSync(input, png);
  try {
    await promisify(execFile)(
      "uv",
      ["run", "-q", "--no-project", "--with", "opencv-python-headless", "--with", "pillow", "--with", "numpy", "python", LINEDRAW, "-i", input, "-o", svg, "--hatch_size", String(opts.hatch ?? 12), "--hatch_light", String(opts.light ?? 70)],
      { cwd: join(ROOT, "pipeline/vendor/linedraw"), maxBuffer: 64 * 1024 * 1024 },
    );
    return parsePolylines(readFileSync(svg, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A cached 0/1 mask (PNG beside its source), so re-tuning a drawing doesn't pay SAM again. */
async function cached(file: string, w: number, h: number, make: () => Promise<Uint8Array | null>): Promise<Uint8Array | null> {
  if (existsSync(file)) {
    const raw = await sharp(file).resize(w, h, { fit: "fill" }).extractChannel(0).raw().toBuffer();
    return Uint8Array.from(raw, (v) => (v > 127 ? 1 : 0));
  }
  const mask = await make();
  if (mask) await sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: w, height: h, channels: 1 } }).png().toFile(file);
  return mask;
}

export interface TraceOptions {
  hatch?: number;
  light?: number;
  /** Tone lift and gamma applied inside the mask, so a mid-grey face isn't hatched solid. */
  lift?: number;
  gamma?: number;
  preview?: string;
}

/**
 * Trace an image (already cropped, any size) into public/lines/<slug>.json. With a mask, the
 * background goes white first and a toned cut-out is written to public/portraits/<slug>.webp
 * for the site to reveal under the lines.
 */
export async function trace(slug: string, image: Buffer, mask: Uint8Array | null, credit: Record<string, unknown>, opts: TraceOptions = {}): Promise<Portrait> {
  const W = 900;
  const rawCrop = await sharp(image).resize({ width: W }).png().toBuffer();
  const H = (await sharp(rawCrop).metadata()).height!;
  let crop = rawCrop;
  if (mask) {
    // Everything outside the subject goes white, blended over a soft edge so the outline stays one line.
    // Lift the subject's tones first: against white, a mid-grey face would be hatched solid.
    const { data, info } = await sharp(crop).removeAlpha().normalise().linear(opts.lift ?? 1.5, 0).gamma(opts.gamma ?? 2.2).raw().toBuffer({ resolveWithObject: true });
    const soft = await sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: info.width, height: info.height, channels: 1 } })
      .blur(2)
      .extractChannel(0)
      .raw()
      .toBuffer();
    for (let i = 0; i < data.length; i++) {
      const a = soft[Math.floor(i / info.channels)] / 255;
      data[i] = Math.round(data[i] * a + 255 * (1 - a));
    }
    crop = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
  }

  const strokes = await drawLines(crop, opts);
  const out: Portrait = { aspect: +(H / W).toFixed(4), strokes, credit: { ...credit, masked: mask ? "SAM 3.1" : "none" } };
  if (mask) {
    // The cut-out, greyscale with the mask as alpha, so the site can reveal the real picture under the lines.
    const grey = await sharp(rawCrop).resize(W, H, { fit: "fill" }).greyscale().normalise().removeAlpha().toColourspace("b-w").raw().toBuffer();
    const alpha = await sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: W, height: H, channels: 1 } }).blur(3).extractChannel(0).raw().toBuffer();
    const ga = Buffer.alloc(W * H * 2);
    for (let i = 0; i < W * H; i++) {
      ga[i * 2] = grey[i];
      ga[i * 2 + 1] = alpha[i];
    }
    await mkdir(join(ROOT, "public/portraits"), { recursive: true });
    await sharp(ga, { raw: { width: W, height: H, channels: 2 } }).webp({ quality: 80, alphaQuality: 80 }).toFile(join(ROOT, "public/portraits", `${slug}.webp`));
    out.photo = `/portraits/${slug}.webp`;
  }
  await mkdir(join(ROOT, "public/lines"), { recursive: true });
  await writeFile(join(ROOT, "public/lines", `${slug}.json`), JSON.stringify(out));

  if (opts.preview) {
    const PW = 600;
    const lines = strokes.map((s) => `<polyline points="${s.map((v) => (v * PW).toFixed(1)).join(",")}" fill="none" stroke="#1f2a44" stroke-width="1.2"/>`).join("");
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${Math.round(PW * out.aspect)}"><rect width="100%" height="100%" fill="#f3e9d4"/>${lines}</svg>`))
      .png()
      .toFile(opts.preview);
  }
  return out;
}

/** The hand-curated portraits: a credited photo in pipeline/portraits, cropped per credits.json. */
export async function portrait(slug: string, opts: TraceOptions & { sam?: boolean } = {}): Promise<Portrait> {
  const credits = JSON.parse(await readFile(join(ROOT, "pipeline/portraits/credits.json"), "utf8"));
  const c = credits[slug];
  if (!c) throw new Error(`no credited portrait for ${slug}`);
  const [left, top, width, height] = c.crop;
  const crop = await sharp(join(ROOT, "pipeline/portraits", `${slug}.jpg`)).extract({ left, top, width, height }).resize({ width: 900 }).png().toBuffer();
  const h = Math.round((900 * height) / width);
  const mask = opts.sam ? await cached(join(ROOT, "pipeline/portraits", `${slug}.mask.png`), 900, h, () => personMask(crop, 900, h, c.include ?? [])) : null;
  if (opts.sam && !mask) console.log(`  ${slug}: SAM found no person; drawing the whole crop`);
  return trace(slug, crop, mask, { page: c.page, license: c.license, licenseUrl: c.licenseUrl, artist: c.artist }, opts);
}

/**
 * A frontispiece for a life made on /create: the reader's photo (SAM 3.1 finds the person) or a
 * Muse Image emblem (SAM 3.1 finds its `concept`). The mask is cached as `<source>.mask.png`.
 */
export async function frontispiece(slug: string, sourceFile: string, concept: string, credit: Record<string, unknown>, opts: TraceOptions = {}): Promise<Portrait> {
  // 900 wide (trace() works at that width), no taller than 4:3 portrait: a long photo keeps its top.
  const wide = await sharp(sourceFile).rotate().resize({ width: 900 }).png().toBuffer();
  const tall = (await sharp(wide).metadata()).height!;
  const img = tall > 1200 ? await sharp(wide).extract({ left: 0, top: 0, width: 900, height: 1200 }).png().toBuffer() : wide;
  const { width: w, height: h } = await sharp(img).metadata();
  const mask = await cached(sourceFile.replace(/\.\w+$/, ".mask.png"), w!, h!, async () => {
    const m = concept === "person" ? await personMask(img, w!, h!) : await conceptMask(img, concept, w!, h!);
    return m && concept !== "person" ? fillHoles(m, w!, h!) : m;
  });
  if (!mask) return trace(slug, img, null, credit, opts);
  // Frame what SAM found. A photo's mid-tones are lifted (the default); an engraved emblem keeps
  // its tones so it hatches richly.
  const framed = await cropToMask(img, mask, w!, h!);
  return trace(slug, framed.img, framed.mask, credit, concept === "person" ? opts : { lift: 1, gamma: 1, hatch: 10, light: 80, ...opts });
}

/** Crop an image and its 0/1 mask to the mask's bounds plus a margin, scaled to 900 wide. */
export async function cropToMask(img: Buffer, mask: Uint8Array, w: number, h: number, pad = 0.08) {
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 <= x0 || y1 <= y0) return { img, mask };
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * pad);
  const left = Math.max(0, x0 - m), top = Math.max(0, y0 - m);
  const width = Math.min(w, x1 + m + 1) - left, height = Math.min(h, y1 + m + 1) - top;
  const H = Math.round((900 * height) / width);
  const out = await sharp(img).extract({ left, top, width, height }).resize(900, H, { fit: "fill" }).png().toBuffer();
  const raw = await sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: w, height: h, channels: 1 } })
    .extract({ left, top, width, height })
    .resize(900, H, { fit: "fill" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  return { img: out, mask: Uint8Array.from(raw, (v) => (v > 127 ? 1 : 0)) };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.loadEnvFile(join(ROOT, ".env"));
  } catch {
    /* no key: --sam unavailable */
  }
  const { parseArgs } = await import("node:util");
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { sam: { type: "boolean", default: false }, hatch: { type: "string" }, light: { type: "string" }, lift: { type: "string" }, gamma: { type: "string" }, preview: { type: "string" } },
  });
  for (const slug of positionals) {
    const p = await portrait(slug, { sam: values.sam, hatch: values.hatch ? Number(values.hatch) : undefined, light: values.light ? Number(values.light) : undefined, lift: values.lift ? Number(values.lift) : undefined, gamma: values.gamma ? Number(values.gamma) : undefined, preview: values.preview?.replace("{slug}", slug) });
    console.log(`${slug}: ${p.strokes.length} strokes (${p.credit.masked} mask)`);
  }
}
