import { describe, expect, it } from "vitest";
import { Source, Story } from "@/lib/schema";
import { clock, sniffAudio, wavSeconds } from "@/pipeline/family/audio";
import { parseTranscribe } from "@/pipeline/family/transcribe";
import { PRICES, transcribeCost } from "@/pipeline/budget";
import { asResearch, checkFacts, citationLabel, citationUrl, findQuote, norm, shortQuote, type RawFacts } from "@/pipeline/family/facts";
import { applyChecks } from "@/pipeline/family/check";
import { parseScript } from "@/pipeline/family/sample";
import { creditFor } from "@/pipeline/family";
import { cleanKeywords, familySlug, keyHash, keyOk } from "@/pipeline/family/record";
import type { FamilyTurn } from "@/pipeline/family/types";

const turns: FamilyTurn[] = [
  { n: 1, startMs: 380, endMs: 5000, text: "Ah Ma, can you tell me where you were born?", speaker: "A" },
  { n: 2, startMs: 5580, endMs: 23000, text: "Okay lah, I was born in Teluk Ayer near the sea. My mother say I am a tiger year baby, so maybe 1938.", speaker: "B" },
  { n: 3, startMs: 81580, endMs: 95000, text: "1966. We moved into a three room HDB flat in Queenstown. Wah, so modern.", speaker: "B" },
];
const ORIGIN = "http://localhost:3100";

describe("family audio", () => {
  const bytes = (s: string, at = 0, len = 16) => {
    const b = new Uint8Array(len);
    for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i);
    return b;
  };
  it("sniffs the containers browsers and phones record", () => {
    const wav = bytes("RIFF");
    wav.set(bytes("WAVE").slice(0, 4), 8);
    expect(sniffAudio(wav)).toBe("wav");
    expect(sniffAudio(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("webm");
    expect(sniffAudio(bytes("OggS"))).toBe("ogg");
    expect(sniffAudio(bytes("ftypM4A ", 4))).toBe("mp4");
    expect(sniffAudio(bytes("ID3"))).toBe("mp3");
    expect(sniffAudio(bytes("fLaC"))).toBe("flac");
  });
  it("refuses anything else, such as a playlist or an image", () => {
    expect(sniffAudio(bytes("#EXTM3U\nhttp://"))).toBeNull();
    expect(sniffAudio(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(sniffAudio(new Uint8Array(4))).toBeNull();
  });
  it("times a 24 kHz mono WAV and prints clock times", () => {
    expect(wavSeconds(44 + 48000 * 90)).toBe(90);
    expect(clock(83.9)).toBe("1:23");
    expect(clock(3725)).toBe("1:02:05");
  });
});

describe("Muse Voice Transcribe", () => {
  it("prices whole seconds at $0.18 an hour", () => {
    expect(transcribeCost(30_400)).toBeCloseTo(30 * PRICES.transcribe, 10);
    expect(transcribeCost(3_600_000)).toBeCloseTo(0.18, 10);
  });
  it("turns the response's turns into numbered, ordered turns", () => {
    const t = parseTranscribe(
      {
        sessionId: "x",
        transcript: "a b",
        audioDurationMs: 8240,
        turns: [
          { turnId: 2, startMs: 5900, endMs: 8240, transcript: "It is raining.", speaker: "B" },
          { turnId: 1, startMs: 1520, endMs: 4640, transcript: "How is the weather?", speaker: "A" },
          { turnId: 3, startMs: 9000, endMs: 9100, transcript: "  " },
        ],
      },
      "DIARIZATION",
    );
    expect(t.turns.map((x) => [x.n, x.startMs, x.speaker])).toEqual([
      [1, 1520, "A"],
      [2, 5900, "B"],
    ]);
    expect(t.usd).toBeCloseTo(8 * PRICES.transcribe, 10);
    expect(t.untimed).toBeUndefined();
  });
  it("falls back to numbered lines, without timestamps, when no turns come back", () => {
    const t = parseTranscribe({ transcript: "I was born in 1938. We moved in 1966!", audioDurationMs: 5000, turns: [] }, "PUSH_TO_TALK");
    expect(t.untimed).toBe(true);
    expect(t.turns).toEqual([
      { n: 1, startMs: -1, endMs: -1, text: "I was born in 1938." },
      { n: 2, startMs: -1, endMs: -1, text: "We moved in 1966!" },
    ]);
    expect(citationUrl(ORIGIN, "ah-ma-x", t.turns[1])).toBe(`${ORIGIN}/family/ah-ma-x/audio#line=2`);
    expect(citationLabel(t.turns[1], "We moved in 1966")).toBe("Recording transcript, line 2 — “We moved in 1966”");
  });
});

describe("facts from a recording", () => {
  it("matches a quote however the punctuation and case differ", () => {
    expect(norm("Okay LAH, I was born—in Teluk Ayer!")).toBe("okay lah i was born in teluk ayer");
    expect(findQuote("I was born in Teluk Ayer near the sea", turns, 1)?.n).toBe(2);
    expect(findQuote("we moved into a three-room HDB flat", turns, 3)?.n).toBe(3);
    expect(findQuote("we moved into a four room HDB flat", turns, 3)).toBeUndefined();
    expect(findQuote("We moved into a three room HDB flat", turns, 3)?.n).toBe(3);
    expect(findQuote("so modern", turns)).toBeUndefined();
  });
  it("keeps only facts whose quote is in the transcript, cited to the turn's start", () => {
    const raw: RawFacts = {
      subject_speaker: "B",
      born: "1938",
      born_approx: true,
      facts: [
        { year: "1966", approx: false, text: "Ah Ma moved into an HDB flat in Queenstown.", turn: 3, quote: "We moved into a three room HDB flat in Queenstown" },
        { year: "1938", approx: true, text: "Ah Ma was born in Teluk Ayer.", turn: 2, quote: "I was born in Teluk Ayer near the sea" },
        { year: "1959", approx: false, text: "Ah Ma married Ah Gong.", turn: 4, quote: "in 1959 I married your Ah Gong" },
        { year: "the sixties", approx: true, text: "Ah Ma sewed.", turn: 2, quote: "I was born in Teluk Ayer" },
      ],
    };
    const c = checkFacts(raw, turns, { origin: ORIGIN, slug: "ah-ma-x" });
    expect(c.facts.map((f) => [f.n, f.year, f.turn, f.t])).toEqual([
      [1, "1938", 2, 5],
      [2, "1966", 3, 81],
    ]);
    expect(c.facts[0].text).toBe("About 1938, Ah Ma was born in Teluk Ayer.");
    expect(c.facts[0].source).toEqual({ label: "Recording, 0:05 — “I was born in Teluk Ayer near the sea”", url: `${ORIGIN}/family/ah-ma-x/audio#t=5` });
    expect(c.dropped.map((d) => d.why)).toEqual(["its quote isn't in the transcript", "no usable year (the sixties)"]);
    expect(c.subject).toBe("B");
  });
  it("labels the sample's citations as fictional", () => {
    const c = checkFacts({ subject_speaker: "B", born: "", born_approx: false, facts: [{ year: "1966", approx: false, text: "x", turn: 3, quote: "1966. We moved into a three room HDB flat" }] }, turns, { origin: ORIGIN, slug: "ah-ma-sample", prefix: "Fictional sample recording" });
    expect(c.facts[0].source.label).toMatch(/^Fictional sample recording, 1:21 — “/);
  });
  it("shortens long quotes at a word", () => {
    const q = "We moved into a three room HDB flat in Queenstown and the whole block came to me for clothes";
    expect(shortQuote(q).length).toBeLessThanOrEqual(65);
    expect(shortQuote(q)).toMatch(/…$/);
    expect(shortQuote("so maybe 1938.")).toBe("so maybe 1938");
  });
  it("writes research the storyboard stage reads, with sources the schema accepts", () => {
    const c = checkFacts({ subject_speaker: "B", born: "", born_approx: false, facts: [{ year: "1966", approx: false, text: "Moved.", turn: 3, quote: "We moved into a three room HDB flat" }] }, turns, { origin: ORIGIN, slug: "ah-ma-x" });
    const r = asResearch("Ah Ma", "grandmother", c.facts);
    expect(r.facts[0]).toEqual({ n: 1, year: "1966", text: "Moved.", sources: [c.facts[0].source] });
    expect(Source.safeParse(r.facts[0].sources[0]).success).toBe(true);
  });
});

describe("caption check", () => {
  const story = Story.parse({
    slug: "ah-ma-x",
    name: "Ah Ma",
    born: "1938",
    died: null,
    tagline: "t",
    listed: false,
    scenes: ["1938", "1952", "1966"].map((year, i) => ({
      id: `s${i + 1}`,
      year,
      title: "T",
      caption: "She remembers salt air and fishing boats.",
      visual: "a shophouse lane",
      sources: [{ label: "Recording, 0:05 — “x”", url: `${ORIGIN}/family/ah-ma-x/audio#t=5` }],
    })),
  });
  it("rewrites unsupported captions and records the verdict", () => {
    const n = applyChecks(
      story,
      {
        scenes: [
          { id: "s1", verdict: "corrected", caption: "Ah Ma was born in Teluk Ayer, near the sea, around 1938.", note: "removed the salt air and boats" },
          { id: "s2", verdict: "ok", caption: "She remembers salt air and fishing boats.", note: "fine" },
        ],
      },
      "2026-10-30T00:00:00Z",
    );
    expect(n).toBe(1);
    expect(story.scenes[0].caption).toBe("Ah Ma was born in Teluk Ayer, near the sea, around 1938.");
    expect(story.scenes[0].checked).toMatchObject({ verdict: "corrected", sources: [] });
    expect(story.scenes[1].checked?.verdict).toBe("ok");
    expect(story.scenes[2].checked).toBeUndefined();
    expect(Story.safeParse(story).success).toBe(true);
  });
});

describe("family books", () => {
  it("get an unguessable slug", () => {
    const s = familySlug("Ah Ma", () => false);
    expect(s).toMatch(/^ah-ma-[a-z0-9]{6}$/);
    expect(familySlug("Ah Ma", () => false)).not.toBe(s);
    expect(familySlug("林", () => false)).toMatch(/^family-[a-z0-9]{6}$/);
  });
  it("delete only with the maker's key", () => {
    const h = keyHash("secret-key");
    expect(keyOk("secret-key", h)).toBe(true);
    expect(keyOk("secret-kex", h)).toBe(false);
    expect(keyOk(null, h)).toBe(false);
    expect(keyOk("secret-key", undefined)).toBe(false);
  });
  it("clean the names and places to listen for", () => {
    expect(cleanKeywords("Potong Pasir, Wei Ling,\nmee pok, x, <script>")).toEqual(["Potong Pasir", "Wei Ling", "mee pok", "script"]);
    expect(cleanKeywords(undefined)).toEqual([]);
  });
  it("credit the frontispiece honestly, and mark the sample as fictional", () => {
    expect(creditFor({ frontispiece: { kind: "photo" } }).text).toMatch(/family photo.*consent.*no face was generated/);
    expect(creditFor({ frontispiece: { kind: "emblem" } }, true).text).toMatch(/^A fictional sample recording, voiced by a computer; nobody in this book is real\. Frontispiece/);
  });
});

describe("the sample script", () => {
  it("parses speakers and skips comments", () => {
    expect(parseScript("# note\nG: Hello?\n\nA: Okay lah.")).toEqual([
      { speaker: "G", text: "Hello?" },
      { speaker: "A", text: "Okay lah." },
    ]);
    expect(() => parseScript("no speaker here")).toThrow();
  });
});
