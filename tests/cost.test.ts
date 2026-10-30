import { describe, expect, it } from "vitest";
import { computeLifeCost, lifeCost } from "@/lib/cost";

const job = (slug: string, usd: Record<string, number>, scenes = ["theatre", "archive", "line"]) => ({
  slug,
  name: slug,
  status: "done",
  steps: Object.fromEntries(Object.entries(usd).map(([k, v]) => [k, { usd: v }])),
  scenes: scenes.map((treatment) => ({ treatment, plate: "/p.webp" })),
});

describe("the cost of a life", () => {
  const ledger = [
    { kind: "wonder", usd: 0.03, note: "direct-a-s1" },
    { kind: "wonder", usd: 0.04, note: "critic-a-s1-r0" },
    { kind: "wonder", usd: 0.04, note: "critic-a-s2-r0" },
    { kind: "wonder", usd: 0.04, note: "critic-a-s1-r1" },
    { kind: "search", usd: 0.04, note: "subject_check" },
  ];
  it("adds Muse Wonder's measured per-film cost to a run made before the Direct step", () => {
    const c = computeLifeCost(ledger, [job("x", { research: 0.14, storyboard: 0.03, plates: 0.07, cutouts: 0.11, frontispiece: 0.01 })]);
    // director 0.03 + critic 0.04 × (1 + half the scenes revised) = 0.09 a film, two illustrated scenes.
    expect(c.wonderPerScene).toBeCloseTo(0.09, 6);
    expect(c.parts.direct).toBeCloseTo(0.18, 6);
    expect(c.parts.screen).toBeCloseTo(0.04, 6);
    expect(c.usd).toBeCloseTo(0.04 + 0.14 + 0.03 + 0.07 + 0.11 + 0.01 + 0.18, 4);
    expect(c.label).toBe(`$${c.usd.toFixed(2)}`);
  });
  it("uses the measured Wonder spend once a run has it, and skips rehearsals and unfinished runs", () => {
    const measured = [...ledger, { kind: "wonder", usd: 0.25, note: "direct-y-s1", job: "create:y" }];
    const c = computeLifeCost(measured, [job("y", { screen: 0.05, research: 0.1, direct: 0.25 }), { ...job("m", { research: 9 }), mock: true }, { ...job("f", { research: 9 }), status: "failed" }]);
    expect(c.lives).toEqual(["y"]);
    expect(c.parts.direct).toBeCloseTo(0.25, 6);
    expect(c.usd).toBeCloseTo(0.4, 4);
  });
  it("parts always add up to the quoted figure (this checkout's ledger)", () => {
    const c = lifeCost();
    expect(Object.values(c.parts).reduce((a, b) => a + b, 0)).toBeCloseTo(c.usd, 3);
    expect(c.usd).toBeGreaterThan(0);
  });
});
