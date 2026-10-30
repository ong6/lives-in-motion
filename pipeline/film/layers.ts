/**
 * Separating a plate into layers for a film: the subject (everything the clean background
 * removed) as one image, or split between the SAM 3.1 cut-outs so each can move on its own.
 */
import sharp from "sharp";
import type { Rect } from "./camera";
import type { Img } from "./frame";
import { blur, bboxOf, matteFromDiff } from "./matte";

/** Matte resolution: the plate/background difference is measured on a W×W grid. */
const MATTE = 700;

/** Soft matte of everything the clean background removed, on the MATTE grid. */
async function diffMatte(plateFile: string, cleanFile: string) {
  const W = MATTE;
  const rgb = (file: string) => sharp(file).removeAlpha().resize(W, W, { fit: "fill" }).blur(1.5).raw().toBuffer();
  const [a, b] = await Promise.all([rgb(plateFile), rgb(cleanFile)]);
  const diff = new Float32Array(W * W);
  for (let i = 0; i < diff.length; i++) diff[i] = Math.hypot(a[i * 3] - b[i * 3], a[i * 3 + 1] - b[i * 3 + 1], a[i * 3 + 2] - b[i * 3 + 2]);
  return matteFromDiff(diff, W, W);
}

/** Plate colours with a MATTE-grid alpha, as a side×side premultiplied image. */
async function cutOut(plateFile: string, m: Float32Array, side: number): Promise<Img> {
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
export async function separate(plateFile: string, cleanFile: string, side: number) {
  const m = await diffMatte(plateFile, cleanFile);
  const box = bboxOf(m, MATTE, MATTE);
  if (!box) return null;
  return { img: await cutOut(plateFile, m, side), box };
}

/**
 * Split the difference matte between the SAM cut-outs, so each layer can move on its own: every
 * matte pixel goes to the cut whose (dilated) mask is strongest there; pixels no cut claims go
 * to the largest layer, so the hole in the clean background is always covered by something.
 */
export async function separateLayers(plateFile: string, cleanFile: string, side: number, layers: { id: string; rect: Rect; cut: string }[]) {
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
