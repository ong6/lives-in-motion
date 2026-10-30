/**
 * The job runner both workbenches use: /create makes a life from the web, /family from a
 * recording. One job runs at a time per runner, inside the server process. Its state lives on
 * globalThis (it survives hot reloads) and in a job file beside the story (it survives a
 * refresh, and tells a restarted server the run was interrupted). Changes are batched, at most
 * four a second, to disk and to every open stream (pipeline/jobs/stream.ts). Spend made inside
 * `scoped` lands on the job, its step and its scene, and every paid call is tagged with the job
 * in the ledger and held under the book's ceiling by the budget guard.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { BudgetError, withScope, type Entry, type SpendScope } from "../budget";
import type { StageEvent } from "../stages";
import { LIFE_CEILING, jobTag } from "./guard";
import type { BaseJob, JobLog, JobScene, Spend, StepState } from "./types";

/** Slugs a job may have: also what keeps a request's slug inside stories/. */
export const SLUG = /^[a-z0-9-]{1,80}$/;
/** The log keeps its last entries only. */
const LOG_MAX = 300;

/** An API error as one readable line: the server's own message when it sent JSON. */
export function friendly(e: unknown): string {
  const raw = String((e as Error)?.message ?? e);
  const m = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const status = raw.match(/^\/\S+ (\d{3}):/)?.[1];
  return (m ? `${status ? `HTTP ${status}: ` : ""}${m[1].replace(/\\"/g, '"').replace(/`/g, "")}` : raw).slice(0, 160);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Add to a spend tally, rounded to a millionth of a dollar. */
export const addSpend = (spend: Spend, kind: Entry["kind"], usd: number) => (spend[kind] = +((spend[kind] ?? 0) + usd).toFixed(6));
const plus = (a: number, b: number) => +(a + b).toFixed(6);

export interface RunnerOptions<S extends string, J extends BaseJob<S>> {
  /** globalThis key for the live state. */
  key: string;
  /** The job file for a slug. */
  file: (slug: string) => string;
  /** Shown as the busy job before it has a slug. */
  label: string;
  /** Whether the job may be written to disk yet; by default anything but a replay. */
  persists?: (job: J) => boolean;
  /** Fill in what a job file written by an older version lacks. */
  upgrade?: (job: J) => J;
  /** The step a failed run's error is logged under. */
  failedAt: (job: J) => S;
  /** An error that ends the run without failing it: returns how to mark the job, or undefined. */
  stopped?: (e: unknown) => ((job: J) => void) | undefined;
}

interface State<J> {
  job: J | null;
  running: boolean;
  listeners: Set<(job: J) => void>;
  timer?: ReturnType<typeof setTimeout>;
}

export type Runner<S extends string, J extends BaseJob<S>> = ReturnType<typeof createRunner<S, J>>;

export function createRunner<S extends string, J extends BaseJob<S>>(o: RunnerOptions<S, J>) {
  const G = globalThis as unknown as Record<string, State<J> | undefined>;
  const state: State<J> = (G[o.key] ??= { job: null, running: false, listeners: new Set() });
  const persists = o.persists ?? ((job: J) => !job.mock);

  /** The job file as written, or null. */
  function readJob(slug: string): J | null {
    if (!SLUG.test(slug)) return null;
    const f = o.file(slug);
    if (!existsSync(f)) return null;
    try {
      const job = JSON.parse(readFileSync(f, "utf8")) as J;
      return o.upgrade ? o.upgrade(job) : job;
    } catch {
      return null;
    }
  }

  /** The job for a slug: the live one, else its file (a "running" file with no runner was interrupted). */
  function getJob(slug: string): J | null {
    if (state.job?.slug === slug) return state.job;
    const job = readJob(slug);
    if (job?.status === "running") job.status = "interrupted";
    return job;
  }

  const busy = () => (state.running ? (state.job?.slug ?? o.label) : null);

  function subscribe(fn: (job: J) => void): () => void {
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  }

  function persist(job: J) {
    if (!persists(job)) return;
    const f = o.file(job.slug);
    const tmp = `${f}.tmp`;
    mkdir(dirname(f), { recursive: true })
      .then(() => writeFile(tmp, JSON.stringify(job, null, 1)))
      .then(() => rename(tmp, f))
      .catch(() => {});
  }

  /** Change the live job, then (throttled, or at once with `flush`) save it and tell every stream. */
  function update(fn: (job: J) => void, flush = false) {
    const job = state.job;
    if (!job) return;
    fn(job);
    job.updatedAt = new Date().toISOString();
    if (job.log.length > LOG_MAX) job.log.splice(0, job.log.length - LOG_MAX);
    const send = () => {
      state.timer = undefined;
      persist(job);
      for (const l of state.listeners) l(job);
    };
    if (flush) {
      clearTimeout(state.timer);
      send();
    } else state.timer ??= setTimeout(send, 250);
  }

  const log = (entry: Omit<JobLog<S>, "at">) => update((j) => j.log.push({ at: new Date().toISOString(), ...entry }));

  function step(id: S, status: StepState["status"], note?: string) {
    update((j) => {
      const s = j.steps[id];
      // A resumed run passes through finished steps without restarting their clocks.
      if (s.status === "done" && (status === "running" || status === "done")) return;
      if (status === "running") s.startedAt ??= new Date().toISOString();
      else if (status !== "waiting") s.endedAt = new Date().toISOString();
      s.status = status;
      if (note) s.note = note;
    });
  }

  const scene = (j: J, id?: string): JobScene | undefined => j.scenes.find((s) => s.id === id);

  /** Ledger spend inside `fn` also lands on the step (and scene) it was made for; retries are logged. */
  const scoped = <T>(stepId: S, sceneId: string | undefined, fn: () => Promise<T>) =>
    withScope(
      {
        onSpend: (e) =>
          update((j) => {
            j.steps[stepId].usd = plus(j.steps[stepId].usd, e.usd);
            const sc = scene(j, sceneId);
            if (sc) addSpend(sc.spend, e.kind, e.usd);
          }),
        onRetry: (message) => log({ step: stepId, scene: sceneId, kind: "retry", message }),
      },
      fn,
    );

  /** The scope a real run makes its calls in: tagged to the book in the ledger, held under its ceiling. */
  const spendScope = (slug: string): SpendScope => ({
    job: jobTag(slug),
    limit: LIFE_CEILING,
    onSpend: (e) =>
      update((j) => {
        j.usd = plus(j.usd, e.usd);
        addSpend(j.spend, e.kind, e.usd);
      }),
  });

  /** A replay's spend: what the real call cost, shown without calling anything. */
  const fake = (stepId: S, sceneId: string | undefined, kind: Entry["kind"], usd: number) =>
    update((j) => {
      j.usd = plus(j.usd, usd);
      addSpend(j.spend, kind, usd);
      j.steps[stepId].usd = plus(j.steps[stepId].usd, usd);
      const sc = scene(j, sceneId);
      if (sc) addSpend(sc.spend, kind, usd);
    });

  /** Stage events (pipeline/stages.ts) → the job's picture of the book, and its log. */
  function onStage(stepId: S, extra?: (j: J, e: StageEvent) => void) {
    return (e: StageEvent) =>
      update((j) => {
        const sc = scene(j, e.scene);
        extra?.(j, e);
        if (e.kind === "plate" && sc) Object.assign(sc, { plate: e.url, status: sc.status === "waiting" || sc.status === "painting" ? "painted" : sc.status });
        if (e.kind === "refused" && sc && e.stage === "illustrate") Object.assign(sc, { status: "refused", note: e.message });
        if (e.kind === "cut" && sc) {
          const d = e.data as JobScene["cuts"][number];
          sc.cuts.push({ concept: d.concept, src: d.src, x: d.x, y: d.y, w: d.w });
        }
        if (e.kind === "background" && sc) sc.background = e.url;
        if (e.kind === "line" && sc) sc.line = e.url;
        const kind: JobLog["kind"] = e.kind === "refused" ? "refused" : e.kind === "warn" || e.kind === "error" ? e.kind : e.url ? "asset" : "info";
        j.log.push({ at: new Date().toISOString(), step: stepId, scene: e.scene, kind, message: e.message, model: e.model, url: e.url });
      });
  }

  /** A stage event made up by a replay, as if `stepId` had sent it. */
  const say = (stepId: S, e: Omit<StageEvent, "stage">) => onStage(stepId)({ stage: "research", ...e });

  /** Run a job in this process; resolves when it has finished (the routes don't wait, the CLIs do). */
  function launch(job: J, run: () => Promise<void>): Promise<void> {
    state.job = job;
    state.running = true;
    update(() => {}, true);
    return (async () => {
      try {
        await run();
        update((j) => {
          j.status = "done";
          j.finishedAt = new Date().toISOString();
        }, true);
      } catch (e) {
        const stop = o.stopped?.(e);
        if (stop) return void update(stop, true);
        const budgetStop = e instanceof BudgetError;
        update((j) => {
          j.status = "failed";
          j.finishedAt = new Date().toISOString();
          j.error = budgetStop ? String((e as Error).message).replace(/^budget: /, "Budget guard: ") : friendly(e);
          const at = o.failedAt(j);
          for (const s of Object.values<StepState>(j.steps)) if (s.status === "running") s.status = "failed";
          j.log.push({ at: new Date().toISOString(), step: at, kind: "error", message: j.error });
        }, true);
      } finally {
        state.running = false;
        update(() => {}, true);
      }
    })();
  }

  /** The live job; only valid while a run is under way. */
  const live = () => state.job!;

  return { state, readJob, getJob, busy, subscribe, update, log, step, scene, scoped, spendScope, fake, onStage, say, launch, live };
}
