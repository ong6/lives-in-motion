import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Direction } from "./Direction";

const PUBLIC = join(process.cwd(), "public", "stories");

const read = (f: string): any => {
  if (!existsSync(f)) return undefined;
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return undefined;
  }
};

/** The renderer's own move, which a scene keeps when Muse Wonder's critic never passed a plan (pipeline/film/camera.ts). */
const FIXED = { focus: { x: 0.5, y: 0.5 }, camera: [{ t: 0, zoom: 1, panX: -0.04, panY: 0 }, { t: 1, zoom: 1.2, panX: 0.04, panY: 0 }] };

/** "Approve" or "reject" says nothing; a fuller sentence from the critic says why. */
const said = (...xs: unknown[]) => xs.find((x): x is string => typeof x === "string" && x.split(/\s+/).length > 3) ?? "";

/**
 * What Muse Wonder did for each scene of a life, by scene id: the plan it directed and its
 * critic's verdict (public/stories/<slug>/<id>/motion.json), or, where its critic rejected every
 * round and the film kept the fixed move, that record from the life's wonder.json.
 */
export function directionsFor(slug: string): Record<string, Direction> {
  if (!/^[a-z0-9-]+$/.test(slug)) return {};
  const life = read(join(PUBLIC, slug, "wonder.json"));
  const ids = new Set<string>(Object.keys(life?.scenes ?? {}));
  for (let i = 1; i <= 14; i++) if (existsSync(join(PUBLIC, slug, `s${i}`, "motion.json"))) ids.add(`s${i}`);
  const out: Record<string, Direction> = {};
  for (const id of ids) {
    const m = read(join(PUBLIC, slug, id, "motion.json"));
    const w = life?.scenes?.[id];
    const defects = (w?.plateDefects ?? []).map((d: any) => String(d?.type ?? d)).filter(Boolean);
    if (m?.plan?.camera?.length) {
      out[id] = {
        kept: false,
        model: m.model ?? life?.model ?? "muse-wonder",
        at: m.at ?? life?.updated,
        usd: Number(w?.usd ?? m.usd ?? 0),
        rationale: m.rationale ?? m.plan.rationale ?? "",
        focus: { x: m.plan.focusX ?? 0.5, y: m.plan.focusY ?? 0.5 },
        camera: m.plan.camera.map((k: any) => ({ t: k.t, zoom: k.zoom, panX: k.panX, panY: k.panY })),
        ambient: m.plan.ambient ?? "",
        score: m.critic?.score ?? w?.score ?? 0,
        verdict: said(m.critic?.verdict, w?.verdict, ...(w?.filmIssues ?? [])),
        rounds: Array.isArray(m.rounds) ? m.rounds.length : (w?.rounds ?? 1),
        best: (m.critic?.round ?? 0) + 1,
        defects,
      };
    } else if (w) {
      out[id] = {
        kept: true,
        model: life.model ?? "muse-wonder",
        at: life.updated,
        usd: Number(w.usd ?? 0),
        rationale: w.rationale ?? "",
        ...FIXED,
        ambient: w.ambient ?? "",
        score: w.score ?? 0,
        verdict: said(w.verdict, ...(w.filmIssues ?? [])),
        rounds: w.rounds ?? 1,
        best: 0,
        defects,
      };
    }
  }
  return out;
}
