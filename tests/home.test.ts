import { describe, expect, it } from "vitest";
import type { Story } from "../lib/schema";
import { chapterFor, datedFor, daysFrom, grouped, linesFor, nearestDays, parseDate, splitVoice, standLines } from "../components/home/lines";

const scene = (id: string, year: string, title: string, caption: string) => ({
  id,
  year,
  title,
  caption,
  treatment: "theatre" as const,
  visual: "v",
  cut: [],
  sources: [{ label: "s", url: "https://example.com" }],
  layers: [],
});
const story = (slug: string, scenes: Story["scenes"]): Story => ({ slug, name: slug, born: "1900", died: null, tagline: "t", scenes });

const jack = story("jack-sim", [
  scene("s1", "1957", "A village", "He is born in a village. He grows up poor."),
  scene("s2", "2001", "Mr Toilet", "On 19 November 2001 he founds the World Toilet Organization. It grows."),
  scene("s3", "2013", "A day at the UN", "The UN adopts a resolution."),
]);

describe("home page lines", () => {
  it("splits a quoted storyboard voice from its source, and leaves prose whole", () => {
    expect(splitVoice(`"Life was in an attap house." (CNA, 2019)`)).toEqual({ text: "Life was in an attap house.", by: "CNA, 2019" });
    expect(splitVoice("He combs his hair with a toilet brush.")).toEqual({ text: "He combs his hair with a toilet brush." });
  });

  it("takes quotations from the matching storyboard chapter only, else the chapter's first sentence", () => {
    const deep = [
      { year: "2008", title: "The bank that said no", voice: "A bank told him no." },
      { year: "2013", title: "A day at the UN", voice: null, quote: { text: "Nothing wrong with the toilet.", speaker: "Jack Sim" } },
    ];
    const lines = linesFor(jack, deep);
    expect(lines[0]).toMatchObject({ text: "Nothing wrong with the toilet.", by: "Jack Sim", chapter: "Chapter III", href: "/jack-sim#p=5" });
    expect(lines.map((l) => l.text)).toContain("He is born in a village.");
    expect(lines.map((l) => l.text)).not.toContain("A bank told him no.");
  });

  it("interleaves lives on the stand and starts anywhere", () => {
    const a = [{ text: "a1" }, { text: "a2" }] as never[];
    const b = [{ text: "b1" }] as never[];
    expect(standLines([a, b], 3).map((l: { text: string }) => l.text)).toEqual(["a1", "b1", "a2"]);
    expect(standLines([a, b], 3, 4).map((l: { text: string }) => l.text)).toEqual(["b1", "a2", "a1"]);
  });

  it("groups the shelf by theme, new lives last", () => {
    const g = grouped([{ slug: "joseph-schooling" }, { slug: "someone-new" }, { slug: "jack-sim" }]);
    expect(g.map((x) => [x.name, x.lives.map((l) => l.slug)])).toEqual([
      ["Builders", ["jack-sim"]],
      ["Athletes", ["joseph-schooling"]],
      ["New on the shelf", ["someone-new"]],
    ]);
  });
});

describe("dated days", () => {
  it("reads a full date and finds its chapter", () => {
    expect(parseDate("On 19 November 2001 he founds it")).toMatchObject({ day: 19, month: 10, year: 2001 });
    expect(parseDate("In 2001 he founds it")).toBeUndefined();
    expect(chapterFor(jack, 2005)).toBe(1);
    expect(chapterFor(jack, 1900)).toBe(0);
  });

  it("keeps the sentence the date is in and links its chapter", () => {
    const [d] = datedFor(jack, ["Born on 18 October 1957 in a village."]);
    expect(d).toMatchObject({ text: "On 19 November 2001 he founds the World Toilet Organization.", href: "/jack-sim#p=4" });
  });

  it("measures to the nearest anniversary across the new year", () => {
    expect(daysFrom(new Date(Date.UTC(2026, 9, 31)), 9, 23)).toBe(-8);
    expect(daysFrom(new Date(Date.UTC(2026, 11, 30)), 0, 2)).toBe(3);
  });

  it("picks the nearest day per life", () => {
    const all = [...datedFor(jack, ["Born on 25 October 1957."]), ...datedFor(story("other", jack.scenes.slice(0, 1)), ["Died on 2 November 1990."])];
    const near = nearestDays(all, new Date(Date.UTC(2026, 9, 31)), 3);
    expect(near.map((d) => [d.slug, d.away])).toEqual([
      ["other", 2],
      ["jack-sim", -6],
    ]);
  });
});
