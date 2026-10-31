# Lives in Motion: operating manual

Singaporean lives as illustrated, page-turning books, made with Meta's models. A Meta Global AI
Developer Hackathon entry (Next.js 16, React 19, TypeScript, pnpm, vitest). `README.md` is for
humans and judges; `DESIGN.md` is the design doc; this file is how to work in the code.

## Rules that are never broken

- **Every Meta call goes through `guard` in `pipeline/budget.ts`**, via the one client in
  `pipeline/meta.ts`. Never `fetch` the Meta API anywhere else. The event allowance is **$150**;
  `guard` refuses any call whose worst case would take the ledger past **$135** (a $15 reserve).
  The ledger is `spend.jsonl` (append-only, committed); `pnpm spend` prints the totals and
  `pnpm spend --add <usd> "<note>"` records spend made outside the pipeline.
- **Never print, log or commit the API key** (`MODEL_API_KEY` in `.env`, gitignored).
- **Tests and refactors make no paid calls.** `pnpm test` is hermetic: tests stub `fetch` and write
  to a temp ledger (`LIM_ROOT`). Rehearsals (`/create`) and the sample replay (`/family`) are free.
- **Content:** no politics or war (the subject screen declines such lives; prompts keep them out of
  the pictures). People appear only as silhouettes or from behind in generated art; no faces.
  Real photos only with open licences, credited (`pipeline/portraits/credits.json`, shown in the
  book and the colophon). Family photos are only traced, never sent to an image model.

## Run, test, check

| Command | What |
|---|---|
| `pnpm dev --port 3100` | The site (the owner's dev server runs on 3100) |
| `pnpm check` | typecheck + tests + production build: run before every commit |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | The parts of `check` |
| `pnpm shoot http://localhost:3100 <dir> [shot,shot]` | Screenshots (`scripts/shoot.ts`); compare before and after a UI change |
| `pnpm make <slug> --stages …` | The stages for a life (`pipeline/cli.ts`); paid |
| `pnpm video <slug> [--scenes s1] [--dry]` | Render films locally; free |
| `pnpm wonder <slug> [--dry]` | Muse Wonder directs and critiques films; paid (`--dry` is free) |
| `pnpm portrait <slug> [--sam]` | Trace a credited photo into a line drawing |
| `pnpm family voice\|make\|score\|check\|relink` | Family mode CLI (`pipeline/family/cli.ts`) |
| `pnpm approve [<slug> [--withdraw]]` | Put a life on or take it off the shelf |
| `pnpm spend` | The ledger's totals |

A refactor must not change behaviour: same checks green, same screenshots (allow for animation
timing), and `pnpm video <slug> --dry` re-renders committed films byte for byte.

## Where things live

```
lib/                 shared, server-safe; no Meta calls
  schema.ts          Story / Scene / Layer zod schema: the contract between pipeline and site
  stories.ts         allStories() (the shelf), getStory(), readingOrder()      [server-only]
  portraits.ts       frontispiece src and credit for a life                       [server-only]
  provenance.ts      where a book's text came from (web or a family recording)
  cost.ts            lifeCost(): the one figure for what a life costs
  eras.ts            era presets: palette, print technique (CSS vars and Muse Image prompts)
pipeline/            everything that makes a book (Node only)
  meta.ts            THE Meta client: MODELS, send() with retries, sparkSearch, sparkJson,
                     museImage, museEdit, samRaw, museWonderJson, museTranscribe
  budget.ts          guard, PRICES (the one price table), ledger, cost/worst-case helpers
  root.ts            ROOT (process.cwd(), or LIM_ROOT in tests)
  prompts.ts         research, storyboard, verify, plate, clean-plate and emblem prompts
  stages.ts          research → storyboard → verify → illustrate → segment → line; edit()
  sam.ts, portrait.ts  SAM mask decoding and cut-outs; linedraw tracing, frontispieces
  film/              the local film renderer: camera, matte, frame (compositor, ffmpeg),
                     layers, motion (Wonder plans: sanitize, fit), line, render
  video.ts           CLI over film/          wonder.ts  Muse Wonder director/critic + CLI
  cli.ts, approve.ts CLIs
  jobs/              the job-runner framework both workbenches share
    runner.ts        createRunner: live state on globalThis, job file, batched updates,
                     steps, spend scoping, stage events, launch, replay helpers
    steps.ts         runScenes (plates + cut-outs lanes), runFilms, frontispiece helpers,
                     photo re-encoding, slug and credit helpers
    guard.ts         rails: on switch, passcode, headroom, daily cap, per-book ceiling,
                     per-visitor limit, input and photo checks, budgetNow()
    stream.ts        the SSE response   types.ts  BaseJob, JobScene, JobLog, Spend, Budget
  create/            /create: index.ts (runner), rehearsal.ts, screen.ts (subject check), types.ts
  family/            /family: index.ts (runner), replay.ts, record.ts, transcribe.ts, facts.ts,
                     check.ts, audio.ts, sample.ts, cli.ts, types.ts
app/                 routes: / (home), /[slug] (a book), /create, /family, /family/[slug]
  api/create, api/family   start (POST), info (GET), job (GET), stream (SSE), audio, delete
components/
  book/              the reader: StoryPlayer (state), Book (leaves), pages, usePageInput,
                     bookChange, paging, pagination, SceneArt, LayerStack, Direction, Cover, Page
  home/              shelf, hero plate, reveals, loop film
  create/, family/   the two workbenches (family also: Recorder, Recording, RecordView)
  shared/            workbench.tsx (Masthead, Steps, Meter, Plates, Log, …, useJobStream),
                     workbench.module.css, LineDrawing, explain
scripts/shoot.ts     screenshots          tests/   vitest, one file per area
```

## Data model

- `stories/<slug>/story.json`: the life, validated by `Story` in `lib/schema.ts` (7 scenes from
  the pipeline, 3–10 allowed). Every write goes through `edit()` in `pipeline/stages.ts`
  (serialised, atomic). `listed: false` keeps a life off the shelf; its URL still opens.
- Beside it: `research.json` (cited facts), `research.raw.json` (the paid answer, re-parseable),
  `verify.json` (Muse Spark's caption fact-checks), `emblem.json`, `credit.json` (the
  frontispiece credit), `job.json` (a `/create` run) or `family-job.json` + `family.json` +
  `recording.{wav,m4a}` (a family book), `source/` (photos, emblem, masks).
- `public/stories/<slug>/<sN>/`: `plate.png|webp`, `background.webp` (clean plate),
  `cut-N.webp` (SAM cut-outs), `line.json`, `scene.mp4` + `scene.jpg` (film, poster),
  `motion.json` (Muse Wonder's plan, which `pnpm video` films from). `public/stories/<slug>/wonder.json`
  is the life's Wonder report. `public/lines/<slug>.json` and `public/portraits/<slug>.webp` are
  the frontispiece. Asset URLs carry `?v=<hash>` so a re-render busts caches.
- A family book is unlisted, under an unguessable slug, and its sources point at
  `/family/<slug>/audio#t=<s>`; `lib/provenance.ts` reads that to tell it apart.
- `stories/*/deep/` and `pipeline/photos/` belong to a separate research agent: don't edit or commit them.

## Adding a model or a stage

- **A model:** add its id to `MODELS` and its price to `PRICES`; if it bills a new way, add a
  cost helper and an `Entry["kind"]` in `budget.ts`. Write one function in `meta.ts` that wraps
  `send()` in `guard(kind, worstCase, call, actualCost, note)`. Worst case must be a true upper
  bound; the actual cost comes from the response. Test it like `tests/meta.test.ts` (stubbed fetch).
- **A stage:** a function in `stages.ts` (or its own module) that reads what the previous stage
  wrote, writes through `edit()`, and reports through the `on` callback (`StageEvent`). Make it
  resumable (skip work already on disk). Wire it into `pipeline/cli.ts`, and into a runner as a
  step: add the step id to the job type and step list, call it inside `runner.scoped(step, scene, …)`,
  and add its estimate and its row in the workbench's `STEPS`.

## Conventions

- Comments are short and say why, not what. Match the surrounding voice; no noise.
- One source of truth: model ids in `MODELS`, prices in `PRICES`, a life's cost in `lifeCost()`,
  rails in `jobs/guard.ts`. Don't copy them.
- Server-only modules import `server-only`; type-only files (`*/types.ts`) are safe in client code.
- Pure logic is a pure function with a test; I/O stays at the edges.
- File names: components PascalCase, everything else camelCase; CSS modules beside their component.
- No new dependencies without a reason; no deprecated shims kept "for compatibility".

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
