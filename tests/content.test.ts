import { describe, expect, it } from "vitest";
import { allStories } from "@/lib/stories";
import { ERAS, eraFor } from "@/lib/eras";
import { readFileSync } from "node:fs";

const stories = allStories();

/** WCAG relative-luminance contrast ratio. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("stories", () => {
  it("are the three lives, in gallery order", () => {
    expect(stories.map((s) => s.slug)).toEqual(["jack-sim", "lee-kuan-yew", "joseph-schooling"]);
  });
  for (const s of stories) {
    describe(s.name, () => {
      it("cites every scene", () => {
        for (const sc of s.scenes) expect(sc.sources.length, sc.id).toBeGreaterThan(0);
      });
      it("runs in chronological order", () => {
        const years = s.scenes.map((sc) => Number(sc.year));
        expect([...years].sort((a, b) => a - b)).toEqual(years);
      });
      it("keeps faces and flags out of the image briefs", () => {
        for (const sc of s.scenes) expect(sc.visual.toLowerCase(), sc.id).not.toMatch(/\b(face|portrait|smil\w*|flags?)\b/);
      });
      it("mixes art treatments", () => {
        expect(new Set(s.scenes.map((sc) => sc.treatment)).size).toBeGreaterThan(1);
      });
      it("has a credited single-line portrait", () => {
        const art = JSON.parse(readFileSync(`public/lines/${s.slug}.json`, "utf8"));
        expect(art.terms.length).toBeGreaterThan(500);
        expect(art.credit.license).toMatch(/Public domain|CC BY/);
      });
    });
  }
});

describe("eras", () => {
  it("cover every year from 1819 with exactly one preset", () => {
    for (let y = 1819; y <= 2100; y++) expect(ERAS.filter((e) => y >= e.from && y <= e.to)).toHaveLength(1);
  });
  it("map key years", () => {
    expect(eraFor(1965).id).toBe("nation-building");
    expect(eraFor("2001").id).toBe("global-city");
  });
  it("keep body and muted text readable on their paper (WCAG AA)", () => {
    for (const e of ERAS) {
      expect(contrast(e.ink, e.paper), e.id).toBeGreaterThanOrEqual(7);
      expect(contrast(e.muted, e.paper), e.id).toBeGreaterThanOrEqual(4.5);
    }
  });
});
