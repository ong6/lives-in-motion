"use client";

/**
 * A family recording beside what was read from it: the player, the dated facts (each with the
 * moment it was said, click to hear it) and the transcript turn by turn. Used live on the
 * workbench, where turns and facts arrive as the models work, and on a book's recording page,
 * where a citation's #t=<seconds> opens the player at that moment.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FamilyFact, FamilyTurn } from "@/pipeline/family/types";
import f from "./family.module.css";

export const clockOf = (sec: number) => {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** The turn playing at a time: the last one that started at or before it. */
export const turnAt = (turns: FamilyTurn[], sec: number) => {
  let hit: FamilyTurn | undefined;
  for (const t of turns) if (t.startMs >= 0 && t.startMs < (Math.floor(sec) + 1) * 1000) hit = t;
  return hit;
};

export function Recording({
  audio,
  turns,
  facts,
  name,
  subject,
  live = false,
  followHash = false,
  waiting,
  compact = false,
}: {
  audio?: string;
  turns: FamilyTurn[];
  facts: FamilyFact[];
  name: string;
  /** Diarization label of the person whose life it is. */
  subject?: string;
  /** Arriving as the models work: new turns and facts animate in. */
  live?: boolean;
  /** Seek to the page's #t=<seconds> (or #line=<n>) on load and when it changes. */
  followHash?: boolean;
  /** What to say while there is no transcript yet. */
  waiting?: { transcript: string; facts: string };
  /** Shorter scrolling columns, so the plates below come into view once they are being painted. */
  compact?: boolean;
}) {
  const player = useRef<HTMLAudioElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<number | null>(null);
  const cited = new Set(facts.map((x) => x.turn));
  const listRef = useRef<HTMLOListElement>(null);

  const reveal = useCallback((n: number) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-turn="${n}"]`);
    const box = listRef.current;
    if (el && box) box.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
  }, []);

  const play = useCallback(
    (sec: number, n?: number) => {
      const a = player.current;
      if (n != null) {
        setActive(n);
        reveal(n);
      }
      if (!a || sec < 0) return;
      const go = () => {
        a.currentTime = sec;
        a.play().then(
          () => setBlocked(null),
          // The browser wants a click before sound: show one.
          () => setBlocked(sec),
        );
      };
      if (a.readyState >= 1) go();
      else a.addEventListener("loadedmetadata", go, { once: true });
    },
    [reveal],
  );

  // A citation link: #t=83 (seconds) or #line=12 (an untimed transcript).
  useEffect(() => {
    if (!followHash) return;
    const fromHash = () => {
      const t = location.hash.match(/t=(\d+(?:\.\d+)?)/);
      const line = location.hash.match(/line=(\d+)/);
      if (t) {
        const sec = Number(t[1]);
        play(sec, turnAt(turns, sec)?.n);
      } else if (line) {
        setActive(Number(line[1]));
        reveal(Number(line[1]));
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // Only on load and hash changes: turns are fixed on this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followHash]);

  const onTime = () => {
    const a = player.current;
    if (!a || a.paused) return;
    const t = turnAt(turns, a.currentTime);
    if (t && t.n !== active) setActive(t.n);
  };

  const who = (t: FamilyTurn) => (!t.speaker ? null : subject && t.speaker === subject ? name : subject ? "Family" : `Speaker ${t.speaker}`);
  const timed = turns.some((t) => t.startMs >= 0);

  return (
    <div className={f.recording} data-compact={compact || undefined}>
      {audio && (
        <div className={f.player}>
          <audio ref={player} src={audio} controls preload="metadata" onTimeUpdate={onTime} onPlay={() => setBlocked(null)} />
          {blocked != null && (
            <button type="button" className={f.playAt} onClick={() => play(blocked)}>
              ▶ Play from {clockOf(blocked)}
            </button>
          )}
        </div>
      )}
      <div className={f.reading}>
        <section className={f.factsSec} aria-labelledby="family-facts">
          <h3 id="family-facts" className={f.colTitle}>
            Dated facts <span>{facts.length ? `${facts.length}, each quoting the recording` : "Muse Spark"}</span>
          </h3>
          {facts.length ? (
            <ol className={f.factList} data-live={live || undefined}>
              {facts.map((x, i) => (
                <li key={x.n} className={f.fact} data-on={active === x.turn || undefined} style={{ animationDelay: live ? `${Math.min(i, 8) * 60}ms` : undefined }}>
                  <span className={f.factYear}>
                    {x.approx && <i>about </i>}
                    {x.year}
                  </span>
                  <span className={f.factBody}>
                    <span className={f.factText}>{x.text}</span>
                    <span className={f.factCite}>
                      <button type="button" className={f.stamp} onClick={() => play(x.t, x.turn)} disabled={x.t < 0 && !timed} title={x.t >= 0 ? `Play the recording from ${clockOf(x.t)}` : `Transcript line ${x.turn}`}>
                        {x.t >= 0 ? `▶ ${clockOf(x.t)}` : `line ${x.turn}`}
                      </button>
                      <q className={f.quote}>{x.quote}</q>
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={f.wait}>{waiting?.facts ?? "No facts yet."}</p>
          )}
        </section>
        <section className={f.transcriptSec} aria-labelledby="family-transcript">
          <h3 id="family-transcript" className={f.colTitle}>
            Transcript <span>{turns.length ? `Muse Voice Transcribe, ${turns.length} turns` : "Muse Voice Transcribe"}</span>
          </h3>
          {turns.length ? (
            <ol className={f.turns} ref={listRef} data-live={live || undefined}>
              {turns.map((t) => (
                <li key={t.n} data-turn={t.n} className={f.turn} data-on={active === t.n || undefined} data-cited={cited.has(t.n) || undefined} data-subject={(subject && t.speaker === subject) || undefined}>
                  <button type="button" className={f.turnAt} onClick={() => play(t.startMs / 1000, t.n)} disabled={t.startMs < 0} title={t.startMs >= 0 ? `Play from ${clockOf(t.startMs / 1000)}` : undefined}>
                    {t.startMs >= 0 ? clockOf(t.startMs / 1000) : t.n}
                  </button>
                  <p>
                    {who(t) && <span className={f.who}>{who(t)}</span>}
                    {t.text}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className={f.wait}>{waiting?.transcript ?? "No transcript yet."}</p>
          )}
        </section>
      </div>
    </div>
  );
}
