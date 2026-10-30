/**
 * pnpm make <slug> [--stages research,storyboard,verify,illustrate,segment,line] [--scenes s1,s4]
 *                  [--name "Jack Sim" --hint "founder of the World Toilet Organization"]
 * Needs MODEL_API_KEY in .env. Each stage reads what the previous one wrote, so any can be rerun.
 */
import { parseArgs } from "node:util";
import { illustrate, line, research, segment, storyboard, verify } from "./stages";

try {
  process.loadEnvFile(".env");
} catch {
  /* no .env */
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    hint: { type: "string", default: "Singaporean" },
    stages: { type: "string", default: "illustrate,segment,line" },
    scenes: { type: "string" },
  },
});
const slug = positionals[0];
if (!slug) {
  console.log("usage: pnpm make <slug> [--stages a,b] [--scenes s1,s2] [--name ... --hint ...]");
  process.exit(1);
}
const only = values.scenes?.split(",");
for (const stage of values.stages!.split(",")) {
  const t = Date.now();
  console.log(`▸ ${stage}`);
  if (stage === "research") {
    if (!values.name) throw new Error("--name is required for research");
    console.log(`  ${(await research(slug, values.name, values.hint!)).length} cited facts`);
  } else if (stage === "storyboard") await storyboard(slug);
  else if (stage === "verify") {
    const disputed = await verify(slug);
    if (disputed.length) console.log(`  ${disputed.length} disputed: see stories/${slug}/verify.json`);
  } else if (stage === "illustrate") await illustrate(slug, only);
  else if (stage === "segment") await segment(slug, only);
  else if (stage === "line") await line(slug, only);
  else throw new Error(`unknown stage ${stage}`);
  console.log(`  done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
}
