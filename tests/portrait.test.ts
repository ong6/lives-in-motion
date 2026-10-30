import { describe, expect, it } from "vitest";
import { parsePolylines } from "@/pipeline/portrait";

describe("linedraw output", () => {
  it("reads polylines into unit-width flat point arrays and drops single points", () => {
    const svg = `<svg><polyline points="0,0,256,128,512,512" /><polyline points="10,10" /></svg>`;
    expect(parsePolylines(svg)).toEqual([[0, 0, 0.5, 0.25, 1, 1]]);
  });
});

describe("mask holes", () => {
  it("fills a hole inside the subject but keeps the open background", async () => {
    const { fillHoles } = await import("@/pipeline/sam");
    // 5×5: a ring of subject around a one-pixel hole, background on the border.
    const m = Uint8Array.from([0,0,0,0,0, 0,1,1,1,0, 0,1,0,1,0, 0,1,1,1,0, 0,0,0,0,0]);
    const f = fillHoles(m, 5, 5);
    expect(f[12]).toBe(1);
    expect(f[0]).toBe(0);
  });
});
