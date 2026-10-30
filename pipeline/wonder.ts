/**
 * pnpm wonder <slug> [--scenes s1,s4] [--dry] [--rounds 2] [--effort low]
 *
 * Muse Wonder as the films' director and critic. For each illustrated scene (line-treatment scenes
 * keep their own draw-on film and are skipped):
 *
 *   1. Director: Wonder looks at the plate, the clean background and each SAM 3.1 cut-out (with
 *      its box and depth), reads the caption and art direction, and returns a motion plan: a
 *      keyframed camera, a move per layer, one ambient effect from the renderer's list, and a
 *      one-line rationale. The plan is sanitized and fitted (pipeline/video.ts) before filming.
 *   2. Critic: the film is rendered locally, six frames go back to Wonder next to the plate and the
 *      brief. It returns {ok, score, filmIssues, plateDefects, revisedPlan}; a rejected film is
 *      re-rendered from the revised plan, at most `--rounds` times. The best-scoring round wins.
 *      Plate defects are only reported (plates are never regenerated here).
 *
 * Writes public/stories/<slug>/<sN>/motion.json (the plan `pnpm video` films from), replaces that
 * scene's scene.mp4 / scene.jpg, and keeps a per-life report in public/stories/<slug>/wonder.json.
 * story.json is not touched. --dry prints what would be sent and the worst-case cost, no calls.
 *
 * Every call goes through the spend guard under the job "wonder", whose lifetime total is capped
 * at WONDER_LIMIT_USD (default $8).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Story, type Scene } from "../lib/schema";
import { eraFor } from "../lib/eras";
import { BudgetError, spentBy, withScope, wonderWorst } from "./budget";
import { MODELS, museWonderJson, type WonderImage } from "./meta";
import { ROOT } from "./root";
import { AMBIENTS, EASES, ENTRANCES, LIMITS, layerRect, motionFile, planScene, renderDirected, type MotionPlan } from "./video";

const FFMPEG = process.env.FFMPEG ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");
const JOB = "wonder";
export const WONDER_LIMIT = Number(process.env.WONDER_LIMIT_USD ?? 8);
const DIRECTOR_TOKENS = 10000;
const CRITIC_TOKENS = 12000;

// ---------- Schemas (strict structured output: every key required, no extras) ----------

const n = (description: string) => ({ type: "number", description });

export function planSchema() {
  const L = LIMITS;
  return {
    type: "object",
    additionalProperties: false,
    required: ["rationale", "focusX", "focusY", "camera", "layers", "ambient"],
    properties: {
      rationale: { type: "string", description: "One sentence, at most 25 words: why this move suits the scene." },
      focusX: n(`Point the camera zooms about, 0..1 across the frame (${L.focus.min}..${L.focus.max}).`),
      focusY: n(`Point the camera zooms about, 0..1 down the frame (${L.focus.min}..${L.focus.max}).`),
      camera: {
        type: "array",
        description: `${L.keys.min} to ${L.keys.max} keyframes, t ascending from 0 to 1.`,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["t", "zoom", "panX", "panY", "ease"],
          properties: {
            t: n("Clip time as a fraction 0..1 (not seconds): 0 is the first frame, 1 the last."),
            zoom: n(`Magnification of the nearest layer, ${L.zoom.min}..${L.zoom.max}; far layers grow less.`),
            panX: n(`Camera offset right (+) or left (-), frame fraction, ±${L.pan}.`),
            panY: n(`Camera offset down (+) or up (-), frame fraction, ±${L.pan}.`),
            ease: { type: "string", enum: [...EASES], description: "Easing of the segment arriving at this key." },
          },
        },
      },
      layers: {
        type: "array",
        description: "One entry per cut-out layer id given.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "depth", "driftX", "driftY", "scale", "enter", "enterAt", "enterFor"],
          properties: {
            id: { type: "string" },
            depth: n(`Parallax depth ${L.depth.min}..${L.depth.max}; 1 is nearest the camera and moves most. The background sits at 0.`),
            driftX: n(`Layer's own travel over the clip, frame fraction, ±${L.drift}.`),
            driftY: n(`Layer's own travel over the clip, + is down, frame fraction, ±${L.drift}. A rise is negative.`),
            scale: n(`Layer scale at the end of the clip about its base, ${L.scale.min}..${L.scale.max}.`),
            enter: { type: "string", enum: [...ENTRANCES], description: "none: present from frame 0; fade/rise/scale-in: invisible until enterAt; settle: present, eases down into place." },
            enterAt: n(`Clip time the entrance starts, ${L.enterAt.min}..${L.enterAt.max}.`),
            enterFor: n(`Entrance length, ${L.enterFor.min}..${L.enterFor.max}; finishes by ${L.enterEnd}.`),
          },
        },
      },
      ambient: { type: "string", enum: [...AMBIENTS] },
    },
  };
}

export const PLATE_DEFECTS = ["stray-text", "face", "off-era", "mangled-subject", "other"] as const;

export function criticSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["ok", "score", "verdict", "filmIssues", "plateDefects", "revisedPlan"],
    properties: {
      ok: { type: "boolean", description: "True if the film is good enough to publish as is." },
      score: { type: "integer", description: "1..10, how well the film serves the brief." },
      verdict: { type: "string", description: "One line." },
      filmIssues: { type: "array", items: { type: "string" } },
      plateDefects: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "detail"],
          properties: { type: { type: "string", enum: [...PLATE_DEFECTS] }, detail: { type: "string" } },
        },
      },
      revisedPlan: { anyOf: [planSchema(), { type: "null" }], description: "A better plan when ok is false, else null." },
    },
  };
}

// ---------- Prompts ----------

const RENDERER = `The renderer is a 2.5D compositor. The clean background (the plate with the cut-outs removed and painted over) sits at depth 0. Each cut-out is a flat layer at its own depth in front of it. A virtual camera moves through them, so nearer layers move and grow more (parallax). The film is 84 frames, 960 px square, and the reader scrubs it with the scroll wheel: scroll position is clip time, so the move should feel good forwards and backwards and never stall mid-scene. All times (keyframe t, enterAt, enterFor) are fractions of the clip from 0 to 1, never seconds; a three-key camera is t 0, 0.5, 1. Frame 0 (t=0) is also the poster the page opens on.
You control:
- camera keyframes: zoom ${LIMITS.zoom.min}..${LIMITS.zoom.max} (nearest-layer magnification), panX/panY within ±${LIMITS.pan}, an ease per segment (${EASES.join(", ")}), and the zoom focus point;
- per layer: depth ${LIMITS.depth.min}..${LIMITS.depth.max}, its own drift (±${LIMITS.drift}), end scale ${LIMITS.scale.min}..${LIMITS.scale.max}, and an entrance (${ENTRANCES.join(", ")}) with start and length;
- one ambient effect: none; light-sweep (a soft warm light passes across); dust (drifting specks); halftone-shimmer (the print's dot screen breathes); rain (fine slanting streaks); haze (a low warm mist band).
Moves that push a layer out of the frame, or need too much overscan of the background, are damped automatically, so stay within the frame.`;

const DIRECTOR = `You direct short scroll-driven films for an illustrated biography of a Singaporean life. Each scene is a printed plate in its era's style (letterpress, halftone, risograph and the like). Your motion must be gentle and purposeful: one clear idea per scene that matches the art direction and the caption, keeping the era print feel. Prefer restraint over spectacle, but the move must be noticeable as the reader scrolls: a film that looks like a still, or a plain centred push-in that ignores what the scene is about, has failed. Use the layers: let the subject's own move (a rise, a drift, a settle, a lean in scale) or the camera's path say something about the moment, with one entrance at most and an ambient only when the scene calls for it (rain only if it is a rainy scene). Never invent new people, faces or text; you can only move what is there.
${RENDERER}
Return the plan as JSON.`;

const CRITIC = `You are a strict picture editor reviewing a short scroll-driven film made from an illustrated plate for a biography of a Singaporean life. You get the plate, a contact sheet of six frames of the film in order (left to right, top to bottom, at clip times 0, 0.2, 0.4, 0.6, 0.8, 1), the art direction, the caption and the motion plan that made the film.
Judge two things separately.
1. The film: does the motion serve the brief and read clearly; does the subject stay coherent (no tearing, doubled edges, halo or a visible ghost where a layer moved off its painted-over spot); does any layer clip the frame edge awkwardly; is the poster frame (t=0) a good opening picture; is the ambient effect fitting and subtle; does it keep the era's print style. Score against a plain centred push-in on the same plate: 5 means no better than that, 8 or more only for a film whose motion clearly expresses the scene. ok is true only if you would publish it and it scores 7 or more. If ok is false, give a revisedPlan that fixes the issues (same schema, same layer ids), else null.
2. The plate itself, independent of the motion: stray text, letters or numbers; faces drawn where the art direction wants silhouettes or figures from behind; an off-era style or anachronism; a mangled subject (broken anatomy, melted objects). List only real defects you can see; an empty list is fine.
${RENDERER}`;

const describeLayer = (l: Scene["layers"][number], aspect: number) => {
  const r = layerRect(l, aspect);
  const f = (v: number) => v.toFixed(3);
  return `- ${l.id}: "${l.concept}", box left ${f(r.left)} top ${f(r.top)} width ${f(r.width)} height ${f(r.height)} (frame units), SAM depth ${l.depth}`;
};

// ---------- Images ----------

async function jpeg(file: string | Buffer, side: number, flatten = false) {
  const sharp = (await import("sharp")).default;
  let img = sharp(file);
  if (flatten) img = img.flatten({ background: "#808080" });
  return img.resize(side, side, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
}

/** Six evenly spaced frames of a film as one 3×2 contact sheet (JPEG). */
export async function contactSheet(mp4: string, frames: number, cell = 384): Promise<Buffer> {
  const picks = Array.from({ length: 6 }, (_, i) => Math.round((i * (frames - 1)) / 5));
  const select = picks.map((p) => `eq(n\\,${p})`).join("+");
  const ff = spawn(FFMPEG, ["-v", "error", "-i", mp4, "-vf", `select='${select}',scale=${cell}:-1,tile=3x2`, "-frames:v", "1", "-fps_mode", "vfr", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-"]);
  const chunks: Buffer[] = [];
  ff.stdout.on("data", (c) => chunks.push(c));
  await new Promise<void>((res, rej) => ff.on("close", (code) => (code ? rej(new Error(`ffmpeg sheet exited ${code}`)) : res())));
  return Buffer.concat(chunks);
}

// ---------- Rounds ----------

export interface Critique {
  ok: boolean;
  score: number;
  verdict: string;
  filmIssues: string[];
  plateDefects: { type: (typeof PLATE_DEFECTS)[number]; detail: string }[];
  revisedPlan: MotionPlan | null;
}

export interface Round {
  plan: MotionPlan;
  fixes: string[];
  critique: Critique;
  usd: number;
}

/**
 * The round to publish: an ok round first, then the highest score; ties go to the earlier round
 * (revisions that don't raise the score tend to push harder, not better).
 */
export function bestRound(rounds: Round[]): number {
  let best = 0;
  rounds.forEach((r, i) => {
    const a = r.critique, b = rounds[best].critique;
    if (Number(a.ok) > Number(b.ok) || (a.ok === b.ok && a.score > b.score)) best = i;
  });
  return best;
}

/** The critic scores 5 for "no better than a plain push-in" and passes at 7; below that the fixed move stays. */
export const MIN_SCORE = 7;

const fileOf = (url: string) => join(ROOT, "public", url.split("?")[0]);
const FRAMES = Math.round(24 * 3.5);

interface SceneReport {
  status: "directed" | "kept-fixed-move" | "failed";
  score?: number;
  ok?: boolean;
  verdict?: string;
  rationale?: string;
  ambient?: string;
  rounds: number;
  usd: number;
  seconds: number;
  filmIssues?: string[];
  plateDefects: Critique["plateDefects"];
  error?: string;
}

async function directScene(slug: string, name: string, scene: Scene, maxRounds: number, effort: "low" | "medium" | "high", log: (s: string) => void): Promise<SceneReport> {
  const sharp = (await import("sharp")).default;
  const base = planScene(scene, (u) => existsSync(fileOf(u)));
  if (!base) throw new Error("no plate");
  const t0 = Date.now();
  const cuts = base.clean ? scene.layers.filter((l) => l.src && existsSync(fileOf(l.src))) : [];
  const aspects = await Promise.all(cuts.map(async (l) => {
    const m = await sharp(fileOf(l.src!)).metadata();
    return (m.height ?? 1) / (m.width ?? 1);
  }));
  const plateImg = await jpeg(fileOf(base.plate), 768);
  const images: WonderImage[] = [{ label: "The plate as printed:", data: plateImg }];
  if (base.clean) images.push({ label: "The clean background (cut-outs removed and painted over):", data: await jpeg(fileOf(base.clean), 768) });
  for (const l of cuts) images.push({ label: `Cut-out ${l.id} ("${l.concept}") on grey:`, data: await jpeg(fileOf(l.src!), 384, true) });
  const era = eraFor(scene.year);
  const brief = [
    `Life: ${name}. Scene ${scene.id}, ${scene.year} (${era.label}; print: ${era.print}), treatment ${scene.treatment}.`,
    `Title: ${scene.title}`,
    `Caption: ${scene.caption}`,
    `Art direction: ${scene.visual}`,
    cuts.length ? `Cut-out layers:\n${cuts.map((l, i) => describeLayer(l, aspects[i])).join("\n")}` : "No cut-out layers: the plate moves as one piece (camera only; leave layers empty).",
  ].join("\n");

  let usd = 0;
  const director = await museWonderJson<MotionPlan>(DIRECTOR, `${brief}\n\nDirect this scene.`, images, `direct-${slug}-${scene.id}`, planSchema(), { maxTokens: DIRECTOR_TOKENS, effort });
  usd += director.usd;
  let plan = director.value;
  log(`director ($${director.usd.toFixed(3)}): ${plan.rationale}`);

  const work = mkdtempSync(join(tmpdir(), `wonder-${slug}-${scene.id}-`));
  const rounds: Round[] = [];
  try {
    for (let round = 0; round <= maxRounds; round++) {
      const dir = join(work, `r${round}`);
      await mkdir(dir, { recursive: true });
      const film = await renderDirected(slug, scene, base, plan, dir);
      if (film.fixes.length) log(`round ${round} fixes: ${film.fixes.join("; ")}`);
      const sheet = await contactSheet(join(dir, "scene.mp4"), FRAMES);
      const critic = await museWonderJson<Critique>(
        CRITIC,
        `${brief}\n\nMotion plan used (after the renderer's clamping):\n${JSON.stringify(film.plan)}\n\nReview the film and the plate.`,
        [
          { label: "The plate as printed:", data: plateImg },
          { label: "Contact sheet, six frames at t = 0, 0.2, 0.4 (top row) and 0.6, 0.8, 1 (bottom row):", data: sheet },
        ],
        `critic-${slug}-${scene.id}-r${round}`,
        criticSchema(),
        { maxTokens: CRITIC_TOKENS, effort },
      );
      usd += critic.usd;
      const c = critic.value;
      rounds.push({ plan: film.plan, fixes: film.fixes, critique: c, usd: critic.usd });
      log(`round ${round} critic ($${critic.usd.toFixed(3)}): ${c.ok ? "ok" : "rejected"} ${c.score}/10, ${c.verdict}${c.filmIssues.length ? ` [${c.filmIssues.join(" | ")}]` : ""}`);
      if (c.ok || !c.revisedPlan || round === maxRounds) break;
      plan = c.revisedPlan;
    }
    const best = bestRound(rounds);
    const chosen = rounds[best];
    const plateDefects = rounds.flatMap((r) => r.critique.plateDefects).filter((d, i, all) => all.findIndex((x) => x.type === d.type && x.detail === d.detail) === i);
    const report: Omit<SceneReport, "status"> = {
      score: chosen.critique.score,
      ok: chosen.critique.ok,
      verdict: chosen.critique.verdict,
      rationale: chosen.plan.rationale,
      ambient: chosen.plan.ambient,
      rounds: rounds.length,
      usd: +usd.toFixed(4),
      seconds: Math.round((Date.now() - t0) / 1000),
      filmIssues: chosen.critique.filmIssues,
      plateDefects,
    };
    if (!chosen.critique.ok && chosen.critique.score < MIN_SCORE) return { status: "kept-fixed-move", ...report };
    const out = join(ROOT, "public/stories", slug, scene.id);
    await copyFile(join(work, `r${best}`, "scene.mp4"), join(out, "scene.mp4"));
    await copyFile(join(work, `r${best}`, "scene.jpg"), join(out, "scene.jpg"));
    await writeFile(
      motionFile(slug, scene.id),
      JSON.stringify(
        {
          model: MODELS.wonder,
          at: new Date().toISOString(),
          usd: +usd.toFixed(4),
          rationale: chosen.plan.rationale,
          plan: chosen.plan,
          critic: { score: chosen.critique.score, ok: chosen.critique.ok, verdict: chosen.critique.verdict, round: best },
          rounds: rounds.map((r) => ({ score: r.critique.score, ok: r.critique.ok, verdict: r.critique.verdict, filmIssues: r.critique.filmIssues, fixes: r.fixes, plan: r.plan })),
        },
        null,
        2,
      ) + "\n",
    );
    return { status: "directed", ...report };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------- CLI ----------

async function main() {
  try {
    process.loadEnvFile(join(ROOT, ".env"));
  } catch {
    /* no .env */
  }
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { scenes: { type: "string" }, dry: { type: "boolean" }, rounds: { type: "string", default: "2" }, effort: { type: "string", default: "low" } },
  });
  const slug = positionals[0];
  if (!slug) {
    console.log("usage: pnpm wonder <slug> [--scenes s1,s4] [--dry] [--rounds 2] [--effort low|medium|high]");
    process.exit(1);
  }
  const only = values.scenes?.split(",");
  const maxRounds = Math.min(2, Math.max(0, Number(values.rounds) || 0));
  const effort = (["low", "medium", "high"].includes(values.effort!) ? values.effort : "low") as "low" | "medium" | "high";
  const story = Story.parse(JSON.parse(await readFile(join(ROOT, "stories", slug, "story.json"), "utf8")));
  const scenes = story.scenes.filter((s) => (!only || only.includes(s.id)) && planScene(s, (u) => existsSync(fileOf(u))));
  const reportFile = join(ROOT, "public/stories", slug, "wonder.json");
  const previous = existsSync(reportFile) ? JSON.parse(await readFile(reportFile, "utf8")) : { scenes: {} };

  if (values.dry) {
    for (const s of scenes) {
      if (s.treatment === "line") {
        console.log(`  ${s.id}: line treatment, skipped`);
        continue;
      }
      const imgs = 2 + s.layers.filter((l) => l.src).length;
      const worst = wonderWorst(9000 + s.visual.length + s.caption.length, imgs, DIRECTOR_TOKENS) + (maxRounds + 1) * wonderWorst(14000, 2, CRITIC_TOKENS);
      console.log(`  ${s.id}: ${s.treatment}, ${imgs} images to the director, worst case $${worst.toFixed(2)} with ${maxRounds} revision rounds`);
    }
    console.log(`wonder job spent $${spentBy(JOB).toFixed(2)} of its $${WONDER_LIMIT} limit; nothing sent (--dry)`);
    return;
  }

  await withScope({ job: JOB, limit: WONDER_LIMIT }, async () => {
    for (const s of scenes) {
      if (s.treatment === "line") {
        console.log(`  ${s.id}: line treatment keeps its draw-on film, skipped`);
        continue;
      }
      console.log(`▸ ${slug} ${s.id}: ${s.title}`);
      let r: SceneReport;
      try {
        r = await directScene(slug, story.name, s, maxRounds, effort, (m) => console.log(`    ${m}`));
      } catch (e) {
        if (e instanceof BudgetError) {
          console.log(`    ${e.message}`);
          break;
        }
        r = { status: "failed", rounds: 0, usd: 0, seconds: 0, plateDefects: [], error: String((e as Error)?.message ?? e).slice(0, 300) };
      }
      console.log(`    → ${r.status}${r.score != null ? ` (${r.score}/10)` : ""}, $${r.usd.toFixed(3)}, ${r.seconds}s${r.plateDefects.length ? `; plate: ${r.plateDefects.map((d) => `${d.type}: ${d.detail}`).join(" | ")}` : ""}${r.error ? `; ${r.error}` : ""}`);
      // Plate defects are about the plate, not this run's film: keep earlier findings until the plate changes.
      const seen = (previous.scenes[s.id]?.plateDefects ?? []) as Critique["plateDefects"];
      r.plateDefects = [...seen, ...r.plateDefects].filter((d, i, all) => all.findIndex((x) => x.type === d.type && x.detail === d.detail) === i);
      previous.scenes[s.id] = r;
      const total = Object.values(previous.scenes as Record<string, SceneReport>).reduce((a, x) => a + (x.usd ?? 0), 0);
      await writeFile(reportFile, JSON.stringify({ model: MODELS.wonder, updated: new Date().toISOString(), usd: +total.toFixed(4), scenes: previous.scenes }, null, 2) + "\n");
    }
  });
  console.log(`wonder job total $${spentBy(JOB).toFixed(2)} of $${WONDER_LIMIT}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
