import Link from "next/link";
import type { CSSProperties } from "react";
import { ERAS } from "@/lib/eras";
import s from "./Threads.module.css";

export interface Thread {
  slug: string;
  name: string;
  born: number;
  /** null while the life goes on. */
  died: number | null;
  cloth: string;
  chapters: { year: number; title: string; chapter: string; href: string }[];
}

/**
 * Every life on the shelf as one thread across the century, on a ground of the eras the books
 * are printed in. Each chapter is a punched mark on its thread that opens the book there;
 * pointing at one (or focusing it) names the chapter and draws the year down through every other
 * life, so you can see who else was where. Plain links and CSS; no script.
 */
export function Threads({ threads, now }: { threads: Thread[]; now: number }) {
  if (!threads.length) return null;
  const from = Math.floor(Math.min(...threads.map((t) => t.born)) / 10) * 10;
  const to = Math.ceil((now + 1) / 10) * 10;
  const x = (y: number) => `${(((y - from) / (to - from)) * 100).toFixed(3)}%`;
  const decades = Array.from({ length: (to - from) / 10 + 1 }, (_, k) => from + k * 10);
  const eras = ERAS.filter((e) => e.to >= from && e.from <= to).map((e) => ({ ...e, a: Math.max(e.from, from), b: Math.min(e.to + 1, to) }));

  return (
    <div className={s.chart} style={{ "--rows": threads.length } as CSSProperties}>
      <ol className={s.names} aria-hidden>
        {threads.map((t) => (
          <li key={t.slug}>
            <Link href={`/${t.slug}`} tabIndex={-1}>
              {t.name}
            </Link>
          </li>
        ))}
      </ol>
      <div className={s.field}>
        {/* The eras, printed as bands of tint behind the threads. */}
        <ol className={s.eras} aria-hidden>
          {eras.map((e, k) => (
            <li key={e.id} style={{ left: x(e.a), width: `calc(${x(e.b)} - ${x(e.a)})`, "--tint": e.accent2, "--k": k } as CSSProperties} title={e.label}>
              {e.b - e.a >= 12 && <span>{e.label}</span>}
            </li>
          ))}
        </ol>
        <ol className={s.decades} aria-hidden>
          {decades.map((d) => (
            <li key={d} style={{ left: x(d) }}>
              {d % 20 === 0 || d === from ? <span>{d}</span> : null}
            </li>
          ))}
        </ol>
        <ul className={s.threads}>
          {threads.map((t, row) => (
            <li key={t.slug} className={s.thread} style={{ "--row": row, "--cloth": t.cloth } as CSSProperties}>
              <span className="sr-only">
                {t.name}, {t.born}–{t.died ?? "today"}
              </span>
              {/* On a narrow screen the names column goes; each thread carries its name instead. */}
              <span className={s.tag} style={{ left: x(t.born) }} aria-hidden>
                {t.name}
              </span>
              <span
                className={`${s.line} ${t.died == null ? s.living : ""}`}
                style={{ left: x(t.born), width: `calc(${x(t.died ?? now)} - ${x(t.born)})` }}
                aria-hidden
              />
              <ul className={s.marks}>
                {t.chapters.map((c, k) => {
                  const dup = t.chapters.slice(0, k).filter((o) => o.year === c.year).length;
                  const side = (c.year - from) / (to - from) > 0.62 ? s.tipLeft : "";
                  return (
                    // Chapters in the same year step off the thread, above and below, so each can be pointed at.
                    <li key={k} style={{ left: `calc(${x(c.year)} + ${dup ? 7 : 0}px)`, top: `calc(50% + ${dup ? (dup % 2 ? -12 : 12) : 0}px)` }}>
                      <Link href={c.href} className={s.mark} aria-label={`${t.name}, ${c.year}: ${c.title} (${c.chapter})`}>
                        <span className={`${s.tip} ${side}`} aria-hidden>
                          <b>{c.year}</b> {c.title}
                          <i>
                            {t.name}, {c.chapter}
                          </i>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
