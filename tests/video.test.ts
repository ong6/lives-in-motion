import { describe, expect, it } from "vitest";
import { FILM, cameraAt, covers, distance, easeInOutSine, lensFor, project, settled } from "@/pipeline/film/camera";
import { LINE, drawnStrokes, lineAt, strokeLengths } from "@/pipeline/film/line";
import { aimAt, bboxOf, matteFromDiff } from "@/pipeline/film/matte";
import { planScene } from "@/pipeline/film/render";
import { Scene } from "@/lib/schema";

const centre = { x: 0.5, y: 0.5 };
const full = { left: 0, top: 0, width: 1, height: 1 };

describe("timing curves", () => {
  it("ease in-out starts and ends still and is monotonic", () => {
    expect(easeInOutSine(0)).toBe(0);
    expect(easeInOutSine(1)).toBeCloseTo(1);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5);
    for (let t = 0; t < 1; t += 0.05) expect(easeInOutSine(t + 0.05)).toBeGreaterThanOrEqual(easeInOutSine(t));
  });

  it("the camera pushes forward the whole clip, trucks from one side to the other, and settles early", () => {
    const a = cameraAt(0, 1), m = cameraAt(0.5, 1), b = cameraAt(1, 1);
    expect(a.z).toBe(0);
    expect(b.z).toBeCloseTo(FILM.push);
    expect(m.z).toBeGreaterThan(a.z);
    expect(a.x).toBeCloseTo(-FILM.truck);
    expect(b.x).toBeCloseTo(FILM.truck);
    expect(cameraAt(1, -1).x).toBeCloseTo(-FILM.truck);
    expect(a.settle).toBe(1);
    expect(cameraAt(FILM.settleSpan, 1).settle).toBe(0);
  });

  it("never moves the camera backwards", () => {
    let z = -1;
    for (let i = 0; i <= 100; i++) {
      const c = cameraAt(i / 100);
      expect(c.z).toBeGreaterThanOrEqual(z);
      z = c.z;
    }
  });
});

describe("layer placement", () => {
  it("leaves everything where it was authored with the camera at rest", () => {
    const r = { left: 0.2, top: 0.4, width: 0.25, height: 0.375 };
    expect(project(r, 0.7, { z: 0, x: 0, settle: 0 }, centre)).toEqual(r);
  });

  it("near layers grow and slide more than far ones (parallax)", () => {
    const cam = cameraAt(1, 1);
    const near = project(full, 1, cam, centre), far = project(full, 0, cam, centre);
    expect(distance(1)).toBeLessThan(distance(0));
    expect(near.width).toBeGreaterThan(far.width);
    expect(far.width).toBeGreaterThan(1);
    const slide = (r: typeof full) => r.left + r.width / 2 - 0.5;
    expect(Math.abs(slide(near))).toBeGreaterThan(Math.abs(slide(far)));
  });

  it("the lens keeps the background covering the frame for the whole clip", () => {
    for (const focal of [centre, { x: 0.2, y: 0.7 }, { x: 0.8, y: 0.35 }])
      for (const dir of [1, -1] as const) {
        const lens = lensFor(0, dir, focal);
        expect(lens).toBeGreaterThanOrEqual(1);
        expect(lens).toBeLessThan(1.15);
        for (let i = 0; i <= 50; i++) expect(covers(project(full, 0, cameraAt(i / 50, dir), focal, lens))).toBe(true);
      }
  });

  it("the settle starts low and small about the subject's foot and ends exactly in place", () => {
    const r = { left: 0, top: 0, width: 1, height: 1 };
    const foot = { x: 0.6, y: 0.9 };
    const start = settled(r, 1, foot);
    expect(start.width).toBeLessThan(1);
    // The foot itself only drops; it doesn't slide sideways.
    expect(foot.x - start.left).toBeCloseTo((foot.x - r.left) * start.width);
    expect(start.top).toBeGreaterThan(r.top);
    expect(settled(r, 0, foot)).toEqual(r);
  });
});

describe("scene plan", () => {
  const base = Scene.parse({
    id: "s2",
    year: "2001",
    title: "t",
    caption: "c",
    visual: "v",
    sources: [{ label: "a", url: "https://a.example" }],
    plate: "/stories/x/s2/plate.webp",
  });
  const cut = { id: "cut-1", concept: "man", depth: 0.6, x: 70, y: 90, w: 30, src: "/stories/x/s2/cut-1.webp" };

  it("is null without a plate on disk", () => {
    expect(planScene(base, () => false)).toBeNull();
  });

  it("falls back to a push-in on the plate, preferring the full-size PNG", () => {
    const p = planScene(base, () => true)!;
    expect(p).toEqual({ plate: "/stories/x/s2/plate.png", clean: null, depth: FILM.plateDepth, dir: -1 });
  });

  it("separates the subject only with cut-outs and a clean background on disk", () => {
    const withBoth = { ...base, background: "/stories/x/s2/background.webp", layers: [cut] };
    expect(planScene(withBoth, () => true)).toMatchObject({ clean: "/stories/x/s2/background.webp", depth: 0.6 });
    expect(planScene(withBoth, (u) => !u.includes("background"))!.clean).toBeNull();
    expect(planScene({ ...base, background: "/stories/x/s2/background.webp" }, () => true)!.clean).toBeNull();
  });
});

describe("subject matte", () => {
  const W = 120;
  const field = (f: (x: number, y: number) => number) => {
    const d = new Float32Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) d[y * W + x] = f(x, y);
    return d;
  };

  it("keeps a solid subject, fills its enclosed holes and drops thin re-render lines", () => {
    // A 40×60 subject (with a hole the colours happen to match in) and a one-pixel line elsewhere.
    const diff = field((x, y) => {
      const inBody = x >= 60 && x < 100 && y >= 40 && y < 100;
      const hole = x >= 75 && x < 85 && y >= 60 && y < 70;
      if (inBody && !hole) return 120;
      return x === 20 ? 200 : 5;
    });
    const m = matteFromDiff(diff, W, W);
    expect(m[65 * W + 80]).toBeGreaterThan(0.9);
    expect(m[70 * W + 20]).toBeLessThan(0.05);
    expect(m[10 * W + 10]).toBeLessThan(0.05);
    const box = bboxOf(m, W, W)!;
    expect(box.left).toBeCloseTo(60 / W, 1);
    expect(box.top + box.height).toBeCloseTo(100 / W, 1);
  });

  it("finds nothing in noise below the threshold", () => {
    expect(bboxOf(matteFromDiff(field((x, y) => (x * 7 + y * 13) % 25), W, W), W, W)).toBeNull();
  });

  it("aims between the frame centre and the subject, trucking toward its side", () => {
    const a = aimAt({ left: 0.6, top: 0.3, width: 0.3, height: 0.6 });
    expect(a.focal.x).toBeGreaterThan(0.5);
    expect(a.focal.x).toBeLessThan(0.75);
    expect(a.dir).toBe(1);
    expect(aimAt({ left: 0.1, top: 0.3, width: 0.2, height: 0.6 }).dir).toBe(-1);
  });
});

describe("line scenes", () => {
  // Two strokes: 0.4 of pen travel, then 0.6 (the jump between them doesn't count).
  const strokes = [
    [0, 0, 0.4, 0],
    [0, 0.5, 0, 0.8, 0.3, 0.8],
  ];

  it("measures pen travel per stroke, cumulatively", () => {
    const cum = strokeLengths(strokes);
    expect(cum[0]).toBeCloseTo(0.4);
    expect(cum[1]).toBeCloseTo(1);
  });

  it("draws nothing at the start, everything at the end, and cuts the stroke in progress", () => {
    expect(drawnStrokes(strokes, 0)).toEqual([]);
    expect(drawnStrokes(strokes, 1)).toEqual(strokes);
    expect(drawnStrokes(strokes, 0.2)[0]).toEqual([0, 0, 0.2, 0]);
    const mid = drawnStrokes(strokes, 0.8);
    expect(mid).toHaveLength(2);
    expect(mid[1].slice(0, 4)).toEqual([0, 0.5, 0, 0.8]);
    expect(mid[1][4]).toBeCloseTo(0.1);
  });

  it("opens on a faint print with full ink and ends on the plate with softened lines", () => {
    const a = lineAt(0), b = lineAt(1);
    expect(a.pen).toBe(0);
    expect(a.plate).toBeCloseTo(LINE.ghost);
    expect(a.ink).toBe(1);
    expect(lineAt(LINE.drawEnd).pen).toBeCloseTo(1);
    expect(b.plate).toBeCloseTo(1);
    expect(b.ink).toBeCloseTo(LINE.lineRest);
    for (let i = 0; i < 50; i++) {
      const p = lineAt(i / 50), q = lineAt((i + 1) / 50);
      expect(q.pen).toBeGreaterThanOrEqual(p.pen);
      expect(q.plate).toBeGreaterThanOrEqual(p.plate);
    }
  });
});
