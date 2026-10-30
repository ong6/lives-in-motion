import { evaluate, type Term } from "./fourier";

/** Is t inside one of the pen-travel ranges? */
export const inGap = (gaps: [number, number][], t: number) => gaps.some(([a, b]) => t >= a && t <= b);

/**
 * SVG path data for the series from t=0 to t=end in a `size` box, split into the drawn line
 * and the faint pen travel between contours.
 */
export function pathData(terms: Term[], gaps: [number, number][] = [], end = 1, steps = 3000, size = 100, count?: number) {
  const n = Math.max(2, Math.round(steps * end));
  let ink = "";
  let travel = "";
  let prev: string | null = null;
  let prevGap: boolean | null = null;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * end;
    const [x, y] = evaluate(terms, t, count).pen;
    const pt = `${(x * size + size / 2).toFixed(2)} ${(y * size + size / 2).toFixed(2)}`;
    const gap = inGap(gaps, t);
    if (gap !== prevGap && prev) {
      // Start the new stroke where the last one ended so the line stays continuous.
      if (gap) travel += `M${prev}`;
      else ink += `M${prev}`;
    }
    if (gap) travel += prevGap === gap ? `L${pt}` : prev ? `L${pt}` : `M${pt}`;
    else ink += prevGap === gap ? `L${pt}` : prev ? `L${pt}` : `M${pt}`;
    prev = pt;
    prevGap = gap;
  }
  return { ink, travel };
}
