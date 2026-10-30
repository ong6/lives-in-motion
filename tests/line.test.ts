import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { dft, evaluate, type Pt } from "@/lib/fourier";
import { pathData } from "@/lib/draw";
import { contourRings, joinRings, jumpRanges, lineArt, loadGray, resample } from "@/pipeline/line";

describe("fourier", () => {
  it("rebuilds a sampled shape exactly at the sample points", () => {
    const square: Pt[] = resample([[0, 0], [1, 0], [1, 1], [0, 1]], 64);
    const terms = dft(square);
    for (const [k, p] of square.entries()) {
      const [x, y] = evaluate(terms, k / 64).pen;
      expect(x).toBeCloseTo(p[0], 6);
      expect(y).toBeCloseTo(p[1], 6);
    }
  });
  it("puts the biggest circle first", () => {
    const circle: Pt[] = Array.from({ length: 32 }, (_, k) => [Math.cos((2 * Math.PI * k) / 32), Math.sin((2 * Math.PI * k) / 32)]);
    const [first, second] = dft(circle);
    expect(first.freq).toBe(1);
    expect(first.amp).toBeCloseTo(1, 6);
    expect(second.amp).toBeLessThan(1e-9);
  });
});

describe("line art", () => {
  const shapes = () =>
    sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#fff"/><circle cx="70" cy="100" r="40" fill="#000"/><rect x="120" y="60" width="50" height="80" fill="#000"/></svg>`))
      .png()
      .toBuffer();

  it("finds one contour per shape and none along the frame", async () => {
    expect(contourRings(await loadGray(await shapes(), 200, 1), [128])).toHaveLength(2);
  });

  it("joins contours into one stroke and marks the pen travel between them", async () => {
    const { path, jumps } = joinRings(contourRings(await loadGray(await shapes(), 200, 1), [128]));
    expect(jumps).toHaveLength(2); // across to the second shape, and home again
    const gaps = jumpRanges(path, jumps);
    expect(gaps.length).toBeGreaterThan(0);
    for (const [a, b] of gaps) expect(b).toBeGreaterThan(a);
  });

  it("produces a closed series that stays in the unit box", async () => {
    const art = lineArt(await loadGray(await shapes(), 200, 1), { levels: [128], samples: 512, keep: 200 });
    expect(art.terms).toHaveLength(200);
    for (let t = 0; t < 1; t += 0.05) {
      const [x, y] = evaluate(art.terms, t).pen;
      expect(Math.abs(x)).toBeLessThan(0.6);
      expect(Math.abs(y)).toBeLessThan(0.6);
    }
    const { ink, travel } = pathData(art.terms, art.gaps, 1, 400);
    expect(ink).toMatch(/^M/);
    expect(travel).toMatch(/^M/);
  });
});
