"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { Cover } from "@/components/book/Cover";
import { FrontispieceSection, Log, Masthead, Meter, Plates, Problem, Steps, WhatYouGet, mins, usd, useJobStream, workbenchStyles as s, type StepInfo } from "@/components/shared/workbench";
import type { CreateInfo, Job, StepId } from "@/pipeline/create/types";

const STEPS: StepInfo<StepId>[] = [
  { id: "screen", name: "Subject check", model: "Muse Spark + web search", does: "confirms a real, documented Singaporean in 2+ sources; declines the rest" },
  { id: "research", name: "Research", model: "Muse Spark + web search", does: "finds dated facts, each with its sources" },
  { id: "storyboard", name: "Storyboard", model: "Muse Spark", does: "turns the facts into seven scenes" },
  { id: "plates", name: "Plates", model: "Muse Image", does: "paints each scene in its decade’s print style" },
  { id: "cutouts", name: "Cut-outs", model: "SAM 3.1 + Muse Image", does: "lifts the subject off each plate and repaints what was behind it" },
  { id: "frontispiece", name: "Frontispiece", model: "Muse Image + SAM 3.1", does: "an emblem of the life, traced in pen lines" },
  { id: "films", name: "Films", model: "this server, no API calls", does: "renders a film for each scene with a fixed camera move" },
  { id: "direct", name: "Direct", model: "Muse Wonder", does: "plans each film’s move, watches the result and asks for one revision" },
];

/**
 * One click fills the form: Singaporeans from the arts, sport, medicine and business, each with an
 * NLB Infopedia article, who aren't on the shelf yet. No politicians and no lives defined by war.
 */
const EXAMPLES = [
  { name: "Georgette Chen", hint: "painter, a pioneer of the Nanyang style" },
  { name: "C. Kunalan", hint: "sprinter, Singapore’s 100 m record holder for 33 years" },
  { name: "Chen Su Lan", hint: "physician, anti-opium campaigner and founder of the Chinese YMCA" },
  { name: "Lee Kong Chian", hint: "rubber industrialist and philanthropist, the Lee Foundation" },
];

/** A step an older job.json doesn't have yet. */
const NO_STEP = { status: "skipped", usd: 0 } as const;
const stepOf = (job: Job, id: StepId): Job["steps"][StepId] => job.steps[id] ?? NO_STEP;

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
};
const clock = (from: string, at: string) => {
  const t = Math.max(0, Math.round((Date.parse(at) - Date.parse(from)) / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const duration = (sec: number) => (sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${sec % 60} s`);

/** Wall time left, from the typical step times: research, storyboard, then plates+cut-outs beside the frontispiece, then films, then Muse Wonder. */
function remaining(job: Job, est: CreateInfo["estimate"], now: number): number {
  const left = (id: StepId) => {
    const st = stepOf(job, id);
    if (st.status !== "running" && st.status !== "waiting") return 0;
    if (st.status === "running" && st.startedAt) return Math.max(est[id] * 0.15, est[id] - (now - Date.parse(st.startedAt)) / 1000);
    return est[id];
  };
  // Cut-outs run beside the plates; about 60% of their time is left once the last plate lands.
  const art = job.steps.plates.status === "done" || job.steps.plates.status === "failed" ? left("cutouts") : left("plates") + est.cutouts * 0.6;
  return left("screen") + left("research") + left("storyboard") + Math.max(art, left("frontispiece")) + left("films") + left("direct");
}
const total = (est: CreateInfo["estimate"]) => (est.screen ?? 0) + est.research + est.storyboard + Math.max(est.plates + est.cutouts * 0.6, est.frontispiece) + est.films + (est.direct ?? 0);

/** Honest range: the estimate at the low end, the last real run (or 10 min) at the high end. */
function timeRange(info: CreateInfo) {
  const lo = Math.round(total(info.estimate) / 60);
  const hi = Math.max(10, Math.ceil((info.last?.seconds ?? 0) / 60));
  return `${lo}–${hi} minutes`;
}

export function Workbench({ initial }: { initial: CreateInfo }) {
  const [info, setInfo] = useState(initial);
  const { job, setJob, budget, link, now, follow } = useJobStream<Job>("/api/create", initial.job, initial.budget);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [another, setAnother] = useState(false);
  const [name, setName] = useState("");
  const [hint, setHint] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const refreshInfo = useCallback(() => {
    fetch("/api/create")
      .then((r) => r.json())
      .then(setInfo, () => {});
  }, []);

  // A finished life is on the shelf now: fetch the shelf again so its cover can be drawn.
  const finished = job && job.status !== "running";
  useEffect(() => {
    if (finished) refreshInfo();
  }, [finished, refreshInfo]);

  async function submit(form: FormData) {
    setSending(true);
    setError(null);
    try {
      const r = await fetch("/api/create", { method: "POST", body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setError(d.error ?? `The server refused the request (HTTP ${r.status}).`);
      history.replaceState(null, "", `/create?job=${d.slug}`);
      setJob(null);
      setAnother(false);
      follow(d.slug);
    } catch {
      setError("Couldn’t reach the server. Check the connection and try again.");
    } finally {
      setSending(false);
      refreshInfo();
    }
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const mock = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "mock";
    if (mock) form.set("mock", "1");
    void submit(form);
  };

  const resume = () => {
    const f = new FormData();
    f.set("resume", job!.slug);
    void submit(f);
  };

  const est = info.estimate;

  if (!job || another)
    return (
      <div className={s.page}>
        <CreateMasthead />
        <div className={s.intake}>
          <form className={s.form} onSubmit={onSubmit}>
            <h1 className={s.formTitle}>Make a new life</h1>
            <p className={s.formLede}>
              Name a Singaporean with a public record. Muse Spark looks them up on the web and cites every fact; Muse Image paints the scenes; SAM 3.1 cuts them into layers. You watch each step happen.
            </p>
            <label className={s.field}>
              <span className={s.fieldLabel}>Name</span>
              <input ref={nameRef} name="name" required maxLength={80} autoComplete="off" placeholder="Georgette Chen" disabled={!info.enabled} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className={s.examples}>
              <span className={s.examplesLabel}>Try</span>
              {EXAMPLES.map((x) => (
                <button
                  key={x.name}
                  type="button"
                  className={s.chip}
                  aria-pressed={name === x.name}
                  disabled={!info.enabled}
                  onClick={() => {
                    setName(x.name);
                    setHint(x.hint);
                    nameRef.current?.focus();
                  }}
                >
                  {x.name}
                </button>
              ))}
            </div>
            <label className={s.field}>
              <span className={s.fieldLabel}>
                Who they are <em>optional, helps the search</em>
              </span>
              <input name="hint" maxLength={120} autoComplete="off" placeholder="painter, a pioneer of the Nanyang style" disabled={!info.enabled} value={hint} onChange={(e) => setHint(e.target.value)} />
            </label>
            <label className={s.field}>
              <span className={s.fieldLabel}>
                A photo for the frontispiece <em>optional</em>
              </span>
              <input
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                disabled={!info.enabled}
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(f ? URL.createObjectURL(f) : null);
                  if (f && f.size > 8 * 1024 * 1024) setError("The photo is over 8 MB; use a smaller one.");
                }}
              />
            </label>
            {preview ? (
              <div className={s.photo}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="The photo you chose" />
                <label className={s.check}>
                  <input type="checkbox" name="rights" required />
                  <span>I took this photo or have the right to use it. It will be traced into a line drawing and credited as supplied by the reader.</span>
                </label>
              </div>
            ) : (
              <p className={s.hint}>Without a photo, Muse Image paints an emblem of the life instead of a likeness.</p>
            )}
            {info.needsToken && (
              <label className={s.field}>
                <span className={s.fieldLabel}>Passcode</span>
                <input name="token" type="password" required autoComplete="off" />
              </label>
            )}
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            {!info.enabled && <p className={s.error}>{info.reason}{info.mockAllowed ? " Rehearsals still run." : ""}</p>}
            <div className={s.actions}>
              <button className={s.make} disabled={!info.enabled || sending} value="make">
                {sending ? "Starting…" : "Make this life"}
              </button>
              {info.mockAllowed && (
                // formNoValidate: a rehearsal replays a finished life under its own name, so the name field isn't needed.
                <button className={s.rehearse} disabled={sending} value="mock" formNoValidate>
                  Rehearse for free
                </button>
              )}
            </div>
            <dl className={s.terms}>
              <div>
                <dt>Time</dt>
                <dd>{timeRange(info)}. You can start reading once the first plates are in.</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>
                  About {info.typical?.label ?? "$1"} of Meta API time{info.typical ? ` (Muse Wonder directing the films is ${usd(info.typical.direct)} of it)` : ""}, stopped at {usd(info.ceiling)} whatever happens.
                  {info.last && (
                    <>
                      {" "}
                      The last one, {info.last.name}, took {duration(info.last.seconds)} and cost {usd(info.last.usd)}.
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Today</dt>
                <dd>
                  {usd(budget.today)} of the {usd(budget.dailyCap)} daily allowance used.
                </dd>
              </div>
            </dl>
            {info.mockAllowed && <p className={s.hint}>Rehearse replays Jack Sim’s finished life, under his own name, with typical timings and costs. No name needed, no Meta calls, nothing charged.</p>}
            <p className={s.hint}>A new life goes straight onto the shelf. Only real, documented Singaporeans are made: Muse Spark checks the name against the web first, and declines unverifiable or private people, minors, politicians, heads of state and lives defined by war or crime.</p>
          </form>

          <WhatYouGet
            lede="A book of seven illustrated scenes you read by scrolling, each painted in the print style of its decade, cut into layers that move, and footnoted with its sources."
            sample={info.sample}
            caption={info.sample && (
              <>
                The seven plates of <Link href={`/${info.sample.slug}`}>{info.sample.name}’s book</Link>, made this way.
              </>
            )}
            steps={STEPS}
            estimate={info.estimate}
            foot="Plates, cut-outs and the frontispiece run side by side, so the whole is shorter than the sum."
          />
        </div>
      </div>
    );

  const running = job.status === "running";
  const plates = job.scenes.filter((x) => x.plate).length;
  const canRead = Boolean(job.steps.storyboard.status === "done" && plates > 0);
  const book = info.shelf?.find((b) => b.slug === job.bookSlug);

  return (
    <div className={s.page}>
      <CreateMasthead />
      <div className={s.bench}>
        <aside className={s.ticket} aria-label="Order and progress">
          <div className={s.order}>
            <p className={s.orderLabel} data-live={running || undefined}>
              {job.mock ? (running ? "Rehearsing" : "Rehearsal") : running ? "Now making" : job.status === "done" ? (job.draft ? "Made, as a draft" : "Made") : job.status === "declined" ? "Declined" : "Stopped"}
            </p>
            <h1 className={s.orderName}>{job.name}</h1>
            {job.hint && <p className={s.orderHint}>{job.hint}</p>}
          </div>

          <Steps steps={STEPS} job={job} est={est} now={now} />
          <Meter
            job={job}
            words={{ mock: "Would have cost", live: "This life so far", unit: "life" }}
            note={`${job.mock ? "Rehearsal: nothing is charged. " : ""}Today’s new lives ${usd(budget.today)} of ${usd(budget.dailyCap)}; event budget ${usd(budget.spent)} of ${usd(budget.stop, 0)}.`}
          />

          {!running && (
            <div className={s.ending} role="status">
              {job.status === "failed" && <Problem raw={job.error} className={s.error} />}
              {job.status === "interrupted" && <p className={s.error}>The server restarted while this life was being made. Finished plates and cut-outs are kept.</p>}
              {job.status === "declined" && <p className={s.declined}>Declined by the subject check. Nothing was researched and nothing was saved.</p>}
              {(job.status === "failed" || job.status === "interrupted") && !job.mock && (
                <button className={s.rehearse} onClick={resume} disabled={sending}>
                  Pick up where it stopped
                </button>
              )}
              {job.status === "done" && !job.mock && (Object.values(job.steps).some((x) => x.status === "failed") || job.scenes.some((x) => x.cuts.length && !x.background)) && (
                <button className={s.rehearse} onClick={resume} disabled={sending}>
                  Retry what didn’t finish
                </button>
              )}
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
              <button className={s.rehearse} onClick={() => setAnother(true)}>
                Make another life
              </button>
            </div>
          )}
        </aside>

        <main className={s.sheet}>
          <Proof job={job} now={now} canRead={canRead} link={link} remaining={running ? remaining(job, est, now) : 0} book={book} onAnother={() => setAnother(true)} />
        </main>

        <aside className={s.margin} aria-label="What the models are doing">
          <Log job={job} clock={clock} />
        </aside>
      </div>
    </div>
  );
}

function CreateMasthead() {
  return (
    <Masthead>
      <Link href="/#shelf">The shelf</Link>
      <Link href="/#making">How a page is made</Link>
      <Link href="/create" aria-current="page">
        Make a new life
      </Link>
    </Masthead>
  );
}

function Proof({
  job,
  now,
  canRead,
  link,
  remaining,
  book,
  onAnother,
}: {
  job: Job;
  now: number;
  canRead: boolean;
  link: string;
  remaining: number;
  book?: NonNullable<CreateInfo["shelf"]>[number];
  onAnother: () => void;
}) {
  const running = job.status === "running";
  // Once the scenes are written the record folds to a few lines, so the plates are in view.
  const [open, setOpen] = useState(false);
  const folded = !open && job.scenes.length > 0 && job.facts.length > 6;
  const sources = new Set(job.facts.flatMap((f) => f.sources.map((x) => x.url))).size;
  return (
    <article className={s.proof}>
      {job.status === "declined" ? (
        <header className={s.declineCard}>
          <div>
            <p className={s.boundLabel}>Subject check · Muse Spark with web search</p>
            <h2 className={s.boundName}>{job.name}</h2>
            <p className={s.declineMsg} role="status">
              {job.screen?.message ?? "This life is outside what Lives in Motion makes."}
            </p>
            {job.screen?.check && <CheckFound check={job.screen.check} ok={false} />}
            <p className={s.boundFacts}>The check cost {usd(job.usd, 4)}; nothing else was called.</p>
            <div className={s.boundActions}>
              <button className={s.readBtn} onClick={onAnother}>
                Try another name
              </button>
              <Link className={s.quiet} href="/#shelf">
                Read a book on the shelf
              </Link>
            </div>
          </div>
        </header>
      ) : job.status === "done" ? (
        <Bound job={job} book={book} sources={sources} onAnother={onAnother} />
      ) : (
        <header className={s.proofHead}>
          <div>
            <h2 className={s.name}>{job.name}</h2>
            <p className={s.tagline}>{job.tagline ?? (job.steps.storyboard.status === "done" ? "" : job.hint || " ")}</p>
          </div>
          <div className={s.read}>
            {canRead ? (
              <Link className={s.readBtn} href={`/${job.bookSlug}`}>
                Read the book so far
              </Link>
            ) : (
              <span className={s.readBtn} aria-disabled>
                Read the book
              </span>
            )}
            <span className={s.eta} aria-live="polite">
              {running && !now
                ? " "
                : running
                  ? `${canRead ? "Readable now. " : "Readable once the first plate is in. "}About ${mins(remaining)} left; ${clock(job.startedAt, new Date(now).toISOString())} so far.`
                  : "Stopped. What was made is kept."}
              {link === "reconnecting" && running ? " Reconnecting to the server…" : ""}
            </span>
          </div>
        </header>
      )}

      {job.status !== "declined" && job.mock && <p className={s.mockNote}>Rehearsal: this replays Jack Sim’s finished life with typical timings and costs. No Meta calls are made and nothing is charged.</p>}

      {job.status !== "declined" && job.screen?.check && (
        <section className={s.checkSec} aria-labelledby="check">
          <h3 id="check" className={s.sectionTitle}>
            Subject check <span>Muse Spark with web search: a real, documented Singaporean, in at least 2 independent sources</span>
          </h3>
          <CheckFound check={job.screen.check} ok />
        </section>
      )}

      {job.status !== "declined" && (
      <>
      <section className={s.galley} aria-labelledby="galley">
        <h3 id="galley" className={s.sectionTitle}>
          The record <span>Muse Spark with web search{job.facts.length ? `: ${job.facts.length} facts from ${sources} sources` : ""}</span>
        </h3>
        {job.facts.length ? (
          <>
            <ol className={s.facts} data-folded={folded || undefined}>
              {job.facts.map((f, i) => (
                <li key={f.n} className={s.fact} style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                  <span className={s.factYear}>{f.year}</span>
                  <span className={s.factText}>
                    {f.text}{" "}
                    {f.sources.map((src, k) => (
                      <a key={k} className={s.cite} href={src.url} target="_blank" rel="noopener noreferrer" title={src.label}>
                        {host(src.url)}
                      </a>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
            {job.scenes.length > 0 && job.facts.length > 6 && (
              <button className={s.unfold} onClick={() => setOpen(!open)} aria-expanded={open}>
                {open ? "Fold the record" : `Show all ${job.facts.length} facts`}
              </button>
            )}
          </>
        ) : (
          <div className={s.searching} aria-live="polite">
            {job.steps.research.status === "failed" ? "Research stopped." : "Muse Spark is reading Infopedia, newspapers and official sources. A long search takes one to two minutes."}
          </div>
        )}
      </section>

      <Plates job={job} />

      {job.scenes.some((x) => x.wonder) && <Directed job={job} />}

      {job.frontispiece && (
        <FrontispieceSection
          job={job}
          kind={
            job.frontispiece.kind === "emblem"
              ? "an emblem by Muse Image, SAM 3.1 mask, traced in pen lines"
              : job.frontispiece.credit
                ? "a credited portrait photo, SAM 3.1 person mask, traced in pen lines"
                : "your photo, SAM 3.1 person mask, traced in pen lines"
          }
          alt={job.frontispiece.kind === "emblem" ? "The emblem Muse Image painted" : job.frontispiece.credit ? `Portrait photo of ${job.name}` : "The photo supplied"}
          caption={job.frontispiece.credit ?? (job.frontispiece.kind === "photo" ? "Supplied by the reader" : "Muse Image")}
        />
      )}
      </>
      )}
    </article>
  );
}

/** The done moment: the life bound in its cloth, turning to face the reader, and the way in. */
function Bound({ job, book, sources, onAnother }: { job: Job; book?: NonNullable<CreateInfo["shelf"]>[number]; sources: number; onAnother: () => void }) {
  const plates = job.scenes.filter((x) => x.plate).length;
  const cuts = job.scenes.reduce((n, x) => n + x.cuts.length, 0);
  const films = job.scenes.filter((x) => x.video).length;
  const name = book?.name ?? job.name;
  const took = clock(job.startedAt, job.finishedAt ?? job.updatedAt);
  return (
    <header className={s.bound}>
      <Link href={`/${job.bookSlug}`} className={s.boundBook} aria-label={`Read ${name}’s book`}>
        <div className={s.boundVolume} style={{ ["--cloth" as string]: book?.cloth ?? "#3b4a3f" } as CSSProperties}>
          <Cover slug={job.bookSlug} name={name} lifespan={book?.lifespan ?? ""} className={s.boundCover} />
        </div>
      </Link>
      <div className={s.boundText}>
        <p className={s.boundLabel}>{job.mock ? `Rehearsal finished: ${name}’s book, replayed` : job.draft ? "Draft. Read it here; it joins the shelf once approved." : "Bound and on the shelf"}</p>
        <h2 className={s.boundName}>{job.name}</h2>
        {job.tagline && <p className={s.tagline}>{job.tagline}</p>}
        <p className={s.boundFacts}>
          {job.facts.length} facts from {sources} sources, {plates} of 7 plates, {cuts} cut-outs and {films} films, {job.mock ? `replayed in ${took}; a real run would cost about ${usd(job.usd)}` : `made in ${took} for ${usd(job.usd)}`}.
        </p>
        <div className={s.boundActions}>
          <Link className={s.readBtn} href={`/${job.bookSlug}`}>
            Read the book
          </Link>
          <button className={s.quiet} onClick={onAnother}>
            Make another life
          </button>
        </div>
      </div>
    </header>
  );
}

/** What the subject check found: its decision, the reason, and every source it cited. */
function CheckFound({ check, ok }: { check: NonNullable<NonNullable<Job["screen"]>["check"]>; ok: boolean }) {
  return (
    <div className={s.check}>
      <p className={s.checkWhy}>
        <strong>{ok ? "Confirmed" : "Declined"}</strong>
        {check.reason ? `: ${check.reason}` : ""} <span>({check.independent} independent {check.independent === 1 ? "source" : "sources"})</span>
      </p>
      {check.sources.length > 0 && (
        <ul className={s.checkSources}>
          {check.sources.map((x) => (
            <li key={x.url}>
              <a href={x.url} target="_blank" rel="noopener noreferrer">
                {x.label}
              </a>{" "}
              <span>{host(x.url)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The Direct step, scene by scene: Muse Wonder's reason for each move and its own score for the film. */
function Directed({ job }: { job: Job }) {
  const rows = job.scenes.filter((x) => x.wonder);
  const st = stepOf(job, "direct");
  return (
    <section className={s.wonderSec} aria-labelledby="wonder">
      <h3 id="wonder" className={s.sectionTitle}>
        Directed by Muse Wonder{" "}
        <span>
          it plans each film’s camera and layer moves, then watches six frames and scores them; 8 of 10 passes
          {st.usd > 0 ? ` · ${usd(st.usd, 3)}` : ""}
        </span>
      </h3>
      <ol className={s.wonderList}>
        {rows.map((sc) => {
          const w = sc.wonder!;
          return (
            <li key={sc.id} className={s.wonderRow} data-status={w.status}>
              <span className={s.wonderYear}>{sc.year}</span>
              <span className={s.wonderBody}>
                <span className={s.wonderTitle}>{sc.title}</span>
                {w.status === "directing" ? (
                  <span className={s.wonderWhy}>Muse Wonder is directing…</span>
                ) : (
                  <>
                    {w.rationale && <span className={s.wonderWhy}>“{w.rationale}”</span>}
                    {w.status !== "directed" && <span className={s.wonderNote}>{w.status === "failed" ? "Not directed; the fixed move stays." : `Fixed move kept${w.note ? `: ${w.note}` : ""}.`}</span>}
                  </>
                )}
              </span>
              <span className={s.wonderScore}>
                {w.score != null ? (
                  <>
                    <strong>{w.score}</strong>/10
                    <em>{w.passed ? "passed" : w.status === "directed" ? "below 8, kept" : ""}</em>
                  </>
                ) : null}
              </span>
              <span className={s.wonderCost}>
                {w.usd ? usd(w.usd, 3) : ""}
                {w.rounds ? ` · ${w.rounds} round${w.rounds === 1 ? "" : "s"}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
