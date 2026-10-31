/**
 * Rendering one scene's film, locally (sharp to decode, the compositor in frame.ts, ffmpeg to
 * encode): the fixed move (a push-in and truck, the subject settling on its clean background),
 * a directed film from Muse Wonder's motion plan, or a line scene drawing itself. Output per
 * scene: public/stories/<slug>/<sN>/scene.mp4 (every frame a keyframe, so any position seeks
 * instantly) and scene.jpg (the first frame, the poster).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Scene } from "../../lib/schema";
import { eraFor } from "../../lib/eras";
import { ROOT } from "../root";
import { FILM, cameraAt, easeInOutSine, lensFor, lensForPath, project, settled } from "./camera";
import { draw, encodeSized, encoder, fileOf, finish, finishPlanned, load, particles, vignette, type Particle } from "./frame";
import { separate, separateLayers } from "./layers";
import { aimAt } from "./matte";
import { fitPlan, focusOf, layerAt, planCamera, layerRect, moved, pathOf, rng, sanitizePlan, type MotionPlan } from "./motion";
import { drawnStrokes, lineAt, strokeLengths, LINE, type LineData } from "./line";

/** A Muse Wonder motion plan for the scene (pnpm wonder); when present the film follows it. */
export const motionFile = (slug: string, id: string) => join(ROOT, "public/stories", slug, id, "motion.json");

export interface Plan {
  /** The plate (full-size PNG when there is one). */
  plate: string;
  /** Clean background (the plate with the cut objects removed); null films the plate alone. */
  clean: string | null;
  /** Depth the separated subject moves at. */
  depth: number;
  /** Side the camera trucks toward when there is no subject to decide it. */
  dir: 1 | -1;
}

/** What to film for a scene, from what exists on disk; null when there is no plate. */
export function planScene(scene: Scene, exists: (url: string) => boolean): Plan | null {
  const png = scene.plate?.replace(/\.webp$/, ".png");
  const plate = png && exists(png) ? png : scene.plate && exists(scene.plate) ? scene.plate : null;
  if (!plate) return null;
  const cuts = scene.layers.filter((l) => l.src && exists(l.src));
  const clean = cuts.length && scene.background && exists(scene.background) ? scene.background : null;
  const n = Number(scene.id.slice(1)) || 1;
  return { plate, clean, depth: clean ? Math.max(...cuts.map((l) => l.depth)) : FILM.plateDepth, dir: n % 2 ? 1 : -1 };
}

/** Render and encode one scene. Returns what was filmed and the bytes written. */
export async function renderScene(slug: string, scene: Scene, plan: Plan, f = FILM) {
  const N = f.size, frames = Math.round(f.fps * f.seconds);
  const dir = join(ROOT, "public/stories", slug, scene.id);
  const side = Math.round(N * 1.25);
  const subject = plan.clean ? await separate(fileOf(plan.plate), fileOf(plan.clean), side) : null;
  const aim = subject ? aimAt(subject.box) : { focal: { x: 0.5, y: 0.5 }, dir: plan.dir };
  const backDepth = subject ? 0 : plan.depth;
  const lens = lensFor(backDepth, aim.dir, aim.focal, f);
  const back = await load(fileOf(subject ? plan.clean! : plan.plate), side);
  // A defocused copy of the background fades in as the camera closes on the subject.
  const soft = subject ? await load(fileOf(plan.clean!), side, 2.2) : null;
  const vig = vignette(N, f.vignette);
  const frame = new Float32Array(N * N * 3);
  const out = Buffer.alloc(N * N * 3);

  const mp4 = join(dir, "scene.mp4");
  const enc = encoder(mp4, N, f);

  const full = { left: 0, top: 0, width: 1, height: 1 };
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const cam = cameraAt(t, aim.dir, f);
    frame.fill(0);
    const br = project(full, backDepth, cam, aim.focal, lens);
    draw(frame, N, back, br);
    if (soft) draw(frame, N, soft, br, 0.5 * easeInOutSine(t));
    if (subject) {
      const b = project(subject.box, plan.depth, cam, aim.focal, lens);
      const foot = { x: b.left + b.width / 2, y: b.top + b.height };
      draw(frame, N, subject.img, settled(project(full, plan.depth, cam, aim.focal, lens), cam.settle, foot, f));
    }
    finish(frame, N, vig, t, out, f);
    if (i === 0) await sharp(out, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(dir, "scene.jpg"));
    await enc.write(out);
  }
  return { layered: Boolean(subject), ...(await enc.close()) };
}

/**
 * Render a scene from a motion plan. `outDir` defaults to the scene folder (scene.mp4 and
 * scene.jpg); wonder.ts renders candidate rounds elsewhere first. The plan is fitted again here,
 * so even a hand-edited motion.json can't push a layer off-frame.
 */
export async function renderDirected(slug: string, scene: Scene, base: Plan, motion: MotionPlan, outDir?: string, f = FILM) {
  const N = f.size, count = Math.round(f.fps * f.seconds);
  const dir = outDir ?? join(ROOT, "public/stories", slug, scene.id);
  const side = Math.round(N * 1.25);
  const cuts = base.clean ? scene.layers.filter((l) => l.src && existsSync(fileOf(l.src))) : [];
  const specs = [];
  for (const l of cuts) {
    const meta = await sharp(fileOf(l.src!)).metadata();
    specs.push({ id: l.id, rect: layerRect(l, (meta.height ?? 1) / (meta.width ?? 1)), cut: fileOf(l.src!) });
  }
  const parts = base.clean && specs.length ? await separateLayers(fileOf(base.plate), fileOf(base.clean), side, specs) : [];
  const layered = parts.length > 0;
  const backDepth = layered ? 0 : base.depth;
  const ids = layered ? parts.map((p) => ({ id: p.id, depth: motion.layers.find((m) => m.id === p.id)?.depth ?? 0.6 })) : [];
  const sane = sanitizePlan(motion, ids);
  const boxes = Object.fromEntries(parts.map((p) => [p.id, p.box]));
  const fitted = fitPlan(sane.plan, boxes, backDepth);
  const plan = fitted.plan, fixes = [...sane.fixes, ...fitted.fixes];
  const focal = focusOf(plan);
  const lens = lensForPath(backDepth, pathOf(plan, 60), focal);
  const back = await load(fileOf(layered ? base.clean! : base.plate), side);
  const vig = vignette(N, f.vignette);
  const frame = new Float32Array(N * N * 3);
  const full = { left: 0, top: 0, width: 1, height: 1 };
  const rand = rng(createHash("sha1").update(`${slug}/${scene.id}`).digest().readUInt32LE(0));
  const set: Particle[] = Array.from({ length: plan.ambient === "rain" ? 140 : 70 }, () => ({ x: rand(), y: rand(), r: 1 + rand() * 1.8, a: 0.12 + rand() * 0.22, ph: rand() }));
  // Draw far to near so nearer layers overlap farther ones.
  const order = parts.map((p) => ({ p, m: plan.layers.find((m) => m.id === p.id)! })).sort((a, b) => a.m.depth - b.m.depth);
  const frames: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const cam = planCamera(plan, t);
    frame.fill(0);
    draw(frame, N, back, project(full, backDepth, cam, focal, lens));
    for (const { p, m } of order) {
      const la = layerAt(m, t, f);
      if (la.opacity <= 0) continue;
      const b = project(p.box, m.depth, cam, focal, lens);
      draw(frame, N, p.img, moved(project(full, m.depth, cam, focal, lens), { x: b.left + b.width / 2, y: b.top + b.height }, la), la.opacity);
    }
    particles(frame, N, plan.ambient, set, t);
    const out = Buffer.alloc(N * N * 3);
    finishPlanned(frame, N, vig, t, out, plan.ambient, f);
    frames.push(out);
  }
  await sharp(frames[0], { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(dir, "scene.jpg"));
  const enc = await encodeSized(join(dir, "scene.mp4"), frames, N, f);
  return { layered, layers: parts.length, plan, fixes, ...enc };
}

const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** Render and encode a line scene. */
export async function renderLineScene(slug: string, scene: Scene, plate: string, line: LineData, f = FILM, l = LINE) {
  const N = f.size, frames = Math.round(f.fps * f.seconds);
  const dir = join(ROOT, "public/stories", slug, scene.id);
  const era = eraFor(scene.year);
  const paper = hexRgb(era.paper), ink = era.ink;
  const cam = { ...f, truck: l.truck };
  const n = Number(scene.id.slice(1)) || 1;
  const turn: 1 | -1 = n % 2 ? 1 : -1;
  const focal = { x: 0.5, y: 0.5 };
  const lens = lensFor(f.plateDepth, turn, focal, cam);
  const side = Math.round(N * 1.25);
  const img = await load(fileOf(plate), side);
  const vig = vignette(N, f.vignette);
  const frame = new Float32Array(N * N * 3);
  const out = Buffer.alloc(N * N * 3);
  const cum = strokeLengths(line.strokes);
  const U = 1000, H = Math.round(line.aspect * U);
  const path = (s: number[]) => {
    let d = "";
    for (let i = 0; i < s.length; i += 2) d += `${i ? "L" : "M"}${(s[i] * U).toFixed(1)} ${(s[i + 1] * U).toFixed(1)}`;
    return d;
  };
  const full = { left: 0, top: 0, width: 1, height: 1 };
  const enc = encoder(join(dir, "scene.mp4"), N, f);

  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const at = lineAt(t, l);
    const r = project(full, f.plateDepth, cameraAt(t, turn, cam), focal, lens);
    for (let o = 0; o < frame.length; o += 3) (frame[o] = paper[0]), (frame[o + 1] = paper[1]), (frame[o + 2] = paper[2]);
    draw(frame, N, img, r, at.plate);
    const drawn = drawnStrokes(line.strokes, at.pen, cum);
    if (drawn.length) {
      // The drawing sits exactly on the plate it was traced from, so it moves with it.
      const k = (r.width * N) / U;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}"><g transform="translate(${(r.left * N).toFixed(2)} ${(r.top * N).toFixed(2)}) scale(${k.toFixed(5)} ${((r.height * N) / H).toFixed(5)})" fill="none" stroke="${ink}" stroke-width="${l.stroke}" stroke-linecap="round" stroke-linejoin="round" opacity="${at.ink.toFixed(3)}"><path d="${drawn.map(path).join("")}"/></g></svg>`;
      draw(frame, N, await load(Buffer.from(svg)), full);
    }
    finish(frame, N, vig, t, out, f);
    if (i === 0) await sharp(out, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(dir, "scene.jpg"));
    await enc.write(out);
  }
  return enc.close();
}
