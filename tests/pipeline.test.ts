import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { encodeSegmentationMask } from "../node_modules/@meta-sam/parser/dist/mask-codec.js";
import { factsFromCited } from "@/pipeline/stages";
import { platePrompt } from "@/pipeline/prompts";
import { cutout, parseSam } from "@/pipeline/sam";
import { eraFor } from "@/lib/eras";
import { allStories } from "@/lib/stories";

describe("research", () => {
  const text = "1957 | Born in Singapore.\n2001 | Founds the World Toilet Organization. [1]\nno year\n2013 | UN adopts World Toilet Day.";
  const at = (s: string) => text.indexOf(s);
  it("keeps only cited lines, each with the citations that overlap it", () => {
    const facts = factsFromCited({
      text,
      citations: [
        { url: "https://a.example", title: "A", start: at("Born"), end: at("Born") + 4 },
        { url: "https://b.example", title: "B", start: at("Founds"), end: at("Founds") + 6 },
      ],
    });
    expect(facts.map((f) => [f.n, f.year, f.sources.length])).toEqual([
      [1, "1957", 1],
      [2, "2001", 1],
    ]);
    expect(facts[1].text).toBe("Founds the World Toilet Organization.");
  });
});

describe("plate prompt", () => {
  it("carries the era's print style and forbids faces, flags and text", () => {
    const scene = allStories()[0].scenes.find((s) => eraFor(s.year).id === "global-city")!;
    const p = platePrompt(scene, eraFor(scene.year));
    expect(p).toContain("risograph");
    expect(p).toContain("no faces");
    expect(p).toContain("No text, letters, numbers, flags or logos");
  });
});

describe("SAM 3.1", () => {
  const sample =
    "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>" +
    "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n";
  it("decodes masks with their bounds; empty output means no match", async () => {
    expect((await parseSam(sample))[0].bounds).toEqual({ left: 211, top: 228, right: 271, bottom: 255 });
    expect(await parseSam("")).toEqual([]);
  });
  it("cuts the masked object out with alpha and places it on the stage", async () => {
    const plate = await sharp({ create: { width: 320, height: 180, channels: 3, background: "#c8553d" } }).png().toBuffer();
    const raster = new Uint8Array(40 * 20).map((_, i) => (i % 40 < 20 ? 1 : 0));
    const cut = await cutout(plate, { mask: encodeSegmentationMask(raster, 40, 20), bounds: { left: 100, top: 80, right: 140, bottom: 100 } });
    const px = await sharp(cut.png).raw().toBuffer();
    expect(px[(10 * 40 + 5) * 4 + 3]).toBeGreaterThan(200);
    expect(px[(10 * 40 + 35) * 4 + 3]).toBeLessThan(50);
    expect(cut).toMatchObject({ x: 37.5, w: 12.5 });
  });
});
