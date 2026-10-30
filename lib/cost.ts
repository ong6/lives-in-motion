import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What one life costs to make on /create, from real data only: the finished real runs' job
 * files (what each step's calls actually cost) and the spend ledger. A run made before the
 * Muse Wonder "Direct" step existed gets Wonder's typical cost added for its illustrated scenes,
 * measured from the ledger's own director and critic calls (one revision at most, as /create
 * runs it). This is the one figure for "the cost of a life": the home page, the README, the
 * /create form and the rehearsal all quote it.
 */

export type CostPart = "screen" | "research" | "storyboard" | "plates" | "cutouts" | "frontispiece" | "direct";

export interface LifeCost {
  /** Typical USD for one life, all steps including Muse Wonder. */
  usd: number;
  /** "$0.58": the figure to print. */
  label: string;
  /** By /create step, summing to `usd`. */
  parts: Record<CostPart, number>;
  /** Muse Wonder for one illustrated scene: director plus critic, with at most one revision. */
  wonderPerScene: number;
  /** Illustrated (non-line) scenes Wonder directs in a typical life. */
  wonderScenes: number;
  /** Real runs the figure is averaged over, and the ledger calls behind the Wonder share. */
  lives: string[];
  wonderCalls: number;
  /** One line on where the number comes from. */
  basis: string;
}

interface LedgerRow {
  kind: string;
  usd: number;
  note?: string;
  job?: string;
}

interface JobFile {
  slug: string;
  name: string;
  mock?: boolean;
  status: string;
  steps: Partial<Record<CostPart | "films", { usd: number }>>;
  scenes: { treatment: string; plate?: string }[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (v: number, d = 4) => +v.toFixed(d);

/** Fallbacks for an empty ledger (a fresh clone): the event's first real run, 2026-10-30. */
const FALLBACK = { screen: 0.047, director: 0.029, critic: 0.038, revision: 0.6 };

/** The pure computation, over parsed ledger rows and job files (tested without a disk). */
export function computeLifeCost(ledger: LedgerRow[], jobs: JobFile[]): LifeCost {
  const wonder = ledger.filter((e) => e.kind === "wonder");
  const director = wonder.filter((e) => e.note?.startsWith("direct-")).map((e) => e.usd);
  const critics = wonder.filter((e) => e.note?.startsWith("critic-"));
  const first = critics.filter((e) => /-r0$/.test(e.note!)).length;
  const second = critics.filter((e) => /-r1$/.test(e.note!)).length;
  const d = director.length ? mean(director) : FALLBACK.director;
  const c = critics.length ? mean(critics.map((e) => e.usd)) : FALLBACK.critic;
  const revision = first ? Math.min(1, second / first) : FALLBACK.revision;
  const wonderPerScene = d + c * (1 + revision);
  // The subject check with web search (2026-10-30 on); the earlier search-free screen cost about a tenth of it.
  const screens = ledger.filter((e) => e.note === "subject_check").map((e) => e.usd);
  const screen = screens.length ? mean(screens) : FALLBACK.screen;

  // Real /create runs only: not rehearsals, not unfinished runs, not other pipelines' job files (family mode has no research step).
  const real = jobs.filter((j) => !j.mock && j.status === "done" && j.steps?.research && Array.isArray(j.scenes));
  const per = real.map((j) => {
    const tag = `create:${j.slug}`;
    const step = (k: CostPart) => j.steps[k]?.usd ?? 0;
    const scenes = j.scenes.filter((s) => s.plate && s.treatment !== "line").length;
    const measuredWonder = ledger.filter((e) => e.job === tag && e.kind === "wonder").reduce((a, e) => a + e.usd, 0);
    return {
      // Runs made before the web-search check get its typical cost.
      screen: j.steps.screen && j.steps.screen.usd > 0.01 ? j.steps.screen.usd : screen,
      research: step("research"),
      storyboard: step("storyboard"),
      plates: step("plates"),
      cutouts: step("cutouts"),
      frontispiece: step("frontispiece"),
      direct: measuredWonder || step("direct") || wonderPerScene * scenes,
      scenes,
    };
  });
  const keys: CostPart[] = ["screen", "research", "storyboard", "plates", "cutouts", "frontispiece", "direct"];
  const parts = Object.fromEntries(keys.map((k) => [k, round(mean(per.map((p) => p[k])))])) as Record<CostPart, number>;
  if (!per.length) Object.assign(parts, { screen: round(screen), research: 0.14, storyboard: 0.027, plates: 0.07, cutouts: 0.11, frontispiece: 0.0125, direct: round(wonderPerScene * 6) });
  const wonderScenes = per.length ? Math.round(mean(per.map((p) => p.scenes))) : 6;
  const usd = round(keys.reduce((a, k) => a + parts[k], 0));
  const names = real.map((j) => j.name);
  return {
    usd,
    label: `$${usd.toFixed(2)}`,
    parts,
    wonderPerScene: round(wonderPerScene),
    wonderScenes,
    lives: names,
    wonderCalls: wonder.length,
    basis: `${names.length ? `measured on ${names.join(", ")} (${names.length} real run${names.length === 1 ? "" : "s"} on /create)` : "the first real run's figures"}, with Muse Wonder at $${wonderPerScene.toFixed(3)} a film from ${wonder.length} ledger calls`,
  };
}

/** The cost of one life, read from this checkout's ledger and job files. */
export function lifeCost(root = process.cwd()): LifeCost {
  const ledgerFile = join(root, "spend.jsonl");
  const ledger: LedgerRow[] = existsSync(ledgerFile)
    ? readFileSync(ledgerFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
  const jobs: JobFile[] = [];
  const dir = join(root, "stories");
  if (existsSync(dir))
    for (const slug of readdirSync(dir)) {
      const f = join(dir, slug, "job.json");
      if (!existsSync(f)) continue;
      try {
        jobs.push(JSON.parse(readFileSync(f, "utf8")));
      } catch {
        /* a half-written job file is skipped */
      }
    }
  return computeLifeCost(ledger, jobs);
}
