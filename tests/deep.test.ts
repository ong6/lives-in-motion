import { describe, expect, it } from "vitest";
import { checkChapters, fold, quotedSpans, repeats, sourcesFor, verbatimIn, type ResearchFact, type Written } from "@/pipeline/deep/check";
import { BANNED, LIVES } from "@/pipeline/deep/config";
import { plan, rectoFolio, versoFolio } from "@/components/book/pagination";
import { coverCrop, objectPosition } from "@/components/book/PhotoArt";

const src = (n: number) => ({ label: `Source ${n}`, url: `https://example.org/${n}` });
const facts: ResearchFact[] = [
  { n: 1, year: "1957", text: "Born in 1957 in a village with no plumbing.", sources: [src(1)] },
  { n: 2, year: "1963", text: "His mother ran a 'Mother's Business School' at home.", quote: "I was glad to begin attending “Mother's Business School” at the age of six.", speaker: "Jack Sim", sources: [src(2), src(1)] },
  { n: 3, year: "1984", text: "Founded Besco in 1984.", sources: [src(3)] },
];
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const chapter = (over: Partial<Written> = {}): Written => ({
  n: 1,
  title: "The bucket",
  year: "1957",
  when: "",
  age: 0,
  body: `A bucket stood in the outhouse. ${words(100)}.`,
  voice: "An outside toilet shaped his first years.",
  turn: "His mother had other plans.",
  quote: null,
  facts: [1],
  ...over,
});

describe("deep edition: checking Muse Spark's chapters", () => {
  it("passes a chapter that keeps the rules", () => {
    expect(checkChapters([chapter()], facts, 1957, 1).problems).toEqual([]);
  });
  it("holds the body to 90-150 words", () => {
    expect(checkChapters([chapter({ body: words(60) })], facts, 1957, 1).problems.join()).toMatch(/60 words/);
    expect(checkChapters([chapter({ body: words(170) })], facts, 1957, 1).problems.join()).toMatch(/170 words/);
  });
  it("accepts a quotation copied verbatim, typographic quotes and all", () => {
    const body = `Pancakes cooled on a cart. ${words(95)}. He remembers: "I was glad to begin attending “Mother's Business School” at the age of six."`;
    const r = checkChapters([chapter({ n: 1, year: "1963", age: 6, body, facts: [2], quote: { fact: 2, text: "I was glad to begin attending “Mother's Business School” at the age of six." } })], facts, 1957, 1);
    expect(r.problems).toEqual([]);
  });
  it("rejects a quotation that is not in the research, or not in its own facts", () => {
    const body = `Pancakes cooled. ${words(95)}. He said once, "I loved school more than anything."`;
    expect(checkChapters([chapter({ body })], facts, 1957, 1).problems.join()).toMatch(/not verbatim/);
    const borrowed = `Pancakes cooled. ${words(95)}. He remembers "glad to begin attending" it.`;
    expect(checkChapters([chapter({ body: borrowed, facts: [1] })], facts, 1957, 1).problems.join()).toMatch(/not verbatim/);
  });
  it("needs the quote field set when the chapter quotes someone", () => {
    const body = `Pancakes cooled. ${words(95)}. He remembers: "I was glad to begin attending".`;
    expect(checkChapters([chapter({ facts: [2], body })], facts, 1957, 1).problems.join()).toMatch(/quote field is null/);
  });
  it("flags praise words, war and politics", () => {
    expect(checkChapters([chapter({ voice: "A legendary founder." })], facts, 1957, 1).problems.join()).toMatch(/praise/);
    expect(checkChapters([chapter({ turn: "Then the war came." })], facts, 1957, 1).problems.join()).toMatch(/politics and war/);
  });
  it("flags a body that says the same thing twice", () => {
    expect(repeats("The award arrived in 2008 from the university. Then he moved on. The university award arrived in 2008.")).not.toBeNull();
    expect(repeats("A bucket stood outside. He said, \"the bucket stood outside\".")).toBeNull();
  });
  it("fixes an age that disagrees with the years, and allows a few years for an approximate one", () => {
    expect(checkChapters([chapter({ year: "1973", age: 3 })], facts, 1957, 1).chapters[0].age).toBe(16);
    expect(checkChapters([chapter({ year: "1960", when: "1960s", age: 7 })], facts, 1957, 1).chapters[0].age).toBe(7);
  });
  it("rejects unknown fact numbers and takes sources only from the cited facts", () => {
    expect(checkChapters([chapter({ facts: [9] })], facts, 1957, 1).problems.join()).toMatch(/not in the research/);
    expect(sourcesFor([2, 1], facts).map((s) => s.url)).toEqual(["https://example.org/2", "https://example.org/1"]);
  });
  it("folds typography and finds quoted spans", () => {
    expect(fold("“It’s… fine”")).toBe('"it\'s... fine"');
    expect(quotedSpans('He said "one two three" and “four five six”, then "no".')).toEqual(["one two three", "four five six"]);
    expect(verbatimIn("glad to begin attending", facts[1])).toBe("quote");
  });
});

describe("deep edition: config", () => {
  it("never uses a banned photograph", () => {
    for (const [slug, c] of Object.entries(LIVES)) {
      for (const b of c.breaks ?? []) expect(BANNED, slug).not.toContain(b.file);
      if (c.frontispiece !== "keep") expect(BANNED, slug).not.toContain(c.frontispiece.file);
    }
  });
  it("labels every photo that is not the person", () => {
    for (const c of Object.values(LIVES)) for (const u of [...Object.values(c.photos), ...(c.breaks ?? []).map((b) => b.use)]) if (u.concept !== "person") expect(u.tag, u.label).toBeTruthy();
  });
  it("keeps flags and faces out of rewritten art directions", () => {
    for (const c of Object.values(LIVES)) for (const a of [...Object.values(c.art ?? {}), ...Object.values(c.replace ?? {})]) expect(a.direction.toLowerCase()).not.toMatch(/\b(face|portrait|smil\w*|flags?)\b/);
  });
});

describe("book plan with breaks and two notes spreads", () => {
  const scenes = Array.from({ length: 12 }, (_, i) => ({ id: `s${i + 1}` }));
  const p = plan({ scenes, breaks: [{ after: "s8" }], edition: "deep" } as never);
  it("puts a break spread after its chapter and shifts the rest", () => {
    expect(p.spreadOf[0]).toBe(3);
    expect(p.kinds[p.spreadOf[7] + 1]).toBe("break");
    expect(p.spreadOf[8]).toBe(p.spreadOf[7] + 2);
    expect(p.scene[p.spreadOf[7] + 1]).toBe(7);
  });
  it("ends with two notes spreads, the back endpapers and the closed cover", () => {
    expect(p.kinds.slice(p.NOTES)).toEqual(["notes", "notes2", "endpapersBack", "closed"]);
    expect(p.END).toBe(p.NOTES + 1);
  });
  it("numbers the title page 1 and every spread after it", () => {
    expect(rectoFolio(2)).toBe(1);
    expect(versoFolio(p.spreadOf[0])).toBe(2);
  });
  it("keeps a seven-scene book's spreads where they were", () => {
    const old = plan({ scenes: scenes.slice(0, 7) } as never);
    expect(old.kinds).toEqual(["cover", "endpapers", "title", ...Array(7).fill("chapter"), "notes", "endpapersBack", "closed"]);
  });
});

describe("photo crop", () => {
  it("shows a band of a tall photo and a slice of a wide one, centred on the subject", () => {
    const tall = coverCrop(2, 1, [0.5, 0.2]);
    expect(tall).toMatchObject({ x: 0, w: 1 });
    expect(tall.h).toBeCloseTo(0.5);
    expect(tall.y).toBeCloseTo(0);
    const wide = coverCrop(0.5, 1, [0.9, 0.5]);
    expect(wide.w).toBeCloseTo(0.5);
    expect(wide.x).toBeCloseTo(0.5);
    expect(objectPosition(wide)).toBe("100.00% 50%");
  });
});
