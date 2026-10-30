/**
 * pnpm family voice                       voice the fictional sample script (macOS `say` + ffmpeg)
 * pnpm family make [<audio>] [--slug s] [--name n] [--hint h] [--keywords "a, b"] [--origin url]
 *                                         make a family book from a recording; with no audio, the
 *                                         sample (as ah-ma-sample). A rerun picks up where it stopped.
 * pnpm family score [<slug>]              compare a transcript with the sample's true script
 * pnpm family relink <slug> <origin>      point a book's recording citations at another origin
 *                                         (e.g. the deployed site's), in family.json, research.json and story.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ROOT } from "../root";

try {
  process.loadEnvFile(join(ROOT, ".env"));
} catch {
  /* no key: only voice and score work */
}

const { SAMPLE, voiceSample } = await import("./sample");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { slug: { type: "string" }, name: { type: "string" }, hint: { type: "string" }, keywords: { type: "string" }, origin: { type: "string" } },
});
const [cmd, ...rest] = positionals;
const ORIGIN = values.origin ?? process.env.FAMILY_ORIGIN ?? "http://localhost:3100";

if (cmd === "voice") {
  console.log(await voiceSample());
} else if (cmd === "make") {
  const fam = await import("./index");
  const { cleanKeywords, jobFile } = await import("./record");
  const { storyDir } = await import("../stages");
  const audio = rest[0] ?? SAMPLE.publicWav;
  const sample = !rest[0];
  const slug = values.slug ?? (sample ? SAMPLE.slug : undefined);
  if (!slug) throw new Error("--slug is needed for your own recording");
  const name = values.name ?? (sample ? SAMPLE.name : undefined);
  if (!name) throw new Error("--name is needed for your own recording");
  // The sample is a fictional family, so it gets the names a family would type in.
  const keywords = values.keywords ? cleanKeywords(values.keywords) : sample ? ["Teluk Ayer", "Potong Pasir", "Queenstown", "mee pok", "Singer", "Wei Ling"] : [];
  const old = fam.getJob(slug);
  const hint = values.hint ?? (sample ? SAMPLE.hint : "");
  const started = Date.now();
  let seen = 0;
  fam.subscribe((j) => {
    for (const l of j.log.slice(seen)) console.log(`  ${l.at.slice(11, 19)} ${l.step}${l.scene ? ` ${l.scene}` : ""}: ${l.message}`);
    seen = j.log.length;
  });
  // A rerun of an unfinished book keeps its meter, clocks and log; finished work on disk is skipped.
  const job = old && old.status !== "done" ? { ...old, status: "running" as const, error: undefined, finishedAt: undefined } : fam.newJob({ slug, name, hint, photos: 0, sample });
  if (old && old.status !== "done") seen = old.log.length;
  for (const st of Object.values(job.steps)) if (st.status === "failed") st.status = "waiting";
  await fam.launch(job, () => fam.runReal({ slug, name, hint, keywords, origin: ORIGIN, audio: { file: audio }, photos: [], sample }));
  const j = fam.getJob(slug)!;
  // The runner saves asynchronously; write the final state before the process exits.
  writeFileSync(jobFile(slug), JSON.stringify(j, null, 1));
  console.log(`\n${j.status} in ${Math.round((Date.now() - started) / 1000)} s, $${j.usd.toFixed(4)}${j.error ? `: ${j.error}` : ""}`);
  console.log(`book: ${ORIGIN}/${slug}   record: ${ORIGIN}/family/${slug}   folder: ${storyDir(slug)}`);
  process.exit(j.status === "done" ? 0 : 1);
} else if (cmd === "score") {
  const slug = rest[0] ?? SAMPLE.slug;
  const fam = JSON.parse(readFileSync(join(ROOT, "stories", slug, "family.json"), "utf8"));
  const truth = JSON.parse(readFileSync(SAMPLE.timeline, "utf8"));
  const { norm } = await import("./facts");
  const words = (s: string) => norm(s).split(" ").filter(Boolean);
  const ref = truth.lines.flatMap((l: { text: string }) => words(l.text));
  const hyp = fam.transcript.turns.flatMap((t: { text: string }) => words(t.text));
  // Word error rate: edit distance over words.
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)]);
  for (let j = 1; j <= hyp.length; j++) d[0][j] = j;
  for (let i = 1; i <= ref.length; i++) for (let j = 1; j <= hyp.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  console.log(`words: ${ref.length} said, ${hyp.length} heard; word error rate ${((d[ref.length][hyp.length] / ref.length) * 100).toFixed(1)}%`);
  const turns = fam.transcript.turns as { startMs: number; text: string; speaker?: string }[];
  // Each scripted line against the nearest returned turn start (the model may split a line into two turns).
  const drift = truth.lines.map((l: { startMs: number }) => Math.min(...turns.map((t) => Math.abs(t.startMs - l.startMs)))).sort((a: number, b: number) => a - b);
  console.log(`turns: ${truth.lines.length} scripted lines, ${turns.length} turns returned; line start vs nearest turn start: median ${drift[Math.floor(drift.length / 2)]} ms, max ${drift.at(-1)} ms`);
  const near = (ms: number) => turns.reduce((a, t) => (Math.abs(t.startMs - ms) < Math.abs(a.startMs - ms) ? t : a));
  const pairs = truth.lines.map((l: { speaker: string; startMs: number }) => `${l.speaker}→${near(l.startMs).speaker ?? "?"}`);
  const counts: Record<string, number> = {};
  for (const x of pairs) counts[x] = (counts[x] ?? 0) + 1;
  console.log(`speakers (script→diarization): ${Object.entries(counts).map(([k, v]) => `${k} ×${v}`).join(", ")}`);
} else if (cmd === "check") {
  // Check a finished book's captions against its recording (what a new run does after the storyboard).
  const slug = rest[0] ?? SAMPLE.slug;
  const { readRecord, jobFile } = await import("./record");
  const { applyChecks, checkCaptions } = await import("./check");
  const { edit, loadStory } = await import("../stages");
  const { withScope } = await import("../budget");
  const { jobTag } = await import("../jobs/guard");
  const r = readRecord(slug);
  if (!r?.facts || !r.transcript) throw new Error(`${slug} has no facts or transcript`);
  let usd = 0;
  const verdicts = await withScope({ job: jobTag(slug), onSpend: (e) => (usd += e.usd) }, () => loadStory(slug).then((s) => checkCaptions(s, r.facts!, r.transcript!.turns)));
  let fixed = 0;
  const story = await edit(slug, (s) => void (fixed = applyChecks(s, verdicts)));
  for (const s of story.scenes) console.log(`${s.id} ${s.checked?.verdict}: ${s.caption}\n     ${s.checked?.note}`);
  // The book's job keeps the full cost of making it.
  const jf = jobFile(slug);
  if (existsSync(jf)) {
    const job = JSON.parse(readFileSync(jf, "utf8"));
    job.usd = +(job.usd + usd).toFixed(6);
    job.spend.spark = +((job.spend.spark ?? 0) + usd).toFixed(6);
    job.steps.storyboard.usd = +(job.steps.storyboard.usd + usd).toFixed(6);
    job.log.push({ at: new Date().toISOString(), step: "storyboard", kind: "info", model: "muse-spark", message: `${fixed} caption${fixed === 1 ? "" : "s"} rewritten to say only what was said` });
    writeFileSync(jf, JSON.stringify(job, null, 1));
  }
  console.log(`${fixed} rewritten, $${usd.toFixed(4)}`);
} else if (cmd === "relink") {
  const [slug, origin] = rest;
  if (!slug || !origin) throw new Error("usage: pnpm family relink <slug> <origin>");
  const swap = (s: string) => s.replace(/^https?:\/\/[^/]+(?=\/family\/)/, origin.replace(/\/$/, ""));
  for (const f of ["family.json", "research.json", "story.json"]) {
    const file = join(ROOT, "stories", slug, f);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8").replace(/"url": ?"([^"]+)"/g, (m, u) => m.replace(u, swap(u))).replace(/"origin": ?"[^"]*"/, `"origin": "${origin.replace(/\/$/, "")}"`);
    writeFileSync(file, text);
    console.log(`relinked ${f}`);
  }
} else {
  console.log("usage: pnpm family voice | make [<audio>] [--slug --name --hint --keywords --origin] | score [<slug>] | relink <slug> <origin>");
}

