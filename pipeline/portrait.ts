/**
 * pnpm portrait <slug> [--preview <png>]: the credited photo in pipeline/portraits → a
 * single-line Fourier portrait in public/lines/<slug>.json. With MODEL_API_KEY set, SAM 3.1
 * isolates the person; without it an oval around the face stands in for the mask.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { applyMask, lineArt, loadGray, ovalMask } from "./line";
import { pathData } from "../lib/draw";
import { personMask } from "./sam";

const ROOT = new URL("..", import.meta.url).pathname;

export async function portrait(slug: string, preview?: string) {
  const credits = JSON.parse(await readFile(join(ROOT, "pipeline/portraits/credits.json"), "utf8"));
  const c = credits[slug];
  if (!c) throw new Error(`no credited portrait for ${slug}`);
  const [left, top, width, height] = c.crop;
  const crop = await sharp(join(ROOT, "pipeline/portraits", `${slug}.jpg`)).extract({ left, top, width, height }).png().toBuffer();
  const gray = await loadGray(crop, 320, 1.8);
  const mask = process.env.MODEL_API_KEY ? await personMask(crop, gray.w, gray.h) : null;
  const [cx, cy, rx, ry] = c.oval;
  const art = lineArt(applyMask(gray, mask ?? ovalMask(gray.w, gray.h, cx, cy, rx, ry)), { levels: [55, 100, 145, 190], minPoints: 30 });
  const credit = { page: c.page, license: c.license, licenseUrl: c.licenseUrl, artist: c.artist, masked: mask ? "SAM 3.1" : "oval" };
  await mkdir(join(ROOT, "public/lines"), { recursive: true });
  await writeFile(join(ROOT, "public/lines", `${slug}.json`), JSON.stringify({ ...art, credit }));
  if (preview) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="600" height="600"><rect width="100" height="100" fill="#f3e9d4"/>${(({ ink, travel }) => `<path d="${travel}" fill="none" stroke="#1f2a44" stroke-opacity=".12" stroke-width="0.25"/><path d="${ink}" fill="none" stroke="#1f2a44" stroke-width="0.3"/>`)(pathData(art.terms, art.gaps))}</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(preview);
  }
  return art;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.loadEnvFile(join(ROOT, ".env")); } catch { /* no key: oval mask */ }
  const [slug, flag, file] = process.argv.slice(2);
  const art = await portrait(slug, flag === "--preview" ? file : undefined);
  console.log(slug, art.terms.length, "terms");
}
