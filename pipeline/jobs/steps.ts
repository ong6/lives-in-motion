/**
 * The work both runners do the same way once a story is storyboarded: plates, cut-outs and line
 * drawings pipelined per scene; the films rendered in a child process; the frontispiece's source
 * shown while it is traced; uploads re-encoded before anything reads them.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Sharp } from "sharp";
import type { Story } from "../../lib/schema";
import { BudgetError } from "../budget";
import { museImage } from "../meta";
import { emblemPrompt } from "../prompts";
import { ROOT } from "../root";
import { asset, illustrateScene, lineScene, loadStory, pool, segmentScene, storyDir, type Emblem } from "../stages";
import { friendly, type Runner } from "./runner";
import type { BaseJob, JobScene } from "./types";

/** Scenes worked on at once after plate 1, in each of the two lanes. */
export const PARALLEL = 3;

/** Run at most n of the given tasks at once. */
export function limiter(n: number) {
  let live = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    // A finishing task hands its slot straight to the next in line, so n is never exceeded.
    if (live >= n) await new Promise<void>((r) => waiting.push(r));
    else live++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else live--;
    }
  };
}

/** A story's scenes as a job shows them, keeping each scene's note and spend from before. */
export function jobScenes(story: Story, old: JobScene[]): JobScene[] {
  const prev = new Map(old.map((s) => [s.id, s]));
  return story.scenes.map((s) => ({
    id: s.id,
    year: s.year,
    title: s.title,
    caption: s.caption,
    treatment: s.treatment,
    // Cut-outs without their clean background go round again to retry the background.
    status: s.layers.some((l) => l.src) && s.background ? "done" : s.plate ? "painted" : "waiting",
    plate: s.plate,
    background: s.background,
    line: s.line,
    poster: s.poster,
    video: s.video,
    cuts: s.layers.filter((l) => l.src).map((l) => ({ concept: l.concept, src: l.src!, x: l.x, y: l.y, w: l.w })),
    note: prev.get(s.id)?.note,
    spend: prev.get(s.id)?.spend ?? {},
  }));
}

/**
 * Plates, cut-outs and line drawings, pipelined per scene. Plate 1 is painted alone first (the
 * others use it as their style reference); then two lanes of PARALLEL: plates, and each painted
 * scene's SAM 3.1 cut-outs, Muse Image clean background and line drawing. The clean background
 * can take minutes, so it must not hold up the plates still to be painted.
 */
export async function runScenes<S extends string, J extends BaseJob<S>>(r: Runner<S, J>, slug: string) {
  const plates = "plates" as S, cutouts = "cutouts" as S;
  const ids = r.live().scenes.map((s) => s.id);
  r.step(plates, "running");
  const setStatus = (id: string, status: JobScene["status"], note?: string) =>
    r.update((j) => {
      const sc = r.scene(j, id);
      if (sc && sc.status !== "refused") Object.assign(sc, { status }, note ? { note } : {});
    });
  const paint = async (id: string) => {
    setStatus(id, "painting");
    try {
      const ok = await r.scoped(plates, id, () => illustrateScene(slug, id, r.onStage(plates)));
      if (ok) setStatus(id, "painted");
      return ok;
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      setStatus(id, "failed", `Muse Image failed: ${friendly(e)}`);
      r.log({ step: plates, scene: id, kind: "error", message: `plate failed: ${friendly(e)}` });
      return false;
    }
  };
  const finish = async (id: string) => {
    if (r.live().steps[cutouts].status === "waiting") r.step(cutouts, "running");
    setStatus(id, "cutting");
    try {
      await r.scoped(cutouts, id, () => segmentScene(slug, id, r.onStage(cutouts)));
      await r.scoped(cutouts, id, () => lineScene(slug, id, r.onStage(cutouts)));
      setStatus(id, "done");
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      setStatus(id, "painted", `cut-outs failed: ${friendly(e)}`);
      r.log({ step: cutouts, scene: id, kind: "error", message: `cut-outs failed: ${friendly(e)}` });
    }
  };
  const finishing: Promise<void>[] = [];
  const lane = limiter(PARALLEL);
  const painted = async (id: string) => {
    if (r.scene(r.live(), id)!.status === "done") return;
    if (await paint(id)) finishing.push(lane(() => finish(id)));
  };
  const [first, ...rest] = ids;
  await painted(first);
  await pool(rest, PARALLEL, painted);
  const refused = r.live().scenes.filter((s) => s.status === "refused" || s.status === "failed").length;
  r.step(plates, refused === ids.length ? "failed" : "done", refused ? `${refused} of ${ids.length} scenes have no plate` : undefined);
  await Promise.all(finishing);
  r.step(cutouts, r.live().steps[cutouts].status === "waiting" ? "skipped" : "done");
}

/** Run a pipeline CLI (`tsx pipeline/<script> ...`) as a child, handing each stdout line to `onLine`. */
export function child(args: string[], onLine: (line: string) => void, onError: (text: string) => void): Promise<number> {
  return new Promise<number>((resolve) => {
    const c = spawn(join(ROOT, "node_modules/.bin/tsx"), args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let buf = "";
    c.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const l of lines) onLine(l);
    });
    c.stderr.on("data", (d) => onError(String(d).trim().slice(0, 160)));
    c.on("close", (code) => resolve(code ?? 1));
    c.on("error", () => resolve(1));
  });
}

/** The scene films, rendered locally (sharp + ffmpeg) by `pnpm video` in a child process, so the server keeps answering. */
export async function runFilms<S extends string, J extends BaseJob<S>>(r: Runner<S, J>, slug: string) {
  const films = "films" as S;
  if (!r.live().scenes.some((s) => s.plate && s.treatment !== "line")) return r.step(films, "skipped", "no plates to film");
  r.step(films, "running");
  r.log({ step: films, kind: "info", message: "rendering scroll films on this machine (sharp + ffmpeg, no API calls)" });
  const code = await child(
    ["pipeline/video.ts", slug],
    (l) => {
      const m = l.match(/^\s+(s\d+): (.+)$/);
      if (m) r.log({ step: films, scene: m[1], kind: "info", message: m[2] });
    },
    (text) => r.log({ step: films, kind: "warn", message: text }),
  );
  const story = await loadStory(slug);
  r.update((j) => {
    for (const s of story.scenes) Object.assign(r.scene(j, s.id) ?? {}, { video: s.video, poster: s.poster });
  });
  r.step(films, code === 0 ? "done" : "failed", code === 0 ? undefined : "the film renderer stopped; the book shows still plates instead");
}

/** Write the frontispiece's source picture, as the workbench shows it while the lines are traced. */
export async function showSource(slug: string, image: Sharp): Promise<string> {
  const shown = asset(slug, "frontispiece", "source.webp");
  await mkdir(join(shown.file, ".."), { recursive: true });
  await image.webp({ quality: 80 }).toFile(shown.file);
  return shown.url;
}

/**
 * The emblem a frontispiece is traced from when there is no photo: the storyboard's emblem brief
 * (or `fallback`), painted by Muse Image once into source/emblem.png. Returns the file and the
 * concept SAM 3.1 masks.
 */
export async function emblemSource(slug: string, fallback: string, onPaint: (emblem: Emblem) => void): Promise<{ file: string; concept: string }> {
  const dir = storyDir(slug);
  const emblem: Emblem = existsSync(join(dir, "emblem.json")) ? JSON.parse(await readFile(join(dir, "emblem.json"), "utf8")) : { visual: fallback, concept: "object" };
  const concept = emblem.concept.split(/\s+/).slice(-2).join(" ") || "object";
  const file = join(dir, "source/emblem.png");
  if (!existsSync(file)) {
    onPaint(emblem);
    await writeFile(file, await museImage(emblemPrompt(emblem.visual, emblem.concept), []));
  }
  return { file, concept };
}

/** A visitor's photo, re-encoded (which also drops EXIF: camera, GPS) before anything reads it. */
export const reencodePhoto = (bytes: Uint8Array, file: string) =>
  sharp(Buffer.from(bytes)).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(file);

/** A slug already used by a story, its pictures or its line drawing. */
export const slugTaken = (s: string) => existsSync(storyDir(s)) || existsSync(join(ROOT, "public/stories", s)) || existsSync(join(ROOT, "public/lines", `${s}.json`));

/** stories/<slug>/credit.json: how the book credits its frontispiece (lib/portraits.ts reads it). */
export const writeCredit = (slug: string, credit: { kind: string; text: string; masked: string }) =>
  writeFile(join(storyDir(slug), "credit.json"), JSON.stringify(credit, null, 2) + "\n");
