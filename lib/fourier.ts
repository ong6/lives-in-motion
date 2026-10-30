/**
 * A closed path as a Fourier series: point(t) = Σ amp·e^{i(freq·2πt + phase)}, t ∈ [0, 1).
 * Drawing it with the largest terms first is the epicycle animation; fewer terms give a
 * looser, more gestural line, more terms converge on the traced outline.
 */
export interface Term {
  freq: number;
  amp: number;
  phase: number;
}

export type Pt = [number, number];

/** Discrete Fourier transform of N evenly spaced samples, terms sorted by amplitude. */
export function dft(points: Pt[]): Term[] {
  const N = points.length;
  const terms: Term[] = [];
  for (let k = 0; k < N; k++) {
    // Signed frequencies (-N/2 … N/2) so the series is smooth between samples.
    const freq = k <= N / 2 ? k : k - N;
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      const a = (-2 * Math.PI * freq * n) / N;
      const [x, y] = points[n];
      re += x * Math.cos(a) - y * Math.sin(a);
      im += x * Math.sin(a) + y * Math.cos(a);
    }
    re /= N;
    im /= N;
    terms.push({ freq, amp: Math.hypot(re, im), phase: Math.atan2(im, re) });
  }
  return terms.sort((a, b) => b.amp - a.amp);
}

/** The pen position at time t using the first `count` terms, plus each epicycle's centre. */
export function evaluate(terms: Term[], t: number, count = terms.length): { pen: Pt; centres: Pt[] } {
  let x = 0;
  let y = 0;
  const centres: Pt[] = [];
  for (let i = 0; i < Math.min(count, terms.length); i++) {
    centres.push([x, y]);
    const { freq, amp, phase } = terms[i];
    const a = freq * 2 * Math.PI * t + phase;
    x += amp * Math.cos(a);
    y += amp * Math.sin(a);
  }
  return { pen: [x, y], centres };
}

/** Sample the series into a polyline from t=0 to t=end. */
export function trace(terms: Term[], end: number, steps: number, count?: number): Pt[] {
  const out: Pt[] = [];
  const n = Math.max(2, Math.round(steps * end));
  for (let i = 0; i <= n; i++) out.push(evaluate(terms, (i / n) * end, count).pen);
  return out;
}
