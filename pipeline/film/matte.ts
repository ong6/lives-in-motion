/**
 * The subject matte. The subject is whatever the clean background removed: plate and background
 * differ there. This is exact to the clean plate by construction (so the hole it leaves is always
 * covered) and does not depend on the SAM mask raster. Pure.
 */
import { lerp, type Rect } from "./camera";

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
