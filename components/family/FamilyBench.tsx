"use client";

/**
 * /family: record or upload a grandparent's story and watch it become a private book. The same
 * workbench as /create (its stylesheet is shared by import): the order and its meter on the
 * left, the proof in the middle (transcript arriving, facts lighting up with the second they were
 * said, then plates painting), the press log in the margin.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { LineDrawing } from "@/components/LineDrawing";
import { Cover } from "@/components/book/Cover";
import { explain } from "@/components/create/explain";
import s from "@/components/create/create.module.css";
import type { FamilyInfo, FamilyJob, FamilyStepId } from "@/pipeline/family/types";
import type { JobScene as FamilyScene } from "@/pipeline/jobs/types";
import { Recording, clockOf } from "./Recording";
import { Privacy } from "./Privacy";
import f from "./family.module.css";

const STEPS: { id: FamilyStepId; name: string; model: string; does: string }[] = [
  { id: "transcribe", name: "Transcribe", model: "Muse Voice Transcribe", does: "writes the recording down, turn by turn, with the time each was said" },
  { id: "facts", name: "Dated facts", model: "Muse Spark", does: "finds the dated moments of the life, each quoting the recording" },
  { id: "storyboard", name: "Storyboard", model: "Muse Spark", does: "turns the facts into seven scenes, then checks every caption against the recording" },
  { id: "plates", name: "Plates", model: "Muse Image", does: "paints each scene in its decade’s print style" },
  { id: "cutouts", name: "Cut-outs", model: "SAM 3.1 + Muse Image", does: "lifts the subject off each plate and repaints what was behind it" },
  { id: "frontispiece", name: "Frontispiece", model: "SAM 3.1 (+ Muse Image)", does: "a family photo traced in pen lines, or an emblem of the life" },
  { id: "films", name: "Films", model: "this server, no API calls", does: "renders the scroll films" },
];

const MODEL_NAME: Record<string, string> = { transcribe: "Muse Voice Transcribe", spark: "Muse Spark", image: "Muse Image", sam: "SAM 3.1", manual: "Other" };
const usd = (v: number, digits = 2) => `$${v.toFixed(v > 0 && v < 0.01 ? 4 : digits)}`;
const mins = (sec: number) => (sec < 90 ? `${Math.max(1, Math.round(sec / 10) * 10)} s` : `${Math.round(sec / 60)} min`);
const since = (from: string, at: string) => clockOf((Date.parse(at) - Date.parse(from)) / 1000);
const keyName = (slug: string) => `lim-family-key:${slug}`;

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

export function Masthead() {
  return (
    <header className={s.masthead}>
      <Link href="/" className={s.wordmark}>
        Lives in Motion
      </Link>
      <nav aria-label="Site">
        <Link href="/#shelf">The shelf</Link>
        <Link href="/create">Make a new life</Link>
        <Link href="/family" aria-current="page">
          Your family’s story
        </Link>
      </nav>
    </header>
  );
}

export function FamilyBench({ initial }: { initial: FamilyInfo }) {
  const [info, setInfo] = useState(initial);
  const [job, setJob] = useState<FamilyJob | null>(initial.job?.status === "running" ? initial.job : null);
  const [budget, setBudget] = useState(initial.budget);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<"live" | "reconnecting" | "closed">("closed");
  const [now, setNow] = useState(0);
  const [another, setAnother] = useState(false);
  const [audio, setAudio] = useState<File | null>(null);
  const [mode, setMode] = useState<"record" | "file">("record");
  const [photos, setPhotos] = useState<string[]>([]);
  const [key, setKey] = useState<string | null>(null);
  const es = useRef<EventSource | null>(null);
  const chosenUrl = useMemo(() => (audio && mode === "file" ? URL.createObjectURL(audio) : null), [audio, mode]);

  const follow = useCallback((slug: string) => {
    es.current?.close();
    const src = new EventSource(`/api/family/${slug}/stream`);
    es.current = src;
    src.onopen = () => setLink("live");
    src.onmessage = (m) => {
      const d = JSON.parse(m.data) as { job: FamilyJob; budget: FamilyInfo["budget"] };
      setJob(d.job);
      setBudget(d.budget);
      setLink("live");
      if (d.job.status !== "running") {
        src.close();
        setLink("closed");
      }
    };
    src.onerror = () => setLink(src.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
  }, []);

  // Back after a refresh: ?job=<slug>, else the job running on the server.
  useEffect(() => {
    const slug = new URLSearchParams(location.search).get("job") ?? (initial.job?.status === "running" ? initial.job.slug : null);
    if (!slug) return;
    setKey(localStorage.getItem(keyName(slug)));
    fetch(`/api/family/${slug}`)
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
      const r = await fetch("/api/family", { method: "POST", body: form });
      const d = await r.json().catch(() => ({ error: `The server answered ${r.status}.` }));
      if (!r.ok) throw new Error(d.error ?? `The server answered ${r.status}.`);
      if (d.key) {
        localStorage.setItem(keyName(d.slug), d.key);
        setKey(d.key);
      } else setKey(null);
      history.replaceState(null, "", `/family?job=${d.slug}`);
      setAnother(false);
      setJob(null);
      follow(d.slug);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!audio) return setError(mode === "record" ? "Record their story first, or choose a recording." : "Choose a recording first.");
    form.set("audio", audio, audio.name);
    void submit(form);
  };

  const trySample = () => {
    const form = new FormData();
    form.set("mock", "1");
    void submit(form);
  };

  if (!job || another)
    return (
      <div className={s.page}>
        <Masthead />
        <div className={s.intake}>
          <form className={s.form} onSubmit={onSubmit}>
            <h1 className={s.formTitle}>Your family’s story</h1>
            <p className={s.formLede}>
              The same book, made for someone who isn’t on the internet. Record a grandparent telling their life, or upload a recording. Every fact in the book is cited to the moment they said it.
            </p>

            {info.sample && (
              <div className={f.sampleCard}>
                <div className={f.sampleHead}>
                  <span className={f.sampleName}>{info.sample.name}</span>
                  <span className={f.sampleLabel}>{info.sample.label}</span>
                </div>
                <p className={s.hint}>
                  A {clockOf(info.sample.seconds)} interview with a made-up grandmother: born about 1938 in Teluk Ayer, a kampong childhood, a seamstress, an HDB flat, a mee pok stall. Nobody in it is real.
                </p>
                <audio src={info.sample.audio} controls preload="none" />
                <div className={f.sampleActions}>
                  {info.mockAllowed && (
                    <button type="button" className={s.make} onClick={trySample} disabled={sending}>
                      Try the sample
                    </button>
                  )}
                  <Link href={`/${info.sample.slug}`}>Read its book</Link>
                  <a href={info.sample.download} download>
                    Download it to upload yourself
                  </a>
                </div>
                {info.mockAllowed && <p className={s.hint}>Try the sample replays its real run in about a minute. No Meta calls, nothing charged.</p>}
              </div>
            )}

            <label className={s.field}>
              <span className={s.fieldLabel}>Their name, as the family says it</span>
              <input name="name" required maxLength={80} autoComplete="off" placeholder="Ah Ma, Grandpa Lim, Nenek" disabled={!info.enabled} />
            </label>
            <label className={s.field}>
              <span className={s.fieldLabel}>
                Who they are <em>optional</em>
              </span>
              <input name="hint" maxLength={120} autoComplete="off" placeholder="my grandmother, a seamstress from Teluk Ayer" disabled={!info.enabled} />
            </label>

            <div className={s.field}>
              <span className={s.fieldLabel}>
                Their story <em>up to {info.limits.seconds / 60} minutes, the most Muse Voice Transcribe takes at once</em>
              </span>
              <div className={f.modes} role="group" aria-label="How to add the recording">
                <button type="button" aria-pressed={mode === "record"} onClick={() => setMode("record")}>
                  Record here
                </button>
                <button type="button" aria-pressed={mode === "file"} onClick={() => setMode("file")}>
                  Upload a recording
                </button>
              </div>
              {mode === "record" ? (
                <Recorder max={info.limits.seconds} disabled={!info.enabled} onAudio={setAudio} />
              ) : (
                <div className={f.chosen}>
                  <input
                    type="file"
                    accept="audio/*,.m4a,.wav,.mp3,.webm,.ogg,.flac"
                    disabled={!info.enabled}
                    aria-label="Recording file"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (file && file.size > info.limits.uploadMb * 1024 * 1024) {
                        setError(`That file is over ${info.limits.uploadMb} MB; trim it to ten minutes or less.`);
                        return;
                      }
                      setError(null);
                      setAudio(file);
                    }}
                  />
                  {chosenUrl && <audio src={chosenUrl} controls preload="metadata" />}
                  <span>WAV, MP3, M4A, WebM, Ogg or FLAC. English, Malay, Mandarin and Tamil, mixed freely; Hokkien, Teochew and Cantonese aren’t supported yet.</span>
                </div>
              )}
            </div>

            <label className={s.field}>
              <span className={s.fieldLabel}>
                Names and places to listen for <em>optional, comma-separated</em>
              </span>
              <input name="keywords" maxLength={400} autoComplete="off" placeholder="Potong Pasir, Wei Ling, mee pok" disabled={!info.enabled} />
            </label>

            <div className={s.field}>
              <span className={s.fieldLabel}>
                Family photos <em>optional, up to {info.limits.photos}</em>
              </span>
              <input
                type="file"
                name="photos"
                multiple
                accept="image/jpeg,image/png,image/webp"
                disabled={!info.enabled}
                aria-label="Family photos"
                onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, info.limits.photos).map((x) => URL.createObjectURL(x)))}
              />
              {photos.length > 0 && (
                <div className={s.photo} style={{ gridTemplateColumns: `repeat(${photos.length}, 72px) 1fr` } as CSSProperties}>
                  {photos.map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={p} src={p} alt="" />
                  ))}
                </div>
              )}
              <label className={s.check}>
                <input type="checkbox" name="consent" />
                <span>The family agrees to these photos being used. SAM 3.1 finds the person and the drawing is traced from the photo; no face is ever generated.</span>
              </label>
              <p className={s.hint}>Without a photo, Muse Image paints an emblem of the life instead of a likeness.</p>
            </div>

            {info.needsToken && (
              <label className={s.field}>
                <span className={s.fieldLabel}>Passcode</span>
                <input name="token" type="password" autoComplete="off" />
              </label>
            )}
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            {!info.enabled && <p className={s.error}>{info.reason}</p>}
            <div className={s.actions}>
              <button className={s.make} disabled={!info.enabled || sending || !audio}>
                {sending ? "Uploading…" : "Make their book"}
              </button>
            </div>
            <dl className={s.terms}>
              <div>
                <dt>Time</dt>
                <dd>
                  About {Math.round((info.sample?.took ?? 600) / 60)} minutes for a three-minute recording. You can start reading once the first plates are in.
                </dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>
                  {info.sample?.usd ? `The sample cost ${usd(info.sample.usd)} of Meta API time; ` : ""}transcription is $0.18 an hour of audio. Stopped at {usd(info.ceiling)} whatever happens.
                </dd>
              </div>
              <div>
                <dt>Today</dt>
                <dd>
                  {usd(budget.today)} of the {usd(budget.dailyCap)} daily allowance used.
                </dd>
              </div>
            </dl>
            <Privacy />
          </form>
          <WhatYouGet info={info} />
        </div>
      </div>
    );

  const running = job.status === "running";
  const canRead = job.scenes.some((x) => x.plate);
  return (
    <div className={s.page}>
      <Masthead />
      <div className={s.bench}>
        <aside className={s.ticket} aria-label="Order and progress">
          <div className={s.order}>
            <p className={s.orderLabel} data-live={running || undefined}>
              {running ? (job.mock ? "Replaying the sample" : "Making their book") : job.status === "done" ? "Finished" : "Stopped"}
            </p>
            <h1 className={s.orderName}>{job.name}</h1>
            {job.sample ? <p className={s.orderHint}>A fictional sample recording, voiced by a computer.</p> : job.hint && <p className={s.orderHint}>{job.hint}</p>}
          </div>
          <Steps job={job} est={info.estimate} now={now} />
          <Meter job={job} budget={budget} />
          {!running && (
            <div className={s.ending} role="status">
              {job.status === "failed" && <Problem raw={job.error} className={s.error} />}
              {job.status === "interrupted" && <p className={s.error}>The server restarted while this book was being made. What was finished is kept.</p>}
              <button
                className={s.rehearse}
                onClick={() => {
                  setAnother(true);
                  setAudio(null);
                  history.replaceState(null, "", "/family");
                }}
              >
                {job.mock ? "Make your own" : "Make another"}
              </button>
            </div>
          )}
        </aside>
        <main className={s.sheet}>
          <article className={s.proof}>
            {job.status === "done" ? (
              <Bound job={job} privateKey={key} />
            ) : (
              <header className={s.proofHead}>
                <div>
                  <h2 className={s.name}>{job.name}</h2>
                  <p className={s.tagline}>{job.tagline ?? (job.hint || " ")}</p>
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
                    {running && now ? `${canRead ? "Readable now. " : "Readable once the first plate is in. "}${since(job.startedAt, new Date(now).toISOString())} so far.` : running ? " " : "Stopped. What was made is kept."}
                    {link === "reconnecting" && running ? " Reconnecting to the server…" : ""}
                  </span>
                </div>
              </header>
            )}
            {job.mock && <p className={s.mockNote}>Replay: this is the sample book’s real run, compressed to about a minute. The recording is fictional and voiced by a computer. No Meta calls are made and nothing is charged.</p>}

            <section className={s.galley} aria-label="The recording">
              <Recording
                audio={job.audio}
                turns={job.turns}
                facts={job.facts}
                name={job.name}
                subject={job.subject}
                live
                compact={job.scenes.length > 0}
                waiting={{
                  transcript: job.steps.transcribe.status === "failed" ? "Transcription stopped." : "Muse Voice Transcribe is listening. A three-minute recording takes about a minute.",
                  facts: job.steps.facts.status === "failed" ? "Stopped." : job.turns.length ? "Muse Spark is reading the transcript for dated moments." : "Facts appear once the transcript is in.",
                }}
              />
            </section>

            <section className={s.platesSec} aria-labelledby="plates">
              <h3 id="plates" className={s.sectionTitle}>
                Seven scenes <span>Muse Image paints, SAM 3.1 cuts out{job.status === "done" ? "; hover a plate to play its film" : ""}</span>
              </h3>
              <div className={s.plates}>
                {(job.scenes.length ? job.scenes : Array.from({ length: 7 }, () => null)).map((sc, i) => (sc ? <Plate key={sc.id} scene={sc} n={i + 1} /> : <div key={i} className={s.slot} data-status="pending" />))}
              </div>
            </section>

            {job.frontispiece && (
              <section className={s.frontSec} aria-labelledby="front">
                <h3 id="front" className={s.sectionTitle}>
                  Frontispiece <span>{job.frontispiece.kind === "emblem" ? "an emblem by Muse Image, SAM 3.1 mask, traced in pen lines" : "a family photo, SAM 3.1 person mask, traced in pen lines"}</span>
                </h3>
                <div className={s.front}>
                  <figure className={s.frontFig}>
                    {job.frontispiece.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={job.frontispiece.image} alt={job.frontispiece.kind === "emblem" ? "The emblem Muse Image painted" : "The family photo"} />
                    ) : (
                      <div className={s.frontWait}>{job.steps.frontispiece.status === "failed" ? "No picture" : "Painting…"}</div>
                    )}
                    <figcaption>{job.frontispiece.kind === "photo" ? "Family photo, with consent" : "Muse Image"}</figcaption>
                  </figure>
                  <figure className={s.frontFig}>
                    {job.frontispiece.lines ? <LineDrawing src={job.frontispiece.lines} loop label={`${job.name}, frontispiece in pen strokes`} className={s.frontLines} /> : <div className={s.frontWait}>{job.steps.frontispiece.status === "failed" ? "Not traced" : "Tracing comes next"}</div>}
                    <figcaption>{job.frontispiece.strokes ? `${job.frontispiece.strokes.toLocaleString()} pen strokes` : "Pen lines"}</figcaption>
                  </figure>
                  {job.frontispiece.note && <Problem raw={job.frontispiece.note} className={job.steps.frontispiece.status === "failed" ? s.error : s.frontNote} />}
                </div>
              </section>
            )}
          </article>
        </main>
        <aside className={s.margin} aria-label="What the models are doing">
          <Log job={job} />
        </aside>
      </div>
    </div>
  );
}

/** A recorder in the page: MediaRecorder, stopped at the API's ten minutes. */
function Recorder({ max, disabled, onAudio }: { max: number; disabled?: boolean; onAudio: (f: File | null) => void }) {
  const [on, setOn] = useState(false);
  const [sec, setSec] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (rec.current?.state === "recording") rec.current.stop();
    setOn(false);
  }, []);

  useEffect(() => {
    if (on && sec >= max) stop();
  }, [on, sec, max, stop]);
  useEffect(() => () => stop(), [stop]);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
        setUrl(URL.createObjectURL(blob));
        onAudio(new File([blob], `recording.${ext}`, { type: blob.type }));
      };
      rec.current = r;
      r.start(1000);
      onAudio(null);
      setUrl(null);
      setSec(0);
      setOn(true);
      const began = Date.now();
      timer.current = setInterval(() => setSec(Math.floor((Date.now() - began) / 1000)), 250);
    } catch (e) {
      setErr((e as Error).name === "NotAllowedError" ? "The browser wasn’t allowed to use the microphone. Allow it, or upload a recording instead." : `Couldn’t start recording: ${(e as Error).message}`);
    }
  };

  return (
    <div className={f.recorder}>
      <button type="button" className={f.recBtn} data-on={on || undefined} onClick={on ? stop : start} disabled={disabled}>
        {on ? "Stop" : url ? "Record again" : "Start recording"}
      </button>
      <span className={f.recClock} aria-live="off">
        {clockOf(sec)} <small>of {clockOf(max)}</small>
      </span>
      {url && <audio src={url} controls preload="metadata" />}
      {err && <p className={s.error}>{err}</p>}
      {!url && !err && <p className={s.hint} style={{ gridColumn: "1 / -1" }}>Ask about where they were born, their homes, work, family and what they do now. Years and ages help (“in 1966 we moved…”).</p>}
    </div>
  );
}

function WhatYouGet({ info }: { info: FamilyInfo }) {
  const sample = info.sample;
  return (
    <section className={s.promise} aria-labelledby="promise">
      <h2 id="promise" className={s.promiseTitle}>
        What you get
      </h2>
      <p className={s.promiseLede}>A private book of seven illustrated scenes from their own words, each painted in the print style of its decade, with notes that play the moment each fact was said.</p>
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
            The plates of <Link href={`/${sample.slug}`}>{sample.name}’s book</Link>, from {sample.label.toLowerCase()}.
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
      <p className={s.promiseFoot}>No subject check is needed for a private person, but the storyboard still keeps politics and war out of the pictures.</p>
    </section>
  );
}

function Steps({ job, est, now }: { job: FamilyJob; est: FamilyInfo["estimate"]; now: number }) {
  return (
    <ol className={s.steps}>
      {STEPS.map((st) => {
        const x = job.steps[st.id];
        const took = x.startedAt ? ((x.endedAt ? Date.parse(x.endedAt) : now || Date.parse(x.startedAt)) - Date.parse(x.startedAt)) / 1000 : 0;
        return (
          <li key={st.id} className={s.step} data-status={x.status}>
            <span className={s.stepMark} aria-hidden />
            <span className={s.stepName}>{st.name}</span>
            <span className={s.stepFig}>{x.status === "waiting" ? `~${mins(est[st.id])}` : x.status === "skipped" ? "skipped" : mins(Math.max(1, took))}</span>
            <span className={s.stepModel}>{st.model}</span>
            <span className={s.stepCost}>{x.usd > 0 ? usd(x.usd, 3) : ""}</span>
            {x.note && (x.status === "failed" ? <Problem raw={x.note} className={s.stepErr} /> : <span className={s.stepNote}>{x.note}</span>)}
          </li>
        );
      })}
    </ol>
  );
}

function Meter({ job, budget }: { job: FamilyJob; budget: FamilyInfo["budget"] }) {
  const pct = Math.min(100, (job.usd / job.ceiling) * 100);
  const parts = Object.entries(job.spend).filter(([, v]) => (v ?? 0) > 0);
  return (
    <div className={s.meter}>
      <div className={s.meterRow}>
        <span>{job.mock ? "The real run cost" : "This book so far"}</span>
        <strong>{usd(job.usd, 3)}</strong>
      </div>
      <div className={s.bar} role="meter" aria-valuemin={0} aria-valuemax={job.ceiling} aria-valuenow={job.usd} aria-label="Spend against this book's ceiling">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className={s.meterNote}>of the {usd(job.ceiling)} ceiling for one book</p>
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
        {job.mock ? "Replay: nothing is charged. " : ""}Today’s new books {usd(budget.today)} of {usd(budget.dailyCap)}.
      </p>
    </div>
  );
}

/** Finished: the book, how private it is, and the way to delete it. */
function Bound({ job, privateKey }: { job: FamilyJob; privateKey: string | null }) {
  const plates = job.scenes.filter((x) => x.plate).length;
  const took = since(job.startedAt, job.finishedAt ?? job.updatedAt);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  const deleteLink = privateKey ? `${origin}/family/${job.slug}?key=${privateKey}` : null;
  return (
    <header className={s.bound}>
      <Link href={`/${job.bookSlug}`} className={s.boundBook} aria-label={`Read ${job.name}’s book`}>
        <div className={s.boundVolume} style={{ ["--cloth" as string]: "#3b4a3f" } as CSSProperties}>
          <Cover slug={job.bookSlug} name={job.name} lifespan={job.born ? `b. ${job.born}` : ""} part="A family book" className={s.boundCover} />
        </div>
      </Link>
      <div className={s.boundText}>
        <p className={f.boundPrivate}>{job.mock ? "Sample replayed: the fictional Ah Ma’s book" : "Private: not on the shelf, readable by its link only"}</p>
        <h2 className={s.boundName}>{job.name}</h2>
        {job.tagline && <p className={s.tagline}>{job.tagline}</p>}
        <p className={s.boundFacts}>
          {job.turns.length} transcript turns, {job.facts.length} dated facts each cited to its second in the recording, {plates} of 7 plates; {job.mock ? `replayed in ${took}; the real run cost ${usd(job.usd)}` : `made in ${took} for ${usd(job.usd)}`}.
        </p>
        <div className={s.boundActions}>
          <Link className={s.readBtn} href={`/${job.bookSlug}`}>
            Read the book
          </Link>
          <Link className={s.quiet} href={`/family/${job.bookSlug}`}>
            The recording and transcript
          </Link>
        </div>
        {deleteLink && (
          <div className={f.boundLinks}>
            <p>Keep this private link: it opens the recording page with a delete button, from any browser. This browser remembers it too.</p>
            <div className={f.keyLink}>
              <input readOnly value={deleteLink} aria-label="Private delete link" onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className={f.copy}
                onClick={() => {
                  void navigator.clipboard?.writeText(deleteLink);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

const spendLine = (sc: FamilyScene) =>
  [sc.spend.image ? `Muse Image ${usd(sc.spend.image, 3)}` : null, sc.spend.sam ? `SAM 3.1 ${usd(sc.spend.sam, 4)}${sc.cuts.length ? `: ${sc.cuts.map((c) => c.concept).join(", ")}` : ""}` : null].filter(Boolean) as string[];

function Plate({ scene, n }: { scene: FamilyScene; n: number }) {
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

const prettyModel = (id: string) =>
  id.startsWith("muse-voice") ? "Muse Voice Transcribe" : id.startsWith("muse-spark") ? "Muse Spark" : id.startsWith("muse-image") ? "Muse Image" : id.startsWith("sam") ? "SAM 3.1" : id;

function Log({ job }: { job: FamilyJob }) {
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
              <span className={s.logAt}>{since(job.startedAt, l.at)}</span>
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
