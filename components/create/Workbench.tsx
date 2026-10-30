"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { LineDrawing } from "@/components/LineDrawing";
import type { Budget, CreateInfo, Job, JobScene, Spend, StepId } from "@/pipeline/create/types";
import s from "./create.module.css";

const STEPS: { id: StepId; name: string; model: (j: Job["models"]) => string; does: string }[] = [
  { id: "research", name: "Research", model: (m) => `Muse Spark + web search`, does: "finds dated facts, each with its sources" },
  { id: "storyboard", name: "Storyboard", model: () => "Muse Spark", does: "turns the facts into seven scenes" },
  { id: "plates", name: "Plates", model: () => "Muse Image", does: "paints each scene in its decade's print style" },
  { id: "cutouts", name: "Cut-outs", model: () => "SAM 3.1 + Muse Image", does: "lifts the subject off each plate and repaints what was behind it" },
  { id: "frontispiece", name: "Frontispiece", model: () => "Muse Image + SAM 3.1", does: "an emblem of the life, traced in pen lines" },
  { id: "films", name: "Films", model: () => "on this machine", does: "renders the scroll films, no API calls" },
];

const MODEL_NAME: Record<string, string> = { spark: "Muse Spark", search: "Muse Spark search", image: "Muse Image", sam: "SAM 3.1" };

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

/** Wall time left, from the typical step times: research, storyboard, then plates+cut-outs beside the frontispiece, then films. */
function remaining(job: Job, est: CreateInfo["estimate"], now: number): number {
  const left = (id: StepId) => {
    const st = job.steps[id];
    if (st.status === "done" || st.status === "skipped" || st.status === "failed") return 0;
    if (st.status === "running" && st.startedAt) return Math.max(est[id] * 0.15, est[id] - (now - Date.parse(st.startedAt)) / 1000);
    return est[id];
  };
  // Cut-outs run beside the plates; about 60% of their time is left once the last plate lands.
  const art = job.steps.plates.status === "done" || job.steps.plates.status === "failed" ? left("cutouts") : left("plates") + est.cutouts * 0.6;
  return left("research") + left("storyboard") + Math.max(art, left("frontispiece")) + left("films");
}
const total = (est: CreateInfo["estimate"]) => est.research + est.storyboard + Math.max(est.plates + est.cutouts * 0.6, est.frontispiece) + est.films;

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
  const es = useRef<EventSource | null>(null);

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

  async function submit(form: FormData) {
    setSending(true);
    setError(null);
    try {
      const r = await fetch("/api/create", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) return setError(d.error ?? "The server refused the request.");
      history.replaceState(null, "", `/create?job=${d.slug}`);
      setJob(null);
      setAnother(false);
      follow(d.slug);
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setSending(false);
      fetch("/api/create").then((r) => r.json()).then(setInfo, () => {});
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

  const running = job?.status === "running";
  const est = info.estimate;
  const plates = job?.scenes.filter((x) => x.plate).length ?? 0;
  const canRead = Boolean(job && job.steps.storyboard.status === "done" && plates > 0);

  return (
    <div className={s.desk} data-desk>
      <header className={s.top}>
        <Link href="/" className={s.home}>
          Lives in Motion
        </Link>
        <span className={s.where}>Make a new life</span>
        <Link href="/" className={s.back}>
          Back to the book
        </Link>
      </header>

      <div className={s.bench}>
        <aside className={s.ticket} aria-label="Order and progress">
          {!job || another ? (
            <form className={s.form} onSubmit={onSubmit}>
              <h1 className={s.formTitle}>Whose life should we make?</h1>
              <p className={s.formLede}>A Singaporean with a public record. Muse Spark looks them up on the web; nothing is invented without a source.</p>
              <label className={s.field}>
                <span>Name</span>
                <input name="name" required maxLength={80} autoComplete="off" placeholder="Tan Howe Liang" disabled={!info.enabled} />
              </label>
              <label className={s.field}>
                <span>
                  Who they are <em>optional</em>
                </span>
                <input name="hint" maxLength={120} autoComplete="off" placeholder="weightlifter, Singapore's first Olympic medallist" disabled={!info.enabled} />
              </label>
              <label className={s.field}>
                <span>
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
              {preview && (
                <div className={s.photo}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt="The photo you chose" />
                  <label className={s.check}>
                    <input type="checkbox" name="rights" required />
                    <span>I took this photo or have the right to use it. It will be traced into a line drawing and credited as supplied by the reader.</span>
                  </label>
                </div>
              )}
              {!preview && <p className={s.hint}>Without a photo, Muse Image paints an emblem of the life instead of a likeness.</p>}
              {info.needsToken && (
                <label className={s.field}>
                  <span>Passcode</span>
                  <input name="token" type="password" required autoComplete="off" />
                </label>
              )}
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
              {!info.enabled && <p className={s.error}>{info.reason}</p>}
              <button className={s.make} disabled={!info.enabled || sending} value="make">
                {sending ? "Starting…" : "Make this life"}
              </button>
              <p className={s.terms}>
                Takes about {mins(total(est))}. Typically $0.25–0.40 of Meta API time, never more than {usd(info.ceiling)}; today {usd(budget.today)} of the {usd(budget.dailyCap)} daily allowance is used.
              </p>
              {info.mockAllowed && (
                <button className={s.rehearse} disabled={!info.enabled || sending} value="mock" formNoValidate={false}>
                  Rehearse with Jack Sim’s finished life (no Meta calls)
                </button>
              )}
            </form>
          ) : (
            <div className={s.order}>
              <p className={s.orderLabel}>{job.mock ? "Rehearsal" : running ? "Now making" : job.status === "done" ? "Made" : "Stopped"}</p>
              <h1 className={s.orderName}>{job.name}</h1>
              {job.hint && <p className={s.orderHint}>{job.hint}</p>}
              {!running && (
                <button className={s.rehearse} onClick={() => setAnother(true)}>
                  Make another life
                </button>
              )}
            </div>
          )}

          {job && <Steps job={job} est={est} now={now} />}
          {job && <Meter job={job} budget={budget} />}

          {job && job.status !== "running" && (
            <div className={s.ending} role="status">
              {job.status === "done" && <p className={s.ok}>Finished in {clock(job.startedAt, job.finishedAt ?? job.updatedAt)}.</p>}
              {job.status === "failed" && <p className={s.error}>{job.error}</p>}
              {job.status === "interrupted" && <p className={s.error}>The server restarted while this life was being made. Finished plates and cut-outs are kept.</p>}
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
            </div>
          )}
        </aside>

        <main className={s.sheet}>
          {job ? <Proof job={job} now={now} canRead={canRead} link={link} remaining={running ? remaining(job, est, now) : 0} /> : <Empty info={info} />}
        </main>

        <aside className={s.margin} aria-label="What the models are doing">
          <h2 className={s.marginTitle}>Press log</h2>
          {job ? <Log job={job} /> : <p className={s.quiet}>Each call to a Meta model appears here as it happens, with what it made and what it cost.</p>}
        </aside>
      </div>
    </div>
  );
}

function Empty({ info }: { info: CreateInfo }) {
  return (
    <div className={s.empty}>
      <p className={s.kicker}>How a life is made</p>
      <h2 className={s.emptyTitle}>Three Meta models, one book, about {mins(total(info.estimate))}.</h2>
      <ol className={s.plan}>
        {STEPS.map((st) => (
          <li key={st.id}>
            <span className={s.planName}>{st.name}</span>
            <span className={s.planModel}>{st.model({ spark: "", image: "", sam: "" })}</span>
            <span className={s.planDoes}>{st.does}</span>
            <span className={s.planTime}>{mins(info.estimate[st.id])}</span>
          </li>
        ))}
      </ol>
      <p className={s.emptyFoot}>
        You can read the book as soon as the storyboard and the first plates are in; the rest fills in while you read. Event budget: {usd(info.budget.spent)} spent, {usd(info.budget.left)} left before the stop line.
      </p>
    </div>
  );
}

function Steps({ job, est, now }: { job: Job; est: CreateInfo["estimate"]; now: number }) {
  return (
    <ol className={s.steps}>
      {STEPS.map((st) => {
        const x = job.steps[st.id];
        const took = x.startedAt ? ((x.endedAt ? Date.parse(x.endedAt) : now) - Date.parse(x.startedAt)) / 1000 : 0;
        return (
          <li key={st.id} className={s.step} data-status={x.status}>
            <span className={s.stepMark} aria-hidden />
            <span className={s.stepName}>{st.name}</span>
            <span className={s.stepModel}>{st.model(job.models)}</span>
            <span className={s.stepFig}>
              {x.status === "waiting" ? `~${mins(est[st.id])}` : x.status === "skipped" ? "skipped" : `${Math.max(0, Math.round(took))} s`}
              {x.usd > 0 && <> {usd(x.usd, 3)}</>}
            </span>
            {x.note && <span className={s.stepNote}>{x.note}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Meter({ job, budget }: { job: Job; budget: Budget }) {
  const pct = Math.min(100, (job.usd / job.ceiling) * 100);
  return (
    <div className={s.meter}>
      <div className={s.meterRow}>
        <span>{job.mock ? "Would cost" : "This life so far"}</span>
        <strong>{usd(job.usd, 3)}</strong>
      </div>
      <div className={s.bar} role="meter" aria-valuemin={0} aria-valuemax={job.ceiling} aria-valuenow={job.usd} aria-label="Spend against this life's ceiling">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className={s.meterNote}>
        Ceiling {usd(job.ceiling)} a life. {Object.entries(job.spend).map(([k, v]) => `${MODEL_NAME[k] ?? k} ${usd(v ?? 0, 3)}`).join(", ")}
      </p>
      <p className={s.meterNote}>
        {job.mock ? "Rehearsal: nothing is charged. " : ""}Event budget {usd(budget.spent)} of the {usd(budget.stop, 0)} stop line; new lives today {usd(budget.today)} of {usd(budget.dailyCap)}.
      </p>
    </div>
  );
}

function Proof({ job, now, canRead, link, remaining }: { job: Job; now: number; canRead: boolean; link: string; remaining: number }) {
  const running = job.status === "running";
  // Once the scenes are written the record folds to a few lines, so the plates are in view.
  const [open, setOpen] = useState(false);
  const folded = !open && job.scenes.length > 0 && job.facts.length > 6;
  const sources = new Set(job.facts.flatMap((f) => f.sources.map((x) => x.url))).size;
  return (
    <article className={s.proof}>
      <header className={s.proofHead}>
        <div>
          <h2 className={s.name}>{job.name}</h2>
          <p className={s.tagline}>{job.tagline ?? (job.steps.storyboard.status === "done" ? "" : job.hint || " ")}</p>
        </div>
        <div className={s.read}>
          {canRead ? (
            <Link className={s.readBtn} href={`/${job.bookSlug}`}>
              Read the book
            </Link>
          ) : (
            <span className={s.readBtn} aria-disabled>
              Read the book
            </span>
          )}
          <span className={s.eta} aria-live="polite">
            {running && !now
              ? "\u00a0"
              : running
              ? `${canRead ? "Readable now; " : ""}about ${mins(remaining)} left, ${clock(job.startedAt, new Date(now).toISOString())} so far`
              : job.status === "done"
                ? "Bound and on the shelf"
                : "Stopped"}
            {link === "reconnecting" && running ? ". Reconnecting to the server…" : ""}
          </span>
        </div>
      </header>

      {job.mock && <p className={s.mockNote}>Rehearsal: this replays Jack Sim’s finished life with typical timings and costs. No Meta calls are made and nothing is charged.</p>}

      <section className={s.galley} aria-labelledby="galley">
        <h3 id="galley" className={s.sectionTitle}>
          The record <span>Muse Spark, web search, {job.facts.length ? `${job.facts.length} facts from ${sources} sources` : "searching…"}</span>
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
          Seven scenes <span>Muse Image paints, SAM 3.1 cuts out</span>
        </h3>
        <div className={s.plates}>
          {(job.scenes.length ? job.scenes : Array.from({ length: 7 }, (_, i) => null)).map((sc, i) => (sc ? <Plate key={sc.id} scene={sc} n={i + 1} /> : <div key={i} className={s.slot} data-status="pending" />))}
        </div>
      </section>

      {job.frontispiece && (
        <section className={s.frontSec} aria-labelledby="front">
          <h3 id="front" className={s.sectionTitle}>
            Frontispiece <span>{job.frontispiece.kind === "photo" ? "your photo, SAM 3.1 person mask, traced in pen lines" : "an emblem by Muse Image, SAM 3.1 mask, traced in pen lines"}</span>
          </h3>
          <div className={s.front}>
            <figure className={s.frontFig}>
              {job.frontispiece.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={job.frontispiece.image} alt={job.frontispiece.kind === "photo" ? "The photo supplied" : "The emblem Muse Image painted"} />
              ) : (
                <div className={s.frontWait}>{job.steps.frontispiece.status === "failed" ? "No picture" : "Painting…"}</div>
              )}
              <figcaption>{job.mock ? "Rehearsal: Jack Sim’s credited portrait" : job.frontispiece.kind === "photo" ? "Supplied by the reader" : "Muse Image"}</figcaption>
            </figure>
            <figure className={s.frontFig}>
              {job.frontispiece.lines ? <LineDrawing src={job.frontispiece.lines} loop label={`${job.name}, frontispiece in pen strokes`} className={s.frontLines} /> : <div className={s.frontWait}>{job.frontispiece.note ?? "Tracing comes next"}</div>}
              <figcaption>{job.frontispiece.strokes ? `${job.frontispiece.strokes.toLocaleString()} pen strokes, linedraw` : "linedraw"}</figcaption>
            </figure>
            {job.frontispiece.note && <p className={s.frontNote}>{job.frontispiece.note}</p>}
          </div>
        </section>
      )}
    </article>
  );
}

const spendLine = (sc: JobScene) =>
  [
    sc.spend.image ? `Muse Image ${usd(sc.spend.image, 3)}` : null,
    sc.spend.sam ? `SAM 3.1 ${usd(sc.spend.sam, 4)}${sc.cuts.length ? `: ${sc.cuts.map((c) => c.concept).join(", ")}` : ""}` : null,
  ].filter(Boolean) as string[];

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
        {scene.note && <span className={status === "refused" || status === "failed" ? s.plateErr : s.plateNote}>{scene.note}</span>}
      </figcaption>
    </figure>
  );
}

function Log({ job }: { job: Job }) {
  const box = useRef<HTMLOListElement>(null);
  const [pinned, setPinned] = useState(true);
  useEffect(() => {
    if (pinned && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [job.log.length, pinned]);
  return (
    <ol
      className={s.log}
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
      }}
      aria-live="polite"
    >
      {job.log.map((l, i) => (
        <li key={i} className={s.logLine} data-kind={l.kind}>
          <span className={s.logAt}>{clock(job.startedAt, l.at)}</span>
          <span className={s.logBody}>
            {(l.model || l.scene) && (
              <span className={s.logWho}>
                {l.scene ? `Scene ${l.scene.slice(1)}` : ""}
                {l.scene && l.model ? ", " : ""}
                {l.model ? prettyModel(l.model) : ""}
              </span>
            )}
            {l.message}
            {l.url && /\.(webp|png|jpg)/.test(l.url) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={s.logThumb} src={l.url} alt="" loading="lazy" />
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

const prettyModel = (id: string) => (id.startsWith("muse-spark") ? "Muse Spark" : id.startsWith("muse-image") ? "Muse Image" : id.startsWith("sam") ? "SAM 3.1" : id);
