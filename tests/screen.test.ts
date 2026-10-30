import { beforeEach, describe, expect, it, vi } from "vitest";

// The Spark call is mocked: no network, no spend.
const sparkJson = vi.fn();
const sparkSearch = vi.fn();
vi.mock("../pipeline/meta", () => ({ sparkJson: (...a: unknown[]) => sparkJson(...a), sparkSearch: (...a: unknown[]) => sparkSearch(...a), MODELS: { spark: "muse-spark-test", image: "i", sam: "s" } }));

const { screen, decide, DECLINE, CATEGORIES, screenSchema, check, parseCheck, decideCheck, blocked, independentSources, siteOf, CHECK_OPTS } = await import("../pipeline/create/screen");

/** A web-search answer in the check's six-line format, with citations. */
const answer = (o: { status?: string; category?: string; known?: string; sg?: string; minor?: string; reason?: string; urls?: string[] }) => {
  const text = [
    "I searched NLB and the press.",
    `STATUS | ${o.status ?? "identified"}`,
    `CATEGORY | ${o.category ?? "arts"}`,
    `KNOWN_FOR | ${o.known ?? "painter of the Nanyang style"}`,
    `SINGAPORE | ${o.sg ?? "yes"}`,
    `MINOR | ${o.minor ?? "no"}`,
    `REASON | ${o.reason ?? "NLB Infopedia and the Straits Times document her career."}`,
  ].join("\n");
  const urls = o.urls ?? ["https://www.nlb.gov.sg/main/article-detail?cmsuuid=1", "https://www.straitstimes.com/life/a", "https://en.wikipedia.org/wiki/Georgette_Chen"];
  return { text, citations: urls.map((url, i) => ({ url, title: `Source ${i + 1}`, start: 0, end: text.length })) };
};

describe("subject check (Muse Spark + web search)", () => {
  beforeEach(() => sparkSearch.mockReset());

  it("is one web-search call with the name and hint, low context, noted as subject_check", async () => {
    sparkSearch.mockResolvedValue(answer({}));
    const r = await check("Georgette Chen", "painter");
    expect(sparkSearch).toHaveBeenCalledTimes(1);
    const [prompt, opts] = sparkSearch.mock.calls[0];
    expect(prompt).toContain("Georgette Chen");
    expect(prompt).toContain("painter");
    expect(opts).toEqual(CHECK_OPTS);
    expect(r.ok).toBe(true);
    expect(r.check?.independent).toBe(3);
    expect(r.check?.sources).toHaveLength(3);
    expect(r.check?.reason).toMatch(/NLB Infopedia/);
  });

  it.each([
    ["fictional names and jokes", { status: "fictional", category: "unknown" }, "fictional", /real person/],
    ["names with no public record", { status: "not_found", category: "unknown", urls: [] }, "unverifiable", /couldn’t find/],
    ["private individuals", { category: "private_individual", known: "a retired teacher" }, "private", /private person/],
    ["minors", { category: "sport", minor: "yes" }, "minor", /under 18/],
    ["politicians", { category: "politician", known: "a minister" }, "category", /politicians/],
    ["military figures", { category: "military" }, "category", /military/],
    ["lives defined by war", { category: "war_or_conflict" }, "category", /war or conflict/],
    ["lives defined by crime", { category: "crime" }, "category", /crime/],
    ["people who aren't Singaporean", { sg: "no" }, "not_singaporean", /Singaporean/],
    ["a single reputable source", { urls: ["https://www.straitstimes.com/a", "https://www.straitstimes.com/b", "https://www.facebook.com/x"] }, "unverifiable", /only one reputable source/],
  ] as const)("declines %s", async (_, o, refused, message) => {
    sparkSearch.mockResolvedValue(answer(o as never));
    const r = await check("A Name", "a hint");
    expect(r.ok).toBe(false);
    expect(r.refused).toBe(refused);
    expect(r.message).toMatch(message);
  });

  it("asks for a hint when several people share the name", async () => {
    sparkSearch.mockResolvedValue(answer({ status: "ambiguous" }));
    expect((await check("Tan Wei Ming", "")).message).toMatch(/Add a hint/);
    sparkSearch.mockResolvedValue(answer({ status: "ambiguous" }));
    const r = await check("Tan Wei Ming", "teacher");
    expect(r.refused).toBe("ambiguous");
    expect(r.message).toMatch(/“teacher” doesn’t say which one/);
  });

  it("declines a blocklisted name before any call, matching by slug", () => {
    expect(blocked("Jane  DOE", [{ name: "jane doe", reason: "takedown request" }])?.reason).toBe("takedown request");
    expect(blocked("Jane Doh", [{ name: "jane doe" }])).toBeUndefined();
    expect(blocked("Georgette Chen")).toBeUndefined(); // the shipped blocklist is empty
  });

  it("counts independent reputable sites, not pages or social media", () => {
    expect(siteOf("https://eresources.nlb.gov.sg/infopedia/x")).toBe("nlb.gov.sg");
    expect(siteOf("https://zh.wikipedia.org/wiki/x")).toBe("wikipedia.org");
    expect(siteOf("not a url")).toBeNull();
    const src = (u: string) => ({ label: u, url: u });
    expect(independentSources(["https://www.straitstimes.com/a", "https://www.straitstimes.com/b", "https://www.instagram.com/x", "https://www.youtube.com/w", "https://www.channelnewsasia.com/c"].map(src))).toBe(2);
  });

  it("reads the six lines even after narration, and treats an unreadable answer as unverified", () => {
    const p = parseCheck(answer({ category: "social enterprise" }));
    expect(p.answer.category).toBe("social_enterprise");
    const empty = parseCheck({ text: "I could not tell.", citations: [] });
    expect(empty.check.status).toBe("not_found");
    expect(decideCheck(empty.answer, empty.check, "X", "").refused).toBe("unverifiable");
  });
});

describe("subject screen", () => {
  beforeEach(() => sparkJson.mockReset());

  it("is one Muse Spark JSON call with the name and hint", async () => {
    sparkJson.mockResolvedValue({ category: "arts", known_for: "painter of the Nanyang style" });
    const r = await screen("Georgette Chen", "painter");
    expect(sparkJson).toHaveBeenCalledTimes(1);
    const [system, user, name, schema] = sparkJson.mock.calls[0];
    expect(system).toMatch(/politician/);
    expect(user).toContain("Georgette Chen");
    expect(user).toContain("painter");
    expect(name).toBe("subject_screen");
    expect(schema).toBe(screenSchema);
    expect(r).toEqual({ ok: true, category: "arts", known_for: "painter of the Nanyang style" });
  });

  it.each(["politician", "head_of_state", "military", "war_or_conflict", "crime", "private_individual"] as const)("declines %s with a kind message", async (category) => {
    sparkJson.mockResolvedValue({ category, known_for: "someone" });
    const r = await screen("A Name", "");
    expect(r.ok).toBe(false);
    expect(r.message).toContain(DECLINE[category]);
    expect(r.message).toMatch(/arts, science, sport, food or the community/);
  });

  it("lets arts, science, sport, food, business, community and unknown names through to research", () => {
    for (const c of ["arts", "science", "sport", "food", "business", "social_enterprise", "community", "other_public", "unknown"] as const) expect(decide({ category: c, known_for: "x" }, "N").ok).toBe(true);
  });

  it("names what the person is known for, except for private people", () => {
    expect(decide({ category: "head_of_state", known_for: "first president of Singapore." }, "Yusof Ishak").message).toMatch(/^Yusof Ishak is known mainly as first president of Singapore\. /);
    expect(decide({ category: "private_individual", known_for: "my grandmother" }, "Ah Ma").message).not.toContain("my grandmother");
  });

  it("treats an answer outside the schema as unknown", () => {
    expect(decide({ category: "wizard" as never, known_for: "" }, "N")).toEqual({ ok: true, category: "unknown", known_for: "" });
    expect(decide(null, "N").category).toBe("unknown");
  });

  it("keeps the schema's enum and the categories in step", () => {
    expect(screenSchema.properties.category.enum).toEqual([...CATEGORIES]);
  });
});
