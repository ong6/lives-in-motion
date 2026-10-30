"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { LineDrawing } from "../LineDrawing";
import { Page } from "./Page";
import s from "@/app/home.module.css";

export interface ContentsEntry {
  slug: string;
  part: string;
  name: string;
  nickname?: string;
  lifespan: string;
  tagline: string;
  page: number;
  portrait: string;
  credit: string;
}

export interface BackMatter {
  label: string;
  href: string;
  page: string;
}

/**
 * The contents as an open spread: the list of lives on the verso with dotted leaders to
 * their page numbers, and on the recto the portrait of whichever life you point at.
 */
export function Contents({
  entries,
  back,
  folios,
}: {
  entries: ContentsEntry[];
  back: BackMatter[];
  folios: [string, string];
}) {
  const [on, setOn] = useState(0);
  const pick = entries[on];
  return (
    <>
      <Page side="verso" placed head="Lives in Motion" folio={folios[0]}>
        <div className={s.contents}>
          <h2 className={s.pageTitle}>Contents</h2>
          <ol className={s.toc}>
            {entries.map((e, i) => (
              <li key={e.slug}>
                <Link href={`/${e.slug}`} className={`${s.entry} ${i === on ? s.entryOn : ""}`} onMouseEnter={() => setOn(i)} onFocus={() => setOn(i)}>
                  <span className={s.entryPart}>Part {e.part}</span>
                  <span className={s.entryLine}>
                    <span className={s.entryName}>
                      {e.name}
                      {e.nickname && <em> “{e.nickname}”</em>}
                    </span>
                    <span className={s.leader} aria-hidden />
                    <span className={s.entryPage}>{e.page}</span>
                  </span>
                  <span className={s.entryTag}>
                    {e.tagline} <span className={s.entryDates}>{e.lifespan}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <ol className={s.backMatter}>
            {back.map((m) => (
              <li key={m.href}>
                <a href={m.href} className={s.entryLine}>
                  <span>{m.label}</span>
                  <span className={s.leader} aria-hidden />
                  <span className={s.entryPage}>{m.page}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      </Page>
      <Page side="recto" placed head="Contents" folio={folios[1]}>
        <figure className={s.tocPlate}>
          <div className={s.tocPortraits}>
            {entries.map((e, i) => (
              <div key={e.slug} style={{ opacity: i === on ? 1 : 0 } as CSSProperties} aria-hidden={i !== on}>
                <LineDrawing src={e.portrait} progress={1} label={`${e.name}, line portrait`} />
              </div>
            ))}
          </div>
          <figcaption>
            <i>
              {pick.name}, {pick.lifespan}.
            </i>{" "}
            {pick.credit}
          </figcaption>
        </figure>
      </Page>
    </>
  );
}
