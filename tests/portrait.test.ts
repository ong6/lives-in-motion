import { describe, expect, it } from "vitest";
import { parsePolylines } from "@/pipeline/portrait";

describe("linedraw output", () => {
  it("reads polylines into unit-width flat point arrays and drops single points", () => {
    const svg = `<svg><polyline points="0,0,256,128,512,512" /><polyline points="10,10" /></svg>`;
    expect(parsePolylines(svg)).toEqual([[0, 0, 0.5, 0.25, 1, 1]]);
  });
});
