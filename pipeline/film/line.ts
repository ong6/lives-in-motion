/**
 * Line scenes. A line-treatment scene films its own making: the pen-plotter line traced from the
 * plate draws itself stroke by stroke over the era's paper, the plate develops underneath it
 * (from a faint print to full colour), the lines soften as the picture takes over, and the
 * camera pushes in slowly. Pure.
 */
import { clamp01, easeInOutSine, easeOutCubic, lerp } from "./camera";

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
