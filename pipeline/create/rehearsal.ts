/**
 * A /create rehearsal: replays a finished life (Jack Sim's) as if it were being made, with the
 * same events and assets (Muse Wonder's real rationales and critic scores included), timings
 * compressed to about a minute, and costs that add up to the typical cost of a life
 * (lib/cost.ts), so "a real run would cost" matches the figure quoted everywhere else. No Meta
 * calls, nothing written to stories/. One scene is refused and one call retried, so the page's
 * error states can be seen too.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lifeCost } from "../../lib/cost";
import { PRICES } from "../budget";
import { MODELS } from "../meta";
import { ROOT } from "../root";
import { loadStory, pool } from "../stages";
import { sleep, type Runner } from "../jobs/runner";
import { PARALLEL } from "../jobs/steps";
import { independentSources } from "./screen";
import { DIRECT_PARALLEL, DIRECT_ROUNDS, type Job, type StepId } from "./types";

/** The scene the rehearsal shows Muse Image declining. */
const REFUSED = "s6";

export async function rehearse(r: Runner<StepId, Job>, slug: string) {
  const { update, step, log, fake, say, scene } = r;
  const story = await loadStory(slug);
  const job = r.live();
  // The typical life's costs, spread over the events that would have spent them.
  const cost = lifeCost(ROOT).parts;
  const painted = story.scenes.filter((s) => s.id !== REFUSED);
  const backgrounds = painted.filter((s) => s.background).length;
  const cutCount = painted.reduce((a, s) => a + s.layers.filter((l) => l.src).length, 0);
  const perBackground = Math.min(PRICES.image, cost.cutouts / Math.max(1, backgrounds));
  const perCut = Math.max(0, cost.cutouts - perBackground * backgrounds) / Math.max(1, cutCount);
  const report = (() => {
    try {
      return JSON.parse(readFileSync(join(ROOT, "public/stories", slug, "wonder.json"), "utf8")).scenes as Record<string, { status: string; score?: number; passed?: boolean; rationale?: string; verdict?: string; rounds?: number; note?: string }>;
    } catch {
      return {};
    }
  })();
  const toDirect = painted.filter((s) => s.treatment !== "line" && s.video);

  step("screen", "running");
  say("screen", { kind: "info", model: MODELS.spark, message: `searching the web to confirm who ${job.name} is before any research` });
  await sleep(2500);
  fake("screen", undefined, "spark", cost.screen);
  const checked = story.scenes.flatMap((s) => s.sources).filter((x, i, all) => all.findIndex((y) => y.url === x.url) === i).slice(0, 5);
  update(
    (j) =>
      void (j.screen = {
        ok: true,
        category: "social_enterprise",
        known_for: "founder of the World Toilet Organization",
        check: { status: "identified", singapore: true, minor: false, reason: "Singaporean social entrepreneur who founded the World Toilet Organization in 2001, covered by Wikipedia, the press and the UN.", sources: checked, independent: independentSources(checked) },
      }),
  );
  say("screen", { kind: "info", model: MODELS.spark, message: `founder of the World Toilet Organization: confirmed by ${checked.length} independent sources, go ahead` });
  step("screen", "done", "social enterprise");

  step("research", "running");
  say("research", { kind: "info", model: MODELS.spark, message: `searching the web for ${job.name}` });
  await sleep(2500);
  log({ step: "research", kind: "retry", message: "rate limited; retrying in 3 s" });
  await sleep(2500);
  const facts = story.scenes.map((s, i) => ({ n: i + 1, year: s.year, text: s.caption, sources: s.sources }));
  for (let i = 1; i <= facts.length; i++) {
    update((j) => void (j.facts = facts.slice(0, i)));
    await sleep(350);
  }
  fake("research", undefined, "search", cost.research);
  say("research", { kind: "info", model: MODELS.spark, message: `${facts.length} cited facts` });
  step("research", "done");

  step("storyboard", "running");
  say("storyboard", { kind: "info", model: MODELS.spark, message: `writing 7 scenes from ${facts.length} facts` });
  await sleep(3000);
  fake("storyboard", undefined, "spark", cost.storyboard);
  update((j) => {
    j.tagline = story.tagline;
    j.born = story.born;
    j.died = story.died;
    j.scenes = story.scenes.map((s) => ({ id: s.id, year: s.year, title: s.title, caption: s.caption, treatment: s.treatment, status: "waiting", cuts: [], spend: {} }));
  });
  step("storyboard", "done");

  const front = (async () => {
    step("frontispiece", "running");
    // Jack Sim's frontispiece is traced from a credited Commons photo, not a Muse Image emblem.
    update((j) => void (j.frontispiece = { kind: "photo", credit: "Photo: Clorox Toilet Products, CC BY 2.0, via Wikimedia Commons" }));
    await sleep(4000);
    update((j) => void (j.frontispiece!.image = `/portraits/${slug}.webp`));
    log({ step: "frontispiece", kind: "asset", message: "credited portrait photo (CC BY 2.0), ready to trace", url: `/portraits/${slug}.webp` });
    log({ step: "frontispiece", kind: "info", model: MODELS.sam, message: "masking the person, then tracing it in pen lines" });
    await sleep(4000);
    fake("frontispiece", undefined, "sam", cost.frontispiece);
    update((j) => Object.assign(j.frontispiece!, { lines: `/lines/${slug}.json`, strokes: 2400 }));
    log({ step: "frontispiece", kind: "asset", message: "traced in 2400 strokes" });
    step("frontispiece", "done");
  })();

  step("plates", "running");
  const one = async (id: string) => {
    const s = story.scenes.find((x) => x.id === id)!;
    update((j) => void (scene(j, id)!.status = "painting"));
    say("plates", { scene: id, kind: "info", model: MODELS.image, message: `painting ${s.year}` });
    await sleep(3500 + Math.random() * 2500);
    if (id === REFUSED) {
      say("plates", { scene: id, kind: "refused", model: MODELS.image, message: "Muse Image declined this scene under its content policy; skipped" });
      update((j) => Object.assign(scene(j, id)!, { status: "refused", note: "Muse Image declined this scene under its content policy; skipped" }));
      return;
    }
    fake("plates", id, "image", cost.plates / painted.length);
    say("plates", { scene: id, kind: "plate", model: MODELS.image, message: "plate", url: s.plate });
    if (r.live().steps.cutouts.status === "waiting") step("cutouts", "running");
    update((j) => void (scene(j, id)!.status = "cutting"));
    for (const l of s.layers.filter((x) => x.src)) {
      await sleep(1200);
      fake("cutouts", id, "sam", perCut);
      say("cutouts", { scene: id, kind: "cut", model: MODELS.sam, message: `cut out “${l.concept}”`, url: l.src, data: l });
    }
    if (s.background) {
      await sleep(2500);
      fake("cutouts", id, "image", perBackground);
      say("cutouts", { scene: id, kind: "background", model: MODELS.image, message: "clean background", url: s.background });
    }
    if (s.line) say("cutouts", { scene: id, kind: "line", message: "traced in pen strokes", url: s.line });
    update((j) => void (scene(j, id)!.status = "done"));
  };
  await one("s1");
  await pool(story.scenes.slice(1).map((s) => s.id), PARALLEL, one);
  step("plates", "done", "1 of 7 scenes has no plate");
  step("cutouts", "done");
  await front;

  step("films", "running");
  for (const s of story.scenes.filter((x) => x.video)) {
    await sleep(700);
    update((j) => Object.assign(scene(j, s.id) ?? {}, { poster: s.poster, video: s.video }));
    log({ step: "films", scene: s.id, kind: "info", message: "film rendered" });
  }
  step("films", "done");

  step("direct", "running");
  log({ step: "direct", kind: "info", model: MODELS.wonder, message: `Muse Wonder plans a move for ${toDirect.length} films, watches each one and asks for one revision at most` });
  update((j) => {
    for (const s of toDirect) Object.assign(scene(j, s.id) ?? {}, { wonder: { status: "directing" } });
  });
  let directed = 0;
  await pool(toDirect, DIRECT_PARALLEL, async (s) => {
    const w = report[s.id];
    await sleep(1500 + Math.random() * 1500);
    if (w?.rationale) log({ step: "direct", scene: s.id, kind: "info", model: MODELS.wonder, message: `director: ${w.rationale}` });
    await sleep(1200);
    fake("direct", s.id, "wonder", cost.direct / toDirect.length);
    const ok = w?.status === "directed";
    if (ok) directed++;
    update((j) => Object.assign(scene(j, s.id) ?? {}, { wonder: w ? { status: ok ? "directed" : "kept-fixed-move", score: w.score, passed: w.passed, rationale: w.rationale, verdict: w.verdict, rounds: Math.min(w.rounds ?? 1, DIRECT_ROUNDS + 1), usd: +(cost.direct / toDirect.length).toFixed(4), note: w.note } : { status: "kept-fixed-move", note: "no direction recorded" } }));
    log({ step: "direct", scene: s.id, kind: "info", model: MODELS.wonder, message: w?.score != null ? `${ok ? "directed" : "fixed move kept"}, critic ${w.score}/10` : "fixed move kept" });
  });
  step("direct", "done", `${directed} of ${toDirect.length} films directed`);
}
