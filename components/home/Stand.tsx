"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Cover } from "@/components/book/Cover";
import type { Line } from "./lines";
import s from "./Shelf.module.css";

export interface StandBook {
  name: string;
  lifespan: string;
  cloth: string;
  plate?: string;
}

const TURN_MS = 9000;

/**
 * The open end of the shelf: one book face-out on a stand, with a line from inside it on a
 * catalogue card and a link straight to that chapter. Every nine seconds another book takes the
 * stand; pointing at it, focusing it, a hidden tab or the shelf off screen holds it, and with
 * reduced motion it only changes when asked. The cover here is a display copy: it takes no part
 * in the shelf-to-book transition, which belongs to the books in the row.
 */
export function Stand({ lines, covers }: { lines: Line[]; covers: Record<string, StandBook> }) {
  const [k, setK] = useState(0);
  const [held, setHeld] = useState(false);
  const [auto, setAuto] = useState(false);
  // Announce a new line only when the reader asked for it, not on every automatic turn.
  const [asked, setAsked] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const seen = useRef(true);

  useEffect(() => setAuto(!matchMedia("(prefers-reduced-motion: reduce)").matches), []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => (seen.current = e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || held || lines.length < 2) return;
    const t = setInterval(() => {
      if (seen.current && !document.hidden) setK((x) => (x + 1) % lines.length);
    }, TURN_MS);
    return () => clearInterval(t);
  }, [auto, held, lines.length]);

  const line = lines[k];
  const book = covers[line.slug];
  return (
    <div
      ref={root}
      className={s.stand}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHeld(false)}
    >
      <p className={s.pencil} aria-hidden>
        Pull a book to read it
        <svg viewBox="0 0 60 40">
          <path d="M56 8 C 38 6, 20 12, 10 32 M10 32 l9 -3 M10 32 l-1 -9" />
        </svg>
      </p>
      {book && (
        <Link href={line.href} className={s.standBook} tabIndex={-1} aria-hidden key={`b-${k}`} style={{ "--cloth": book.cloth } as CSSProperties}>
          <Cover slug={line.slug} name={book.name} lifespan={book.lifespan} lift={false} className={s.front}>
            {book.plate && (
              <span className={s.onlay}>
                <img src={book.plate} alt="" loading="lazy" />
              </span>
            )}
          </Cover>
        </Link>
      )}
      <div className={s.card}>
        <div aria-live={asked ? "polite" : "off"}>
          <figure className={s.cardLine} key={`l-${k}`}>
            <blockquote>
              <p>{line.by ? `“${line.text}”` : line.text}</p>
            </blockquote>
            {line.by && <figcaption>{line.by}</figcaption>}
          </figure>
        </div>
        <Link href={line.href} className={s.cardGo} key={`g-${k}`}>
          <i>{line.name}</i>, {line.chapter}, {line.year}: {line.title}
        </Link>
        {lines.length > 1 && (
          <button
            type="button"
            className={s.cardNext}
            onClick={() => {
              setAsked(true);
              setK((x) => (x + 1) % lines.length);
            }}
          >
            Another line
          </button>
        )}
      </div>
    </div>
  );
}
