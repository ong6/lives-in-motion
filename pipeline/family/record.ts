/**
 * What a family book keeps beside its story (stories/<slug>/family.json, the recording, the job
 * file), its unguessable slug, and the delete key only its maker holds.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "../root";
import { storyDir } from "../stages";
import { safeEqual, slugify } from "../jobs/guard";
import { SLUG } from "../jobs/runner";
import type { Transcript } from "./transcribe";
import type { FamilyFact } from "./types";

/** Named apart from /create's job.json so neither page mistakes the other's jobs for its own. */
export const jobFile = (slug: string) => join(storyDir(slug), "family-job.json");
const recordFile = (slug: string) => join(storyDir(slug), "family.json");
export const recordingFile = (slug: string, ext: "m4a" | "wav") => join(storyDir(slug), `recording.${ext}`);
export const audioUrl = (slug: string) => `/api/family/${slug}/audio`;
/** Everything a family book wrote: its folder (recording, transcript, story) and its public assets. */
export const bookPaths = (slug: string) => [storyDir(slug), join(ROOT, "public/stories", slug), join(ROOT, "public/lines", `${slug}.json`), join(ROOT, "public/portraits", `${slug}.webp`)];

export interface FamilyRecord {
  slug: string;
  name: string;
  hint: string;
  sample?: boolean;
  label?: string;
  createdAt: string;
  origin: string;
  /** sha256 of the delete key, which only the maker's browser holds. Absent on the sample. */
  keyHash?: string;
  durationMs?: number;
  transcript?: Transcript;
  subject?: string;
  facts?: FamilyFact[];
  dropped?: { text: string; why: string }[];
  photos: number;
}

export function readRecord(slug: string): FamilyRecord | null {
  if (!SLUG.test(slug) || !existsSync(recordFile(slug))) return null;
  try {
    return JSON.parse(readFileSync(recordFile(slug), "utf8")) as FamilyRecord;
  } catch {
    return null;
  }
}

export async function writeRecord(r: FamilyRecord) {
  const f = recordFile(r.slug);
  await writeFile(`${f}.tmp`, JSON.stringify(r, null, 1));
  await rename(`${f}.tmp`, f);
}

/** A family book's slug: the name plus a random tail, so an unlisted book can't be guessed. */
export function familySlug(name: string, taken: (slug: string) => boolean): string {
  const base = (slugify(name) || "family").slice(0, 40).replace(/-+$/, "");
  for (;;) {
    const s = `${base}-${randomBytes(5).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6).padEnd(6, "x")}`;
    if (!taken(s)) return s;
  }
}

export const newKey = () => randomBytes(18).toString("base64url");
export const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");
export const keyOk = (given: string | null | undefined, hash: string | undefined): boolean => Boolean(given && hash) && safeEqual(keyHash(given!), hash!);

/** Names and places to listen for, from the form's comma-separated field. */
export const cleanKeywords = (v: unknown) =>
  (typeof v === "string" ? v : "")
    .split(/[,\n]/)
    .map((k) => k.replace(/[<>{}\\`]/g, "").trim())
    .filter((k) => k.length > 1 && k.length <= 40)
    .slice(0, 30);
