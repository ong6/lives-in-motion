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
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { personMask } from "./sam";

const ROOT = new URL("..", import.meta.url).pathname;
const LINEDRAW = join(ROOT, "pipeline/vendor/linedraw/linedraw.py");
/** linedraw draws on a 1024-wide canvas and writes the SVG at half scale. */
const SVG_WIDTH = 512;

export interface Portrait {
  /** height / width */
  aspect: number;
  /** Polylines in plotter order, x and y as flat pairs in a box 1 wide and `aspect` tall. */
  strokes: number[][];
  credit: Record<string, unknown>;
}

/** <polyline points="x,y,x,y…"> → flat number arrays scaled to a unit-width box. */
export function parsePolylines(svg: string, width = SVG_WIDTH): number[][] {
  return [...svg.matchAll(/points="([^"]+)"/g)]
    .map((m) => m[1].split(",").map((v) => +(Number(v) / width).toFixed(4)))
    .filter((pts) => pts.length >= 4);
}

/** An image → pen-plotter strokes with the vendored linedraw (hatch: patch size; light: lightest hatched tone). */
export function drawLines(png: Buffer, opts: { hatch?: number; light?: number } = {}): number[][] {
  const dir = mkdtempSync(join(tmpdir(), "lim-lines-"));
  const [input, svg] = [join(dir, "in.png"), join(dir, "out.svg")];
  writeFileSync(input, png);
  execFileSync(
    "uv",
    ["run", "-q", "--no-project", "--with", "opencv-python-headless", "--with", "pillow", "--with", "numpy", "python", LINEDRAW, "-i", input, "-o", svg, "--hatch_size", String(opts.hatch ?? 32), "--hatch_light", String(opts.light ?? 80)],
    { cwd: join(ROOT, "pipeline/vendor/linedraw"), stdio: "ignore" },
  );
  const strokes = parsePolylines(readFileSync(svg, "utf8"));
  rmSync(dir, { recursive: true, force: true });
  return strokes;
}

/** SAM 3.1's person mask, kept beside the photo so re-tuning the drawing doesn't pay again. */
async function cachedMask(slug: string, crop: Buffer, w: number, h: number): Promise<Uint8Array | null> {
  const file = join(ROOT, "pipeline/portraits", `${slug}.mask.png`);
  if (existsSync(file)) {
    const raw = await sharp(file).resize(w, h, { fit: "fill" }).extractChannel(0).raw().toBuffer();
    return Uint8Array.from(raw, (v) => (v > 127 ? 1 : 0));
  }
  const mask = await personMask(crop, w, h);
  if (mask) await sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: w, height: h, channels: 1 } }).png().toFile(file);
  return mask;
}

export async function portrait(slug: string, opts: { sam?: boolean; hatch?: number; light?: number; lift?: number; gamma?: number; preview?: string } = {}): Promise<Portrait> {
  const credits = JSON.parse(await readFile(join(ROOT, "pipeline/portraits/credits.json"), "utf8"));
  const c = credits[slug];
  if (!c) throw new Error(`no credited portrait for ${slug}`);
  const [left, top, width, height] = c.crop;
  const img = sharp(join(ROOT, "pipeline/portraits", `${slug}.jpg`)).extract({ left, top, width, height }).resize({ width: 900 });
  let crop = await img.png().toBuffer();

  const mask = opts.sam ? await cachedMask(slug, crop, 900, Math.round((900 * height) / width)) : null;
  if (opts.sam && !mask) console.log(`  ${slug}: SAM found no person; drawing the whole crop`);
  if (mask) {
    // Everything outside the person goes white, blended over a soft edge so the outline stays one line.
    // Lift the person's tones first: against white, a mid-grey face would be hatched solid.
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

  const strokes = drawLines(crop, opts);
  const out: Portrait = {
    aspect: +(height / width).toFixed(4),
    strokes,
    credit: { page: c.page, license: c.license, licenseUrl: c.licenseUrl, artist: c.artist, masked: mask ? "SAM 3.1" : "none" },
  };
  await mkdir(join(ROOT, "public/lines"), { recursive: true });
  await writeFile(join(ROOT, "public/lines", `${slug}.json`), JSON.stringify(out));

  if (opts.preview) {
    const W = 600;
    const lines = strokes.map((s) => `<polyline points="${s.map((v) => (v * W).toFixed(1)).join(",")}" fill="none" stroke="#1f2a44" stroke-width="1.2"/>`).join("");
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Math.round(W * out.aspect)}"><rect width="100%" height="100%" fill="#f3e9d4"/>${lines}</svg>`))
      .png()
      .toFile(opts.preview);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
