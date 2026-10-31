"use client";

/**
 * /family: record or upload a grandparent's story and watch it become a private book. The same
 * workbench as /create (its stylesheet is shared by import): the order and its meter on the
 * left, the proof in the middle (transcript arriving, facts lighting up with the second they were
 * said, then plates painting), the press log in the margin.
 */
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { Cover } from "@/components/book/Cover";
import { FrontispieceSection, Log, Masthead, Meter, Plates, Problem, Steps, WhatYouGet, usd, useJobStream, workbenchStyles as s, type StepInfo } from "@/components/shared/workbench";
import type { FamilyInfo, FamilyJob, FamilyStepId } from "@/pipeline/family/types";
import { Privacy } from "./Privacy";
import { Recorder } from "./Recorder";
import { Recording, clockOf } from "./Recording";
import f from "./family.module.css";

const STEPS: StepInfo<FamilyStepId>[] = [
  { id: "transcribe", name: "Transcribe", model: "Muse Voice Transcribe", does: "writes the recording down, turn by turn, with the time each was said" },
  { id: "facts", name: "Dated facts", model: "Muse Spark", does: "finds the dated moments of the life, each quoting the recording" },
  { id: "storyboard", name: "Storyboard", model: "Muse Spark", does: "turns the facts into seven scenes, then checks every caption against the recording" },
  { id: "plates", name: "Plates", model: "Muse Image", does: "paints each scene in its decade’s print style" },
  { id: "cutouts", name: "Cut-outs", model: "SAM 3.1 + Muse Image", does: "lifts the subject off each plate and repaints what was behind it" },
  { id: "frontispiece", name: "Frontispiece", model: "SAM 3.1 (+ Muse Image)", does: "a family photo traced in pen lines, or an emblem of the life" },
  { id: "films", name: "Films", model: "this server, no API calls", does: "renders the scroll films" },
];

const since = (from: string, at: string) => clockOf((Date.parse(at) - Date.parse(from)) / 1000);
const keyName = (slug: string) => `lim-family-key:${slug}`;

export function FamilyMasthead() {
  return (
    <Masthead>
      <Link href="/#shelf">The shelf</Link>
      <Link href="/create">Make a new life</Link>
      <Link href="/family" aria-current="page">
        Your family’s story
      </Link>
    </Masthead>
  );
}

export function FamilyBench({ initial }: { initial: FamilyInfo }) {
  const [info, setInfo] = useState(initial);
  const [key, setKey] = useState<string | null>(null);
  const { job, setJob, budget, link, now, follow } = useJobStream<FamilyJob>("/api/family", initial.job, initial.budget, (slug) => setKey(localStorage.getItem(keyName(slug))));
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [another, setAnother] = useState(false);
  const [audio, setAudio] = useState<File | null>(null);
  const [mode, setMode] = useState<"record" | "file">("record");
  const [photos, setPhotos] = useState<string[]>([]);
  const chosenUrl = useMemo(() => (audio && mode === "file" ? URL.createObjectURL(audio) : null), [audio, mode]);

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
        <FamilyMasthead />
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
          <WhatYouGet
            lede="A private book of seven illustrated scenes from their own words, each painted in the print style of its decade, with notes that play the moment each fact was said."
            sample={info.sample}
            caption={info.sample && (
              <>
                The plates of <Link href={`/${info.sample.slug}`}>{info.sample.name}’s book</Link>, from {info.sample.label.toLowerCase()}.
              </>
            )}
            steps={STEPS}
            estimate={info.estimate}
            foot="No subject check is needed for a private person, but the storyboard still keeps politics and war out of the pictures."
          />
        </div>
      </div>
    );

  const running = job.status === "running";
  const canRead = job.scenes.some((x) => x.plate);
  return (
    <div className={s.page}>
      <FamilyMasthead />
      <div className={s.bench}>
        <aside className={s.ticket} aria-label="Order and progress">
          <div className={s.order}>
            <p className={s.orderLabel} data-live={running || undefined}>
              {running ? (job.mock ? "Replaying the sample" : "Making their book") : job.status === "done" ? "Finished" : "Stopped"}
            </p>
            <h1 className={s.orderName}>{job.name}</h1>
            {job.sample ? <p className={s.orderHint}>A fictional sample recording, voiced by a computer.</p> : job.hint && <p className={s.orderHint}>{job.hint}</p>}
          </div>
          <Steps steps={STEPS} job={job} est={info.estimate} now={now} />
          <Meter
            job={job}
            words={{ mock: "The real run cost", live: "This book so far", unit: "book" }}
            note={`${job.mock ? "Replay: nothing is charged. " : ""}Today’s new books ${usd(budget.today)} of ${usd(budget.dailyCap)}.`}
          />
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

            <Plates job={job} />

            {job.frontispiece && (
              <FrontispieceSection
                job={job}
                kind={job.frontispiece.kind === "emblem" ? "an emblem by Muse Image, SAM 3.1 mask, traced in pen lines" : "a family photo, SAM 3.1 person mask, traced in pen lines"}
                alt={job.frontispiece.kind === "emblem" ? "The emblem Muse Image painted" : "The family photo"}
                caption={job.frontispiece.kind === "photo" ? "Family photo, with consent" : "Muse Image"}
              />
            )}
          </article>
        </main>
        <aside className={s.margin} aria-label="What the models are doing">
          <Log job={job} clock={since} />
        </aside>
      </div>
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
