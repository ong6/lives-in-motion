"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { eraFor, eraVars } from "@/lib/eras";
import { Cover, clothFor } from "./Cover";
import { DirectionCard } from "./Direction";
import { LayerStack } from "./LayerStack";
import { Endpaper, Page, bookStyles as b } from "./Page";
import { BackCover, ChapterText, Credits, Frontispiece, Notes, ScenePlate, TitlePage, technique } from "./pages";
import { FIRST_CHAPTER, TITLE, pagesFor, plan, roman } from "./pagination";
import { clamp, type Plays } from "./paging";
import type { Life } from "./StoryPlayer";
import s from "./StoryPlayer.module.css";

/**
 * One life's book on the desk: its leaves at `pos` (between two whole numbers a leaf is turning),
 * each face drawn only while it can be seen, the plate taken apart into its layers, and the
 * chapter rail with its ribbon. The leaves turn in CSS 3D; StoryPlayer moves `pos`.
 */
export function Book({
  life,
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
  const { story, index } = life;
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

  // This book's own folios: the title page is page 1, so the frontispiece and title spread is at 0.
  const folio = (offset: number) => offset;
  const lastPage = pagesFor(n);
  const folioOf = (i: number) =>
    ({
      cover: 0,
      endpapers: 0,
      title: 0,
      chapter: 2 + 2 * (i - FIRST_CHAPTER),
      notes: 2 * n + 2,
      endpapersBack: lastPage,
      closed: lastPage,
    })[kinds[i]];
  const at = Math.floor(clamp(pos, 0, CLOSED));
  const read = clamp((folioOf(at) + (folioOf(Math.min(CLOSED, at + 1)) - folioOf(at)) * (pos - at)) / lastPage);

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
            <div className={s.plate} data-layers={layersAt === sp || undefined}>{near(j) && <ScenePlate scene={sc} start={playOf(sp)} shown={shows} layers={layersAt === sp} />}</div>
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
      <Credits credit={life.credit} last={last} />
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
          <TitlePage chapters={n} name={story.name} lifespan={life.lifespan} tagline={story.tagline} main={main} />
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
        <BackCover last={last} />
      </div>,
    ];
  };

  // The plate last taken apart: its stack stays mounted while it lays itself back down, but goes at once if the page turns.
  const stackAt = useRef<number | null>(null);
  if (layersAt != null) stackAt.current = layersAt;
  const stackScene = stackAt.current != null ? scenes[stackAt.current - FIRST_CHAPTER] : undefined;
  const stackStill = stackAt.current != null && Math.abs(pos - stackAt.current) < 0.001 && closing == null;
  const stackDir = stackScene && life.directions?.[stackScene.id];

  // Only the pages that can be seen are painted: the top two of each pile.
  const topLeft = turns.findLastIndex((t) => t >= 0.5);
  const topRight = turns.findIndex((t) => t < 0.5);

  const bookVars = {
    ["--bl" as string]: `${2 + 10 * read}px`,
    ["--br" as string]: `${2 + 10 * (1 - read)}px`,
    ["--cloth" as string]: clothFor(first, index),
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

      {main && stackScene?.plate && stackStill && (
        <LayerStack
          key={stackScene.id}
          scene={stackScene}
          open={layersAt === stackAt.current}
          aside={stackDir && <DirectionCard dir={stackDir} plate={stackScene.plate} />}
        />
      )}

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
