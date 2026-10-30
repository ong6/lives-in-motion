import Link from "next/link";
import type { CSSProperties } from "react";
import { Cover } from "@/components/book/Cover";
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
}

/** A small stable wobble per book, so equal page counts still give a row of unequal volumes. */
const wobble = (slug: string) => [...slug].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7) / 997;

/**
 * The shelf: the books stand spine-out in one row, as on a real bookcase. Each spine is cloth
 * with raised bands, a band cropped from the life's first plate, the name in gilt down its
 * length and the dates at the foot. The first book stands half pulled out, its cover showing,
 * with a pencilled note; pulling another (hover or focus) slides it out toward the reader and
 * turns it to show its cover, the books after it make room and its neighbours lean. A row of
 * label cards under the shelf names every book, so the row reads without hovering at all. All
 * of it is CSS on transforms and opacity.
 */
export function Shelf({ books, nameSize }: { books: ShelfBook[]; nameSize: string }) {
  return (
    <div className={s.case} style={{ "--n": books.length, "--name-size": nameSize } as CSSProperties} data-reveal>
      <p className={s.pencil} aria-hidden>
        Pull a book to read it
        <svg viewBox="0 0 60 40">
          <path d="M4 6 C 22 6, 40 12, 50 32 M50 32 l-9 -3 M50 32 l1 -9" />
        </svg>
      </p>
      <ol className={s.row}>
        {books.map((bk, i) => {
          const w = wobble(bk.slug);
          const vars = {
            "--i": i,
            "--h": `${Math.round(372 + Math.min(40, bk.pages) * 1.6 + w * 22)}px`,
            "--t": `${Math.round(54 + Math.min(40, bk.pages) * 0.7 + w * 12)}px`,
            "--cloth": bk.cloth,
          } as CSSProperties;
          const label = bk.blank ? bk.name : `${bk.name}’s book`;
          return (
            <li key={bk.slug} className={`${s.item} ${bk.blank ? s.blank : ""}`} data-blank={bk.blank} style={vars}>
              <Link href={bk.href} className={s.pull} aria-label={`${bk.blank ? bk.name : `Open ${label}`}: ${bk.tagline}`}>
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
              </Link>
              {/* What the pulled book is, set beside the row while it is out. */}
              <div className={s.detail} aria-hidden>
                <p className={s.detailName}>{bk.name}</p>
                <p className={s.detailTag}>{bk.tagline}</p>
                <p className={s.detailMeta}>{bk.meta}</p>
                <p className={s.detailGo}>{bk.blank ? "Start it" : "Open the book"} →</p>
              </div>
              {/* The label card in the row under the shelf. */}
              <Link href={bk.href} className={s.card} tabIndex={-1}>
                <span className={s.cardName}>{bk.name}</span>
                <span className={s.cardTag}>{bk.tagline}</span>
                <span className={s.cardMeta}>{bk.meta}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      <div className={s.board} aria-hidden />
    </div>
  );
}
