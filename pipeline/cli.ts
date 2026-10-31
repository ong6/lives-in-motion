/**
 * pnpm make <slug> [--stages research,storyboard,verify,illustrate,segment,line] [--scenes s1,s4]
 *                  [--name "Jack Sim" --hint "founder of the World Toilet Organization"]
 * pnpm make <slug> --deep [--stages write,assemble,…] [--scenes s3] [--force]: the deep edition
 *                  (pipeline/deep/index.ts); without --stages it runs every stage, skipping work done.
 * Needs MODEL_API_KEY in .env. Each stage reads what the previous one wrote, so any can be rerun.
 */
import { parseArgs } from "node:util";
import { illustrate, line, research, segment, storyboard, verify } from "./stages";
import { DEEP_STAGES, makeDeep, type DeepStage } from "./deep";

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
    stages: { type: "string" },
    scenes: { type: "string" },
    deep: { type: "boolean" },
    force: { type: "boolean" },
  },
});
const slug = positionals[0];
if (!slug) {
  console.log("usage: pnpm make <slug> [--stages a,b] [--scenes s1,s2] [--name ... --hint ...]");
  process.exit(1);
}
const only = values.scenes?.split(",");
if (values.deep) {
  const stages = (values.stages?.split(",") ?? [...DEEP_STAGES]) as DeepStage[];
  const bad = stages.filter((s) => !DEEP_STAGES.includes(s));
  if (bad.length) throw new Error(`unknown deep stage ${bad.join(", ")}; stages: ${DEEP_STAGES.join(", ")}`);
  await makeDeep(slug, stages, { only, force: values.force });
  process.exit(0);
}
for (const stage of (values.stages ?? "illustrate,segment,line").split(",")) {
  const t = Date.now();
  console.log(`▸ ${stage}`);
  if (stage === "research") {
    if (!values.name) throw new Error("--name is required for research");
    console.log(`  ${(await research(slug, values.name, values.hint!)).length} cited facts`);
  } else if (stage === "storyboard") await storyboard(slug);
  else if (stage === "verify") {
    const disputed = await verify(slug, undefined, { only });
    if (disputed.length) console.log(`  ${disputed.length} disputed: see stories/${slug}/verify.json`);
  } else if (stage === "illustrate") await illustrate(slug, { only });
  else if (stage === "segment") await segment(slug, { only });
  else if (stage === "line") await line(slug, { only });
  else throw new Error(`unknown stage ${stage}`);
  console.log(`  done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
}
