"use client";

/**
 * What is printed on the book's pages: the frontispiece and title page, each chapter's text and
 * plate, the notes, the picture credits and the back cover. Book.tsx places them on the leaves.
 */
import { useLayoutEffect, useRef } from "react";
import Link from "next/link";
import type { Checked, Story } from "@/lib/schema";
import { eraFor, type Era } from "@/lib/eras";
import { LineDrawing } from "../shared/LineDrawing";
import { bookStyles as b } from "./Page";
import { roman } from "./pagination";
import { SceneArt, sceneDuration } from "./SceneArt";
import { useTimeline } from "./useTimeline";
import s from "./StoryPlayer.module.css";

type SceneT = Story["scenes"][number];

const CHAPTERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
/** "1950s offset lithograph poster, flat inks…" → "1950s offset lithograph poster". */
export const technique = (year: string) => eraFor(year).print.split(",")[0];

export function Frontispiece({ name, portrait, credit, plate, start }: { name: string; portrait?: string; credit: string; plate?: string; start: number | null }) {
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

export function TitlePage({ chapters, name, lifespan, tagline, main }: { chapters: number; name: string; lifespan: string; tagline: string; main: boolean }) {
  const Name = main ? "h1" : "p";
  return (
    <div className={s.titlePage}>
      <p className={s.titlePart}>A life in {CHAPTERS[chapters] ?? chapters} chapters</p>
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
export function ScenePlate({ scene, start, shown, layers }: { scene: SceneT; start: number | null; shown: boolean; layers: boolean }) {
  const t = useTimeline(start, sceneDuration(scene));
  return <SceneArt scene={scene} active={shown && !layers} progress={t} />;
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

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Singapore" });
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const VERDICT: Record<Checked["verdict"], string> = {
  ok: "Supported by its sources",
  corrected: "Corrected to match its sources",
  disputed: "Disputed, and not yet resolved",
};

/** A quiet mark under the caption: Muse Spark's fact-check; hover or focus shows when and what it found. */
function CheckMark({ checked, id }: { checked: Checked; id: string }) {
  const ok = checked.verdict !== "disputed";
  const n = checked.sources.length;
  return (
    <p className={s.check} data-verdict={checked.verdict}>
      <span className={s.checkMark} tabIndex={0} aria-describedby={id}>
        <span aria-hidden>{ok ? "✓" : "?"}</span> {ok ? "Checked" : "Queried"} by Muse Spark
      </span>
      <span role="tooltip" id={id} className={s.checkTip}>
        <b>
          {VERDICT[checked.verdict]}, {dateOf(checked.at)}.
        </b>
        {checked.note && <span>{checked.note.replace(/\s*→\s*/, " Then: ")}</span>}
        <span className={s.checkSrc}>
          {n ? `Cited: ${checked.sources.map(hostOf).join(", ")} · ` : ""}
          {checked.model}
        </span>
      </span>
    </p>
  );
}

export function ChapterText({ scene, j, era, onNote }: { scene: SceneT; j: number; era: Era; onNote: () => void }) {
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
      {scene.checked && <CheckMark checked={scene.checked} id={`check-${scene.id}`} />}
    </div>
  );
}

export function Notes({ story, folio }: { story: Story; folio: (o: number) => number }) {
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
              {sc.checked && (
                <span className={s.noteCheck}>
                  {" "}
                  {sc.checked.verdict === "corrected" ? "Corrected" : sc.checked.verdict === "disputed" ? "Queried" : "Checked"} by Muse Spark,{" "}
                  {dateOf(sc.checked.at).replace(/ \d{4}$/, "")}
                  {sc.checked.sources.length > 0 && ", against "}
                  {sc.checked.sources.map((u, k) => (
                    <span key={u}>
                      {k > 0 && (k === sc.checked!.sources.length - 1 ? " and " : ", ")}
                      <a href={u} target="_blank" rel="noopener noreferrer">
                        {hostOf(u)}
                      </a>
                    </span>
                  ))}
                  .
                </span>
              )}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The last page of a book: how its pictures were made, and where the next turn goes. */
export function Credits({ credit, last }: { credit: string; last: boolean }) {
  return (
    <div className={s.creditsPage}>
      <h2>On the pictures</h2>
      <p>
        The research and every caption’s sources come from Meta Muse Spark with web search, and Muse Spark checked each caption against
        them again. The plates are painted with Meta Muse Image in the print style of each scene’s decade, and cut into layers with SAM 3.1.
        People appear as silhouettes or from behind, by design.
      </p>
      <p>
        Muse Wonder directed the films: it read each plate and its layers, planned the camera and every layer’s move, then watched six frames
        of the render, critiqued them and revised. The films were rendered on our own machine. Press L on any plate to see it taken apart.
      </p>
      {credit && <p>The frontispiece is traced from a photograph. {credit}</p>}
      <p className={s.finis} aria-hidden>
        ⁂
      </p>
      <p className={s.overleaf}>{last ? "Turn the page to close the book." : "Turn the page to put this book down and take the next one from the shelf."}</p>
    </div>
  );
}

/** The back cover, once it has closed over the book; the last life's carries the way back. */
export function BackCover({ last }: { last: boolean }) {
  return (
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
  );
}
