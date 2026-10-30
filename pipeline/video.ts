/**
 * pnpm video <slug> [--scenes s1,s4] [--dry]   (--dry renders but leaves story.json alone)
 *
 * Renders each illustrated scene as a short 2.5D film the book plays when its page turns open
 * (pipeline/film/): a virtual camera pushes in and trucks sideways, every layer moves by its own
 * depth (the clean background far, the SAM 3.1 cut-outs near), the subject settles into place,
 * and a soft light passes over a vignette. Scenes without cut-outs get a slow push-in on the plate
 * alone. Line-treatment scenes film their line drawing drawing itself while the plate develops
 * underneath it. A scene with a motion.json (written by `pnpm wonder`, Muse Wonder's motion plan)
 * is filmed from that plan instead. Everything is local: no paid calls.
 *
 * The scene's `video` and `poster` URLs (with a content hash) are written into story.json by a
 * read-modify-write of the raw file.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Story } from "../lib/schema";
import { ROOT } from "./root";
import { fileOf } from "./film/frame";
import { motionFile, planScene, renderDirected, renderLineScene, renderScene } from "./film/render";

const storyFile = (slug: string) => join(ROOT, "stories", slug, "story.json");

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { scenes: { type: "string" }, dry: { type: "boolean" } } });
  const slug = positionals[0];
  if (!slug) {
    console.log("usage: pnpm video <slug> [--scenes s1,s4] [--dry]");
    process.exit(1);
  }
  const only = values.scenes?.split(",");
  const story = Story.parse(JSON.parse(await readFile(storyFile(slug), "utf8")));
  const made: Record<string, { video: string; poster: string }> = {};
  for (const scene of story.scenes) {
    if (only && !only.includes(scene.id)) continue;
    const plan = planScene(scene, (url) => existsSync(fileOf(url)));
    if (!plan) {
      console.log(`  ${scene.id}: no plate yet, skipped`);
      continue;
    }
    const t = Date.now();
    let bytes: number, hash: string, kind: string;
    if (scene.treatment === "line") {
      if (!scene.line || !existsSync(fileOf(scene.line))) {
        console.log(`  ${scene.id}: line treatment without a line drawing yet, skipped`);
        continue;
      }
      ({ bytes, hash } = await renderLineScene(slug, scene, plan.plate, JSON.parse(await readFile(fileOf(scene.line), "utf8"))));
      kind = "line drawing over the developing plate";
    } else if (existsSync(motionFile(slug, scene.id))) {
      const motion = JSON.parse(await readFile(motionFile(slug, scene.id), "utf8"));
      const r = await renderDirected(slug, scene, plan, motion.plan);
      ({ bytes, hash } = r);
      kind = `directed by ${motion.model ?? "Muse Wonder"} (${r.layers} layer${r.layers === 1 ? "" : "s"}, ${r.plan.ambient}${r.fixes.length ? `; ${r.fixes.join("; ")}` : ""})`;
    } else {
      const r = await renderScene(slug, scene, plan);
      ({ bytes, hash } = r);
      kind = r.layered ? "subject on clean background" : plan.clean ? "no subject in the difference matte, plate push-in" : "plate push-in";
    }
    const base = `/stories/${slug}/${scene.id}`;
    made[scene.id] = { video: `${base}/scene.mp4?v=${hash}`, poster: `${base}/scene.jpg?v=${hash}` };
    console.log(`  ${scene.id}: ${kind}, ${(bytes / 1e6).toFixed(2)} MB in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  if (!Object.keys(made).length || values.dry) return;
  // Read-modify-write the raw file right before writing, touching only these two fields, so a
  // pipeline that wrote meanwhile keeps its changes.
  const raw = JSON.parse(await readFile(storyFile(slug), "utf8"));
  for (const sc of raw.scenes) if (made[sc.id]) Object.assign(sc, made[sc.id]);
  Story.parse(raw);
  await writeFile(storyFile(slug), JSON.stringify(raw, null, 2) + "\n");
  console.log(`  story.json: video on ${Object.keys(made).join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
