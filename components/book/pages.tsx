"use client";

/**
 * What is printed on the book's pages: the frontispiece and title page, each chapter's text and
 * plate, the notes, the picture credits and the back cover. Book.tsx places them on the leaves.
 */
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import type { Checked, Story } from "@/lib/schema";
import { eraFor, type Era } from "@/lib/eras";
import { isFamilyBook } from "@/lib/provenance";
import { LineDrawing } from "../shared/LineDrawing";
import { bookStyles as b } from "./Page";
import { roman } from "./pagination";
import { PhotoCredit, PhotoFrame, PhotoLabel, hostOf } from "./PhotoArt";
import { SceneArt, sceneDuration } from "./SceneArt";
import { useTimeline } from "./useTimeline";
import s from "./StoryPlayer.module.css";

type SceneT = Story["scenes"][number];
type PhotoT = NonNullable<SceneT["photo"]>;

const CHAPTERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen"];
/** "1950s offset lithograph poster, flat inks…" → "1950s offset lithograph poster". */
export const technique = (year: string) => eraFor(year).print.split(",")[0];

export function Frontispiece({ name, portrait, credit, depicts, plate, start }: { name: string; portrait?: string; credit: string; depicts?: string; plate?: string; start: number | null }) {
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
        <i>{depicts ? depicts.replace(/^./, (c) => c.toUpperCase()) : name}</i>
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

/** The teaser at the foot of the page you turn: it pulls the reader into the next chapter. */
export function Turn({ text }: { text: string }) {
  return (
    <p className={s.turn}>
      <span>{curly(text)}</span>
      <span className={s.turnMark} aria-hidden>
        ⟶
      </span>
    </p>
  );
}

/** Typographer's quotes for display: "…" → “…”, it's → it’s. The stored text stays as checked. */
export const curly = (t: string) =>
  t
    .replace(/(^|[\s(\[{\u2014-])"/g, "$1\u201C")
    .replace(/"/g, "\u201D")
    .replace(/(^|[\s(\[{\u2014-])'/g, "$1\u2018")
    .replace(/'/g, "\u2019");

/** "aged 12"; the birth chapter says so. */
const ageLine = (age?: number) => (age == null ? null : age === 0 ? "born" : `aged ${age}`);

export function ChapterText({ scene, j, era, onNote, turn = false }: { scene: SceneT; j: number; era: Era; onNote: () => void; turn?: boolean }) {
  const ref = useFit<HTMLDivElement>();
  const note = (
    <sup className={s.ref}>
      <button type="button" onClick={onNote} aria-label={`Note ${j + 1}: sources, in the notes at the end`}>
        {j + 1}
      </button>
    </sup>
  );
  if (!scene.body)
    return (
      <div className={s.chapter} ref={ref}>
        <p className={s.chapterNo}>Chapter {roman(j + 1)}</p>
        <p className={s.year}>{scene.year}</p>
        <p className={s.eraName}>{era.label}</p>
        <h2 className={s.title}>{scene.title}</h2>
        <p className={s.caption}>
          {scene.caption}
          {note}
        </p>
        {scene.checked && <CheckMark checked={scene.checked} id={`check-${scene.id}`} />}
      </div>
    );
  // The deep edition: a story page. Year and age, the title, the body with a drop cap, the voice as a pull-quote.
  const pulled = scene.quote && scene.voice?.includes(scene.quote.text.slice(0, 24));
  const text = (
    <div className={`${s.chapter} ${s.tale} ${turn && scene.turn ? s.withTurn : ""}`} ref={ref}>
      <header className={s.storyHead}>
        <p className={s.storyYear}>{scene.when ?? scene.year}</p>
        <p className={s.storyMeta}>
          <span className={s.chapterNo}>Chapter {roman(j + 1)}</span>
          {ageLine(scene.age) && <span className={s.age}>{ageLine(scene.age)}</span>}
        </p>
      </header>
      <h2 className={s.storyTitle}>{scene.title}</h2>
      <p className={s.body}>
        {curly(scene.body)}
        {note}
      </p>
      {scene.voice && (
        <blockquote className={s.voice}>
          <p>{curly(scene.voice.replace(/\s*\((?:[^)]*\d{4})\)\s*$/, ""))}</p>
          {pulled && scene.quote && (
            <cite>
              {scene.quote.speaker.replace(/\s*\(.*\)$/, "")}, <a href={scene.quote.source.url} target="_blank" rel="noopener noreferrer">{hostOf(scene.quote.source.url)}</a>
            </cite>
          )}
        </blockquote>
      )}
      {scene.checked && <CheckMark checked={scene.checked} id={`check-${scene.id}`} />}
    </div>
  );
  // The turn sits outside the fitted block, at the foot of the page.
  return turn && scene.turn ? (
    <>
      {text}
      <div className={s.pageTurn}>
        <Turn text={scene.turn} />
      </div>
    </>
  ) : (
    text
  );
}

const PHOTO_MS = 3800;

/**
 * A photo chapter's verso: the real photograph, full-bleed (or mounted as a print when it is
 * small or poor), its pen trace drawing over a pale wash as the page lands, then the photo
 * developing underneath while the trace settles into a light overlay. The label says what it is
 * ("Place" for one that is not the person) and the credit sits on the page.
 */
export function PhotoPage({ scene, start, near, layers, button }: { scene: SceneT; start: number | null; near: boolean; layers: boolean; button: ReactNode }) {
  const photo = scene.photo!;
  const t = useTimeline(start, PHOTO_MS);
  const draw = Math.min(1, t / 0.62);
  const develop = Math.max(0, Math.min(1, (t - 0.42) / 0.5));
  const frame = (box: number | null) => near && <PhotoFrame photo={photo} boxAspect={box} draw={draw} develop={develop} settled={t >= 1} />;
  const caption = (
    <figcaption className={s.photoCaption}>
      <span className={s.photoWhat}>
        <PhotoLabel photo={photo} />
      </span>
      <PhotoCredit photo={photo} />
      {button}
    </figcaption>
  );
  if (photo.mounted)
    return (
      <figure className={s.mounted}>
        <div className={s.mountWell}>
          <div className={s.print} data-layers={layers || undefined} style={{ ["--a" as string]: photo.aspect } as CSSProperties}>
            {frame(null)}
          </div>
        </div>
        {caption}
      </figure>
    );
  return (
    <figure className={s.fullBleed}>
      <div className={s.bleedPhoto} data-layers={layers || undefined}>
        {frame(880 / 660)}
      </div>
      {caption}
    </figure>
  );
}

/** One half of a photograph printed across both pages, slowly drawing nearer. */
export function BreakHalf({ photo, side }: { photo: PhotoT; side: "verso" | "recto" }) {
  return (
    <figure className={`${s.breakHalf} ${side === "recto" ? s.breakRight : ""}`}>
      <div className={s.breakImg}>
        <PhotoFrame photo={photo} boxAspect={880 / 1320} show={["photo"]} />
      </div>
      {side === "recto" && (
        <figcaption className={s.photoCaption}>
          <span className={s.photoWhat}>
            <PhotoLabel photo={photo} />
          </span>
          <PhotoCredit photo={photo} traced={false} />
        </figcaption>
      )}
    </figure>
  );
}

/** The Layers view's card for a photograph: where it came from and what each sheet is. */
export function PhotoCard({ photo }: { photo: PhotoT }) {
  return (
    <div className={s.photoCard}>
      <p className={s.photoCardKicker}>The photograph</p>
      <p className={s.photoCardLabel}>
        <PhotoLabel photo={photo} />
      </p>
      <dl>
        <dt>Photograph</dt>
        <dd>
          <PhotoCredit photo={photo} traced={false} />
        </dd>
        <dt>Mask</dt>
        <dd>{photo.cutout ? `SAM 3.1 found “${photo.concept}” and cut it out of the frame.` : `SAM 3.1 looked for “${photo.concept}”; the whole frame was traced.`}</dd>
        <dt>Pen trace</dt>
        <dd>
          Traced from the masked photo with linedraw (MIT), in plotter order; it draws over the photo as the page opens.
          {/\bSA\b|SA /.test(photo.credit.license + " ") ? ` Shared under ${photo.credit.license}.` : ""}
        </dd>
      </dl>
    </div>
  );
}

export function Notes({ story, folioOf }: { story: Story; folioOf: (j: number) => number }) {
  const ref = useFit<HTMLDivElement>();
  const deep = story.edition === "deep";
  return (
    <div className={`${s.notesPage} ${deep ? s.notesDeep : ""}`} ref={ref}>
      <h2>Notes</h2>
      <ol>
        {story.scenes.map((sc, j) => (
          <li key={sc.id} id={`note-${j + 1}`}>
            <span className={s.noteNo}>{j + 1}</span>
            <p>
              <i>
                {deep ? roman(j + 1) : `Chapter ${roman(j + 1)}`}, p. {folioOf(j)}.
              </i>{" "}
              {sc.title} ({sc.when ?? sc.year}).{" "}
              {sc.sources.map((src, k) => (
                <span key={src.url}>
                  {k > 0 && "; "}
                  <a href={src.url} target="_blank" rel="noopener noreferrer" title={src.label}>
                    {deep ? shortLabel(src.label) : src.label}
                  </a>
                </span>
              ))}
              .
              {sc.checked && (
                <span className={s.noteCheck}>
                  {" "}
                  {sc.checked.verdict === "corrected" ? "Corrected" : sc.checked.verdict === "disputed" ? "Queried" : "Checked"} by Muse Spark,{" "}
                  {dateOf(sc.checked.at).replace(/ \d{4}$/, "")}
                  {!deep && sc.checked.sources.length > 0 && ", against "}
                  {!deep &&
                    sc.checked.sources.map((u, k) => (
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

/** "CNA Insider, 'From O-level failure…' (2019)" → "CNA Insider (2019)": the full label is its title. */
function shortLabel(label: string) {
  const year = label.match(/\((?:[^)]*?)(\d{4})\)\s*$/)?.[1];
  const head = label.split(/,\s|:\s/)[0].replace(/['‘’"“”]/g, "").trim();
  return year && !head.includes(year) ? `${head} (${year})` : head;
}

/** Where the sources disagreed, and the reading this book follows (Muse Spark's notes, from the write stage). */
export function Conflicts({ story }: { story: Story }) {
  const ref = useFit<HTMLDivElement>();
  const list = story.conflicts ?? [];
  return (
    <div className={`${s.notesPage} ${s.notesDeep}`} ref={ref}>
      <h2>Where the sources differ</h2>
      <p className={s.notesLead}>
        Every chapter is written by Muse Spark from numbered facts, each read again on its cited page. Where two sources disagreed, the book
        follows the corroborated reading or is phrased to be true either way:
      </p>
      <ul className={s.conflicts}>
        {list.map((c) => (
          <li key={c.topic}>
            <b>{c.topic}.</b> {c.choice}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Every photograph in the book, with its page, maker and licence. */
export function Photographs({ story, folioOf, breakFolio }: { story: Story; folioOf: (j: number) => number; breakFolio: (i: number) => number }) {
  const ref = useFit<HTMLDivElement>();
  const rows: { page: number; photo: PhotoT; traced: boolean }[] = [
    ...story.scenes.flatMap((sc, j) => (sc.photo ? [{ page: folioOf(j), photo: sc.photo, traced: Boolean(sc.photo.trace) }] : [])),
    ...(story.breaks ?? []).map((b, i) => ({ page: breakFolio(i), photo: b.photo, traced: false })),
  ].sort((a, b) => a.page - b.page);
  return (
    <div className={`${s.notesPage} ${s.notesDeep}`} ref={ref}>
      <h2>Photographs</h2>
      <p className={s.notesLead}>Real photographs, openly licensed. A photo marked Place, Object or Event does not show the person.</p>
      <ol className={s.photoList}>
        {rows.map((r) => (
          <li key={r.photo.src}>
            <span className={s.noteNo}>p. {r.page}</span>
            <p>
              <PhotoLabel photo={r.photo} />. <PhotoCredit photo={r.photo} traced={r.traced} />
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The last page of a book: how its words and pictures were made, as this book was made. A family
 * book's text is a transcribed recording, cited to the moment each fact was said; only a book
 * whose films Muse Wonder directed says so; a frontispiece is a credited photograph only when it is.
 */
export function Credits({ story, credit, curated, directed, last }: { story: Story; credit: string; curated: boolean; directed: boolean; last: boolean }) {
  return (
    <div className={s.creditsPage}>
      <h2>On the pictures</h2>
      {isFamilyBook(story) ? (
        <p>
          The text comes from a family recording. Meta Muse Voice Transcribe wrote it down turn by turn; Muse Spark found the dated facts in
          it, each cited in the notes to the moment it was said, and checked every caption against the recording. The plates are painted with
          Meta Muse Image in the print style of each scene’s decade, and cut into layers with SAM 3.1. People appear as silhouettes or from
          behind, by design.
        </p>
      ) : story.edition === "deep" ? (
        <p>
          Meta Muse Spark wrote every chapter from numbered, cited facts, and checked each one against its sources on the web. The plates are
          painted with Meta Muse Image in the print style of each chapter’s decade and cut into layers with SAM 3.1; people in them appear as
          silhouettes or from behind, by design. The photographs are real and openly licensed: SAM 3.1 masked each subject and a pen traced it.
        </p>
      ) : (
        <p>
          The research and every caption’s sources come from Meta Muse Spark with web search, and Muse Spark checked each caption against
          them again. The plates are painted with Meta Muse Image in the print style of each scene’s decade, and cut into layers with SAM 3.1.
          People appear as silhouettes or from behind, by design.
        </p>
      )}
      {directed ? (
        <p>
          Muse Wonder directed the films: it read each plate and its layers, planned the camera and every layer’s move, then watched six frames
          of the render, critiqued them and revised. The films were rendered on our own machine. Press L on any plate to see it taken apart.
        </p>
      ) : (
        <p>The films were rendered on our own machine, each a camera move through its plate’s layers. Press L on any plate to see it taken apart.</p>
      )}
      {credit && <p>{curated ? `The frontispiece is traced from a photograph. ${credit}` : credit}</p>}
      {story.edition === "deep" && <p className={s.small}>Pen traces by linedraw (MIT, LingDong-). Every photograph’s maker and licence is listed opposite and on its page.</p>}
      <p className={s.finis} aria-hidden>
        ⁂
      </p>
      <p className={s.overleaf}>{last ? "Turn the page to close the book." : "Turn the page to put this book down and take the next one from the shelf."}</p>
    </div>
  );
}

/** The back cover, once it has closed over the book; the last life's carries the way back. */
export function BackCover({ story, last }: { story: Story; last: boolean }) {
  return (
    <div className={s.backInner}>
      <p className={b.coverSeries}>Lives in Motion</p>
      <p className={s.blurb}>
        {isFamilyBook(story)
          ? "A family’s story, told in their own words. Every scene is cited to the recording; every picture is made with Meta’s AI."
          : "Singaporean lives, told decade by decade. Every scene is sourced; every picture is made with Meta’s AI."}
      </p>
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
