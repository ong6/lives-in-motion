import "server-only";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allStories, lifespan } from "@/lib/stories";
import { eraFor } from "@/lib/eras";
import { clothFor } from "@/components/book/Cover";
import type { CreateInfo, Job } from "@/pipeline/create/types";

/**
 * What the workbench shows beside the pipeline's own info: the shelf (so a finished life is
 * shown as the cover it is bound in), a sample life's plates for the empty page, and the
 * last real run's time and cost, so the estimate on the form is checked against something.
 */
export function withShelf<T extends CreateInfo>(info: T): T {
  const stories = allStories();
  const shelf = stories.map((st, i) => ({
    slug: st.slug,
    name: st.name,
    lifespan: lifespan(st),
    cloth: clothFor(eraFor(st.scenes[0].year), i),
  }));
  const sampleStory = stories.find((s) => s.slug === "jack-sim") ?? stories[0];
  const sample = sampleStory && {
    slug: sampleStory.slug,
    name: sampleStory.name,
    plates: sampleStory.scenes.filter((s) => s.plate).map((s) => ({ year: s.year, title: s.title, src: s.plate! })),
  };
  return { ...info, shelf, sample, last: lastRun() };
}

function lastRun(): CreateInfo["last"] {
  const dir = join(process.cwd(), "stories");
  let best: (Job & { finishedAt: string }) | undefined;
  for (const slug of readdirSync(dir)) {
    const f = join(dir, slug, "job.json");
    if (!existsSync(f)) continue;
    try {
      const j = JSON.parse(readFileSync(f, "utf8")) as Job;
      if (j.mock || j.status !== "done" || !j.finishedAt) continue;
      if (!best || j.finishedAt > best.finishedAt) best = j as Job & { finishedAt: string };
    } catch {}
  }
  if (!best) return undefined;
  return { slug: best.slug, name: best.name, seconds: Math.round((Date.parse(best.finishedAt) - Date.parse(best.startedAt)) / 1000), usd: best.usd };
}
