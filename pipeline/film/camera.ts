/**
 * The fixed camera every film starts from, and the 2.5D projection all films use: a virtual
 * camera pushes in and trucks sideways, and every layer moves by its own depth. Pure.
 */

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
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

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
 * near-still frame, with a little linear travel mixed in so the film never stalls mid-scene.
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
