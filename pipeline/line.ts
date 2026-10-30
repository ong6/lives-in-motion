/**
 * Image → one continuous line → Fourier terms.
 *
 * 1. Contours: iso-lines of the blurred image at a few tone levels (d3-contour's marching
 *    squares). Contours read as a drawing far better than edge or stipple points; it is
 *    the approach of LingDong's linedraw. A SAM 3.1 mask, when given, whitens the background
 *    so the subject's silhouette becomes the outermost contour.
 * 2. Join: closed contours are chained into one stroke, entering each at its point nearest
 *    the pen, so the connecting jumps stay short.
 * 3. Resample by arc length and take the DFT (lib/fourier.ts); the site draws it with epicycles.
 */
import sharp from "sharp";
import { contours } from "d3-contour";
import { dft, type Pt, type Term } from "../lib/fourier";

export interface Gray {
  data: Float64Array;
  w: number;
  h: number;
  /** Optional 0/1 subject mask; contours hugging its border are dropped. */
  mask?: Uint8Array;
}

export async function loadGray(input: Buffer | string, size = 320, blur = 2): Promise<Gray> {
  const { data, info } = await sharp(input)
    .resize(size, size, { fit: "inside" })
    .flatten({ background: "#fff" })
    .grayscale()
    .normalise()
    .blur(blur)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: Float64Array.from(data), w: info.width, h: info.height };
}

/** Whiten everything outside a 0/1 mask of the same size. */
export function applyMask(g: Gray, mask: Uint8Array): Gray {
  return { ...g, mask, data: g.data.map((v, i) => (mask[i] ? v : 255)) };
}

/** A soft oval 0/1 mask: the stand-in for a SAM 3.1 person mask when there is no API key. */
export function ovalMask(w: number, h: number, cx = 0.5, cy = 0.5, rx = 0.46, ry = 0.5): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) m[y * w + x] = ((x / w - cx) / rx) ** 2 + ((y / h - cy) / ry) ** 2 <= 1 ? 1 : 0;
  return m;
}

/** Closed iso-lines at each tone level, longest first; short specks are dropped. */
export function contourRings(g: Gray, levels: number[], minPoints = 24): Pt[][] {
  const rings: Pt[][] = [];
  for (const poly of contours().size([g.w, g.h]).thresholds(levels)(Array.from(g.data))) {
    for (const polygon of poly.coordinates)
      for (const ring of polygon) {
        // Rings that run along the image border or the mask's edge are the frame, not the drawing.
        const onEdge = ring.filter(([x, y]) => nearBorder(g, x, y)).length;
        if (ring.length >= minPoints && onEdge < ring.length * 0.2) rings.push(ring as Pt[]);
      }
  }
  return rings.sort((a, b) => b.length - a.length);
}

function nearBorder(g: Gray, x: number, y: number, r = 3): boolean {
  if (x <= 1 || y <= 1 || x >= g.w - 1 || y >= g.h - 1) return true;
  if (!g.mask) return false;
  for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
    const nx = Math.round(x + dx), ny = Math.round(y + dy);
    if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h || !g.mask[ny * g.w + nx]) return true;
  }
  return false;
}

const dist2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/**
 * Chain closed rings into one stroke: from the pen, enter the nearest ring at its nearest
 * point, go round, repeat. `jumps` holds the index of each connecting segment's start.
 */
export function joinRings(rings: Pt[][]): { path: Pt[]; jumps: number[] } {
  if (!rings.length) return { path: [], jumps: [] };
  const left = rings.slice(1);
  const path: Pt[] = [...rings[0], rings[0][0]];
  const jumps: number[] = [];
  while (left.length) {
    const pen = path[path.length - 1];
    let best = { ring: 0, at: 0, d: Infinity };
    left.forEach((ring, r) => {
      for (let i = 0; i < ring.length; i += 3) {
        const d = dist2(pen, ring[i]);
        if (d < best.d) best = { ring: r, at: i, d };
      }
    });
    const ring = left.splice(best.ring, 1)[0];
    jumps.push(path.length - 1);
    for (let k = 0; k <= ring.length; k++) path.push(ring[(best.at + k) % ring.length]);
  }
  jumps.push(path.length - 1); // the closing segment back to the start
  return { path, jumps };
}

/** Each jump segment as a [t0, t1] range of the closed path's arc length (0–1). */
export function jumpRanges(path: Pt[], jumps: number[]): [number, number][] {
  const closed = [...path, path[0]];
  const cum = [0];
  for (let i = 1; i < closed.length; i++) cum.push(cum[i - 1] + Math.sqrt(dist2(closed[i], closed[i - 1])));
  const total = cum[cum.length - 1] || 1;
  return jumps.map((i) => [+(cum[i] / total).toFixed(5), +(cum[i + 1] / total).toFixed(5)] as [number, number]).filter(([a, b]) => b - a > 0.002);
}

/** N points evenly spaced along the closed polyline. */
export function resample(path: Pt[], n: number): Pt[] {
  const closed = [...path, path[0]];
  const seg = closed.slice(1).map((p, i) => Math.sqrt(dist2(p, closed[i])));
  const total = seg.reduce((a, b) => a + b, 0);
  const out: Pt[] = [];
  let i = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (i < seg.length - 1 && acc + seg[i] < target) acc += seg[i++];
    const f = seg[i] ? (target - acc) / seg[i] : 0;
    const [a, b] = [closed[i], closed[i + 1]];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

export interface LineArt {
  /** Terms in a unit box centred on 0 (x, y within about ±0.5), largest first. */
  terms: Term[];
  /** Stretches where the pen travels between contours; drawn faintly. */
  gaps: [number, number][];
  aspect: number;
}

export function lineArt(g: Gray, opts: { levels?: number[]; minPoints?: number; samples?: number; keep?: number } = {}): LineArt {
  const rings = contourRings(g, opts.levels ?? [70, 120, 170], opts.minPoints);
  const { path, jumps } = joinRings(rings);
  if (path.length < 3) throw new Error("no contours found: try other levels");
  const s = Math.max(g.w, g.h);
  const norm = resample(path, opts.samples ?? 4096).map(([x, y]) => [(x - g.w / 2) / s, (y - g.h / 2) / s] as Pt);
  const terms = dft(norm)
    .slice(0, opts.keep ?? 1500)
    .map((t) => ({ freq: t.freq, amp: +t.amp.toFixed(5), phase: +t.phase.toFixed(4) }));
  return { terms, gaps: jumpRanges(path, jumps), aspect: g.w / g.h };
}
