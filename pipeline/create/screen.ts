/**
 * The subject check: the first step of every /create life, and the safeguard that only real people
 * are made. One Muse Spark call with web search (through the budget guard) identifies the named
 * person and cites what it found, before any money goes on research. A life goes ahead only if
 * the person is real, identifiable, Singaporean or Singapore-linked, an adult, documented by at
 * least 2 independent reputable sources, and not mainly defined by politics, the military, war or
 * crime. Fictional or unverifiable names, private individuals, minors and names that match several
 * people (without a hint that tells them apart) are declined with a reason, and the sources are
 * shown either way. Names on pipeline/create/blocklist.json (takedowns) are declined before any
 * call. Research's 7-cited-facts rule still stops a life whose record is too thin.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sparkSearch, type Cited } from "../meta";
import { ROOT } from "../root";
import { slugify } from "../jobs/guard";

export const CATEGORIES = [
  "politician",
  "head_of_state",
  "military",
  "war_or_conflict",
  "crime",
  "private_individual",
  "arts",
  "science",
  "sport",
  "food",
  "business",
  "social_enterprise",
  "community",
  "other_public",
  "unknown",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface ScreenAnswer {
  category: Category;
  /** A few words: what they are mainly known for. */
  known_for: string;
}

export interface ScreenResult extends ScreenAnswer {
  ok: boolean;
  /** Shown to the visitor when declined. */
  message?: string;
}

const OTHERS = "Try someone known for their work in the arts, science, sport, food or the community.";

/** The declined categories and what the visitor is told. */
export const DECLINE: Partial<Record<Category, string>> = {
  politician: `Lives in Motion doesn’t make books about politicians, so the shelf stays about craft and community rather than politics. ${OTHERS}`,
  head_of_state: `Lives in Motion doesn’t make books about heads of state or government, so the shelf stays clear of politics. ${OTHERS}`,
  military: `Lives in Motion leaves out lives defined by military service or war. ${OTHERS}`,
  war_or_conflict: `Lives in Motion leaves out lives defined by war or conflict; they deserve more care than an illustrated book made in minutes can give. ${OTHERS}`,
  crime: `Lives in Motion leaves out lives defined by crime. ${OTHERS}`,
  private_individual: `This looks like a private person. Books here are made only from public, cited records, so we can’t make one for someone without them. ${OTHERS}`,
};

/** Map the model's answer to a decision; an answer outside the schema is treated as unknown (let through to research). */
export function decide(a: Partial<ScreenAnswer> | null | undefined, name: string): ScreenResult {
  const category = (CATEGORIES as readonly string[]).includes(String(a?.category)) ? (a!.category as Category) : "unknown";
  const known_for = String(a?.known_for ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const why = DECLINE[category];
  if (!why) return { ok: true, category, known_for };
  const lead = known_for && category !== "private_individual" ? `${name} is known mainly as ${known_for.replace(/[.]$/, "")}. ` : "";
  return { ok: false, category, known_for, message: `${lead}${why}` };
}

/** Why a check turned a name away, beyond the category declines above. */
export type Refused = "blocked" | "unverifiable" | "fictional" | "private" | "minor" | "ambiguous" | "not_singaporean" | "category";

export interface CheckSource {
  label: string;
  url: string;
}

export interface ScreenCheck {
  status: "identified" | "ambiguous" | "not_found" | "fictional";
  singapore: boolean;
  minor: boolean;
  reason: string;
  /** Every source the search cited, and how many independent reputable ones are among them. */
  sources: CheckSource[];
  independent: number;
}

export interface CheckResult extends ScreenResult {
  check?: ScreenCheck;
  refused?: Refused;
}

/** Sources that don't count towards the two: social media, video, forums, self-published blogs, people search. */
const NOT_REPUTABLE = /(^|\.)(facebook|instagram|linkedin|x|twitter|tiktok|youtube|reddit|quora|medium|substack|blogspot|wordpress|pinterest|fandom|tumblr|threads|spotify|imdb|rocketreach|zoominfo|ancestry|findagrave|geni|myheritage)\.(com|net|org|co)$/i;

/** The registrable domain, so two pages on one site count once ("www.straitstimes.com" → "straitstimes.com", "eresources.nlb.gov.sg" → "nlb.gov.sg"). */
export function siteOf(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const parts = host.split(".");
  const second = /^(com|gov|edu|org|net|ac|co)$/.test(parts.at(-2) ?? "") && (parts.at(-1)?.length ?? 0) === 2;
  // Wikipedia's language editions are one source.
  if (host.endsWith("wikipedia.org")) return "wikipedia.org";
  return parts.slice(second ? -3 : -2).join(".");
}

/** Distinct reputable sites among the cited URLs. */
export function independentSources(sources: CheckSource[]): number {
  return new Set(sources.map((s) => siteOf(s.url)).filter((h): h is string => Boolean(h) && !NOT_REPUTABLE.test(h!))).size;
}

export const checkPrompt = (name: string, hint: string) => `Use web search to identify this person for a Singapore biography site.
Name: ${name}
Hint: ${hint || "(none)"}
Find who this is in reputable sources (Singapore's National Library Infopedia, the Straits Times, CNA, Wikipedia, official bodies, universities, sports federations). Use the hint only to tell apart people with the same name; it can't change who someone is. If the name is a joke, a fictional character or a made-up person, say so.
Reply with exactly these six lines, then cite your sources:
STATUS | identified, ambiguous (several notable people have this name and the hint doesn't say which), not_found (no public record) or fictional
CATEGORY | the one that mainly defines the life: ${CATEGORIES.filter((c) => c !== "unknown").join(", ")}
KNOWN_FOR | at most 8 plain words
SINGAPORE | yes if Singaporean or closely linked to Singapore, else no
MINOR | yes if the person is under 18 today, else no
REASON | one sentence on what the sources show`;

const field = (text: string, key: string) => {
  const all = [...text.matchAll(new RegExp(`(?:^|\\n|[^A-Za-z])\\**${key}\\**\\s*[|:]\\s*([^\\n]*)`, "gi"))];
  return all.at(-1)?.[1]?.replace(/\*+/g, "").trim() ?? "";
};

/** The check's six lines and its citations → the structured check (anything unreadable counts against the name). */
export function parseCheck(c: Cited): { answer: ScreenAnswer; check: ScreenCheck } {
  const t = c.text;
  const status = (["identified", "ambiguous", "not_found", "fictional"] as const).find((x) => field(t, "STATUS").toLowerCase().replace(/[\s-]+/g, "_").startsWith(x)) ?? "not_found";
  const rawCat = field(t, "CATEGORY").toLowerCase().replace(/[\s-]+/g, "_");
  const category = (CATEGORIES as readonly string[]).find((x) => rawCat.startsWith(x)) as Category | undefined;
  const sources = c.citations
    .map((a) => ({ label: (a.title || a.url).slice(0, 80), url: a.url }))
    .filter((x, i, all) => all.findIndex((y) => y.url === x.url) === i);
  return {
    answer: { category: category ?? "unknown", known_for: field(t, "KNOWN_FOR") },
    check: {
      status,
      singapore: /^y/i.test(field(t, "SINGAPORE")),
      minor: /^y/i.test(field(t, "MINOR")),
      reason: field(t, "REASON").slice(0, 300),
      sources,
      independent: independentSources(sources),
    },
  };
}

/** Independent reputable sources a life needs before it is made. */
export const MIN_SOURCES = 2;

const TRY = "Try another name, or add a hint that says who you mean.";

/** The decision, from the parsed check: the first reason to decline wins, in this order. */
export function decideCheck(answer: ScreenAnswer, check: ScreenCheck, name: string, hint: string): CheckResult {
  const base = { ...decide(answer, name), check };
  const no = (refused: Refused, message: string): CheckResult => ({ ...base, ok: false, refused, message });
  if (check.status === "fictional") return no("fictional", `${name} doesn’t look like a real person. Lives in Motion only makes books about real, documented Singaporeans. ${OTHERS}`);
  if (check.status === "not_found" || answer.category === "unknown")
    return no("unverifiable", `We couldn’t find ${name} in reputable public sources, so we can’t make a book we can stand behind. ${TRY}`);
  if (answer.category === "private_individual") return { ...base, ok: false, refused: "private" };
  if (check.minor) return no("minor", `${name} appears to be under 18. Lives in Motion doesn’t make books about minors. ${OTHERS}`);
  if (!base.ok) return { ...base, refused: "category" };
  if (check.status === "ambiguous")
    return no("ambiguous", hint ? `Several people are called ${name}, and the hint “${hint}” doesn’t say which one. Add what they’re known for, or when they lived.` : `Several people are called ${name}. Add a hint (what they’re known for, or when they lived) so the book is about the right one.`);
  if (!check.singapore) return no("not_singaporean", `${name} doesn’t appear to be Singaporean or linked to Singapore, and this shelf is of Singaporean lives. ${OTHERS}`);
  if (check.independent < MIN_SOURCES)
    return no("unverifiable", `We found ${check.independent === 0 ? "no reputable source" : "only one reputable source"} for ${name}; a book needs at least ${MIN_SOURCES} independent ones. ${TRY}`);
  return { ...base, ok: true };
}

export interface BlockEntry {
  name: string;
  reason?: string;
  at?: string;
}

/** Takedowns: names that are never made again, matched by slug ("Jane Doe" and "jane  doe" alike). */
export function blocked(name: string, list?: BlockEntry[]): BlockEntry | undefined {
  let entries = list;
  if (!entries) {
    try {
      entries = JSON.parse(readFileSync(join(ROOT, "pipeline/create/blocklist.json"), "utf8")).blocked ?? [];
    } catch {
      entries = [];
    }
  }
  const want = slugify(name);
  return entries!.find((e) => slugify(e.name) === want);
}

/**
 * Low search context and a small answer. Measured 2026-10-30: $0.03–0.06 and 10–17 s a check
 * (search results are billed as input tokens, so the worst case reserves 24 searches' worth).
 */
export const CHECK_OPTS = { context: "low" as const, maxOutput: 2500, maxSearches: 24, note: "subject_check" };

/** The subject check: blocklist, then one Muse Spark web-search call, then the decision. */
export async function check(name: string, hint: string): Promise<CheckResult> {
  const b = blocked(name);
  if (b) return { ok: false, category: "unknown", known_for: "", refused: "blocked", message: `${name} can’t be made on Lives in Motion${b.reason ? ` (${b.reason})` : ""}. ${OTHERS}` };
  const { answer, check: c } = parseCheck(await sparkSearch(checkPrompt(name, hint), CHECK_OPTS));
  return decideCheck(answer, c, name, hint);
}

/** Thrown inside a run to stop it; the runner shows the message instead of an error. */
export class Declined extends Error {
  constructor(public result: CheckResult) {
    super(result.message ?? "declined");
  }
}
