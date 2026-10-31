"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Story } from "@/lib/schema";
import { eraFor, eraVars } from "@/lib/eras";
import { Book } from "./Book";
import { SEQ, TITLE_ENTRANCE, bookChangeAt } from "./bookChange";
import type { Direction } from "./Direction";
import { bookStyles as b } from "./Page";
import { FIRST_CHAPTER, TITLE, eraAt, plan } from "./pagination";
import { RIFFLE_MAX, RIFFLE_MS, TURN_MS, clamp, handoff, playAt, turnEase, wheel, type Plays } from "./paging";
import { usePageInput } from "./usePageInput";
import { easeInOut } from "./useTimeline";
import s from "./StoryPlayer.module.css";

/**
 * The life is a book you read a page at a time (spreads: pagination.ts). One wheel flick, key
 * press or swipe turns one leaf (usePageInput.ts); the rail riffles to a chapter. After the
 * notes of every life but the last, turning on closes this book, slides it aside, brings in the
 * next life's book and opens it at its title page (bookChange.ts), and only then does the route
 * change. The stage is laid out once at a fixed design size and scaled to fit the window
 * (StoryPlayer.module.css), so the page and its type keep their proportions at every size.
 */

/** Everything a book needs about one life; the next life's comes along so its book can open here. */
export interface Life {
  story: Story;
  lifespan: string;
  portrait?: string;
  credit: string;
  /** The frontispiece is traced from a hand-curated, credited photograph (not one the life's maker supplied, or an emblem). */
  curated: boolean;
  /** 0-based position in the reading order (neighbouring books alternate their cloth). */
  index: number;
  /** What Muse Wonder did for each scene's film, by scene id. */
  directions?: Record<string, Direction>;
}

export function StoryPlayer({ life, next, arrive = false }: { life: Life; next?: Life; arrive?: boolean }) {
  const router = useRouter();
  const { story } = life;
  const n = story.scenes.length;
  const { NOTES, CLOSED } = plan(n);
  /** The last spread a reader can turn to; for every life but the last, turning past the notes changes books. */
  const lastSpread = next ? NOTES : CLOSED;

  const [pos, setPos] = useState(arrive ? TITLE : 0);
  /** The spread being turned to (the ribbon and the desk follow it at once) and the one last at rest. */
  const [target, setTarget] = useState(arrive ? TITLE : 0);
  const [settled, setSettled] = useState(arrive ? TITLE : 0);
  const [plays, setPlays] = useState<Plays>({});
  /** The book change, ms since it started; null when not changing. */
  const [seqT, setSeqT] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  /** The plate taken apart into its layers (only ever the spread at rest). */
  const [layersOpen, setLayersOpen] = useState(false);

  const reduced = useRef(false);
  const posRef = useRef(pos);
  posRef.current = pos;
  const settledRef = useRef(settled);
  settledRef.current = settled;
  const anim = useRef(0);
  const busy = useRef(false);
  const seq = useRef<{ t0: number; raf: number; done: boolean } | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    reduced.current = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Opened by the previous life's book change: its title spread's entrance is already under way.
    const h = handoff.to;
    handoff.to = null;
    if (arrive) {
      if (h?.slug === story.slug && !reduced.current) setPlays({ [TITLE]: playAt(h.start) });
      history.replaceState(null, "", `${location.pathname}#p=${TITLE}`);
    } else {
      // Back, forward and refresh reopen the book at the spread it was left at.
      const m = /p=(\d+)/.exec(location.hash);
      if (m) {
        const sp = clamp(Number(m[1]), 0, lastSpread);
        setPos(sp);
        setTarget(sp);
        setSettled(sp);
      }
    }
    setReady(true);
    // Only on the first paint of this life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL on the spread at rest, so Back and refresh come back to it.
  useEffect(() => {
    if (seqT != null) return;
    const hash = settled > 0 ? `#p=${settled}` : "";
    if (location.hash !== hash) history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
  }, [settled, seqT]);

  /** Animate `pos` to `to` over `ms`; `ease` shapes the whole run. */
  const run = useCallback((to: number, ms: number, ease: (t: number) => number, done?: () => void) => {
    cancelAnimationFrame(anim.current);
    const from = posRef.current;
    if (ms <= 0 || from === to) {
      setPos(to);
      done?.();
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = clamp((now - t0) / ms);
      setPos(from + (to - from) * ease(t));
      if (t < 1) anim.current = requestAnimationFrame(step);
      else done?.();
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  /** Turn to spread `to`: one leaf, or a riffle through several. */
  const goTo = useCallback(
    (to: number) => {
      to = clamp(to, 0, lastSpread);
      const from = settledRef.current;
      if (to === from) {
        run(to, 220, (t) => 1 - (1 - t) ** 2);
        return;
      }
      setLayersOpen(false);
      const leaves = Math.abs(to - from);
      const ms = reduced.current ? 0 : Math.min(RIFFLE_MAX, TURN_MS + RIFFLE_MS * (leaves - 1));
      busy.current = true;
      setTarget(to);
      // The new spread's entrance starts as the last leaf passes upright.
      const start = performance.now() + Math.max(0, ms - (ms / leaves) * 0.55);
      setPlays(reduced.current ? {} : { [from]: playAt(performance.now() - 1e5), [to]: playAt(start) });
      run(to, ms, leaves > 1 ? easeInOut : turnEase, () => {
        busy.current = false;
        wheel.landed = performance.now();
        setSettled(to);
        setPlays((p) => (p[to] != null ? { [to]: p[to] } : {}));
      });
    },
    [lastSpread, run],
  );

  // ---------- The book change ----------

  const navigate = useCallback(() => {
    if (!next || !seq.current || seq.current.done) return;
    seq.current.done = true;
    cancelAnimationFrame(seq.current.raf);
    setSeqT(SEQ.end);
    handoff.to = { slug: next.story.slug, start: seq.current.t0 + TITLE_ENTRANCE };
    // The rest of a flick that skipped here, and the route change itself, must not turn the new page.
    wheel.spent = true;
    wheel.quietUntil = performance.now() + 450;
    router.push(`/${next.story.slug}?from=turn`, { scroll: false });
  }, [next, router]);

  const changeBooks = useCallback(() => {
    if (!next || seq.current) return;
    busy.current = true;
    setLayersOpen(false);
    router.prefetch(`/${next.story.slug}?from=turn`);
    const t0 = performance.now();
    seq.current = { t0, raf: 0, done: false };
    if (reduced.current) {
      seq.current.t0 = t0 - SEQ.end;
      navigate();
      return;
    }
    const tick = (now: number) => {
      if (!seq.current || seq.current.done) return;
      const t = now - t0;
      setSeqT(Math.min(t, SEQ.end));
      if (t >= SEQ.end) navigate();
      else seq.current.raf = requestAnimationFrame(tick);
    };
    seq.current.raf = requestAnimationFrame(tick);
  }, [next, navigate, router]);
  useEffect(() => () => cancelAnimationFrame(seq.current?.raf ?? 0), []);

  // Input during the book change is dropped: the change always plays through, so nothing is skipped.
  const forward = useCallback(() => {
    if (seq.current || busy.current) return;
    if (settledRef.current >= lastSpread) {
      if (next) changeBooks();
      else goTo(lastSpread);
    } else goTo(settledRef.current + 1);
  }, [goTo, lastSpread, next, changeBooks]);
  const backward = useCallback(() => {
    if (seq.current || busy.current) return;
    goTo(settledRef.current - 1);
  }, [goTo]);

  useEffect(() => {
    if (next && settled >= NOTES - 1) router.prefetch(`/${next.story.slug}?from=turn`);
  }, [settled, NOTES, next, router]);

  // ---------- Input ----------

  const changing = useCallback(() => seq.current != null, []);
  const toggleLayers = useCallback((open?: boolean) => setLayersOpen((o) => open ?? !o), []);
  const hasPlate = useCallback(
    (spread: number) => {
      const j = spread - FIRST_CHAPTER;
      return j >= 0 && j < n && Boolean(story.scenes[j].plate);
    },
    [n, story.scenes],
  );
  usePageInput({ forward, backward, goTo, run, setPos, toggleLayers, lastSpread, hasNext: Boolean(next), settled: settledRef, busy, changing, hasPlate, anim, stage });

  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  // A #p= link (or the reader editing the hash) turns to that spread.
  useEffect(() => {
    const onHash = () => {
      const m = /p=(\d+)/.exec(location.hash);
      if (m && !busy.current && !seq.current) goTo(Number(m[1]));
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [goTo]);

  // ---------- Render ----------

  const inSeq = seqT != null && next != null;
  const change = inSeq ? bookChangeAt(seqT) : null;
  const era = change?.nextEra && next ? eraFor(next.story.scenes[0].year) : eraAt(story, target);
  const cur = target - FIRST_CHAPTER;
  const rail = !inSeq && cur >= 0 && cur < n ? cur : null;
  // The next book's title spread plays its entrance from the moment its cover starts to open.
  const nextPlay = useRef<Plays>({});
  if (!change?.opening) nextPlay.current = {};
  else if (!nextPlay.current[TITLE] && seq.current) nextPlay.current = { [TITLE]: playAt(seq.current.t0 + TITLE_ENTRANCE) };

  return (
    <main className={`${s.story} ${b.desk}`} style={eraVars(era) as CSSProperties} data-desk data-ready={ready || undefined}>
      {/* Targets for #p=N: until the book has opened at that spread, :target keeps the closed cover off screen. */}
      {Array.from({ length: lastSpread + 1 }, (_, i) => (
        <span key={i} id={`p=${i}`} className={s.anchor} aria-hidden />
      ))}
      <Link href="/#shelf" className={s.home}>
        Lives in Motion
      </Link>

      <div className={s.viewport}>
        <div ref={stage} className={s.stage}>
          <div className={s.slot} style={change ? { transform: change.outgoing } : undefined}>
            <Book
              life={life}
              last={!next}
              pos={pos}
              closing={change?.closing}
              plays={inSeq ? {} : plays}
              rail={rail}
              layersAt={layersOpen ? settled : null}
              onLayers={() => setLayersOpen((o) => !o)}
              onGo={goTo}
            />
          </div>
          {change?.incoming && next && (
            <div className={s.slot} style={{ transform: change.incoming }}>
              <Book life={next} last={false} pos={change.nextPos} plays={nextPlay.current} rail={null} main={false} onGo={() => {}} />
            </div>
          )}

          <p className={s.cue} style={{ opacity: pos < 0.05 && !arrive ? 1 : 0 }} aria-hidden>
            Scroll, or press →, to open the book
          </p>
          {next && (
            <p className={`${s.cue} ${s.onward}`} data-show={(settled === NOTES && !inSeq) || undefined}>
              Turn the page, or{" "}
              <button type="button" onClick={changeBooks}>
                next on the shelf: {next.story.name}
              </button>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
