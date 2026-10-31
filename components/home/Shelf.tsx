import Link from "next/link";
import type { CSSProperties } from "react";
import { Cover } from "@/components/book/Cover";
import { Stand, type StandBook } from "./Stand";
import type { Line } from "./lines";
import s from "./Shelf.module.css";

/** One volume on the shelf: a life, or one of the blank books that start a new one. */
export interface ShelfBook {
  slug: string;
  href: string;
  name: string;
  /** A shorter name for the spine, if the name won't stand on it. */
  spine?: string;
  /** "b. 1957" or "1933–2024"; empty for a blank. */
  lifespan: string;
  tagline: string;
  /** "Seven chapters, 1957–2019", or what a blank book makes. */
  meta: string;
  /** Pages in the book; sets the spine's thickness and height a little, as on a real shelf. */
  pages: number;
  cloth: string;
  /** The life's first plate, cropped into a band on the spine and set into the cover. */
  plate?: string;
  blank?: "new" | "family";
  /** A line from inside the book, shown on its bookplate while it is pulled. */
  excerpt?: Line;
}

export interface ShelfGroup {
  id: string;
  name: string;
  books: ShelfBook[];
}

/** A small stable wobble per book, so equal page counts still give a row of unequal volumes. */
const wobble = (slug: string) => [...slug].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7) / 997;

/**
 * The bookcase: one bay with a back panel, the books spine-out on a board in sections (each
 * section between book-ends, its name on a brass holder under the board), a paper label under
 * every spine, and at the open end a face-out book on a stand with a line from inside it.
 *
 * Pulling a book (hover or focus) slides it out and turns its cover to the reader, with its
 * bookplate beside it; only what stands after it moves over, into the stand's room, so nothing
 * moves under the pointer. Transforms and opacity only; the sizes follow the bay's width and the
 * number of books, so five or ten fill it the same way.
 */
export function Shelf({ groups, nameSize, lines, covers }: { groups: ShelfGroup[]; nameSize: string; lines: Line[]; covers: Record<string, StandBook> }) {
  const n = groups.reduce((a, g) => a + g.books.length, 0);
  return (
    <div className={s.case} style={{ "--n": n, "--g": groups.length, "--name-size": nameSize } as CSSProperties} data-reveal>
      <div className={s.bay}>
        <ol className={s.row}>
          {groups.map((g, gi) => (
            <li key={g.id} className={s.group} data-group={g.id} style={{ "--gi": gi } as CSSProperties}>
              <ol className={s.groupRow} aria-label={g.name}>
                {g.books.map((bk, i) => (
                  <Book key={bk.slug} bk={bk} i={i} />
                ))}
              </ol>
              <p className={s.section}>
                <span>{g.name}</span>
              </p>
            </li>
          ))}
          <li className={s.endEnd} aria-hidden />
          {lines.length > 0 && (
            <li className={s.standSlot}>
              <Stand lines={lines} covers={covers} />
            </li>
          )}
        </ol>
        <div className={s.board} aria-hidden />
      </div>
    </div>
  );
}

function Book({ bk, i }: { bk: ShelfBook; i: number }) {
  const w = wobble(bk.slug);
  const vars = {
    "--i": i,
    "--k": (0.93 + Math.min(40, bk.pages) / 40 * 0.07 + w * 0.05).toFixed(3),
    "--tk": (0.9 + Math.min(40, bk.pages) / 40 * 0.12 + w * 0.12).toFixed(3),
    "--cloth": bk.cloth,
  } as CSSProperties;
  const ticket = bk.blank ? bk.spine ?? bk.name : bk.name;
  const label = bk.blank ? bk.name : `Open ${bk.name}’s book`;
  return (
    <li className={`${s.item} ${bk.blank ? s.blank : ""}`} data-book={bk.slug} style={vars}>
      <Link href={bk.href} className={s.pull} aria-label={`${label}: ${bk.tagline}`}>
        <span className={s.book}>
          <span className={s.spine} aria-hidden>
            <span className={s.bands} />
            {bk.plate ? (
              <span className={s.inset}>
                <img src={bk.plate} alt="" loading="lazy" />
              </span>
            ) : (
              <span className={`${s.inset} ${s.insetEmpty}`}>
                <span>+</span>
              </span>
            )}
            <span className={s.spineName}>{bk.spine ?? bk.name}</span>
            <span className={s.foot}>
              {bk.lifespan
                .replace(/^b\. /, "")
                .split("–")
                .map((y, k) => (
                  <span key={k}>{y}</span>
                ))}
            </span>
          </span>
          <span className={s.face}>
            <Cover
              slug={bk.slug}
              name={bk.blank ? (bk.blank === "new" ? "New life" : "Family story") : bk.name}
              lifespan={bk.blank ? (bk.blank === "new" ? "Name it" : "Tell it") : bk.lifespan}
              lift={!bk.blank}
              className={`${s.front} ${bk.blank ? s.blankFront : ""}`}
            >
              {bk.plate ? (
                <span className={s.onlay} aria-hidden>
                  <img src={bk.plate} alt="" loading="lazy" />
                </span>
              ) : (
                <span className={`${s.onlay} ${s.onlayEmpty}`} aria-hidden>
                  <span>+</span>
                </span>
              )}
            </Cover>
          </span>
        </span>

        {/* The label under the spine, pasted on the board's edge: the name, which the spine's dates sit above. */}
        <span className={s.ticket} aria-hidden>
          <span className={s.ticketName}>{ticket}</span>
        </span>

        {/* The bookplate, beside the cover while the book is out. */}
        <span className={s.plate} aria-hidden>
          <span className={s.plateName}>{bk.name}</span>
          <span className={s.plateTag}>{bk.tagline}</span>
          {bk.excerpt && (
            <span className={s.plateLine}>
              <span className={s.plateQuote}>{bk.excerpt.by ? `“${bk.excerpt.text}”` : bk.excerpt.text}</span>
              <span className={s.plateWhere}>
                {bk.excerpt.chapter}, {bk.excerpt.year}
                {bk.excerpt.by ? `. ${bk.excerpt.by}` : ""}
              </span>
            </span>
          )}
          <span className={s.plateMeta}>{bk.meta}</span>
          <span className={s.plateGo}>{bk.blank ? "Start it" : "Open the book"}</span>
        </span>
      </Link>
    </li>
  );
}
