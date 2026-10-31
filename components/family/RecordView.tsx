"use client";

/**
 * A family book's recording page (/family/<slug>, and /family/<slug>/audio#t=<s>, where the
 * book's notes link). The player opens at the cited moment, the facts and transcript sit beside
 * it, and the maker's browser (or the private link) can delete the whole book.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { workbenchStyles as s } from "@/components/shared/workbench";
import type { FamilyFact, FamilyTurn } from "@/pipeline/family/types";
import { FamilyMasthead } from "./FamilyBench";
import { Privacy } from "./Privacy";
import { Recording, clockOf, turnAt } from "./Recording";
import f from "./family.module.css";

export interface RecordProps {
  slug: string;
  name: string;
  tagline?: string;
  label?: string;
  sample: boolean;
  audio: string;
  seconds: number;
  turns: FamilyTurn[];
  facts: FamilyFact[];
  subject?: string;
  hasBook: boolean;
  untimed: boolean;
  model: string;
}

export function RecordView(p: RecordProps) {
  const [key, setKey] = useState<string | null>(null);
  const [cited, setCited] = useState<{ sec: number; fact?: FamilyFact } | null>(null);
  const [armed, setArmed] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("key");
    if (q) {
      localStorage.setItem(`lim-family-key:${p.slug}`, q);
      // Keep the key out of the address bar (and out of anything shared from it).
      history.replaceState(null, "", location.pathname + location.hash);
    }
    setKey(q ?? localStorage.getItem(`lim-family-key:${p.slug}`));
    const read = () => {
      const m = location.hash.match(/t=(\d+)/);
      if (!m) return setCited(null);
      const sec = Number(m[1]);
      const turn = turnAt(p.turns, sec);
      setCited({ sec, fact: p.facts.find((x) => x.turn === turn?.n) });
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [p.slug, p.turns, p.facts]);

  const del = async () => {
    if (!armed) return setArmed(true);
    setError(null);
    const r = await fetch(`/api/family/${p.slug}`, { method: "DELETE", headers: { "x-family-key": key ?? "" } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error ?? `The server answered ${r.status}.`);
    localStorage.removeItem(`lim-family-key:${p.slug}`);
    setGone(true);
  };

  if (gone)
    return (
      <div className={s.page}>
        <FamilyMasthead />
        <div className={f.record}>
          <h1 className={f.recordName}>Deleted</h1>
          <p className={s.formLede}>{p.name}’s book, the recording, its transcript and every picture made from them have been removed from this server.</p>
          <Link className={s.readBtn} href="/family" style={{ justifySelf: "start" }}>
            Back to Your family’s story
          </Link>
        </div>
      </div>
    );

  return (
    <div className={s.page}>
      <FamilyMasthead />
      <div className={f.record}>
        <header className={f.recordHead}>
          <div>
            <p className={f.recordKicker}>{p.sample ? p.label : "A private family book · the recording"}</p>
            <h1 className={f.recordName}>{p.name}</h1>
            {p.tagline && <p className={s.tagline}>{p.tagline}</p>}
          </div>
          <div className={f.recordActions}>
            {p.hasBook && (
              <Link className={s.readBtn} href={`/${p.slug}`}>
                Read the book
              </Link>
            )}
            <span className={s.eta}>
              {clockOf(p.seconds)} recording · {p.turns.length} turns · {p.facts.length} cited facts
            </span>
          </div>
        </header>
        {cited && (
          <p className={f.cited} role="status">
            Cited in the book: the moment at <b>{clockOf(cited.sec)}</b>
            {cited.fact ? <> — “{cited.fact.quote}”</> : null}. Press play if it hasn’t started.
          </p>
        )}
        {p.untimed && <p className={s.hint}>Muse Voice Transcribe returned no timestamps for this recording, so the book cites transcript line numbers instead.</p>}
        <div className={f.recordSheet}>
          <Recording audio={p.audio} turns={p.turns} facts={p.facts} name={p.name} subject={p.subject} followHash />
        </div>
        <div className={f.recordFoot}>
          <Privacy />
          <section className={f.danger} aria-labelledby="delete">
            <h3 id="delete">Delete this book</h3>
            {p.sample ? (
              <p>This is the site’s fictional sample, so it stays. A family’s own book has a delete button here.</p>
            ) : key ? (
              <>
                <p>Removes the book, the recording, the transcript and every picture from this server. It can’t be undone.</p>
                <button type="button" className={f.deleteBtn} data-armed={armed || undefined} onClick={del}>
                  {armed ? "Yes, delete it all" : "Delete the book and its recording"}
                </button>
                {armed && (
                  <button type="button" className={s.quiet} onClick={() => setArmed(false)}>
                    Keep it
                  </button>
                )}
              </>
            ) : (
              <p>Only the browser that made this book, or its private delete link, can delete it.</p>
            )}
            {error && <p className={s.error}>{error}</p>}
          </section>
        </div>
        <p className={s.hint}>Transcribed by {p.model}; the facts and the book were made with Muse Spark, Muse Image and SAM 3.1.</p>
      </div>
    </div>
  );
}
