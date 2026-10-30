"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Story } from "@/lib/schema";
import { eraFor, eraVars, type Era } from "@/lib/eras";
import { Endpaper, Page, bookStyles as b } from "./book/Page";
import { Cover, clothFor } from "./book/Cover";
import { PART, roman } from "./book/pagination";
import { LineDrawing } from "./LineDrawing";
import { LayerStack, SceneArt, sceneDuration } from "./SceneArt";
import { easeInOut, useTimeline } from "./useTimeline";
import s from "./StoryPlayer.module.css";

/**
 * The life is a book you read a page at a time. Spreads, in order: the closed cover, the
 * endpapers, frontispiece and title page, one spread per scene (text on the verso, the plate
 * on the recto), the notes, the back endpapers and the closed back cover. One wheel flick,
 * key press or swipe turns one leaf; the rail riffles to a chapter. After the notes of every
 * life but the last, turning on closes this book, slides it aside, brings in the next life's
 * book and opens it at its title page, and only then does the route change.
 *
 * The stage is laid out once at DESIGN_W × DESIGN_H and scaled to fit the window, so the
 * page and its type keep their proportions at every window size.
 */

type Kind = "cover" | "endpapers" | "title" | "chapter" | "notes" | "endpapersBack" | "closed";

const TITLE = 2;
const FIRST_CHAPTER = 3;

/** One leaf's turn, and how much longer each extra leaf of a riffle adds. */
const TURN_MS = 820;
const RIFFLE_MS = 150;
const RIFFLE_MAX = 1700;
/** Wheel travel (px) that commits a turn; below it the leaf only peeks. */
const COMMIT_PX = 40;
/** How far, in leaves, a peek lifts the page (0.1 ≈ 18°). */
const PEEK = 0.1;
/** A wheel pause this long ends a gesture: a peek springs back, inertia stops being swallowed. */
const GESTURE_GAP = 170;

/** The book change, in ms from its start. */
const SEQ = { close: 760, outStart: 640, outEnd: 1380, inStart: 1080, inEnd: 1860, openStart: 1880, end: 2860 };

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));

/** "1950s offset lithograph poster, flat inks…" → "1950s offset lithograph poster". */
const technique = (year: string) => eraFor(year).print.split(",")[0];
const part = (i: number) => `Part ${PART[i] ?? i + 1}`;

/** Everything a book needs about one life; the next life's comes along so its book can open here. */
export interface Life {
  story: Story;
  lifespan: string;
  portrait?: string;
  credit: string;
  /** 0-based position in the anthology. */
  part: number;
  /** Page number of the frontispiece; folios count on from it. */
  firstPage: number;
}

function plan(n: number) {
  const kinds: Kind[] = ["cover", "endpapers", "title", ...Array<Kind>(n).fill("chapter"), "notes", "endpapersBack", "closed"];
  return { kinds, NOTES: FIRST_CHAPTER + n, CLOSED: kinds.length - 1 };
}

/** The era a spread is printed in; the desk takes its colour. */
function eraAt(story: Story, spread: number): Era {
  const j = spread - FIRST_CHAPTER;
  return eraFor(story.scenes[j >= 0 && j < story.scenes.length ? j : 0].year);
}

/**
 * The spreads playing their entrance: when it starts (performance.now()) for the JS clocks, and
 * the same moment as a delay from when the entry was made, for the CSS animations.
 */
type Plays = Record<number, { start: number; delay: number }>;
const playAt = (start: number) => ({ start, delay: Math.round(start - performance.now()) });

/**
 * A life handed over by the previous life's book change: the title spread's entrance started
 * there, and carries on here from the same moment.
 */
let handoff: { slug: string; start: number } | null = null;

// ---------- The book ----------

function Frontispiece({ name, portrait, credit, plate, start }: { name: string; portrait?: string; credit: string; plate?: string; start: number | null }) {
  const t = useTimeline(start, 2600);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3);
  return (
    <figure className={s.frontis}>
      <div className={s.frontisArt}>
        <LineDrawing
          src={portrait}
          progress={t}
          label={`${name}, drawn in pen strokes`}
          fallback={
            plate ? (
              <img className={s.frontisPlate} src={plate} alt="" />
            ) : (
              <span className={s.monogram} aria-hidden>
                {initials}
              </span>
            )
          }
        />
      </div>
      <figcaption>
        <i>{name}</i>
        {credit ? `, drawn stroke by stroke. ${credit}` : "."}
      </figcaption>
    </figure>
  );
}

function TitlePage({ partNo, name, lifespan, tagline, main }: { partNo: number; name: string; lifespan: string; tagline: string; main: boolean }) {
  const Name = main ? "h1" : "p";
  return (
    <div className={s.titlePage}>
      <p className={s.titlePart}>{part(partNo)}</p>
      <Name className={s.titleName}>{name}</Name>
      <p className={s.titleDates}>{lifespan}</p>
      <span className={s.titleRule} aria-hidden />
      <p className={s.titleTag}>{tagline}</p>
      <p className={s.titleImprint}>
        <span>Lives in Motion</span>
        Singapore
      </p>
    </div>
  );
}

/** The plate's art, on its own clock so only it re-renders while its entrance plays. */
function Plate({ scene, start, shown, layers }: { scene: Story["scenes"][number]; start: number | null; shown: boolean; layers: boolean }) {
  const t = useTimeline(start, sceneDuration(scene));
  return (
    <>
      <SceneArt scene={scene} active={shown && !layers} progress={t} />
      <LayerStack scene={scene} open={layers} />
    </>
  );
}

/** Step a text block's type down (via --fit) until it fits its box; a guard for long captions. */
function useFit<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let f = 1;
      el.style.setProperty("--fit", "1");
      while (el.scrollHeight > el.clientHeight + 1 && f > 0.7) {
        f -= 0.04;
        el.style.setProperty("--fit", f.toFixed(2));
      }
    };
    fit();
    document.fonts?.ready.then(fit);
  }, []);
  return ref;
}

function ChapterText({ scene, j, era, onNote }: { scene: Story["scenes"][number]; j: number; era: Era; onNote: () => void }) {
  const ref = useFit<HTMLDivElement>();
  return (
    <div className={s.chapter} ref={ref}>
      <p className={s.chapterNo}>Chapter {roman(j + 1)}</p>
      <p className={s.year}>{scene.year}</p>
      <p className={s.eraName}>{era.label}</p>
      <h2 className={s.title}>{scene.title}</h2>
      <p className={s.caption}>
        {scene.caption}
        <sup className={s.ref}>
          <button type="button" onClick={onNote} aria-label={`Note ${j + 1}: sources, in the notes at the end`}>
            {j + 1}
          </button>
        </sup>
      </p>
    </div>
  );
}

function Notes({ story, folio }: { story: Story; folio: (o: number) => number }) {
  const ref = useFit<HTMLDivElement>();
  return (
    <div className={s.notesPage} ref={ref}>
      <h2>Notes</h2>
      <ol>
        {story.scenes.map((sc, j) => (
          <li key={sc.id} id={`note-${j + 1}`}>
            <span className={s.noteNo}>{j + 1}</span>
            <p>
              <i>
                Chapter {roman(j + 1)}, p. {folio(2 + 2 * j)}.
              </i>{" "}
              {sc.title} ({sc.year}).{" "}
              {sc.sources.map((src, k) => (
                <span key={src.url}>
                  {k > 0 && "; "}
                  <a href={src.url} target="_blank" rel="noopener noreferrer">
                    {src.label}
                  </a>
                </span>
              ))}
              .
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Book({
  life,
  totalPages,
  last,
  pos,
  closing,
  plays,
  rail,
  main = true,
  layersAt = null,
  onLayers,
  onGo,
}: {
  life: Life;
  totalPages: number;
  /** The last life: its back cover carries the way back to the shelf. */
  last: boolean;
  /** Where the reader is, in spreads; between two whole numbers a leaf is turning. */
  pos: number;
  /** The book change: the rest of the pages and the back board swing over together (0 → 1). */
  closing?: number;
  plays: Plays;
  /** The chapter the ribbon marks, or null to hide the rail. */
  rail: number | null;
  /** The page's own book (its title is the h1; its cover can fly in from the shelf). */
  main?: boolean;
  /** The spread whose plate is taken apart into its layers, if any. */
  layersAt?: number | null;
  onLayers?: () => void;
  onGo: (spread: number) => void;
}) {
  const { story, firstPage, part: partNo } = life;
  const scenes = story.scenes;
  const n = scenes.length;
  const { kinds, NOTES, CLOSED } = plan(n);
  const leaves = kinds.length - 1;
  const backLeaf = leaves - 1;

  /** How far leaf k has turned, 0 (lying right) to 1 (lying left). */
  const turns = Array.from({ length: leaves }, (_, k) => (closing != null && k >= NOTES ? closing : clamp(pos - k)));
  const open = turns[0];
  const shut = turns[backLeaf];
  const closed = open === 0;

  const folio = (offset: number) => firstPage + offset;
  const lastPage = Math.min(totalPages, firstPage + 2 * n + 4);
  const folioOf = (i: number) =>
    ({
      cover: firstPage - 2,
      endpapers: firstPage - 1,
      title: firstPage,
      chapter: firstPage + 2 + 2 * (i - FIRST_CHAPTER),
      notes: firstPage + 2 * n + 2,
      endpapersBack: lastPage,
      closed: lastPage,
    })[kinds[i]];
  const at = Math.floor(clamp(pos, 0, CLOSED));
  const read = clamp((folioOf(at) + (folioOf(Math.min(CLOSED, at + 1)) - folioOf(at)) * (pos - at)) / totalPages);

  const years = scenes.map((sc) => sc.year);
  const first = eraFor(scenes[0].year);
  const playOf = (spread: number) => plays[spread]?.start ?? null;
  /** A face playing its spread's entrance: the class starts the CSS choreography, delayed to its start time. */
  const faceProps = (spread: number, style?: CSSProperties) => {
    const p = plays[spread];
    return {
      className: p ? s.play : "",
      style: (p ? { ...style, ["--delay" as string]: `${p.delay}ms` } : style) as CSSProperties,
    };
  };
  const near = (j: number) => Math.abs(FIRST_CHAPTER + j - pos) < 1.6 || plays[FIRST_CHAPTER + j] != null;

  const plateFace = (j: number) => {
    const sc = scenes[j];
    const sp = FIRST_CHAPTER + j;
    const shows = turns[sp - 1] > 0 && turns[sp] < 0.5;
    return (
      <Page key="f" side="recto" head={sc.title} folio={folio(3 + 2 * j)} {...faceProps(sp, eraVars(eraFor(sc.year)) as CSSProperties)}>
        <figure className={s.plateFig}>
          <div className={s.plateMark}>
            <div className={s.plate} data-layers={layersAt === sp || undefined}>{near(j) && <Plate scene={sc} start={playOf(sp)} shown={shows} layers={layersAt === sp} />}</div>
          </div>
          <figcaption>
            <span>
              <span className={s.plateNo}>Plate {roman(j + 1)}</span>
              {sc.plate
                ? `${sc.year}, in the manner of a ${technique(sc.year)}. Painted with Muse Image.`
                : `${sc.year}. The illustration is still being made.`}
            </span>
            {sc.plate && onLayers && (
              <button type="button" className={s.layersBtn} aria-pressed={layersAt === sp} onClick={onLayers} title="Take the plate apart (L)">
                {layersAt === sp ? "Put it back together" : "Layers"}
              </button>
            )}
          </figcaption>
        </figure>
      </Page>
    );
  };

  const chapterFace = (j: number) => {
    const sc = scenes[j];
    const e = eraFor(sc.year);
    return (
      <Page key="b" side="verso" head={story.name} folio={folio(2 + 2 * j)} {...faceProps(FIRST_CHAPTER + j, eraVars(e) as CSSProperties)}>
        <ChapterText scene={sc} j={j} era={e} onNote={() => onGo(NOTES)} />
      </Page>
    );
  };

  const creditsFace = (
    <Page key="f" side="recto" head="Notes" folio={folio(2 * n + 3)} {...faceProps(NOTES, eraVars(first) as CSSProperties)}>
      <div className={s.creditsPage}>
        <h2>On the pictures</h2>
        <p>
          The research and every caption’s sources come from Meta Muse Spark with web search. The plates are painted with Meta Muse Image in
          the print style of each scene’s decade, and cut into layers with SAM 3.1. People appear as silhouettes or from behind, by design.
        </p>
        {life.credit && <p>The frontispiece is traced from a photograph. {life.credit}</p>}
        <p className={s.finis} aria-hidden>
          ⁂
        </p>
        <p className={s.overleaf}>{last ? "Turn the page to close the book." : `Turn the page for ${part(partNo + 1)}.`}</p>
      </div>
    </Page>
  );

  /** Front and back face of leaf k. */
  const faces = (k: number): [ReactNode, ReactNode] => {
    if (k === 0)
      return [
        <Cover
          key="f"
          slug={story.slug}
          name={story.name}
          lifespan={life.lifespan}
          part={part(partNo)}
          lift={main && closed}
          className={closed ? s.coverLanded : ""}
        />,
        <div key="b" className={s.pastedown}>
          <div className={s.pastedownPaper}>
            <Endpaper years={years} />
          </div>
        </div>,
      ];
    if (k === 1)
      return [
        <Page key="f" side="recto">
          <Endpaper years={years} />
        </Page>,
        <Page key="b" side="verso" {...faceProps(TITLE)}>
          <Frontispiece name={story.name} portrait={life.portrait} credit={life.credit} plate={scenes[0].plate} start={playOf(TITLE)} />
        </Page>,
      ];
    if (k === TITLE)
      return [
        <Page key="f" side="recto" {...faceProps(TITLE)}>
          <TitlePage partNo={partNo} name={story.name} lifespan={life.lifespan} tagline={story.tagline} main={main} />
        </Page>,
        chapterFace(0),
      ];
    if (k < NOTES - 1) return [plateFace(k - FIRST_CHAPTER), chapterFace(k - FIRST_CHAPTER + 1)];
    if (k === NOTES - 1)
      return [
        plateFace(n - 1),
        <Page key="b" side="verso" head={story.name} folio={folio(2 * n + 2)} {...faceProps(NOTES, eraVars(first) as CSSProperties)}>
          <Notes story={story} folio={folio} />
        </Page>,
      ];
    if (k === NOTES)
      return [
        creditsFace,
        <Page key="b" side="verso">
          <Endpaper years={years} />
        </Page>,
      ];
    // The back board: its pastedown, then the back cover once it has closed over the book.
    return [
      <div key="f" className={`${s.pastedown} ${s.pastedownBack}`}>
        <div className={s.pastedownPaper}>
          <Endpaper years={years} />
        </div>
      </div>,
      <div key="b" className={`${b.cover} ${s.backCover}`}>
        <div className={s.backInner}>
          <p className={b.coverSeries}>Lives in Motion</p>
          <p className={s.blurb}>Singaporean lives, told decade by decade. Every scene is sourced; every picture is made with Meta’s AI.</p>
          {last && (
            <>
              <span className={s.backRule} aria-hidden />
              <Link href="/#shelf" className={s.backLink}>
                Back to the shelf
              </Link>
              <Link href="/create" className={s.backLink}>
                Make a new life
              </Link>
            </>
          )}
        </div>
      </div>,
    ];
  };

  // Only the pages that can be seen are painted: the top two of each pile.
  const topLeft = turns.findLastIndex((t) => t >= 0.5);
  const topRight = turns.findIndex((t) => t < 0.5);

  const bookVars = {
    ["--bl" as string]: `${2 + 10 * read}px`,
    ["--br" as string]: `${2 + 10 * (1 - read)}px`,
    ["--cloth" as string]: clothFor(first, partNo),
    // Shut, the closed board sits centred; open, the spread moves a little left to make room for the ribbon.
    transform: `translateX(calc(var(--pw) * ${(0.5 * shut - 0.5 * (1 - open)).toFixed(4)} - var(--rail-room) * ${(open * (1 - shut)).toFixed(4)}))`,
  } as CSSProperties;

  return (
    <div className={b.book} style={bookVars}>
      {/* While the book is shut only the cover is drawn, so the cover can fly in from the shelf over an empty desk. */}
      <div className={b.board} style={{ visibility: shut > 0 || closed ? "hidden" : undefined }} />
      <div className={`${b.block} ${b.blockR}`} style={{ visibility: shut > 0.5 || closed ? "hidden" : undefined }} />
      <div className={`${b.block} ${b.blockL}`} style={{ opacity: open > 0.5 && shut < 0.5 ? 1 : 0 }} />

      {turns.map((t, k) => {
        const [front, back] = faces(k);
        const left = t >= 0.5;
        const board = k === 0 || k === backLeaf;
        // The cover stays: once open it is the left board.
        const hidden = k > 0 && (closed || (left ? k < topLeft - 1 : k > topRight + 1));
        const moving = t > 0 && t < 1;
        const z = left ? 10 + 2 * k : 400 - 2 * k;
        const arc = Math.sin(Math.PI * t);
        return (
          <div key={k}>
            {moving && (
              <div
                className={`${b.cast} ${left ? b.castL : b.castR}`}
                style={{
                  zIndex: z - 1,
                  opacity: arc * 0.8,
                  ["--reach" as string]: `${(left ? -1 : 1) * Math.cos(Math.PI * t) * 100 + 12}%`,
                }}
              />
            )}
            <div
              className={`${b.leaf} ${board ? s.boardLeaf : ""}`}
              data-landed={board && closed ? "" : undefined}
              style={{
                zIndex: z,
                visibility: hidden ? "hidden" : undefined,
                // The leaf lifts off the block as it turns and leans its free edge a little ahead.
                transform: moving
                  ? `perspective(3400px) translateZ(${(arc * 20).toFixed(1)}px) rotateY(${(-180 * t).toFixed(2)}deg) skewY(${(arc * (left ? 1.2 : -1.2)).toFixed(2)}deg)`
                  : `rotateY(${-180 * t}deg)`,
              }}
            >
              <div className={s.face} style={{ visibility: left ? "hidden" : undefined }}>
                {front}
                {moving && !board && (
                  <div className={b.shade} style={{ opacity: Math.min(1, t * 2), ["--glint" as string]: `${(100 - 180 * t).toFixed(1)}%` }} />
                )}
              </div>
              <div className={`${s.face} ${b.back}`} style={{ visibility: left ? undefined : "hidden" }}>
                {back}
                {moving && !board && (
                  <div
                    className={`${b.shade} ${b.back}`}
                    style={{ opacity: Math.min(1, (1 - t) * 2), ["--glint" as string]: `${(180 * (1 - t) - 80).toFixed(1)}%` }}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}

      {main && (
        <nav className={s.rail} aria-label="Chapters" data-show={rail != null || undefined}>
          <span className={s.ribbon} style={{ transform: `translateY(${(rail ?? 0) * 44}px)` }} aria-hidden />
          {scenes.map((sc, i) => (
            <button
              key={sc.id}
              className={i === rail ? s.on : ""}
              onClick={() => onGo(FIRST_CHAPTER + i)}
              aria-current={i === rail ? "page" : undefined}
              aria-label={`Chapter ${roman(i + 1)}, ${sc.year}: ${sc.title}`}
              title={sc.title}
              tabIndex={rail == null ? -1 : undefined}
            >
              {sc.year}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

// ---------- The reader ----------

export function StoryPlayer({ life, totalPages, next, arrive = false }: { life: Life; totalPages: number; next?: Life; arrive?: boolean }) {
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
    const h = handoff;
    handoff = null;
    if (arrive) {
      if (h?.slug === story.slug && !reduced.current) setPlays({ [TITLE]: playAt(h.start) });
      history.replaceState(history.state, "", `${location.pathname}#p=${TITLE}`);
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
    if (location.hash !== hash) history.replaceState(history.state, "", `${location.pathname}${location.search}${hash}`);
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
    handoff = { slug: next.story.slug, start: seq.current.t0 + SEQ.openStart + 650 };
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

  const forward = useCallback(() => {
    if (seq.current) return navigate();
    if (busy.current) return;
    if (settledRef.current >= lastSpread) {
      if (next) changeBooks();
      else goTo(lastSpread);
    } else goTo(settledRef.current + 1);
  }, [goTo, lastSpread, next, changeBooks, navigate]);
  const backward = useCallback(() => {
    if (seq.current) return navigate();
    if (busy.current) return;
    goTo(settledRef.current - 1);
  }, [goTo, navigate]);

  useEffect(() => {
    if (next && settled >= NOTES - 1) router.prefetch(`/${next.story.slug}?from=turn`);
  }, [settled, NOTES, next, router]);

  // ---------- Input: one gesture, one leaf ----------

  useEffect(() => {
    let acc = 0;
    let last = 0;
    let lastMag = 0;
    /** Swallowing the tail of a gesture that already turned a page (trackpad inertia). */
    let spent = false;
    let release = 0;

    const peek = (v: number) => {
      if (busy.current || seq.current) return;
      const base = settledRef.current;
      const room = v > 0 ? (base < lastSpread || next ? 1 : 0.25) : base > 0 ? 1 : 0.25;
      cancelAnimationFrame(anim.current);
      setPos(base + clamp(v, -1, 1) * PEEK * room);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch zoom
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * scale;
      const now = performance.now();
      const gap = now - last;
      const mag = Math.abs(d);
      last = now;
      // A gesture is over after a pause, or when the deltas jump up again (a new flick inside the inertia).
      const fresh = gap > GESTURE_GAP || (spent && mag > lastMag * 2.2 && mag > 24);
      lastMag = mag;
      if (fresh) {
        spent = false;
        acc = 0;
      }
      if (spent || busy.current) {
        spent = true;
        if (seq.current && fresh) navigate();
        return;
      }
      if (seq.current) {
        if (fresh) navigate();
        spent = true;
        return;
      }
      if (acc !== 0 && Math.sign(d) !== Math.sign(acc)) acc = 0;
      acc += d;
      clearTimeout(release);
      if (Math.abs(acc) >= COMMIT_PX) {
        spent = true;
        acc = 0;
        if (d > 0) forward();
        else backward();
        return;
      }
      peek(acc / COMMIT_PX);
      release = window.setTimeout(() => {
        acc = 0;
        if (!busy.current && !seq.current) run(settledRef.current, 240, (t) => 1 - (1 - t) ** 3);
      }, GESTURE_GAP);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable]")) return;
      const onControl = el?.closest("button, a");
      if ((e.key === "l" || e.key === "L") && !seq.current && !busy.current) {
        const j = settledRef.current - FIRST_CHAPTER;
        if (j >= 0 && j < n && story.scenes[j].plate) setLayersOpen((o) => !o);
        return;
      }
      const fwd = ["ArrowRight", "ArrowDown", "PageDown"].includes(e.key) || (e.key === " " && !e.shiftKey && !onControl);
      const back = ["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key) || (e.key === " " && e.shiftKey && !onControl);
      if (fwd || back || e.key === "Home" || e.key === "End") e.preventDefault();
      else return;
      if (e.repeat && seq.current) return;
      if (seq.current) return navigate();
      if (busy.current) return;
      if (fwd) forward();
      else if (back) backward();
      else goTo(e.key === "Home" ? 0 : lastSpread);
    };

    let touch: { x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => (touch = { x: e.touches[0].clientX, y: e.touches[0].clientY });
    const onTouchMove = (e: TouchEvent) => e.preventDefault();
    const onTouchEnd = (e: TouchEvent) => {
      if (!touch) return;
      const dx = e.changedTouches[0].clientX - touch.x;
      const dy = e.changedTouches[0].clientY - touch.y;
      touch = null;
      const d = Math.abs(dx) > Math.abs(dy) ? -dx : -dy;
      if (Math.abs(d) < 40) return;
      if (d > 0) forward();
      else backward();
    };

    // The pointer leans the plates a few pixels, deeper layers more.
    let praf = 0;
    let px = 0;
    let py = 0;
    const onPointer = (e: PointerEvent) => {
      px = (e.clientX / innerWidth) * 2 - 1;
      py = (e.clientY / innerHeight) * 2 - 1;
      praf ||= requestAnimationFrame(() => {
        praf = 0;
        stage.current?.style.setProperty("--mx", px.toFixed(3));
        stage.current?.style.setProperty("--my", py.toFixed(3));
      });
    };

    addEventListener("wheel", onWheel, { passive: false });
    addEventListener("keydown", onKey);
    addEventListener("touchstart", onTouchStart, { passive: true });
    addEventListener("touchmove", onTouchMove, { passive: false });
    addEventListener("touchend", onTouchEnd);
    addEventListener("pointermove", onPointer, { passive: true });
    return () => {
      removeEventListener("wheel", onWheel);
      removeEventListener("keydown", onKey);
      removeEventListener("touchstart", onTouchStart);
      removeEventListener("touchmove", onTouchMove);
      removeEventListener("touchend", onTouchEnd);
      removeEventListener("pointermove", onPointer);
      clearTimeout(release);
      cancelAnimationFrame(praf);
    };
  }, [forward, backward, goTo, lastSpread, next, navigate, run, n, story.scenes]);

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
  const t = seqT ?? 0;
  const closing = inSeq ? easeInOut(seg(t, 0, SEQ.close)) : undefined;
  const nextFirst = next ? eraFor(next.story.scenes[0].year) : null;
  const era = inSeq && t >= SEQ.close - 120 && nextFirst ? nextFirst : eraAt(story, target);
  const cur = target - FIRST_CHAPTER;
  const rail = !inSeq && cur >= 0 && cur < n ? cur : null;

  // The outgoing book is pushed off to the left; the next slides in from the right and settles.
  const outT = seg(t, SEQ.outStart, SEQ.outEnd);
  const out = outT ** 2;
  const inT = seg(t, SEQ.inStart, SEQ.inEnd);
  const inn = 1 - (1 - inT) ** 3;
  const nextPos = inSeq ? 2 * easeInOut(seg(t, SEQ.openStart, SEQ.end)) : 0;
  const nextPlay = useRef<Plays>({});
  if (!inSeq || t < SEQ.openStart) nextPlay.current = {};
  else if (!nextPlay.current[TITLE] && seq.current) nextPlay.current = { [TITLE]: playAt(seq.current.t0 + SEQ.openStart + 650) };
  const nextPlays = nextPlay.current;

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
          <div
            className={s.slot}
            style={
              inSeq
                ? { transform: `translate(${(-1250 * out).toFixed(1)}px, ${(70 * out).toFixed(1)}px) rotate(${(-7 * out).toFixed(2)}deg) scale(${(1 - 0.08 * out).toFixed(3)})` }
                : undefined
            }
          >
            <Book life={life} totalPages={totalPages} last={!next} pos={pos} closing={closing} plays={inSeq ? {} : plays}
              rail={rail}
              layersAt={layersOpen ? settled : null}
              onLayers={() => setLayersOpen((o) => !o)}
              onGo={goTo}
            />
          </div>
          {inSeq && next && t >= SEQ.inStart && (
            <div
              className={s.slot}
              style={{ transform: `translate(${(1250 * (1 - inn)).toFixed(1)}px, ${(-40 * (1 - inn)).toFixed(1)}px) rotate(${(6 * (1 - inn)).toFixed(2)}deg)` }}
            >
              <Book life={next} totalPages={totalPages} last={false} pos={nextPos} plays={nextPlays} rail={null} main={false} onGo={() => {}} />
            </div>
          )}

          <p className={s.cue} style={{ opacity: pos < 0.05 && !arrive ? 1 : 0 }} aria-hidden>
            Scroll, or press →, to open the book
          </p>
          {next && (
            <p className={`${s.cue} ${s.onward}`} data-show={(settled === NOTES && !inSeq) || undefined}>
              Turn the page, or{" "}
              <button type="button" onClick={changeBooks}>
                go on to {part(next.part)}: {next.story.name}
              </button>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

/** One leaf: it hesitates as it lifts, swings, and settles softly onto the pile. */
function turnEase(t: number) {
  // A cubic Bézier (0.45, 0, 0.18, 1), solved for x by Newton's method.
  const x1 = 0.45, x2 = 0.18, y1 = 0, y2 = 1;
  const bx = (u: number) => 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u * u * (1 - u) + u ** 3;
  const dbx = (u: number) => 3 * x1 * (1 - u) ** 2 + 6 * (x2 - x1) * u * (1 - u) + 3 * (1 - x2) * u * u;
  let u = t;
  for (let i = 0; i < 6; i++) {
    const d = dbx(u);
    if (Math.abs(d) < 1e-6) break;
    u = clamp(u - (bx(u) - t) / d);
  }
  return 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u * u * (1 - u) + u ** 3;
}
