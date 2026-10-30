"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { LineDrawing } from "@/components/LineDrawing";
import { Cover } from "@/components/book/Cover";
import type { Budget, CreateInfo, Job, JobScene, StepId } from "@/pipeline/create/types";
import { explain } from "./explain";
import s from "./create.module.css";

const STEPS: { id: StepId; name: string; model: string; does: string }[] = [
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

const MODEL_NAME: Record<string, string> = { spark: "Muse Spark", search: "Muse Spark search", image: "Muse Image", sam: "SAM 3.1", wonder: "Muse Wonder", manual: "Other" };

/** A step an older job.json doesn't have yet. */
const NO_STEP = { status: "skipped", usd: 0 } as const;
const stepOf = (job: Job, id: StepId): Job["steps"][StepId] => job.steps[id] ?? NO_STEP;

const usd = (v: number, digits = 2) => `$${v.toFixed(v > 0 && v < 0.01 ? 4 : digits)}`;
const mins = (sec: number) => (sec < 90 ? `${Math.max(1, Math.round(sec / 10) * 10)} s` : `${Math.round(sec / 60)} min`);
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

/** An error line in plain words; the raw text, if any, behind a disclosure. */
function Problem({ raw, className }: { raw?: string | null; className?: string }) {
  const e = explain(raw);
  if (!e.text) return null;
  return (
    <span className={`${s.problem} ${className ?? ""}`}>
      {e.text}
      {e.detail && (
        <details className={s.detail}>
          <summary>Details</summary>
          <code>{e.detail}</code>
        </details>
      )}
    </span>
  );
}

export function Workbench({ initial }: { initial: CreateInfo }) {
  const [info, setInfo] = useState(initial);
  const [job, setJob] = useState<Job | null>(initial.job?.status === "running" ? initial.job : null);
  const [budget, setBudget] = useState<Budget>(initial.budget);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<"live" | "reconnecting" | "closed">("closed");
  // 0 until mounted: the server and the first client render must print the same clock.
  const [now, setNow] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [another, setAnother] = useState(false);
  const [name, setName] = useState("");
  const [hint, setHint] = useState("");
  const es = useRef<EventSource | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const refreshInfo = useCallback(() => {
    fetch("/api/create")
      .then((r) => r.json())
      .then(setInfo, () => {});
  }, []);

  const follow = useCallback((slug: string) => {
    es.current?.close();
    const src = new EventSource(`/api/create/${slug}/stream`);
    es.current = src;
    src.onopen = () => setLink("live");
    src.onmessage = (m) => {
      const d = JSON.parse(m.data) as { job: Job; budget: Budget };
      setJob(d.job);
      setBudget(d.budget);
      setLink("live");
      if (d.job.status !== "running") {
        src.close();
        setLink("closed");
      }
    };
    // EventSource retries by itself; say so rather than going quiet.
    src.onerror = () => setLink(src.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
  }, []);

  // Reconnect after a refresh: ?job=<slug>, else the job running on the server.
  useEffect(() => {
    const slug = new URLSearchParams(location.search).get("job") ?? (initial.job?.status === "running" ? initial.job.slug : null);
    if (!slug) return;
    fetch(`/api/create/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setJob(d.job);
        setBudget(d.budget);
        if (d.job.status === "running") follow(slug);
      });
    return () => es.current?.close();
  }, [follow, initial.job]);

  useEffect(() => {
    setNow(Date.now());
    if (job?.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job?.status]);

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
        <Masthead />
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

          <WhatYouGet info={info} />
        </div>
      </div>
    );

  const running = job.status === "running";
  const plates = job.scenes.filter((x) => x.plate).length;
  const canRead = Boolean(job.steps.storyboard.status === "done" && plates > 0);
  const book = info.shelf?.find((b) => b.slug === job.bookSlug);

  return (
    <div className={s.page}>
      <Masthead />
      <div className={s.bench}>
        <aside className={s.ticket} aria-label="Order and progress">
          <div className={s.order}>
            <p className={s.orderLabel} data-live={running || undefined}>
              {job.mock ? (running ? "Rehearsing" : "Rehearsal") : running ? "Now making" : job.status === "done" ? (job.draft ? "Made, as a draft" : "Made") : job.status === "declined" ? "Declined" : "Stopped"}
            </p>
            <h1 className={s.orderName}>{job.name}</h1>
            {job.hint && <p className={s.orderHint}>{job.hint}</p>}
          </div>

          <Steps job={job} est={est} now={now} />
          <Meter job={job} budget={budget} />

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
          <Log job={job} />
        </aside>
      </div>
    </div>
  );
}

function Masthead() {
  return (
    <header className={s.masthead}>
      <Link href="/" className={s.wordmark}>
        Lives in Motion
      </Link>
      <nav aria-label="Site">
        <Link href="/#shelf">The shelf</Link>
        <Link href="/#making">How a page is made</Link>
        <Link href="/create" aria-current="page">
          Make a new life
        </Link>
      </nav>
    </header>
  );
}

/** The empty page's other half: what a run makes, shown with a real one, and the steps it takes. */
function WhatYouGet({ info }: { info: CreateInfo }) {
  const sample = info.sample;
  return (
    <section className={s.promise} aria-labelledby="promise">
      <h2 id="promise" className={s.promiseTitle}>
        What you get
      </h2>
      <p className={s.promiseLede}>A book of seven illustrated scenes you read by scrolling, each painted in the print style of its decade, cut into layers that move, and footnoted with its sources.</p>
      {sample && sample.plates.length > 0 && (
        <figure className={s.contact}>
          <div className={s.contactRow}>
            {sample.plates.slice(0, 7).map((p) => (
              <div key={p.src} className={s.contactPlate}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={`${p.year}: ${p.title}`} loading="lazy" />
                <span>{p.year}</span>
              </div>
            ))}
          </div>
          <figcaption>
            The seven plates of <Link href={`/${sample.slug}`}>{sample.name}’s book</Link>, made this way.
          </figcaption>
        </figure>
      )}
      <ol className={s.plan}>
        {STEPS.map((st) => (
          <li key={st.id}>
            <span className={s.planName}>{st.name}</span>
            <span className={s.planDoes}>
              {st.does}
              <span className={s.planModel}>{st.model}</span>
            </span>
            <span className={s.planTime}>~{mins(info.estimate[st.id])}</span>
          </li>
        ))}
      </ol>
      <p className={s.promiseFoot}>Plates, cut-outs and the frontispiece run side by side, so the whole is shorter than the sum.</p>
    </section>
  );
}

function Steps({ job, est, now }: { job: Job; est: CreateInfo["estimate"]; now: number }) {
  return (
    <ol className={s.steps}>
      {STEPS.map((st) => {
        const x = stepOf(job, st.id);
        const took = x.startedAt ? ((x.endedAt ? Date.parse(x.endedAt) : now) - Date.parse(x.startedAt)) / 1000 : 0;
        return (
          <li key={st.id} className={s.step} data-status={x.status}>
            <span className={s.stepMark} aria-hidden />
            <span className={s.stepName}>{st.name}</span>
            <span className={s.stepFig}>{x.status === "waiting" ? `~${mins(est[st.id])}` : x.status === "skipped" ? "skipped" : x.status === "declined" ? "declined" : mins(Math.max(1, took))}</span>
            <span className={s.stepModel}>{st.model}</span>
            <span className={s.stepCost}>{x.usd > 0 ? usd(x.usd, 3) : ""}</span>
            {x.note && (x.status === "failed" || x.status === "declined" ? <Problem raw={x.note} className={s.stepErr} /> : <span className={s.stepNote}>{x.note}</span>)}
          </li>
        );
      })}
    </ol>
  );
}

function Meter({ job, budget }: { job: Job; budget: Budget }) {
  const pct = Math.min(100, (job.usd / job.ceiling) * 100);
  const parts = Object.entries(job.spend).filter(([, v]) => (v ?? 0) > 0);
  return (
    <div className={s.meter}>
      <div className={s.meterRow}>
        <span>{job.mock ? "Would have cost" : "This life so far"}</span>
        <strong>{usd(job.usd, 3)}</strong>
      </div>
      <div className={s.bar} role="meter" aria-valuemin={0} aria-valuemax={job.ceiling} aria-valuenow={job.usd} aria-label="Spend against this life's ceiling">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className={s.meterNote}>of the {usd(job.ceiling)} ceiling for one life</p>
      {parts.length > 0 && (
        <dl className={s.split}>
          {parts.map(([k, v]) => (
            <div key={k}>
              <dt>{MODEL_NAME[k] ?? k}</dt>
              <dd>{usd(v ?? 0, 3)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className={s.meterNote}>
        {job.mock ? "Rehearsal: nothing is charged. " : ""}Today’s new lives {usd(budget.today)} of {usd(budget.dailyCap)}; event budget {usd(budget.spent)} of {usd(budget.stop, 0)}.
      </p>
    </div>
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

      <section className={s.platesSec} aria-labelledby="plates">
        <h3 id="plates" className={s.sectionTitle}>
          Seven scenes <span>Muse Image paints, SAM 3.1 cuts out{job.status === "done" ? "; hover a plate to play its film" : ""}</span>
        </h3>
        <div className={s.plates}>
          {(job.scenes.length ? job.scenes : Array.from({ length: 7 }, () => null)).map((sc, i) => (sc ? <Plate key={sc.id} scene={sc} n={i + 1} /> : <div key={i} className={s.slot} data-status="pending" />))}
        </div>
      </section>

      {job.scenes.some((x) => x.wonder) && <Directed job={job} />}

      {job.frontispiece && (
        <section className={s.frontSec} aria-labelledby="front">
          <h3 id="front" className={s.sectionTitle}>
            Frontispiece{" "}
            <span>
              {job.frontispiece.kind === "emblem"
                ? "an emblem by Muse Image, SAM 3.1 mask, traced in pen lines"
                : job.frontispiece.credit
                  ? "a credited portrait photo, SAM 3.1 person mask, traced in pen lines"
                  : "your photo, SAM 3.1 person mask, traced in pen lines"}
            </span>
          </h3>
          <div className={s.front}>
            <figure className={s.frontFig}>
              {job.frontispiece.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={job.frontispiece.image} alt={job.frontispiece.kind === "emblem" ? "The emblem Muse Image painted" : job.frontispiece.credit ? `Portrait photo of ${job.name}` : "The photo supplied"} />
              ) : (
                <div className={s.frontWait}>{job.steps.frontispiece.status === "failed" ? "No picture" : "Painting…"}</div>
              )}
              <figcaption>{job.frontispiece.credit ?? (job.frontispiece.kind === "photo" ? "Supplied by the reader" : "Muse Image")}</figcaption>
            </figure>
            <figure className={s.frontFig}>
              {job.frontispiece.lines ? <LineDrawing src={job.frontispiece.lines} loop label={`${job.name}, frontispiece in pen strokes`} className={s.frontLines} /> : <div className={s.frontWait}>{job.steps.frontispiece.status === "failed" ? "Not traced" : "Tracing comes next"}</div>}
              <figcaption>{job.frontispiece.strokes ? `${job.frontispiece.strokes.toLocaleString()} pen strokes` : "Pen lines"}</figcaption>
            </figure>
            {job.frontispiece.note && <Problem raw={job.frontispiece.note} className={job.steps.frontispiece.status === "failed" ? s.error : s.frontNote} />}
          </div>
        </section>
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

const spendLine = (sc: JobScene) =>
  [
    sc.spend.image ? `Muse Image ${usd(sc.spend.image, 3)}` : null,
    sc.spend.sam ? `SAM 3.1 ${usd(sc.spend.sam, 4)}${sc.cuts.length ? `: ${sc.cuts.map((c) => c.concept).join(", ")}` : ""}` : null,
    sc.spend.wonder ? `Muse Wonder ${usd(sc.spend.wonder, 3)}` : null,
  ].filter(Boolean) as string[];

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

function Plate({ scene, n }: { scene: JobScene; n: number }) {
  const [hover, setHover] = useState(false);
  const base = scene.background ?? scene.plate;
  const status = scene.status;
  return (
    <figure className={s.slot} data-status={status} data-treatment={scene.treatment} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className={s.art}>
        {base ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={base} className={s.plateImg} src={base} alt={`${scene.year}: ${scene.title}`} />
            {scene.background &&
              scene.cuts.map((c) => (
                // The cut-out sits on the clean background where SAM found it, lifted a little.
                // eslint-disable-next-line @next/next/no-img-element
                <img key={c.src} className={s.cut} src={c.src} alt="" style={{ left: `${c.x - c.w / 2}%`, bottom: `${100 - c.y}%`, width: `${c.w}%` }} />
              ))}
            {!scene.background &&
              scene.cuts.map((c) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={c.src} className={`${s.cut} ${s.cutFound}`} src={c.src} alt="" style={{ left: `${c.x - c.w / 2}%`, bottom: `${100 - c.y}%`, width: `${c.w}%` }} />
              ))}
            {hover && scene.video && <video className={s.film} src={scene.video} autoPlay muted loop playsInline poster={scene.poster} />}
          </>
        ) : (
          <div className={s.blank}>
            <span className={s.blankYear}>{scene.year}</span>
            <span className={s.blankState}>
              {status === "painting" ? "Muse Image is painting" : status === "refused" ? "Declined" : status === "failed" ? "Failed" : "Waiting"}
            </span>
          </div>
        )}
        {status === "cutting" && <span className={s.scan} aria-hidden />}
      </div>
      <figcaption className={s.plateCap}>
        <span className={s.plateNo}>{n}</span>
        <span className={s.plateTitle}>
          <span className={s.plateYear}>{scene.year}</span> {scene.title}
        </span>
        <span className={s.plateModels}>
          {spendLine(scene).map((t) => (
            <span key={t}>{t}</span>
          ))}
          {status === "cutting" && <span>SAM 3.1 cutting</span>}
          {scene.video && <span>film</span>}
          {scene.line && <span>pen line</span>}
        </span>
        {scene.note && (status === "refused" || status === "failed" ? <Problem raw={scene.note} className={s.plateErr} /> : <span className={s.plateNote}>{scene.note}</span>)}
      </figcaption>
    </figure>
  );
}

const prettyModel = (id: string) => (id.startsWith("muse-spark") ? "Muse Spark" : id.startsWith("muse-image") ? "Muse Image" : id.startsWith("muse-wonder") ? "Muse Wonder" : id.startsWith("sam") ? "SAM 3.1" : id);

function Log({ job }: { job: Job }) {
  const box = useRef<HTMLOListElement>(null);
  const [pinned, setPinned] = useState(true);
  useEffect(() => {
    if (pinned && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [job.log.length, pinned]);
  const calls = job.log.filter((l) => l.model).length;
  return (
    <>
      <div className={s.logHead}>
        <h2 className={s.marginTitle}>Press log</h2>
        <span>{calls ? `${calls} model events` : "waiting for the first call"}</span>
      </div>
      <ol
        className={s.log}
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
        aria-live="polite"
        aria-relevant="additions"
      >
        {job.log.map((l, i) => {
          const who = [l.scene ? `Scene ${l.scene.slice(1)}` : "", l.model ? prettyModel(l.model) : ""].filter(Boolean).join(", ");
          const bad = l.kind === "error" || l.kind === "refused";
          return (
            <li key={i} className={s.logLine} data-kind={l.kind}>
              <span className={s.logAt}>{clock(job.startedAt, l.at)}</span>
              <span className={s.logBody}>
                {who && <span className={s.logWho}>{who}</span>}
                {bad ? <Problem raw={l.message} /> : <span className={s.logMsg}>{l.message}</span>}
              </span>
              {l.url && /\.(webp|png|jpg)/.test(l.url) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={s.logThumb} src={l.url} alt="" loading="lazy" />
              ) : null}
            </li>
          );
        })}
      </ol>
      {!pinned && (
        <button
          className={s.latest}
          onClick={() => {
            setPinned(true);
            if (box.current) box.current.scrollTop = box.current.scrollHeight;
          }}
        >
          Jump to latest
        </button>
      )}
    </>
  );
}
