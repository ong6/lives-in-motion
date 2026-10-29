/**
 * pnpm make <slug> [--name "Jack Sim" --hint "founder of the World Toilet Organization"]
 *                  [--stages research,storyboard,illustrate,segment] [--scenes s1,s4]
 * Needs MODEL_API_KEY in .env. Stages are resumable: each reads the previous stage's file.
 */
import { parseArgs } from "node:util";
import { illustrate, research, segment, storyboard } from "./stages";

try { process.loadEnvFile(".env"); } catch { /* no .env: fine for --help */ }

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    hint: { type: "string", default: "Singaporean" },
    stages: { type: "string", default: "research,storyboard,illustrate,segment" },
    scenes: { type: "string" },
  },
});
const slug = positionals[0];
if (!slug) {
  console.log('usage: pnpm make <slug> [--name "Full Name" --hint "who they are"] [--stages a,b] [--scenes s1,s2]');
  process.exit(1);
}
const stages = values.stages!.split(",");
for (const stage of stages) {
  const t = Date.now();
  console.log(`▸ ${stage}`);
  if (stage === "research") {
    if (!values.name) throw new Error("--name is required for research");
    const facts = await research(slug, values.name, values.hint!);
    console.log(`  ${facts.length} cited facts`);
  } else if (stage === "storyboard") {
    const s = await storyboard(slug);
    console.log(`  ${s.scenes.length} scenes`);
  } else if (stage === "illustrate") {
    await illustrate(slug, values.scenes?.split(","));
  } else if (stage === "segment") {
    await segment(slug);
  } else throw new Error(`unknown stage ${stage}`);
  console.log(`  done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
}
