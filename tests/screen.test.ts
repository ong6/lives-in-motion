import { beforeEach, describe, expect, it, vi } from "vitest";

// The Spark call is mocked: no network, no spend.
const sparkJson = vi.fn();
vi.mock("../pipeline/meta", () => ({ sparkJson: (...a: unknown[]) => sparkJson(...a), MODELS: { spark: "muse-spark-test", image: "i", sam: "s" } }));

const { screen, decide, DECLINE, CATEGORIES, screenSchema } = await import("../pipeline/create/screen");

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
