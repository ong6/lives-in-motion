import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Story } from "../src/schema";
import { MOTIFS, motifSvg } from "../src/motifs";
import { ERAS, eraFor } from "../src/eras";

const dir = join(__dirname, "..", "stories");
const stories = readdirSync(dir).map((slug) => Story.parse(JSON.parse(readFileSync(join(dir, slug, "story.json"), "utf8"))));

describe("stories", () => {
  it("has the first three lives in order of the brief", () => {
    expect(stories.map((s) => s.slug).sort()).toEqual(["jack-sim", "joseph-schooling", "lee-kuan-yew"]);
  });

  for (const s of stories) {
    describe(s.name, () => {
      it("cites every scene with an https source", () => {
        for (const sc of s.scenes) {
          expect(sc.sources.length).toBeGreaterThan(0);
          for (const src of sc.sources) expect(src.url).toMatch(/^https?:\/\//);
        }
      });
      it("runs in chronological order", () => {
        const years = s.scenes.map((sc) => Number(sc.year));
        expect([...years].sort((a, b) => a - b)).toEqual(years);
      });
      it("only uses motifs that exist", () => {
        for (const sc of s.scenes) for (const l of sc.layers) if (l.motif) expect(MOTIFS[l.motif], `${sc.id}/${l.motif}`).toBeDefined();
      });
      it("keeps layer ids unique within a scene", () => {
        for (const sc of s.scenes) expect(new Set(sc.layers.map((l) => l.id)).size).toBe(sc.layers.length);
      });
      it("never describes a face in a visual brief", () => {
        for (const sc of s.scenes) expect(sc.visual.toLowerCase()).not.toMatch(/\b(face|portrait|smil)/);
      });
    });
  }
});

describe("eras", () => {
  it("covers every year from 1819 to 2100 with exactly one preset", () => {
    for (let y = 1819; y <= 2100; y++) expect(ERAS.filter((e) => y >= e.from && y <= e.to)).toHaveLength(1);
  });
  it("maps key years", () => {
    expect(eraFor(1965).id).toBe("nation-building");
    expect(eraFor("2001").id).toBe("global-city");
    expect(eraFor(1942).id).toBe("occupation");
  });
});

describe("motifs", () => {
  it("every motif renders a well-formed svg with each era's inks", () => {
    for (const name of Object.keys(MOTIFS))
      for (const e of ERAS) {
        const svg = motifSvg(name, e, "19 NOV");
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg).not.toMatch(/NaN|undefined/);
      }
  });
  it("escapes motif text", () => {
    expect(motifSvg("banner", ERAS[0], "<b>&")).toContain("&#60;b&#62;&#38;");
  });
});
