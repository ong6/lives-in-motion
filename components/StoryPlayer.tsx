"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Story } from "@/lib/schema";
import { eraFor, eraVars } from "@/lib/eras";
import { Endpaper, Page, bookStyles as b } from "./book/Page";
import { Cover, clothFor } from "./book/Cover";
import { PART, roman } from "./book/pagination";
import { LineDrawing } from "./LineDrawing";
import { SceneArt } from "./SceneArt";
import { useScrollProgress } from "./useScrollProgress";
import s from "./StoryPlayer.module.css";

/**
 * The life is a book you read by scrolling. Spreads, in order: the closed cover, the
 * endpapers, frontispiece and title page, one spread per scene (text on the verso, the plate
 * on the recto), the notes, and then either the next life's frontispiece and title page (the
 * anthology goes on; scrolling past it opens the next life's page at that same spread) or,
 * for the last life, the back endpapers and the closed back cover. Between two spreads one
 * leaf turns over the gutter.
 */

type Kind = "cover" | "endpapers" | "title" | "chapter" | "notes" | "next" | "endpapersBack" | "closed";

/** Screen heights of scroll each spread holds for. */
const HOLD: Record<Kind, number> = {
  cover: 0.7,
  endpapers: 0.6,
  title: 1.4,
  chapter: 1.5,
  notes: 1.6,
  next: 1.1,
  endpapersBack: 0.6,
  closed: 1,
};
/** Screen heights a page takes to turn, centred on the boundary between two spreads. */
const TURN = 0.6;
const TITLE = 2;
const FIRST_CHAPTER = 3;

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const ease = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;

function plan(n: number, hasNext: boolean) {
  const kinds: Kind[] = [
    "cover",
    "endpapers",
    "title",
    ...Array<Kind>(n).fill("chapter"),
    "notes",
    ...(hasNext ? (["next"] as Kind[]) : (["endpapersBack", "closed"] as Kind[])),
  ];
  const holds = kinds.map((k) => HOLD[k]);
  const starts: number[] = [];
  let total = 0;
  for (const h of holds) {
    starts.push(total);
    total += h;
  }
  return { kinds, holds, starts, total };
}

/** Where a page opened at its title spread sits: the middle of that spread's hold. */
const arrival = (starts: number[], holds: number[]) => starts[TITLE] + holds[TITLE] / 2;
/** How far the frontispiece has drawn itself at `pos`; the next life's copy is drawn to the same point. */
const drawnAt = (pos: number, starts: number[], holds: number[]) => clamp((pos - (starts[TITLE] - TURN / 2)) / holds[TITLE]);

/** "1950s offset lithograph poster, flat inks…" → "1950s offset lithograph poster". */
const technique = (year: string) => eraFor(year).print.split(",")[0];
const part = (i: number) => `Part ${PART[i] ?? i + 1}`;

export interface NextLife {
  slug: string;
  name: string;
  lifespan: string;
  tagline: string;
  /** 0-based position in the anthology. */
  part: number;
  portrait?: string;
  credit: string;
  firstYear: string;
  /** Its first plate, the frontispiece when there is no line portrait. */
  plate?: string;
}

function Frontispiece({
  name,
  portrait,
  credit,
  plate,
  progress,
  loop,
}: {
  name: string;
  portrait?: string;
  credit: string;
  plate?: string;
  progress?: number;
  loop?: boolean;
}) {
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
          progress={progress}
          loop={loop}
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

function TitlePage({
  partNo,
  name,
  lifespan,
  tagline,
  main = true,
}: {
  partNo: number;
  name: string;
  lifespan: string;
  tagline: string;
  main?: boolean;
}) {
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

export function StoryPlayer({
  story,
  lifespan,
  portrait,
  credit,
  part: partNo,
  firstPage,
  totalPages,
  next,
  arrive = false,
}: {
  story: Story;
  lifespan: string;
  portrait?: string;
  credit: string;
  /** 0-based position of this life in the anthology. */
  part: number;
  /** Page number of the frontispiece; folios count on from it. */
  firstPage: number;
  /** Pages in the whole anthology, for the thickness of the page block on each side. */
  totalPages: number;
  next?: NextLife;
  /** Opened by turning the last page of the previous life: start at the title spread. */
  arrive?: boolean;
}) {
  const router = useRouter();
  const track = useRef<HTMLElement>(null);
  const scenes = story.scenes;
  const n = scenes.length;
  const { kinds, holds, starts, total } = plan(n, Boolean(next));
  const NOTES = FIRST_CHAPTER + n;
  const p = useScrollProgress(track, arrive ? arrival(starts, holds) / total : 0);
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(matchMedia("(prefers-reduced-motion: reduce)").matches), []);

  // Arriving from the previous life: be at the title spread before the first paint, then tidy the URL.
  useLayoutEffect(() => {
    if (!arrive || !track.current) return;
    const el = track.current;
    scrollTo({ top: el.offsetTop + (arrival(starts, holds) / total) * (el.offsetHeight - innerHeight), behavior: "instant" });
    history.replaceState(history.state, "", location.pathname);
    // Only on the first paint of this life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = p * total;
  const leaves = kinds.length - 1;
  const backLeaf = next ? -1 : leaves - 1;

  /** How far leaf k has turned, 0 (lying right) to 1 (lying left). */
  const turn = (k: number) => {
    const t = clamp((pos - (starts[k] + holds[k] - TURN / 2)) / TURN);
    return reduced ? (t < 0.5 ? 0 : 1) : ease(t);
  };
  const turns = Array.from({ length: leaves }, (_, k) => turn(k));

  let spread = 0;
  for (let i = 0; i < starts.length; i++) if (pos >= starts[i]) spread = i;
  const kind = kinds[spread];
  const cur = spread - FIRST_CHAPTER;
  const near = Math.min(n - 1, Math.max(0, cur));
  const first = eraFor(scenes[0].year);
  const nextEra = next ? eraFor(next.firstYear) : first;
  const era = kind === "chapter" ? eraFor(scenes[near].year) : kind === "next" ? nextEra : first;

  /** The folio open at each spread; the page block's thickness follows it through the anthology. */
  const folioOf = (k: Kind, i: number) =>
    ({
      cover: firstPage - 2,
      endpapers: firstPage - 1,
      title: firstPage,
      chapter: firstPage + 2 + 2 * (i - FIRST_CHAPTER),
      notes: firstPage + 2 * n + 2,
      next: firstPage + 2 * n + 4,
      endpapersBack: totalPages,
      closed: totalPages,
    })[k];
  const at = folioOf(kind, spread);
  const after = spread < leaves ? folioOf(kinds[spread + 1], spread + 1) : at;
  const read = clamp((at + (after - at) * (turns[spread] ?? 0)) / totalPages);

  /** A plate shows once the leaf above it has lifted, until its own leaf passes the gutter. */
  const plateShows = (j: number) => turns[FIRST_CHAPTER - 1 + j] > 0 && turns[FIRST_CHAPTER + j] < 0.5;
  const sceneProgress = (j: number) => {
    const sp = FIRST_CHAPTER + j;
    return clamp((pos - (starts[sp] - TURN / 2)) / (holds[sp] + TURN));
  };
  const drawing = drawnAt(pos, starts, holds);
  /** The next life's frontispiece reaches, at the end of this track, the point its own page opens at. */
  const nextDrawing = next
    ? clamp((pos - (starts[NOTES + 1] - TURN / 2)) / (holds[NOTES + 1] + TURN / 2)) * drawnAt(arrival(starts, holds), starts, holds)
    : 0;

  const scrollToSpread = useCallback(
    (sp: number) => {
      const el = track.current;
      if (!el) return;
      const to = sp === 0 ? 0 : starts[sp] + holds[sp] / 2;
      scrollTo({ top: el.offsetTop + (to / total) * (el.offsetHeight - innerHeight), behavior: reduced ? "auto" : "smooth" });
    },
    [starts, holds, total, reduced],
  );

  // The handoff: past the next life's title page, its own page takes over at that spread.
  const gone = useRef(false);
  const armed = useRef(false);
  const prefetched = useRef(false);
  const turnOn = useCallback(() => {
    if (!next || gone.current) return;
    gone.current = true;
    router.push(`/${next.slug}?from=turn`, { scroll: false });
  }, [next, router]);
  useEffect(() => {
    if (!next) return;
    if (spread >= NOTES && !prefetched.current) {
      prefetched.current = true;
      router.prefetch(`/${next.slug}`);
    }
    // Arm only once the reader has been above the end, so a restored scroll position (Back) can't bounce forward.
    if (p < 0.985) armed.current = true;
    else if (p >= 0.999 && armed.current) turnOn();
  }, [p, spread, NOTES, next, router, turnOn]);

  // Arrow keys turn one page while the book is on screen; past the last spread → turns to the next life.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "ArrowRight" && spread < starts.length - 1) scrollToSpread(spread + 1);
      else if (e.key === "ArrowRight" && next) turnOn();
      else if (e.key === "ArrowLeft" && spread > 0) scrollToSpread(spread - 1);
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [spread, starts.length, scrollToSpread, next, turnOn]);

  const folio = (offset: number) => firstPage + offset;
  const years = scenes.map((sc) => sc.year);
  const open = turns[0];
  const shut = backLeaf >= 0 ? turns[backLeaf] : 0;
  const closed = open === 0;

  const plateFace = (j: number) => {
    const sc = scenes[j];
    return (
      <Page side="recto" head={sc.title} folio={folio(3 + 2 * j)} style={eraVars(eraFor(sc.year)) as CSSProperties}>
        <figure className={s.plateFig}>
          <div className={s.plate}>
            {Math.abs(j - near) <= 1 && <SceneArt scene={sc} active={plateShows(j)} progress={sceneProgress(j)} />}
          </div>
          <figcaption>
            <i>Plate {roman(j + 1)}.</i>{" "}
            {sc.plate
              ? `${sc.year}, in the manner of a ${technique(sc.year)}. Painted with Muse Image.`
              : `${sc.year}. The illustration is still being made.`}
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
              <button type="button" onClick={() => scrollToSpread(NOTES)} aria-label={`Note ${j + 1}: sources, in the notes at the end`}>
                {j + 1}
              </button>
            </sup>
          </p>
        </div>
      </Page>
    );
  };

  const notesFace = (
    <Page side="verso" head={story.name} folio={folio(2 * n + 2)} style={eraVars(first) as CSSProperties}>
      <div className={s.notesPage}>
        <h2>Notes</h2>
        <ol>
          {scenes.map((sc, j) => (
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
    </Page>
  );

  const creditsFace = (
    <Page side="recto" head="Notes" folio={folio(2 * n + 3)} style={eraVars(first) as CSSProperties}>
      <div className={s.creditsPage}>
        <h2>On the pictures</h2>
        <p>
          The research and every caption’s sources come from Meta Muse Spark with web search. The plates are painted with Meta Muse Image in
          the print style of each scene’s decade, and cut into layers with SAM 3.1. People appear as silhouettes or from behind, by design.
        </p>
        {credit && <p>The frontispiece is traced from a photograph. {credit}</p>}
        <p className={s.finis} aria-hidden>
          ⁂
        </p>
        <p className={s.overleaf}>{next ? `Overleaf, ${part(next.part)}: ${next.name}.` : "Turn the page to close the book."}</p>
      </div>
    </Page>
  );

  const nextVars = eraVars(nextEra) as CSSProperties;

  /** Front and back face of leaf k. */
  const faces = (k: number): [ReactNode, ReactNode] => {
    if (k === 0)
      return [
        <Cover key="f" slug={story.slug} name={story.name} lifespan={lifespan} part={part(partNo)} lift={closed} />,
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
        <Page key="b" side="verso">
          <Frontispiece name={story.name} portrait={portrait} credit={credit} plate={scenes[0].plate} progress={drawing} />
        </Page>,
      ];
    if (k === TITLE)
      return [
        <Page key="f" side="recto">
          <TitlePage partNo={partNo} name={story.name} lifespan={lifespan} tagline={story.tagline} />
        </Page>,
        chapterFace(0),
      ];
    if (k < NOTES - 1) return [plateFace(k - FIRST_CHAPTER), chapterFace(k - FIRST_CHAPTER + 1)];
    if (k === NOTES - 1) return [plateFace(n - 1), notesFace];
    if (k === NOTES)
      return [
        creditsFace,
        next ? (
          <Page key="b" side="verso" style={nextVars}>
            <Frontispiece name={next.name} portrait={next.portrait} credit={next.credit} plate={next.plate} progress={nextDrawing} />
          </Page>
        ) : (
          <Page key="b" side="verso">
            <Endpaper years={years} />
          </Page>
        ),
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
          <span className={s.backRule} aria-hidden />
          <Link href="/#shelf" className={s.backLink}>
            Back to the shelf
          </Link>
          <Link href="/create" className={s.backLink}>
            Make a new life
          </Link>
        </div>
      </div>,
    ];
  };

  // Only the pages that can be seen are painted: the top two of each pile.
  const topLeft = turns.findLastIndex((t) => t >= 0.5);
  const topRight = turns.findIndex((t) => t < 0.5);

  const cloth = next && kind === "next" ? clothFor(nextEra, next.part) : clothFor(first, partNo);
  const bookVars = {
    ["--bl" as string]: `${2 + 10 * read}px`,
    ["--br" as string]: `${2 + 10 * (1 - read)}px`,
    ["--cloth" as string]: cloth,
    transform: `translateX(calc(var(--pw) * ${(0.5 * shut - 0.5 * (1 - open)).toFixed(4)}))`,
  } as CSSProperties;
  const inChapters = cur >= 0 && cur < n;

  return (
    <main className={`${s.story} ${b.desk}`} style={eraVars(era) as CSSProperties} data-desk>
      <Link href="/#shelf" className={s.home}>
        Lives in Motion
      </Link>

      <section ref={track} className={s.track} style={{ height: `${(total + 1) * 100}svh` }} data-track={n} data-total={total}>
        {starts.map((st, i) => (
          <span key={i} className={s.snap} style={{ top: `${(i === 0 ? 0 : st + holds[i] / 2) * 100}svh` }} aria-hidden />
        ))}
        <div className={s.stage}>
          <div className={b.book} style={bookVars}>
            {/* While the book is shut only the cover is drawn, so the cover can fly in from the shelf over an empty desk. */}
            <div className={b.board} style={{ visibility: shut > 0 || closed ? "hidden" : undefined }} />
            <div className={`${b.block} ${b.blockR}`} style={{ visibility: shut > 0 || closed ? "hidden" : undefined }} />
            <div className={`${b.block} ${b.blockL}`} style={{ opacity: open > 0.5 ? 1 : 0 }} />

            {next && (
              <Page side="recto" placed style={{ ...nextVars, visibility: closed ? "hidden" : undefined }}>
                <TitlePage partNo={next.part} name={next.name} lifespan={next.lifespan} tagline={next.tagline} main={false} />
              </Page>
            )}

            {turns.map((t, k) => {
              const [front, back] = faces(k);
              const left = t >= 0.5;
              const board = k === 0 || k === backLeaf;
              // The cover stays: once open it is the left board.
              const hidden = k > 0 && (closed || (left ? k < topLeft - 1 : k > topRight + 1));
              const moving = t > 0 && t < 1;
              const z = left ? 10 + 2 * k : 400 - 2 * k;
              return (
                <div key={k}>
                  {moving && !left && (
                    <div
                      className={`${b.cast} ${b.castR}`}
                      style={{
                        zIndex: z - 1,
                        opacity: Math.sin(Math.PI * t) * 0.8,
                        ["--reach" as string]: `${Math.cos(Math.PI * t) * 100 + 12}%`,
                      }}
                    />
                  )}
                  {moving && left && (
                    <div
                      className={`${b.cast} ${b.castL}`}
                      style={{
                        zIndex: z - 1,
                        opacity: Math.sin(Math.PI * t) * 0.8,
                        ["--reach" as string]: `${-Math.cos(Math.PI * t) * 100 + 12}%`,
                      }}
                    />
                  )}
                  <div
                    className={`${b.leaf} ${board ? s.boardLeaf : ""}`}
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

            <nav
              className={s.rail}
              aria-label="Chapters"
              style={{ opacity: inChapters ? 1 : 0, visibility: inChapters ? undefined : "hidden" }}
            >
              <span className={s.ribbon} style={{ transform: `translateY(${near * 44}px)` }} aria-hidden />
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

          <p className={s.cue} style={{ opacity: Math.max(0, 1 - open * 3) }} aria-hidden>
            Scroll to open the book
          </p>
          {next && (
            <p className={`${s.cue} ${s.onward}`} data-show={kind === "next" || undefined}>
              Keep scrolling, or{" "}
              <button type="button" onClick={turnOn}>
                turn to {part(next.part)}
              </button>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
