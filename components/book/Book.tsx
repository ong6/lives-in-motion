"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { eraFor, eraVars } from "@/lib/eras";
import { Cover, clothFor } from "./Cover";
import { DirectionCard } from "./Direction";
import { LayerStack } from "./LayerStack";
import { Endpaper, Page, bookStyles as b } from "./Page";
import { BackCover, BreakHalf, ChapterText, Conflicts, Credits, Frontispiece, Notes, PhotoCard, PhotoPage, Photographs, ScenePlate, TitlePage, Turn, technique } from "./pages";
import { TITLE, pagesOf, plan, rectoFolio, roman, versoFolio } from "./pagination";
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
  const P = plan(story);
  const { kinds, NOTES, END, CLOSED } = P;
  const leaves = kinds.length - 1;
  const backLeaf = leaves - 1;

  /** How far leaf k has turned, 0 (lying right) to 1 (lying left). */
  const turns = Array.from({ length: leaves }, (_, k) => (closing != null && k >= END ? closing : clamp(pos - k)));
  const open = turns[0];
  const shut = turns[backLeaf];
  const closed = open === 0;

  // This book's own folios: the title page is page 1, so the frontispiece and title spread is at 0.
  const lastPage = pagesOf(P);
  const folioOf = (i: number) => (i <= TITLE ? 0 : i > END ? lastPage : versoFolio(i));
  const at = Math.floor(clamp(pos, 0, CLOSED));
  const read = clamp((folioOf(at) + (folioOf(Math.min(CLOSED, at + 1)) - folioOf(at)) * (pos - at)) / lastPage);

  const years = scenes.map((sc) => sc.year);
  const first = eraFor(scenes[0].year);
  const playOf = (spread: number) => plays[spread]?.start ?? null;
  /** A face playing its spread's entrance: the class starts the CSS choreography, delayed to its start time. */
  const faceProps = (spread: number, style?: CSSProperties, extra = "") => {
    const p = plays[spread];
    return {
      className: `${p ? s.play : ""} ${extra}`,
      style: (p ? { ...style, ["--delay" as string]: `${p.delay}ms` } : style) as CSSProperties,
    };
  };
  const near = (sp: number) => Math.abs(sp - pos) < 1.6 || plays[sp] != null;
  const shown = (sp: number) => Math.abs(sp - pos) < 1;
  const deep = story.edition === "deep";
  const toNotes = () => onGo(NOTES);

  const layersButton = (sp: number, light = false) =>
    onLayers && (
      <button type="button" className={`${s.layersBtn} ${light ? s.layersLight : ""}`} aria-pressed={layersAt === sp} onClick={onLayers} title="Take the picture apart (L)">
        {layersAt === sp ? "Put it back together" : "Layers"}
      </button>
    );

  /** A plate chapter's recto: the print in its plate mark, its caption, and the turn at the foot. */
  const plateFace = (sp: number) => {
    const j = P.scene[sp];
    const sc = scenes[j];
    return (
      <Page key="f" side="recto" head={sc.title} folio={rectoFolio(sp)} {...faceProps(sp, eraVars(eraFor(sc.year)) as CSSProperties)}>
        <figure className={`${s.plateFig} ${sc.turn ? s.withTurn : ""}`}>
          <div className={s.plateMark}>
            <div className={s.plate} data-layers={layersAt === sp || undefined}>
              {near(sp) && <ScenePlate scene={sc} start={playOf(sp)} shown={shown(sp)} layers={layersAt === sp} />}
            </div>
          </div>
          <figcaption>
            <span>
              <span className={s.plateNo}>Plate {roman(j + 1)}</span>
              {sc.plate ? `${sc.when ?? sc.year}, in the manner of a ${technique(sc.year)}. Painted with Muse Image.` : `${sc.year}. The illustration is still being made.`}
            </span>
            {sc.plate && layersButton(sp)}
          </figcaption>
          {sc.turn && <Turn text={sc.turn} />}
        </figure>
      </Page>
    );
  };

  /** A photo chapter's verso: the real photograph, its pen trace drawing over it as the page lands. */
  const photoFace = (sp: number) => {
    const j = P.scene[sp];
    const sc = scenes[j];
    return (
      <Page key="b" side="verso" folio={sc.photo?.mounted ? versoFolio(sp) : undefined} {...faceProps(sp, eraVars(eraFor(sc.year)) as CSSProperties, sc.photo?.mounted ? "" : s.bleed)}>
        {sc.photo && <PhotoPage scene={sc} start={playOf(sp)} near={near(sp)} layers={layersAt === sp} button={layersButton(sp, !sc.photo.mounted)} />}
      </Page>
    );
  };

  const textFace = (sp: number, side: "verso" | "recto") => {
    const j = P.scene[sp];
    const sc = scenes[j];
    const e = eraFor(sc.year);
    return (
      <Page key={side === "recto" ? "f" : "b"} side={side} head={side === "verso" ? story.name : sc.title} folio={side === "verso" ? versoFolio(sp) : rectoFolio(sp)} {...faceProps(sp, eraVars(e) as CSSProperties)}>
        <ChapterText scene={sc} j={j} era={e} onNote={toNotes} turn={side === "recto"} />
      </Page>
    );
  };

  /** One half of a photograph printed across the spread. */
  const breakFace = (sp: number, side: "verso" | "recto") => {
    const b = story.breaks![P.brk[sp]];
    const e = eraFor(scenes[P.scene[sp]].year);
    return (
      <Page key={side === "recto" ? "f" : "b"} side={side} {...faceProps(sp, eraVars(e) as CSSProperties, s.bleed)}>
        {near(sp) && <BreakHalf photo={b.photo} side={side} />}
      </Page>
    );
  };

  const versoOf = (sp: number): ReactNode => {
    const kind = kinds[sp];
    if (kind === "title")
      return (
        <Page key="b" side="verso" {...faceProps(TITLE)}>
          <Frontispiece name={story.name} portrait={life.portrait} credit={life.credit} depicts={life.depicts} plate={scenes.find((x) => x.plate)?.plate} start={playOf(TITLE)} />
        </Page>
      );
    if (kind === "chapter") return scenes[P.scene[sp]].treatment === "photo" ? photoFace(sp) : textFace(sp, "verso");
    if (kind === "break") return breakFace(sp, "verso");
    if (kind === "notes" || kind === "notes2")
      return (
        <Page key="b" side="verso" head={story.name} folio={versoFolio(sp)} {...faceProps(sp, eraVars(first) as CSSProperties)}>
          {kind === "notes" ? <Notes story={story} folioOf={(j) => versoFolio(P.spreadOf[j])} /> : <Photographs story={story} folioOf={(j) => versoFolio(P.spreadOf[j])} breakFolio={(i) => versoFolio(P.brk.indexOf(i))} />}
        </Page>
      );
    return (
      <Page key="b" side="verso">
        <Endpaper years={years} />
      </Page>
    );
  };

  const rectoOf = (sp: number): ReactNode => {
    const kind = kinds[sp];
    if (kind === "title")
      return (
        <Page key="f" side="recto" {...faceProps(TITLE)}>
          <TitlePage chapters={scenes.length} name={story.name} lifespan={life.lifespan} tagline={story.tagline} main={main} />
        </Page>
      );
    if (kind === "chapter") return scenes[P.scene[sp]].treatment === "photo" ? textFace(sp, "recto") : plateFace(sp);
    if (kind === "break") return breakFace(sp, "recto");
    const credits = (
      <Credits story={story} credit={life.credit} curated={life.curated} directed={Object.keys(life.directions ?? {}).length > 0} last={last} />
    );
    return (
      <Page key="f" side="recto" head="Notes" folio={rectoFolio(sp)} {...faceProps(sp, eraVars(first) as CSSProperties)}>
        {kind === "notes" && deep ? <Conflicts story={story} /> : credits}
      </Page>
    );
  };

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
        versoOf(TITLE),
      ];
    if (k < backLeaf) return [rectoOf(k), versoOf(k + 1)];
    // The back board: its pastedown, then the back cover once it has closed over the book.
    return [
      <div key="f" className={`${s.pastedown} ${s.pastedownBack}`}>
        <div className={s.pastedownPaper}>
          <Endpaper years={years} />
        </div>
      </div>,
      <div key="b" className={`${b.cover} ${s.backCover}`}>
        <BackCover story={story} last={last} />
      </div>,
    ];
  };

  // The plate last taken apart: its stack stays mounted while it lays itself back down, but goes at once if the page turns.
  const stackAt = useRef<number | null>(null);
  if (layersAt != null) stackAt.current = layersAt;
  const stackScene = stackAt.current != null && kinds[stackAt.current] === "chapter" ? scenes[P.scene[stackAt.current]] : undefined;
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

      {main && (stackScene?.plate || stackScene?.photo) && stackStill && (
        <LayerStack
          key={stackScene.id}
          scene={stackScene}
          open={layersAt === stackAt.current}
          aside={stackScene.photo ? <PhotoCard photo={stackScene.photo} /> : stackDir && stackScene.plate && <DirectionCard dir={stackDir} plate={stackScene.plate} />}
        />
      )}

      {main && (
        <nav className={s.rail} aria-label="Chapters" data-show={rail != null || undefined}>
          <span className={s.ribbon} style={{ transform: `translateY(${(rail ?? 0) * 44}px)` }} aria-hidden />
          {scenes.map((sc, i) => (
            <button
              key={sc.id}
              className={i === rail ? s.on : ""}
              onClick={() => onGo(P.spreadOf[i])}
              aria-current={i === rail ? "page" : undefined}
              aria-label={`Chapter ${roman(i + 1)}, ${sc.year}: ${sc.title}`}
              title={sc.title}
              tabIndex={rail == null ? -1 : undefined}
            >
              {sc.year}
              {sc.treatment === "photo" && <span className={s.railPhoto} aria-hidden />}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
