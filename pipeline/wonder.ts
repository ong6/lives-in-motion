/**
 * pnpm wonder <slug> [--scenes s1,s4] [--dry] [--rounds 2] [--effort low] [--parallel 1]
 *                    [--fix-plates [--keep dir]] [--publish]
 *
 * Muse Wonder as the films' director and critic. For each illustrated scene (line-treatment scenes
 * keep their own draw-on film and are skipped):
 *
 *   1. Director: Wonder looks at the plate, the clean background and each SAM 3.1 cut-out (with
 *      its box and depth), reads the caption and art direction, and returns a motion plan that
 *      tells the scene's story (a reveal, a layer entrance, a pull-back for loss, a rise for
 *      triumph): a keyframed camera, a move per layer, one ambient effect from the renderer's
 *      list, and a one-line rationale. The plan is sanitized and fitted (pipeline/film/motion.ts, which
 *      damps any move that would take a layer out of frame) before filming.
 *   2. Critic: the film is rendered locally, six frames go back to Wonder next to the plate and the
 *      brief. It returns {ok, score, filmIssues, plateDefects, revisedPlan}; a film passes at 8
 *      (MIN_SCORE); a rejected one is re-rendered from the revised plan, at most `--rounds` times.
 *      The best-scoring round is published if it beats a plain push-in (KEEP_SCORE), even below 8.
 *   3. Plates (--fix-plates): every plate the critic flagged (stray text, a face, off-era, a mangled
 *      subject) is re-rolled with Muse Image, at most 3 attempts, plate 1 as the style reference
 *      and the art direction rewritten by Wonder's last verdict; Wonder judges the old plate and
 *      each attempt and the best is kept. A new plate is cut out again (SAM 3.1 + clean plate)
 *      and directed again. The re-roll is recorded under the scene's `plateFix` in wonder.json.
 *
 * Writes public/stories/<slug>/<sN>/motion.json (the plan `pnpm video` films from), replaces that
 * scene's scene.mp4 / scene.jpg, and keeps a per-life report in public/stories/<slug>/wonder.json.
 * story.json is touched only by a plate re-roll, or with --publish (the new film's ?v= hash; the
 * /create runner uses it); otherwise run `pnpm video <slug>` after. --dry prints what would be
 * sent and the worst-case cost, no calls. --events adds machine-readable `@@{json}` progress lines.
 *
 * Every call goes through the spend guard under the job "wonder" (or --job, with --limit), whose
 * lifetime total is capped at WONDER_LIMIT_USD (default $8).
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
import { FILM } from "./film/camera";
import { FFMPEG, fileOf } from "./film/frame";
import { AMBIENTS, EASES, ENTRANCES, LIMITS, layerRect, type MotionPlan } from "./film/motion";
import { motionFile, planScene, renderDirected } from "./film/render";

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

const RENDERER = `The renderer is a 2.5D compositor. The clean background (the plate with the cut-outs removed and painted over) sits at depth 0. Each cut-out is a flat layer at its own depth in front of it. A virtual camera moves through them, so nearer layers move and grow more (parallax). The film is 84 frames, 960 px square. The book is read a page at a time: when the reader turns to the scene's page the film plays through once (and plays back if they turn back), then its last frame holds while they read. So the first frame (t=0) is the picture the page opens on, the last frame (t=1) is the picture the reader dwells on, and the move between them should feel good in both directions and never stall. All times (keyframe t, enterAt, enterFor) are fractions of the clip from 0 to 1, never seconds; a three-key camera is t 0, 0.5, 1.
You control:
- camera keyframes: zoom ${LIMITS.zoom.min}..${LIMITS.zoom.max} (nearest-layer magnification; a key may start high and fall, which pulls back), panX/panY within ±${LIMITS.pan}, an ease per segment (${EASES.join(", ")}), and the zoom focus point;
- per layer: depth ${LIMITS.depth.min}..${LIMITS.depth.max}, its own drift (±${LIMITS.drift}), end scale ${LIMITS.scale.min}..${LIMITS.scale.max}, and an entrance (${ENTRANCES.join(", ")}) with start and length;
- one ambient effect: none; light-sweep (a soft warm light passes across); dust (drifting specks); halftone-shimmer (the print's dot screen breathes); rain (fine slanting streaks); haze (a low warm mist band).
Moves that push a layer out of the frame, or need too much overscan of the background, are damped automatically (the whole move shrinks until every layer stays in frame), so an over-ambitious plan comes out timid: aim big but keep each layer's box inside the frame along the whole path.`;

const DIRECTOR = `You direct short films for an illustrated biography of a Singaporean life. Each scene is a printed plate in its era's style (letterpress, halftone, risograph and the like), and your film is the moment the page comes alive. Tell the scene's story with the move: decide what the caption is about (an arrival, a struggle, a loss, a triumph, a turning point, a quiet beginning) and choose the move that says it. A plain centred push-in, or a film that looks like a still, has failed.
A vocabulary to draw on (combine two at most, and make each one clearly visible):
- Reveal: open tight on a telling detail (zoom 1.3 or more, focus on it) and travel out or across to the whole scene, so the picture is discovered.
- Layer entrance: hold the setting, then bring the subject in (rise, settle, scale-in or fade) at a story beat, so the person or object arrives.
- Pull-back for loss, absence or an ending: start close on the subject and draw the camera away (zoom falling to 1), the subject shrinking a little (end scale below 1) as the world opens around it.
- Rise for triumph or achievement: the subject lifts (driftY negative) and grows (end scale above 1) while the camera tilts up with it (panY negative) and closes in.
- Journey or change: a lateral travel (panX across the frame, layers drifting at different speeds) that carries the eye from where the life was to where it goes.
- Weight or a quiet beginning: a slow, low settle with a long ease, the subject coming to rest.
Cut-outs that touch or hold each other (a lifter and the barbell, a swimmer and the water, a rider and the bus) must move as one: give them the same depth, drift and end scale, or they tear apart. The first frame should already show the subject unless its entrance is the story beat, and then it should arrive early (enterAt 0.15 or less).
Use real amplitude: a zoom change of at least 0.2 or a pan of at least 0.06, layers at clearly different depths so parallax shows, and the subject's own move large enough to see. Use eases to give the move a beat (in-out for a held breath, out for an arrival). Keep the era's print feel, and add an ambient only when the scene calls for it (rain only in a rainy scene). Never invent new people, faces or text; you can only move what is there.
${RENDERER}
Return the plan as JSON, with a one-sentence rationale naming the story beat and the move that tells it.`;

const CRITIC = `You are a strict picture editor reviewing a short film made from an illustrated plate for a biography of a Singaporean life. You get the plate, a contact sheet of six frames of the film in order (left to right, top to bottom, at clip times 0, 0.2, 0.4, 0.6, 0.8, 1), the art direction, the caption and the motion plan that made the film.
Judge two things separately.
1. The film: does the motion serve the brief and read clearly; does the subject stay coherent (no tearing, doubled edges, halo or a visible ghost where a layer moved off its painted-over spot); does any layer clip the frame edge awkwardly; do cut-outs that belong together stay together; is the first frame (t=0) a good opening picture and the last (t=1) a good one to dwell on; is the ambient effect fitting and subtle; does it keep the era's print style. Score against a plain centred push-in on the same plate: 5 means no better than that, 8 or more only for a film whose motion clearly expresses the scene's story (a reveal, an entrance, a pull-back for loss, a rise for triumph, a journey) with visible, purposeful movement. ok is true only if you would publish it and it scores 8 or more. If ok is false, give a revisedPlan that fixes the issues and is bolder where the film is timid (same schema, same layer ids), else null.
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

/** The critic scores 5 for "no better than a plain push-in" and passes a film at 8. */
export const MIN_SCORE = 8;
/**
 * Below the pass mark, the best round is still published if it beats a plain push-in (score 6 or
 * more); at 5 or under the fixed move stays.
 */
export const KEEP_SCORE = 6;

/** Frames in a film, for the contact sheet. */
const FRAMES = Math.round(FILM.fps * FILM.seconds);

export interface SceneReport {
  status: "directed" | "kept-fixed-move" | "failed";
  score?: number;
  ok?: boolean;
  /** The published round reached the critic's pass mark (MIN_SCORE). */
  passed?: boolean;
  verdict?: string;
  rationale?: string;
  ambient?: string;
  rounds: number;
  usd: number;
  seconds: number;
  filmIssues?: string[];
  plateDefects: Critique["plateDefects"];
  /** The last time `--fix-plates` re-rolled this scene's plate. */
  plateFix?: PlateFix;
  /** Why this run's film wasn't published (the previous one scored higher, or it was no better than a push-in). */
  note?: string;
  /** Film URLs of the published round, with their content hash. */
  video?: string;
  poster?: string;
  error?: string;
}

export interface DirectOptions {
  maxRounds: number;
  effort?: "low" | "medium" | "high";
  /** Publish only a round that scores above this (the film already on the page and its score). */
  beat?: number;
  log?: (s: string) => void;
}

/**
 * Direct one scene: Wonder plans the move, the film is rendered, Wonder critiques six frames of it,
 * and a rejected film is re-rendered from the critic's revised plan, at most `maxRounds` times.
 * The best round is published (scene.mp4, scene.jpg, motion.json) when it beats a plain push-in
 * and whatever is already published; story.json is left to the caller.
 */
export async function directScene(slug: string, name: string, scene: Scene, opts: DirectOptions): Promise<SceneReport> {
  const { maxRounds, effort = "low", beat = 0, log = () => {} } = opts;
  const sharp = (await import("sharp")).default;
  const base = planScene(scene, (u) => existsSync(fileOf(u)));
  if (!base) throw new Error("no plate");
  const t0 = Date.now();
  const cuts = base.clean ? scene.layers.filter((l) => l.src && existsSync(fileOf(l.src))) : [];
  const aspects = await Promise.all(
    cuts.map(async (l) => {
      const m = await sharp(fileOf(l.src!)).metadata();
      return (m.height ?? 1) / (m.width ?? 1);
    }),
  );
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
  const rounds: (Round & { hash: string })[] = [];
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
      rounds.push({ plan: film.plan, fixes: film.fixes, critique: c, usd: critic.usd, hash: film.hash });
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
      passed: chosen.critique.ok && chosen.critique.score >= MIN_SCORE,
      verdict: chosen.critique.verdict,
      rationale: chosen.plan.rationale,
      ambient: chosen.plan.ambient,
      rounds: rounds.length,
      usd: +usd.toFixed(4),
      seconds: Math.round((Date.now() - t0) / 1000),
      filmIssues: chosen.critique.filmIssues,
      plateDefects,
    };
    if (!chosen.critique.ok && chosen.critique.score < KEEP_SCORE) return { status: "kept-fixed-move", ...report, note: `best round scored ${chosen.critique.score}, no better than a plain push-in` };
    if (chosen.critique.score <= beat) return { status: "kept-fixed-move", ...report, note: `best round scored ${chosen.critique.score}; the film already published scored ${beat}, so it stays` };
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
          critic: { score: chosen.critique.score, ok: chosen.critique.ok, passed: report.passed, verdict: chosen.critique.verdict, round: best },
          rounds: rounds.map((r) => ({ score: r.critique.score, ok: r.critique.ok, verdict: r.critique.verdict, filmIssues: r.critique.filmIssues, fixes: r.fixes, plan: r.plan })),
        },
        null,
        2,
      ) + "\n",
    );
    const at = `/stories/${slug}/${scene.id}`;
    return { status: "directed", ...report, video: `${at}/scene.mp4?v=${chosen.hash}`, poster: `${at}/scene.jpg?v=${chosen.hash}` };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------- Plates: the critic's flags, re-rolled ----------

export interface PlateVerdict {
  score: number;
  defects: Critique["plateDefects"];
  revisedVisual: string;
}

export function plateJudgeSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["score", "defects", "revisedVisual"],
    properties: {
      score: { type: "integer", description: "1..10: how faithfully and cleanly the plate draws the art direction. 10 is exactly as briefed with every object reading as what it is; 5 is a usable picture with a muddled subject; 3 or less is broken." },
      defects: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "detail"],
          properties: { type: { type: "string", enum: [...PLATE_DEFECTS] }, detail: { type: "string" } },
        },
      },
      revisedVisual: { type: "string", description: "The art direction rewritten so an image model draws it right next time: the same scene and objects, each described by concrete shape so it can't be mistaken, at most 90 words, no faces, no text." },
    },
  };
}

const PLATE_JUDGE = `You are a strict picture editor for an illustrated biography of a Singaporean life. You get the art direction for one square plate, the book's first plate (the style every plate should share) and a candidate plate. Score how well the candidate draws the art direction, then list real defects you can see: stray text, letters or numbers; faces drawn where the direction wants silhouettes or figures from behind; an off-era style or anachronism; a mangled subject (broken anatomy, melted or merged objects, or a key object that doesn't read as what the direction names). An empty list is fine. Finally rewrite the art direction for the image model so a new attempt avoids these defects: keep the scene's meaning and objects, but describe each key object by its concrete shape, parts and placement so it can't be drawn as something else.`;

export interface PlateFix {
  at: string;
  attempts: { n: number; score: number; defects: Critique["plateDefects"]; visual: string }[];
  /** 0 is the plate that was there before; n is attempt n. */
  kept: number;
  before: number;
  after: number;
  usd: number;
}

const flagged = (r: SceneReport | undefined) => Boolean(r?.plateDefects?.length);

/**
 * Re-roll one flagged plate with Muse Image: up to `attempts` new plates, each from the art
 * direction rewritten by the last verdict and the defects to avoid, with plate 1 as the style
 * reference; Muse Wonder judges the old plate and each attempt against the scene's visual, and the
 * best one is kept. A new plate gets new SAM 3.1 cut-outs and a new clean background (the old ones
 * are deleted first) and loses its old motion plan, so the scene must be directed again.
 */
export async function fixPlate(slug: string, story: { name: string; scenes: Scene[] }, scene: Scene, known: Critique["plateDefects"], o: { attempts?: number; keep?: string; log?: (s: string) => void } = {}): Promise<{ fix: PlateFix; changed: boolean }> {
  const { attempts = 3, log = () => {} } = o;
  const { readdir, unlink } = await import("node:fs/promises");
  const sharp = (await import("sharp")).default;
  const { museImage } = await import("./meta");
  const { platePrompt } = await import("./prompts");
  const { asset, edit, segmentScene } = await import("./stages");
  const dir = join(ROOT, "public/stories", slug, scene.id);
  const plateFile = join(dir, "plate.png");
  const first = join(ROOT, "public/stories", slug, story.scenes[0].id, "plate.png");
  const style = scene.id !== story.scenes[0].id && existsSync(first) ? await readFile(first) : null;
  const styleImg = style ? await jpeg(style, 512) : null;
  const era = eraFor(scene.year);
  let usd = 0;
  const judge = async (png: Buffer, label: string): Promise<PlateVerdict> => {
    const imgs: WonderImage[] = [];
    if (styleImg) imgs.push({ label: "The book's first plate (the style reference):", data: styleImg });
    imgs.push({ label: "The candidate plate:", data: await jpeg(png, 768) });
    const r = await museWonderJson<PlateVerdict>(PLATE_JUDGE, `Life: ${story.name}. ${scene.year} (${era.label}; print: ${era.print}).\nTitle: ${scene.title}\nCaption: ${scene.caption}\nArt direction: ${scene.visual}\n\nJudge the candidate plate.`, imgs, `plate-judge-${slug}-${scene.id}-${label}`, plateJudgeSchema(), { maxTokens: 6000, effort: "low" });
    usd += r.usd;
    log(`judge ${label} ($${r.usd.toFixed(3)}): ${r.value.score}/10${r.value.defects.length ? `; ${r.value.defects.map((d) => `${d.type}: ${d.detail}`).join(" | ")}` : ""}`);
    return r.value;
  };
  const old = await readFile(plateFile);
  const v0 = await judge(old, "before");
  const cands: { n: number; png: Buffer; v: PlateVerdict; visual: string }[] = [{ n: 0, png: old, v: { ...v0, defects: [...known, ...v0.defects].filter((d, i, all) => all.findIndex((x) => x.detail === d.detail) === i) }, visual: scene.visual }];
  const rank = (c: (typeof cands)[number]) => c.v.score * 10 - c.v.defects.length;
  let last = cands[0];
  for (let n = 1; n <= attempts; n++) {
    const visual = last.v.revisedVisual?.trim() || scene.visual;
    const avoid = last.v.defects.map((d) => `- ${d.detail}`).join("\n");
    const prompt = `${platePrompt({ ...scene, visual }, era)}${avoid ? `\nAn earlier attempt went wrong; avoid this:\n${avoid}` : ""}`;
    log(`attempt ${n}: ${visual}`);
    let png: Buffer;
    try {
      png = await museImage(prompt, style ? [style] : []);
    } catch (e) {
      log(`attempt ${n} failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      continue;
    }
    if (o.keep) {
      await mkdir(o.keep, { recursive: true });
      await writeFile(join(o.keep, `${slug}-${scene.id}-attempt-${n}.png`), png);
    }
    const c = { n, png, v: await judge(png, `a${n}`), visual };
    cands.push(c);
    last = c;
    if (c.v.score >= MIN_SCORE && !c.v.defects.length) break;
  }
  const best = cands.reduce((a, c) => (rank(c) > rank(a) ? c : a), cands[0]);
  const fix: PlateFix = {
    at: new Date().toISOString(),
    attempts: cands.slice(1).map((c) => ({ n: c.n, score: c.v.score, defects: c.v.defects, visual: c.visual })),
    kept: best.n,
    before: cands[0].v.score,
    after: best.v.score,
    usd: +usd.toFixed(4),
  };
  if (best.n === 0) {
    log(`kept the old plate (${cands[0].v.score}/10): no attempt beat it`);
    return { fix, changed: false };
  }
  log(`kept attempt ${best.n} (${best.v.score}/10, was ${cands[0].v.score}/10); cutting it out again`);
  await writeFile(plateFile, best.png);
  await sharp(best.png).resize(1400, 1400, { fit: "inside" }).webp({ quality: 82 }).toFile(join(dir, "plate.webp"));
  // The old cut-outs, clean background and motion plan belong to the old plate.
  for (const f of await readdir(dir)) if (/^cut-\d+\.webp$/.test(f) || f === "background.webp" || f === "motion.json") await unlink(join(dir, f));
  await edit(slug, (s) => {
    const sc = s.scenes.find((x) => x.id === scene.id)!;
    sc.plate = asset(slug, scene.id, "plate.webp").url;
    sc.layers = sc.layers.filter((l) => l.overlay);
    delete sc.background;
  });
  await segmentScene(slug, scene.id, (e) => log(e.message), true);
  return { fix, changed: true };
}

// ---------- CLI ----------

/** One machine-readable progress line for a parent process (the /create runner). */
const emit = (on: boolean, e: object) => on && console.log(`@@${JSON.stringify(e)}`);

async function main() {
  try {
    process.loadEnvFile(join(ROOT, ".env"));
  } catch {
    /* no .env */
  }
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      scenes: { type: "string" },
      dry: { type: "boolean" },
      rounds: { type: "string", default: "2" },
      effort: { type: "string", default: "low" },
      "fix-plates": { type: "boolean" },
      keep: { type: "string" },
      parallel: { type: "string", default: "1" },
      job: { type: "string" },
      limit: { type: "string" },
      events: { type: "boolean" },
      publish: { type: "boolean" },
    },
  });
  const slug = positionals[0];
  if (!slug) {
    console.log("usage: pnpm wonder <slug> [--scenes s1,s4] [--dry] [--rounds 2] [--effort low|medium|high] [--fix-plates [--keep dir]] [--parallel 1] [--publish]");
    process.exit(1);
  }
  let only = values.scenes?.split(",");
  const maxRounds = Math.min(2, Math.max(0, Number(values.rounds) || 0));
  const effort = (["low", "medium", "high"].includes(values.effort!) ? values.effort : "low") as "low" | "medium" | "high";
  const parallel = Math.min(4, Math.max(1, Number(values.parallel) || 1));
  const job = values.job ?? JOB;
  const limit = values.limit != null ? Number(values.limit) : WONDER_LIMIT;
  const events = Boolean(values.events);
  const storyPath = join(ROOT, "stories", slug, "story.json");
  let story = Story.parse(JSON.parse(await readFile(storyPath, "utf8")));
  const reportFile = join(ROOT, "public/stories", slug, "wonder.json");
  const previous: { scenes: Record<string, SceneReport> } = existsSync(reportFile) ? JSON.parse(await readFile(reportFile, "utf8")) : { scenes: {} };
  let writing = Promise.resolve();
  const save = () =>
    (writing = writing.then(async () => {
      const total = Object.values(previous.scenes).reduce((a, x) => a + (x.usd ?? 0) + (x.plateFix?.usd ?? 0), 0);
      await writeFile(reportFile, JSON.stringify({ model: MODELS.wonder, updated: new Date().toISOString(), usd: +total.toFixed(4), passMark: MIN_SCORE, scenes: previous.scenes }, null, 2) + "\n");
    }));

  if (values.dry) {
    const scenes = story.scenes.filter((s) => (!only || only.includes(s.id)) && planScene(s, (u) => existsSync(fileOf(u))));
    for (const s of scenes) {
      if (s.treatment === "line") {
        console.log(`  ${s.id}: line treatment, skipped`);
        continue;
      }
      const imgs = 2 + s.layers.filter((l) => l.src).length;
      const worst = wonderWorst(9000 + s.visual.length + s.caption.length, imgs, DIRECTOR_TOKENS) + (maxRounds + 1) * wonderWorst(14000, 2, CRITIC_TOKENS);
      console.log(`  ${s.id}: ${s.treatment}, ${imgs} images to the director, worst case $${worst.toFixed(2)} with ${maxRounds} revision rounds${values["fix-plates"] && flagged(previous.scenes[s.id]) ? "; plate flagged, would be re-rolled (up to 3 Muse Image attempts)" : ""}`);
    }
    console.log(`${job} job spent $${spentBy(job).toFixed(2)} of its $${limit} limit; nothing sent (--dry)`);
    return;
  }

  await withScope({ job, limit }, async () => {
    if (values["fix-plates"]) {
      // Re-roll every plate the critic flagged (in --scenes, if given); then direct just those scenes.
      const todo = story.scenes.filter((s) => (!only || only.includes(s.id)) && s.treatment !== "line" && flagged(previous.scenes[s.id]));
      if (!todo.length) console.log("  no flagged plates");
      const fixed: string[] = [];
      for (const s of todo) {
        console.log(`▸ ${slug} ${s.id}: re-rolling the plate (${previous.scenes[s.id].plateDefects.map((d) => d.type).join(", ")})`);
        try {
          const { fix, changed } = await withScope({ onSpend: (e) => emit(events, { type: "spend", scene: s.id, kind: e.kind, usd: e.usd }) }, () =>
            fixPlate(slug, story, s, previous.scenes[s.id].plateDefects, { keep: values.keep, log: (m) => console.log(`    ${m}`) }),
          );
          const kept = fix.kept ? fix.attempts.find((a) => a.n === fix.kept)! : null;
          previous.scenes[s.id] = { ...previous.scenes[s.id], plateFix: fix, ...(changed ? { plateDefects: kept!.defects } : {}) };
          await save();
          if (changed) fixed.push(s.id);
        } catch (e) {
          if (e instanceof BudgetError) {
            console.log(`    ${e.message}`);
            return;
          }
          console.log(`    plate re-roll failed: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
        }
      }
      only ??= fixed;
      story = Story.parse(JSON.parse(await readFile(storyPath, "utf8")));
    }
    const scenes = story.scenes.filter((s) => (!only || only.includes(s.id)) && planScene(s, (u) => existsSync(fileOf(u))));
    const { pool, edit } = await import("./stages");
    let stop = false;
    await pool(scenes, parallel, async (s) => {
      if (stop) return;
      if (s.treatment === "line") {
        console.log(`  ${s.id}: line treatment keeps its draw-on film, skipped`);
        return;
      }
      const prefix = parallel > 1 ? `${s.id} ` : "";
      console.log(`▸ ${slug} ${s.id}: ${s.title}`);
      emit(events, { type: "start", scene: s.id });
      let r: SceneReport;
      try {
        r = await withScope({ onSpend: (e) => emit(events, { type: "spend", scene: s.id, kind: e.kind, usd: e.usd }) }, () =>
          directScene(slug, story.name, s, { maxRounds, effort, log: (m) => (console.log(`    ${prefix}${m}`), emit(events, { type: "log", scene: s.id, message: m })) }),
        );
      } catch (e) {
        if (e instanceof BudgetError) {
          console.log(`    ${e.message}`);
          emit(events, { type: "budget", scene: s.id, message: e.message });
          stop = true;
          return;
        }
        r = { status: "failed", rounds: 0, usd: 0, seconds: 0, plateDefects: [], error: String((e as Error)?.message ?? e).slice(0, 300) };
      }
      console.log(`    ${prefix}→ ${r.status}${r.score != null ? ` (${r.score}/10${r.passed ? ", passed" : ""})` : ""}, $${r.usd.toFixed(3)}, ${r.seconds}s${r.note ? `; ${r.note}` : ""}${r.plateDefects.length ? `; plate: ${r.plateDefects.map((d) => `${d.type}: ${d.detail}`).join(" | ")}` : ""}${r.error ? `; ${r.error}` : ""}`);
      // Plate defects are about the plate, not this run's film: keep earlier findings until the plate changes.
      const prev = previous.scenes[s.id];
      const seen = (prev?.plateDefects ?? []) as Critique["plateDefects"];
      r.plateDefects = [...seen, ...r.plateDefects].filter((d, i, all) => all.findIndex((x) => x.type === d.type && x.detail === d.detail) === i);
      if (prev?.plateFix) r.plateFix = prev.plateFix;
      // A re-run that publishes nothing leaves the earlier directed film on the page: report that one.
      if (r.status === "kept-fixed-move" && prev?.status === "directed" && existsSync(motionFile(slug, s.id)))
        r = { ...prev, plateDefects: r.plateDefects, usd: +(prev.usd + r.usd).toFixed(4), note: `${new Date().toISOString().slice(0, 10)} re-run: ${r.note ?? `best ${r.score}/10`}; the earlier film stays` };
      previous.scenes[s.id] = r;
      emit(events, { type: "scene", scene: s.id, report: r });
      await save();
      if (values.publish && r.status === "directed" && r.video) {
        await edit(slug, (st) => void Object.assign(st.scenes.find((x) => x.id === s.id)!, { video: r.video, poster: r.poster }));
      }
    });
  });
  await writing;
  console.log(`${job} job total $${spentBy(job).toFixed(2)} of $${limit}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
