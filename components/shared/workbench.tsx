"use client";

/**
 * What the two workbenches (/create and /family) share: the masthead, the step list, the spend
 * meter, a scene's plate slot, the frontispiece section, the press log, the plan of steps and
 * the job's live stream. Each workbench supplies its own words.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { BaseJob, Budget, JobScene, StepState } from "@/pipeline/jobs/types";
import { LineDrawing } from "./LineDrawing";
import { explain } from "./explain";
import s from "./workbench.module.css";

export { s as workbenchStyles };

export const usd = (v: number, digits = 2) => `$${v.toFixed(v > 0 && v < 0.01 ? 4 : digits)}`;
export const mins = (sec: number) => (sec < 90 ? `${Math.max(1, Math.round(sec / 10) * 10)} s` : `${Math.round(sec / 60)} min`);

const MODEL_NAME: Record<string, string> = { spark: "Muse Spark", search: "Muse Spark search", image: "Muse Image", sam: "SAM 3.1", wonder: "Muse Wonder", transcribe: "Muse Voice Transcribe", manual: "Other" };
const prettyModel = (id: string) =>
  id.startsWith("muse-voice") ? "Muse Voice Transcribe" : id.startsWith("muse-spark") ? "Muse Spark" : id.startsWith("muse-image") ? "Muse Image" : id.startsWith("muse-wonder") ? "Muse Wonder" : id.startsWith("sam") ? "SAM 3.1" : id;

/** One step as the workbench lists it. */
export interface StepInfo<S extends string> {
  id: S;
  name: string;
  model: string;
  does: string;
}

/** A step an older job file doesn't have yet. */
const NO_STEP: StepState = { status: "skipped", usd: 0 };

export function Masthead({ children }: { children: ReactNode }) {
  return (
    <header className={s.masthead}>
      <Link href="/" className={s.wordmark}>
        Lives in Motion
      </Link>
      <nav aria-label="Site">{children}</nav>
    </header>
  );
}

/** An error line in plain words; the raw text, if any, behind a disclosure. */
export function Problem({ raw, className }: { raw?: string | null; className?: string }) {
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

export function Steps<S extends string>({ steps, job, est, now }: { steps: StepInfo<S>[]; job: BaseJob<S>; est: Record<S, number>; now: number }) {
  return (
    <ol className={s.steps}>
      {steps.map((st) => {
        const x = job.steps[st.id] ?? NO_STEP;
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

/** Spend against the book's ceiling, by model; `words` names the book and the replay. */
export function Meter({ job, words, note }: { job: BaseJob<string>; words: { mock: string; live: string; unit: string }; note: ReactNode }) {
  const pct = Math.min(100, (job.usd / job.ceiling) * 100);
  const parts = Object.entries(job.spend).filter(([, v]) => (v ?? 0) > 0);
  return (
    <div className={s.meter}>
      <div className={s.meterRow}>
        <span>{job.mock ? words.mock : words.live}</span>
        <strong>{usd(job.usd, 3)}</strong>
      </div>
      <div className={s.bar} role="meter" aria-valuemin={0} aria-valuemax={job.ceiling} aria-valuenow={job.usd} aria-label={`Spend against this ${words.unit}'s ceiling`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className={s.meterNote}>of the {usd(job.ceiling)} ceiling for one {words.unit}</p>
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
      <p className={s.meterNote}>{note}</p>
    </div>
  );
}

const spendLine = (sc: JobScene) =>
  [
    sc.spend.image ? `Muse Image ${usd(sc.spend.image, 3)}` : null,
    sc.spend.sam ? `SAM 3.1 ${usd(sc.spend.sam, 4)}${sc.cuts.length ? `: ${sc.cuts.map((c) => c.concept).join(", ")}` : ""}` : null,
    sc.spend.wonder ? `Muse Wonder ${usd(sc.spend.wonder, 3)}` : null,
  ].filter(Boolean) as string[];

/** One scene's slot: the plate as it lands, its cut-outs, its film on hover, and what each model cost. */
export function ScenePlate({ scene, n }: { scene: JobScene; n: number }) {
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
            {scene.cuts.map((c) => (
              // On the clean background the cut-out sits where SAM found it, lifted a little; without one it is outlined.
              // eslint-disable-next-line @next/next/no-img-element
              <img key={c.src} className={scene.background ? s.cut : `${s.cut} ${s.cutFound}`} src={c.src} alt="" style={{ left: `${c.x - c.w / 2}%`, bottom: `${100 - c.y}%`, width: `${c.w}%` }} />
            ))}
            {hover && scene.video && <video className={s.film} src={scene.video} autoPlay muted loop playsInline poster={scene.poster} />}
          </>
        ) : (
          <div className={s.blank}>
            <span className={s.blankYear}>{scene.year}</span>
            <span className={s.blankState}>{status === "painting" ? "Muse Image is painting" : status === "refused" ? "Declined" : status === "failed" ? "Failed" : "Waiting"}</span>
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

/** The seven plate slots, empty ones waiting until the storyboard names the scenes. */
export function Plates({ job }: { job: BaseJob<string> }) {
  return (
    <section className={s.platesSec} aria-labelledby="plates">
      <h3 id="plates" className={s.sectionTitle}>
        Seven scenes <span>Muse Image paints, SAM 3.1 cuts out{job.status === "done" ? "; hover a plate to play its film" : ""}</span>
      </h3>
      <div className={s.plates}>
        {(job.scenes.length ? job.scenes : Array.from({ length: 7 }, () => null)).map((sc, i) => (sc ? <ScenePlate key={sc.id} scene={sc} n={i + 1} /> : <div key={i} className={s.slot} data-status="pending" />))}
      </div>
    </section>
  );
}

/** The frontispiece: its source picture and the pen lines traced from it. */
export function FrontispieceSection({ job, kind, alt, caption }: { job: BaseJob<string>; kind: string; alt: string; caption: string }) {
  const f = job.frontispiece!;
  const failed = job.steps.frontispiece?.status === "failed";
  return (
    <section className={s.frontSec} aria-labelledby="front">
      <h3 id="front" className={s.sectionTitle}>
        Frontispiece <span>{kind}</span>
      </h3>
      <div className={s.front}>
        <figure className={s.frontFig}>
          {f.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.image} alt={alt} />
          ) : (
            <div className={s.frontWait}>{failed ? "No picture" : "Painting…"}</div>
          )}
          <figcaption>{caption}</figcaption>
        </figure>
        <figure className={s.frontFig}>
          {f.lines ? <LineDrawing src={f.lines} loop label={`${job.name}, frontispiece in pen strokes`} className={s.frontLines} /> : <div className={s.frontWait}>{failed ? "Not traced" : "Tracing comes next"}</div>}
          <figcaption>{f.strokes ? `${f.strokes.toLocaleString()} pen strokes` : "Pen lines"}</figcaption>
        </figure>
        {f.note && <Problem raw={f.note} className={failed ? s.error : s.frontNote} />}
      </div>
    </section>
  );
}

/** The press log: every model event, newest at the foot, pinned there until the reader scrolls up. */
export function Log({ job, clock }: { job: BaseJob<string>; clock: (from: string, at: string) => string }) {
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

/** The empty page's other half: a finished book's plates and the steps a run takes, with typical times. */
export function WhatYouGet<S extends string>({ lede, sample, caption, steps, estimate, foot }: { lede: string; sample?: { plates: { year: string; title: string; src: string }[] }; caption: ReactNode; steps: StepInfo<S>[]; estimate: Record<S, number>; foot: string }) {
  return (
    <section className={s.promise} aria-labelledby="promise">
      <h2 id="promise" className={s.promiseTitle}>
        What you get
      </h2>
      <p className={s.promiseLede}>{lede}</p>
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
          <figcaption>{caption}</figcaption>
        </figure>
      )}
      <ol className={s.plan}>
        {steps.map((st) => (
          <li key={st.id}>
            <span className={s.planName}>{st.name}</span>
            <span className={s.planDoes}>
              {st.does}
              <span className={s.planModel}>{st.model}</span>
            </span>
            <span className={s.planTime}>~{mins(estimate[st.id])}</span>
          </li>
        ))}
      </ol>
      <p className={s.promiseFoot}>{foot}</p>
    </section>
  );
}

/**
 * A job followed live: its Server-Sent Events (api/<kind>/<slug>/stream), the link's health, a
 * one-second clock while it runs, and, after a refresh, the job in ?job=<slug> or the one
 * running on the server.
 */
export function useJobStream<J extends BaseJob<string>>(api: string, initial: J | null, initialBudget: Budget, onResume?: (slug: string) => void) {
  const [job, setJob] = useState<J | null>(initial?.status === "running" ? initial : null);
  const [budget, setBudget] = useState<Budget>(initialBudget);
  const [link, setLink] = useState<"live" | "reconnecting" | "closed">("closed");
  // 0 until mounted: the server and the first client render must print the same clock.
  const [now, setNow] = useState(0);
  const es = useRef<EventSource | null>(null);

  const follow = useCallback(
    (slug: string) => {
      es.current?.close();
      const src = new EventSource(`${api}/${slug}/stream`);
      es.current = src;
      src.onopen = () => setLink("live");
      src.onmessage = (m) => {
        const d = JSON.parse(m.data) as { job: J; budget: Budget };
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
    },
    [api],
  );

  useEffect(() => {
    const slug = new URLSearchParams(location.search).get("job") ?? (initial?.status === "running" ? initial.slug : null);
    if (!slug) return;
    onResume?.(slug);
    fetch(`${api}/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setJob(d.job);
        setBudget(d.budget);
        if (d.job.status === "running") follow(slug);
      });
    return () => es.current?.close();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, initial]);

  useEffect(() => {
    setNow(Date.now());
    if (job?.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job?.status]);

  return { job, setJob, budget, link, now, follow };
}

