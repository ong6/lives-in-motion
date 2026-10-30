import { describe, expect, it } from "vitest";
import {
  LIMITS,
  fitPlan,
  layerAt,
  layerBox,
  layerRect,
  lensForPath,
  planCamera,
  planProblems,
  sanitizePlan,
  visibleShare,
  type MotionPlan,
} from "@/pipeline/video";
import { MIN_SCORE, bestRound, criticSchema, planSchema, type Round } from "@/pipeline/wonder";
import { PRICES, wonderCost, wonderWorst } from "@/pipeline/budget";

const layers = [
  { id: "cut-1", depth: 0.6 },
  { id: "cut-2", depth: 0.8 },
];
const boxes = {
  "cut-1": { left: 0.35, top: 0.4, width: 0.3, height: 0.55 },
  "cut-2": { left: 0.05, top: 0.6, width: 0.2, height: 0.35 },
};

const wild = {
  focusX: 7,
  focusY: -3,
  rationale: "x".repeat(1000),
  ambient: "fireworks",
  camera: [
    { t: 3.5, zoom: 4, panX: 1, panY: -1, ease: "bounce" },
    { t: 0.2, zoom: 0.5, panX: "left", panY: 0, ease: "in" },
    { t: 0.22, zoom: 1.1, panX: 0, panY: 0, ease: "out" },
  ],
  layers: [
    { id: "cut-1", depth: 9, driftX: 0.9, driftY: -0.9, scale: 3, enter: "explode", enterAt: 0.9, enterFor: 2 },
    { id: "cut-1", depth: 0.5, driftX: 0, driftY: 0, scale: 1, enter: "none", enterAt: 0, enterFor: 0.2 },
    { id: "ghost", depth: 0.5 },
  ],
};

const inRange = (p: MotionPlan) => {
  const L = LIMITS;
  expect(p.focusX).toBeGreaterThanOrEqual(L.focus.min);
  expect(p.focusX).toBeLessThanOrEqual(L.focus.max);
  expect(p.camera.length).toBeGreaterThanOrEqual(L.keys.min);
  expect(p.camera.length).toBeLessThanOrEqual(L.keys.max);
  expect(p.camera[0].t).toBe(0);
  expect(p.camera[p.camera.length - 1].t).toBe(1);
  for (let i = 1; i < p.camera.length; i++) expect(p.camera[i].t - p.camera[i - 1].t).toBeGreaterThanOrEqual(L.keyGap);
  for (const k of p.camera) {
    expect(k.zoom).toBeGreaterThanOrEqual(L.zoom.min);
    expect(k.zoom).toBeLessThanOrEqual(L.zoom.max);
    expect(Math.abs(k.panX)).toBeLessThanOrEqual(L.pan);
    expect(Math.abs(k.panY)).toBeLessThanOrEqual(L.pan);
  }
  for (const m of p.layers) {
    expect(m.depth).toBeGreaterThanOrEqual(L.depth.min);
    expect(m.depth).toBeLessThanOrEqual(L.depth.max);
    expect(Math.abs(m.driftX)).toBeLessThanOrEqual(L.drift);
    expect(Math.abs(m.driftY)).toBeLessThanOrEqual(L.drift);
    expect(m.scale).toBeGreaterThanOrEqual(L.scale.min);
    expect(m.scale).toBeLessThanOrEqual(L.scale.max);
    expect(m.enterAt + m.enterFor).toBeLessThanOrEqual(L.enterEnd + 1e-9);
  }
};

describe("motion plan validation", () => {
  it("clamps every number, replaces unknown enums and reports what it changed", () => {
    const { plan, fixes } = sanitizePlan(wild, layers);
    inRange(plan);
    expect(plan.ambient).toBe("light-sweep");
    expect(plan.camera.every((k) => ["linear", "in-out", "in", "out"].includes(k.ease))).toBe(true);
    expect(plan.layers.find((m) => m.id === "cut-1")!.enter).toBe("none");
    expect(plan.rationale.length).toBeLessThanOrEqual(400);
    expect(fixes.length).toBeGreaterThan(5);
  });

  it("keeps exactly one move per known layer: unknown and duplicate ids dropped, missing ones held still", () => {
    const { plan, fixes } = sanitizePlan(wild, layers);
    expect(plan.layers.map((m) => m.id)).toEqual(["cut-1", "cut-2"]);
    expect(plan.layers[0].depth).toBe(LIMITS.depth.max);
    expect(plan.layers[1]).toMatchObject({ depth: 0.8, driftX: 0, driftY: 0, scale: 1, enter: "none" });
    expect(fixes.join(" ")).toMatch(/unknown layer ghost/);
    expect(fixes.join(" ")).toMatch(/duplicate layer cut-1/);
  });

  it("falls back to a default move for garbage input", () => {
    for (const raw of [null, undefined, 42, "plan", [], { camera: "zoom" }]) {
      const { plan } = sanitizePlan(raw, layers);
      inRange(plan);
      expect(plan.layers).toHaveLength(2);
    }
  });

  it("is idempotent on a clean plan", () => {
    const once = sanitizePlan(wild, layers).plan;
    const twice = sanitizePlan(once, layers);
    expect(twice.plan).toEqual(once);
    expect(twice.fixes).toEqual([]);
  });

  it("rescales key times given in seconds instead of merging them", () => {
    const { plan, fixes } = sanitizePlan({ camera: [{ t: 0, zoom: 1, panX: 0, panY: 0, ease: "linear" }, { t: 1.75, zoom: 1.1, panX: 0, panY: 0, ease: "in-out" }, { t: 3.5, zoom: 1.2, panX: 0, panY: 0, ease: "out" }] }, []);
    expect(plan.camera.map((k) => k.t)).toEqual([0, 0.5, 1]);
    expect(fixes.join(" ")).toMatch(/rescaled/);
  });

  it("interpolates the camera through its keyframes", () => {
    const { plan } = sanitizePlan({ camera: [{ t: 0, zoom: 1, panX: -0.05, panY: 0, ease: "linear" }, { t: 1, zoom: 1.25, panX: 0.05, panY: 0.02, ease: "linear" }] }, []);
    expect(planCamera(plan, 0)).toMatchObject({ z: 0, x: -0.05, y: 0 });
    const end = planCamera(plan, 1);
    expect(1 / (1 - end.z)).toBeCloseTo(1.25);
    expect(end.x).toBeCloseTo(0.05);
    expect(planCamera(plan, 0.5).x).toBeCloseTo(0);
  });

  it("entrances start invisible (fade, rise, scale-in) and finish by their end", () => {
    const base = { id: "a", depth: 0.6, driftX: 0, driftY: 0, scale: 1, enterAt: 0.2, enterFor: 0.3 };
    for (const enter of ["fade", "rise", "scale-in"] as const) {
      expect(layerAt({ ...base, enter }, 0).opacity).toBe(0);
      expect(layerAt({ ...base, enter }, 0.5).opacity).toBeCloseTo(1);
    }
    expect(layerAt({ ...base, enter: "settle" }, 0).opacity).toBe(1);
    expect(layerAt({ ...base, enter: "none" }, 0)).toEqual({ opacity: 1, dx: 0, dy: 0, scale: 1 });
  });
});

describe("plan fitting: no off-frame layers", () => {
  const extreme = (): MotionPlan =>
    sanitizePlan(
      {
        focusX: 0.2,
        focusY: 0.8,
        ambient: "dust",
        camera: [
          { t: 0, zoom: 1, panX: -0.08, panY: -0.08, ease: "linear" },
          { t: 1, zoom: 1.35, panX: 0.08, panY: 0.08, ease: "linear" },
        ],
        layers: [
          { id: "cut-1", depth: 1, driftX: 0.04, driftY: 0.04, scale: 1.1, enter: "rise", enterAt: 0, enterFor: 0.3 },
          { id: "cut-2", depth: 1, driftX: -0.04, driftY: 0.04, scale: 1.1, enter: "rise", enterAt: 0, enterFor: 0.3 },
        ],
      },
      layers,
    ).plan;

  it("flags a plan that pushes a layer out of the frame", () => {
    expect(planProblems(extreme(), boxes).length).toBeGreaterThan(0);
  });

  it("damps it until every layer stays in frame and the background still covers", () => {
    const { plan, fixes } = fitPlan(extreme(), boxes);
    expect(planProblems(plan, boxes)).toEqual([]);
    expect(fixes.length).toBe(1);
    const lens = lensForPath(0, Array.from({ length: 41 }, (_, i) => planCamera(plan, i / 40)), { x: plan.focusX, y: plan.focusY });
    expect(lens).toBeLessThanOrEqual(LIMITS.lens);
    for (const m of plan.layers)
      for (let i = 0; i <= 40; i++) {
        const box = boxes[m.id as keyof typeof boxes];
        expect(visibleShare(layerBox(plan, m, box, i / 40, lens))).toBeGreaterThanOrEqual(visibleShare(box) - LIMITS.offFrame);
      }
  });

  it("leaves a plan that already fits alone", () => {
    const calm = sanitizePlan({ camera: [{ t: 0, zoom: 1, panX: 0, panY: 0, ease: "linear" }, { t: 1, zoom: 1.1, panX: 0.02, panY: 0, ease: "in-out" }] }, layers).plan;
    const { plan, fixes } = fitPlan(calm, boxes);
    expect(plan).toEqual(calm);
    expect(fixes).toEqual([]);
  });

  it("holds still when even a damped move can't fit (a layer hanging off the edge)", () => {
    const edge = { "cut-1": { left: 0.85, top: 0.85, width: 0.3, height: 0.3 }, "cut-2": boxes["cut-2"] };
    const { plan } = fitPlan(extreme(), edge);
    expect(planProblems(plan, edge)).toEqual([]);
  });

  it("places schema layers by centre x, bottom y and width", () => {
    const r = layerRect({ x: 50, y: 90, w: 40 }, 1.5);
    expect(r.left).toBeCloseTo(0.3);
    expect(r.top).toBeCloseTo(0.3);
    expect(r.width).toBeCloseTo(0.4);
    expect(r.height).toBeCloseTo(0.6);
  });
});

describe("Wonder calls", () => {
  it("prices Muse Wonder at $4 in, $0.20 cached, $20 out per million tokens", () => {
    expect(PRICES.wonderInput * 1e6).toBeCloseTo(4);
    expect(PRICES.wonderOutput * 1e6).toBeCloseTo(20);
    expect(wonderCost({ prompt_tokens: 1e6, completion_tokens: 1e6, prompt_tokens_details: { cached_tokens: 5e5 } })).toBeCloseTo(2 + 0.1 + 20);
    expect(() => wonderCost({})).toThrow();
    // The worst case always covers the whole output cap.
    expect(wonderWorst(0, 0, 10000)).toBeGreaterThanOrEqual(10000 * PRICES.wonderOutput);
  });

  it("schemas are strict: every property required, no extras", () => {
    const check = (s: any) => {
      if (s?.type === "object") {
        expect(s.additionalProperties).toBe(false);
        expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
        Object.values(s.properties).forEach(check);
      }
      if (s?.items) check(s.items);
      if (s?.anyOf) s.anyOf.forEach(check);
    };
    check(planSchema());
    check(criticSchema());
  });

  it("publishes an ok round first, else the best score, earlier on a tie", () => {
    const r = (score: number, ok = false) => ({ critique: { ok, score } }) as Round;
    expect(bestRound([r(6), r(6), r(5)])).toBe(0);
    expect(bestRound([r(5), r(7), r(7)])).toBe(1);
    expect(bestRound([r(8), r(7, true)])).toBe(1);
    expect(MIN_SCORE).toBe(7);
  });
});
