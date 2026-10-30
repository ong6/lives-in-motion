/**
 * "Try the sample": replays the sample book's real run, compressed to about a minute, with the
 * same turns, facts, plates and costs, from its saved job. No Meta calls, nothing written,
 * nothing charged.
 */
import { MODELS } from "../meta";
import { loadStory, pool } from "../stages";
import { sleep, type Runner } from "../jobs/runner";
import { PARALLEL } from "../jobs/steps";
import { clock } from "./audio";
import { SAMPLE } from "./sample";
import type { FamilyJob, FamilyStepId } from "./types";

export async function replay(r: Runner<FamilyStepId, FamilyJob>, rec: FamilyJob) {
  const { update, step, log, fake, say, scene } = r;
  const story = await loadStory(SAMPLE.slug);
  // The real run's step costs, shared out over the scenes that had them.
  const painted = Math.max(1, story.scenes.filter((s) => s.plate).length);
  const perPlate = rec.steps.plates.usd / painted, perCut = rec.steps.cutouts.usd / painted;

  step("transcribe", "running");
  update((j) => Object.assign(j, { audio: rec.audio, durationMs: rec.durationMs }));
  log({ step: "transcribe", kind: "info", model: MODELS.transcribe, message: `transcribing ${clock((rec.durationMs ?? 0) / 1000)} of audio (English, Malay, Mandarin, Tamil; speakers labelled)` });
  await sleep(2500);
  for (let i = 1; i <= rec.turns.length; i++) {
    update((j) => Object.assign(j, { turns: rec.turns.slice(0, i), subject: rec.subject }));
    await sleep(Math.min(900, 9000 / rec.turns.length));
  }
  fake("transcribe", undefined, "transcribe", rec.steps.transcribe.usd);
  log({ step: "transcribe", kind: "info", model: MODELS.transcribe, message: `${rec.turns.length} turns` });
  step("transcribe", "done");

  step("facts", "running");
  log({ step: "facts", kind: "info", model: MODELS.spark, message: `reading ${rec.turns.length} turns for dated facts` });
  await sleep(2500);
  for (let i = 1; i <= rec.facts.length; i++) {
    update((j) => void (j.facts = rec.facts.slice(0, i)));
    await sleep(450);
  }
  fake("facts", undefined, "spark", rec.steps.facts.usd);
  log({ step: "facts", kind: "info", model: MODELS.spark, message: `${rec.facts.length} dated facts, each cited to the second it was said` });
  step("facts", "done");

  step("storyboard", "running");
  log({ step: "storyboard", kind: "info", model: MODELS.spark, message: `writing 7 scenes from ${rec.facts.length} facts` });
  await sleep(2500);
  fake("storyboard", undefined, "spark", rec.steps.storyboard.usd);
  update((j) => {
    Object.assign(j, { tagline: story.tagline, born: story.born });
    j.scenes = story.scenes.map((s) => ({ id: s.id, year: s.year, title: s.title, caption: s.caption, treatment: s.treatment, status: "waiting", cuts: [], spend: {} }));
  });
  step("storyboard", "done");

  const front = (async () => {
    step("frontispiece", "running");
    update((j) => void (j.frontispiece = { kind: rec.frontispiece?.kind ?? "emblem" }));
    await sleep(4000);
    update((j) => void (j.frontispiece!.image = rec.frontispiece?.image));
    log({ step: "frontispiece", kind: "asset", model: MODELS.image, message: "emblem", url: rec.frontispiece?.image });
    await sleep(3500);
    fake("frontispiece", undefined, "image", rec.steps.frontispiece.usd);
    update((j) => Object.assign(j.frontispiece!, { lines: rec.frontispiece?.lines, strokes: rec.frontispiece?.strokes }));
    log({ step: "frontispiece", kind: "asset", message: `traced in ${rec.frontispiece?.strokes ?? 0} strokes` });
    step("frontispiece", "done");
  })();

  step("plates", "running");
  const one = async (id: string) => {
    const s = story.scenes.find((x) => x.id === id)!;
    update((j) => void (scene(j, id)!.status = "painting"));
    say("plates", { scene: id, kind: "info", model: MODELS.image, message: `painting ${s.year}` });
    await sleep(3000 + Math.random() * 2000);
    if (!s.plate) {
      say("plates", { scene: id, kind: "refused", model: MODELS.image, message: "Muse Image declined this scene under its content policy; skipped" });
      return;
    }
    fake("plates", id, "image", perPlate);
    say("plates", { scene: id, kind: "plate", model: MODELS.image, message: "plate", url: s.plate });
    if (r.live().steps.cutouts.status === "waiting") step("cutouts", "running");
    update((j) => void (scene(j, id)!.status = "cutting"));
    for (const l of s.layers.filter((x) => x.src)) {
      await sleep(1000);
      say("cutouts", { scene: id, kind: "cut", model: MODELS.sam, message: `cut out “${l.concept}”`, url: l.src, data: l });
    }
    fake("cutouts", id, "sam", perCut);
    if (s.background) {
      await sleep(2000);
      say("cutouts", { scene: id, kind: "background", model: MODELS.image, message: "clean background", url: s.background });
    }
    if (s.line) say("cutouts", { scene: id, kind: "line", message: "traced in pen strokes", url: s.line });
    update((j) => void (scene(j, id)!.status = "done"));
  };
  await one(story.scenes[0].id);
  await pool(story.scenes.slice(1).map((s) => s.id), PARALLEL, one);
  step("plates", "done", rec.steps.plates.note);
  step("cutouts", "done");
  await front;

  step("films", "running");
  for (const s of story.scenes.filter((x) => x.video)) {
    await sleep(600);
    update((j) => Object.assign(scene(j, s.id) ?? {}, { poster: s.poster, video: s.video }));
    log({ step: "films", scene: s.id, kind: "info", message: "film rendered" });
  }
  step("films", "done");
}
