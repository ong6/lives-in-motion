import { describe, expect, it } from "vitest";
import { factsFromCited } from "../pipeline/stages";
import { platePrompt, storyboardSchema } from "../pipeline/prompts";
import { eraFor } from "../src/eras";
import { MOTIFS } from "../src/motifs";

describe("factsFromCited", () => {
  const text = "1957 | Born in Singapore.\n2001 | Founds the World Toilet Organization. [1]\nno year here\n2013 | UN adopts World Toilet Day.";
  const at = (s: string) => text.indexOf(s);
  it("numbers facts and attaches the citations whose spans overlap each line", () => {
    const facts = factsFromCited({
      text,
      citations: [
        { url: "https://a.example/born", title: "A", start: at("Born"), end: at("Born") + 4 },
        { url: "https://b.example/wto", title: "B", start: at("Founds"), end: at("Founds") + 6 },
        { url: "https://b.example/wto", title: "B", start: at("World"), end: at("World") + 5 },
      ],
    });
    expect(facts.map((f) => [f.n, f.year, f.sources.length])).toEqual([
      [1, "1957", 1],
      [2, "2001", 1],
    ]);
    expect(facts[1].text).toBe("Founds the World Toilet Organization.");
  });
  it("drops uncited lines", () => {
    expect(factsFromCited({ text, citations: [] })).toEqual([]);
  });
});

describe("prompts", () => {
  it("plate prompt carries the era's print style and forbids faces and text", () => {
    const scene = { id: "s4", year: "2001", title: "t", caption: "c", visual: "a globe", sources: [{ label: "x", url: "https://x.y" }], layers: [{ id: "g", concept: "globe", depth: 0.3, motif: "globe", x: 50, y: 90, w: 30, enter: "rise" as const }] };
    const p = platePrompt(scene, eraFor(2001));
    expect(p).toContain("risograph");
    expect(p).toContain("no faces");
    expect(p).toContain("No text");
    expect(p).toContain("globe");
  });
  it("storyboard schema only allows motifs the renderer has", () => {
    const motif = (storyboardSchema as any).properties.scenes.items.properties.layers.items.properties.motif;
    expect(motif.enum).toEqual(Object.keys(MOTIFS));
  });
});

import sharp from "sharp";
import { encodeSegmentationMask } from "../node_modules/@meta-sam/parser/dist/mask-codec.js";
import { cutout, parseSam } from "../pipeline/sam";

describe("SAM 3.1 output", () => {
  // The two-object sample from @meta-sam/parser's README, as one image's output line.
  const sample =
    "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>" +
    "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" +
    ",1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>" +
    "<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n";

  it("parses masks and bounds", async () => {
    const masks = await parseSam(sample);
    expect(masks).toHaveLength(2);
    expect(masks[0].bounds).toEqual({ left: 211, top: 228, right: 271, bottom: 255 });
  });
  it("treats empty output as no match", async () => {
    expect(await parseSam("")).toEqual([]);
  });
  it("cuts a masked object out with alpha and places it on the stage", async () => {
    const plate = await sharp({ create: { width: 320, height: 180, channels: 3, background: "#c8553d" } }).png().toBuffer();
    const raster = new Uint8Array(40 * 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) raster[y * 40 + x] = x < 20 ? 1 : 0;
    const mask = encodeSegmentationMask(raster, 40, 20);
    const cut = await cutout(plate, { mask, bounds: { left: 100, top: 80, right: 140, bottom: 100 } });
    const img = sharp(cut.png);
    const meta = await img.metadata();
    expect([meta.width, meta.height, meta.channels]).toEqual([40, 20, 4]);
    const px = await img.raw().toBuffer();
    expect(px[(10 * 40 + 5) * 4 + 3]).toBeGreaterThan(200); // inside the mask
    expect(px[(10 * 40 + 35) * 4 + 3]).toBeLessThan(50); // outside it
    expect(cut).toMatchObject({ x: 37.5, w: 12.5 });
    expect(cut.y).toBeCloseTo(55.56, 1);
  });
});
