"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { Story } from "@/lib/schema";
import { eraFor, eraVars } from "@/lib/eras";
import { Endpaper, Page, Spread, bookStyles as b } from "./book/Page";
import { PART, roman } from "./book/pagination";
import { LineDrawing } from "./LineDrawing";
import { SceneArt } from "./SceneArt";
import { useScrollProgress } from "./useScrollProgress";
import s from "./StoryPlayer.module.css";

/**
 * The life is a book you read by scrolling. Spreads, in order: the closed cover, the
 * endpapers, frontispiece and title page, then one spread per scene (text on the verso,
 * the plate on the recto). Between two spreads one leaf turns over the gutter.
 *
 * Leaves (k): 0 cover | pastedown, 1 free endpaper | frontispiece, 2 title page | chapter I,
 * 3 + j plate j | chapter j + 2. The last plate is printed on the base page under them all.
 */

/** Screen heights of scroll each spread holds for: cover, endpapers, title, then each chapter. */
const HOLD = { cover: 0.7, endpapers: 0.6, title: 1.4, chapter: 1.5 };
/** Screen heights a page takes to turn, centred on the boundary between two spreads. */
const TURN = 0.6;
const FIRST_CHAPTER = 3;

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const ease = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;

function plan(n: number) {
  const holds = [HOLD.cover, HOLD.endpapers, HOLD.title, ...Array<number>(n).fill(HOLD.chapter)];
  const starts: number[] = [];
  let total = 0;
  for (const h of holds) {
    starts.push(total);
    total += h;
  }
  return { holds, starts, total };
}

/** "1950s offset lithograph poster, flat inks…" → "1950s offset lithograph poster". */
const technique = (year: string) => eraFor(year).print.split(",")[0];

export interface NextLife {
  slug: string;
  name: string;
  part: number;
  page: number;
}

export function StoryPlayer({
  story,
  lifespan,
  portrait,
  credit,
  part,
  firstPage,
  next,
}: {
  story: Story;
  lifespan: string;
  portrait: string;
  credit: string;
  /** 0-based position of this life in the anthology. */
  part: number;
  /** Page number of the frontispiece; folios count on from it. */
  firstPage: number;
  next?: NextLife;
}) {
  const track = useRef<HTMLElement>(null);
  const p = useScrollProgress(track);
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(matchMedia("(prefers-reduced-motion: reduce)").matches), []);

  const scenes = story.scenes;
  const n = scenes.length;
  const { holds, starts, total } = plan(n);
  const pos = p * total;
  const leaves = n + 2;

  /** How far leaf k has turned, 0 (lying right) to 1 (lying left). */
  const turn = (k: number) => {
    const t = clamp((pos - (starts[k] + holds[k] - TURN / 2)) / TURN);
    return reduced ? (t < 0.5 ? 0 : 1) : ease(t);
  };
  const turns = Array.from({ length: leaves }, (_, k) => turn(k));

  let spread = 0;
  for (let i = 0; i < starts.length; i++) if (pos >= starts[i]) spread = i;
  const cur = spread - FIRST_CHAPTER;
  const near = Math.max(0, cur);
  const era = eraFor(scenes[Math.max(0, cur)].year);
  const first = eraFor(scenes[0].year);
  const read = clamp(pos / total);

  /** A plate shows once the leaf above it has lifted, until its own leaf passes the gutter. */
  const plateShows = (j: number) => turns[FIRST_CHAPTER - 1 + j] > 0 && (j === n - 1 || turns[FIRST_CHAPTER + j] < 0.5);
  const sceneProgress = (j: number) => {
    const sp = FIRST_CHAPTER + j;
    return clamp((pos - (starts[sp] - TURN / 2)) / (holds[sp] + TURN));
  };
  const drawing = clamp((pos - (starts[2] - TURN / 2)) / holds[2]);

  const scrollToSpread = useCallback(
    (sp: number) => {
      const el = track.current;
      if (!el) return;
      const at = sp === 0 ? 0 : starts[sp] + holds[sp] / 2;
      scrollTo({ top: el.offsetTop + (at / total) * (el.offsetHeight - innerHeight), behavior: reduced ? "auto" : "smooth" });
    },
    [starts, holds, total, reduced],
  );

  // Arrow keys turn one page while the book is open on screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey || p >= 1) return;
      if (e.key === "ArrowRight" && spread < starts.length - 1) scrollToSpread(spread + 1);
      else if (e.key === "ArrowLeft" && spread > 0) scrollToSpread(spread - 1);
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [spread, starts.length, scrollToSpread, p]);

  const folio = (offset: number) => firstPage + offset;
  const years = scenes.map((sc) => sc.year);
  const open = turns[0];

  const plateFace = (j: number, placed = false) => {
    const sc = scenes[j];
    const shows = plateShows(j);
    return (
      <Page side="recto" placed={placed} head={sc.title} folio={folio(3 + 2 * j)} style={eraVars(eraFor(sc.year)) as CSSProperties}>
        <figure className={s.plateFig}>
          <div className={s.plate}>
            {Math.abs(j - near) <= 1 && <SceneArt scene={sc} active={shows} progress={sceneProgress(j)} />}
          </div>
          <figcaption>
            <i>Plate {roman(j + 1)}.</i>{" "}
            {sc.plate ? `${sc.year}, in the manner of a ${technique(sc.year)}.` : `${sc.year}. The illustration is still being made.`}
          </figcaption>
        </figure>
      </Page>
    );
  };

  const chapterFace = (j: number) => {
    const sc = scenes[j];
    const e = eraFor(sc.year);
    return (
      <Page side="verso" head={story.name} folio={folio(2 + 2 * j)} style={eraVars(e) as CSSProperties}>
        <div className={s.chapter}>
          <p className={s.chapterNo}>Chapter {roman(j + 1)}</p>
          <p className={s.year}>{sc.year}</p>
          <p className={s.eraName}>{e.label}</p>
          <h2 className={s.title}>{sc.title}</h2>
          <p className={s.caption}>
            {sc.caption}
            <sup className={s.ref}>
              <a href={`#note-${j + 1}`} aria-label={`Note ${j + 1}, sources`}>
                {j + 1}
              </a>
            </sup>
          </p>
        </div>
      </Page>
    );
  };

  /** Front and back face of leaf k. */
  const faces = (k: number): [React.ReactNode, React.ReactNode] => {
    if (k === 0)
      return [
        <div key="f" className={s.cover}>
          <p className={s.coverSeries}>Lives in Motion</p>
          <div className={s.coverTitle}>
            <h1>{story.name}</h1>
            <p>{lifespan}</p>
          </div>
          <p className={s.coverFoot}>Part {PART[part] ?? part + 1}</p>
        </div>,
        <div key="b" className={`${s.cover} ${s.pastedown}`}>
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
        <Page key="b" side="verso">
          <figure className={s.frontis}>
            <div className={s.frontisArt}>
              <LineDrawing src={portrait} progress={drawing} label={`${story.name}, drawn in pen strokes`} />
            </div>
            <figcaption>
              <i>{story.name}</i>, drawn stroke by stroke from a photograph. {credit}
            </figcaption>
          </figure>
        </Page>,
      ];
    if (k === 2)
      return [
        <Page key="f" side="recto">
          <div className={s.titlePage}>
            <p className={s.titlePart}>Part {PART[part] ?? part + 1}</p>
            <p className={s.titleName}>{story.name}</p>
            <p className={s.titleDates}>{lifespan}</p>
            <span className={s.titleRule} aria-hidden />
            <p className={s.titleTag}>{story.tagline}</p>
            <p className={s.titleImprint}>
              <span>Lives in Motion</span>
              Singapore
            </p>
          </div>
        </Page>,
        chapterFace(0),
      ];
    const j = k - FIRST_CHAPTER;
    return [plateFace(j), chapterFace(j + 1)];
  };

  // Only the pages that can be seen are painted: the top two of each pile.
  const topLeft = turns.findLastIndex((t) => t >= 0.5);
  const topRight = turns.findIndex((t) => t < 0.5);

  const deskVars = { ...eraVars(spread < FIRST_CHAPTER ? first : era) } as CSSProperties;
  const bookVars = {
    ["--bl" as string]: `${2 + 10 * read}px`,
    ["--br" as string]: `${2 + 10 * (1 - read)}px`,
    ["--cloth" as string]: `color-mix(in oklab, ${first.accent} 50%, ${first.ink})`,
    transform: `translateX(calc(var(--pw) * ${(-0.5 * (1 - open)).toFixed(4)}))`,
  } as CSSProperties;

  return (
    <main className={`${s.story} ${b.desk}`} style={deskVars} data-desk>
      <Link href="/#contents" className={s.home}>
        Lives in Motion
      </Link>

      <section ref={track} className={s.track} style={{ height: `${(total + 1) * 100}svh` }} data-track={n} data-total={total}>
        {starts.map((st, i) => (
          <span key={i} className={s.snap} style={{ top: `${(i === 0 ? 0 : st + holds[i] / 2) * 100}svh` }} aria-hidden />
        ))}
        <div className={s.stage}>
          <div className={b.book} style={bookVars}>
            <div className={`${b.board} ${b.boardR}`} />
            <div className={`${b.block} ${b.blockR}`} />
            <div className={`${b.block} ${b.blockL}`} style={{ opacity: open > 0.5 ? 1 : 0 }} />

            {plateFace(n - 1, true)}

            {turns.map((t, k) => {
              const [front, back] = faces(k);
              const left = t >= 0.5;
              // The cover stays: once open it is the left board.
              const hidden = k > 0 && (left ? k < topLeft - 1 : k > topRight + 1);
              const moving = t > 0 && t < 1;
              const z = left ? 10 + 2 * k : 400 - 2 * k;
              return (
                <div key={k}>
                  {moving && !left && (
                    <div className={`${b.cast} ${b.castR}`} style={{ zIndex: z - 1, opacity: Math.sin(Math.PI * t) * 0.8, ["--reach" as string]: `${Math.cos(Math.PI * t) * 100 + 12}%` }} />
                  )}
                  {moving && left && (
                    <div className={`${b.cast} ${b.castL}`} style={{ zIndex: z - 1, opacity: Math.sin(Math.PI * t) * 0.8, ["--reach" as string]: `${-Math.cos(Math.PI * t) * 100 + 12}%` }} />
                  )}
                  <div
                    className={`${b.leaf} ${k === 0 ? s.coverLeaf : ""}`}
                    style={{
                      zIndex: z,
                      visibility: hidden ? "hidden" : undefined,
                      transform: `perspective(3000px) rotateY(${(-180 * t).toFixed(2)}deg)`,
                    }}
                  >
                    <div className={s.face} style={{ visibility: left ? "hidden" : undefined }}>
                      {front}
                      {moving && <div className={b.shade} style={{ opacity: Math.min(1, t * 2) }} />}
                    </div>
                    <div className={`${s.face} ${b.back}`} style={{ visibility: left ? undefined : "hidden" }}>
                      {back}
                      {moving && <div className={`${b.shade} ${b.back}`} style={{ opacity: Math.min(1, (1 - t) * 2) }} />}
                    </div>
                  </div>
                </div>
              );
            })}

            <nav className={s.rail} aria-label="Chapters">
              <span className={s.ribbon} style={{ transform: `translateY(${near * 44}px)`, opacity: cur >= 0 ? 1 : 0 }} aria-hidden />
              {scenes.map((sc, i) => (
                <button
                  key={sc.id}
                  className={i === cur ? s.on : ""}
                  onClick={() => scrollToSpread(FIRST_CHAPTER + i)}
                  aria-current={i === cur ? "page" : undefined}
                  aria-label={`Chapter ${roman(i + 1)}, ${sc.year}: ${sc.title}`}
                  title={sc.title}
                >
                  {sc.year}
                </button>
              ))}
            </nav>
          </div>
          <p className={s.cue} style={{ opacity: 1 - open * 3 }} aria-hidden>
            Scroll to open the book
          </p>
        </div>
      </section>

      <section className={s.notes} id="notes">
        <Spread
          read={1}
          style={{ ["--cloth" as string]: `color-mix(in oklab, ${first.accent} 50%, ${first.ink})` }}
          verso={
            <Page side="verso" placed head={story.name} folio={folio(2 * n + 2)} style={eraVars(first) as CSSProperties}>
              <div className={s.notesPage}>
                <h2>Notes</h2>
                <ol>
                  {scenes.map((sc, j) => (
                    <li key={sc.id} id={`note-${j + 1}`}>
                      <span className={s.noteNo}>{j + 1}</span>
                      <p>
                        <i>Chapter {roman(j + 1)}, p. {folio(2 + 2 * j)}.</i> {sc.title} ({sc.year}).{" "}
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
            </Page>
          }
          recto={
            <Page side="recto" placed head="Notes" folio={folio(2 * n + 3)} style={eraVars(first) as CSSProperties}>
              <div className={s.creditsPage}>
                <h2>On the pictures</h2>
                <p>
                  The plates are illustrated with Meta Muse Image in the print style of each scene’s decade and cut into layers
                  with SAM 3.1. People appear as silhouettes or from behind, by design. The frontispiece is traced from a photograph.{" "}
                  {credit}
                </p>
                <p className={s.finis} aria-hidden>
                  ⁂
                </p>
                <div className={s.onward}>
                  {next && (
                    <Link href={`/${next.slug}`}>
                      <small>Continue with Part {PART[next.part] ?? next.part + 1}, p. {next.page}</small>
                      {next.name}
                    </Link>
                  )}
                  <Link href="/#contents">
                    <small>Return to the</small>
                    Contents
                  </Link>
                </div>
              </div>
            </Page>
          }
        />
      </section>
    </main>
  );
}
