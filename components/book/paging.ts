/**
 * How a leaf turns, and the state a turn carries across a route change. Client-only.
 */

/** One leaf's turn, and how much longer each extra leaf of a riffle adds. */
export const TURN_MS = 820;
export const RIFFLE_MS = 150;
export const RIFFLE_MAX = 1700;
/** Wheel travel (px) that commits a turn; below it the leaf only peeks. */
export const COMMIT_PX = 40;
/** How far, in leaves, a peek lifts the page (0.1 ≈ 18°). */
export const PEEK = 0.1;
/** A wheel pause this long ends a gesture: a peek springs back, inertia stops being swallowed. */
export const GESTURE_GAP = 170;

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));

/**
 * The spreads playing their entrance: when it starts (performance.now()) for the JS clocks, and
 * the same moment as a delay from when the entry was made, for the CSS animations.
 */
export type Plays = Record<number, { start: number; delay: number }>;
export const playAt = (start: number) => ({ start, delay: Math.round(start - performance.now()) });

/**
 * A life handed over by the previous life's book change: the title spread's entrance started
 * there, and carries on here from the same moment.
 */
export const handoff: { to: { slug: string; start: number } | null } = { to: null };

/**
 * The wheel gesture in progress, kept across the route change of a book change: a flick that
 * skips the change to its end must not reach the next life's page as a fresh gesture and turn
 * it past its title spread. `quietUntil` swallows all wheel input until then (performance.now()).
 */
export const wheel = { last: 0, lastMag: 0, spent: false, quietUntil: 0, landed: 0 };

/** One leaf: it hesitates as it lifts, swings, and settles softly onto the pile. */
export function turnEase(t: number) {
  // A cubic Bézier (0.45, 0, 0.18, 1), solved for x by Newton's method.
  const x1 = 0.45, x2 = 0.18, y1 = 0, y2 = 1;
  const bx = (u: number) => 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u * u * (1 - u) + u ** 3;
  const dbx = (u: number) => 3 * x1 * (1 - u) ** 2 + 6 * (x2 - x1) * u * (1 - u) + 3 * (1 - x2) * u * u;
  let u = t;
  for (let i = 0; i < 6; i++) {
    const d = dbx(u);
    if (Math.abs(d) < 1e-6) break;
    u = clamp(u - (bx(u) - t) / d);
  }
  return 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u * u * (1 - u) + u ** 3;
}
