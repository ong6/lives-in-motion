/**
 * Guard rails for /create, a public page that spends real money. Pure functions over the ledger
 * entries and env, so they are tested without a server.
 */
import { timingSafeEqual } from "node:crypto";
import type { Entry } from "../budget";

/** Ledger `job` prefix for lives made on /create. */
export const JOB_PREFIX = "create:";
export const jobTag = (slug: string) => `${JOB_PREFIX}${slug}`;

/**
 * Most one life may cost. Worst case of a run: research search $0.17, storyboard $0.07, 7 plates
 * + 7 clean backgrounds + 1 emblem at $0.01 (doubled for the fallback route) $0.30, up to 43 SAM
 * calls $0.11: about $0.65. The ceiling is enforced per call by the budget guard.
 */
export const LIFE_CEILING = 1.5;
/** Refuse to start when the event budget's headroom before the stop line is under this. */
export const MIN_HEADROOM = 2;

export const LIMITS = { name: 80, hint: 120, photoBytes: 8 * 1024 * 1024 };
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Slugs the app already routes, so a life can't shadow a page. */
const RESERVED = new Set(["create", "api", "_next", "stories", "lines", "portraits", "favicon-ico", "about", "new"]);

type Env = Record<string, string | undefined>;

export const createEnabled = (env: Env = process.env) => env.NODE_ENV !== "production" || env.ALLOW_CREATE === "1";
/** Rehearsals (no spend) are a development tool, or forced on with CREATE_MOCK=1. */
export const mockAllowed = (env: Env = process.env) => env.NODE_ENV !== "production" || env.CREATE_MOCK === "1";
export const mockForced = (env: Env = process.env) => env.CREATE_MOCK === "1";
export const dailyCap = (env: Env = process.env) => {
  const v = Number(env.CREATE_DAILY_USD ?? 10);
  return Number.isFinite(v) && v >= 0 ? v : 10;
};

export function tokenOk(given: string | null | undefined, env: Env = process.env): boolean {
  const want = env.CREATE_TOKEN;
  if (!want) return true;
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Start of the server's local day, so "today" matches the owner's clock. */
export const startOfDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** USD spent today on /create lives, from the ledger's `job` tags. */
export function spentToday(entries: Entry[], now = new Date()): number {
  const from = startOfDay(now).getTime();
  return entries.filter((e) => e.job?.startsWith(JOB_PREFIX) && Date.parse(e.at) >= from).reduce((a, e) => a + e.usd, 0);
}

export interface Refusal {
  status: number;
  error: string;
}

/**
 * Everything that must hold before a paid life starts. `left` is the budget guard's headroom
 * before its stop line; `busy` is the slug of a job already running.
 */
export function preflight(o: { env?: Env; entries: Entry[]; left: number; busy?: string | null; token?: string | null; mock?: boolean; now?: Date }): Refusal | null {
  const env = o.env ?? process.env;
  const busy: Refusal | null = o.busy ? { status: 409, error: `Another life (${o.busy}) is being made right now. One at a time: try again when it finishes.` } : null;
  // Rehearsals spend nothing, so they need neither the on switch nor the passcode.
  if (o.mock) return mockAllowed(env) ? busy : { status: 403, error: "Rehearsals are off on this server." };
  if (!createEnabled(env)) return { status: 403, error: "Making new lives is switched off on this server." };
  if (!tokenOk(o.token, env)) return { status: 401, error: "That passcode isn't right." };
  if (busy) return busy;
  if (o.left < MIN_HEADROOM)
    return { status: 402, error: `The event budget has $${o.left.toFixed(2)} left before its stop line; new lives need at least $${MIN_HEADROOM}.` };
  const cap = dailyCap(env), today = spentToday(o.entries, o.now);
  if (today + LIFE_CEILING > cap)
    return { status: 429, error: `Today's allowance for new lives is $${cap.toFixed(2)} and $${today.toFixed(2)} is spent; a life can cost up to $${LIFE_CEILING.toFixed(2)}. Try again tomorrow.` };
  return null;
}

/** "Tan Howe Liang" → "tan-howe-liang"; accents folded, anything else dropped. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** The slug, or slug-2, slug-3… if a life, a page or an asset folder already has it. */
export function uniqueSlug(name: string, taken: (slug: string) => boolean): string {
  const base = slugify(name) || "life";
  for (let i = 1; ; i++) {
    const s = i === 1 ? base : `${base}-${i}`;
    if (!RESERVED.has(s) && !taken(s)) return s;
  }
}

export interface Input {
  name: string;
  hint: string;
}

/** Trim and check the typed fields; returns the clean values or the first problem. */
export function validateInput(name: unknown, hint: unknown): { ok: true; value: Input } | { ok: false; error: string } {
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const n = clean(name), h = clean(hint);
  if (!n) return { ok: false, error: "Type the person's name." };
  if (n.length > LIMITS.name) return { ok: false, error: `Keep the name under ${LIMITS.name} characters.` };
  if (!/\p{L}/u.test(n)) return { ok: false, error: "The name needs at least one letter." };
  if (/[<>{}\[\]\\|`]|https?:|www\./i.test(n)) return { ok: false, error: "Type a name only, without links or symbols." };
  if (h.length > LIMITS.hint) return { ok: false, error: `Keep the hint to one line, under ${LIMITS.hint} characters.` };
  if (/[<>{}\\`]|https?:/i.test(h)) return { ok: false, error: "Keep the hint to plain words, without links." };
  return { ok: true, value: { name: n, hint: h } };
}

/** Sniff the first bytes, so a renamed file can't pass as an image. */
export function sniffImage(bytes: Uint8Array): (typeof PHOTO_TYPES)[number] | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function validatePhoto(p: { type: string; size: number; bytes: Uint8Array }): { ok: true; type: (typeof PHOTO_TYPES)[number] } | { ok: false; error: string } {
  if (p.size > LIMITS.photoBytes) return { ok: false, error: "The photo is over 8 MB; use a smaller one." };
  if (!PHOTO_TYPES.includes(p.type as (typeof PHOTO_TYPES)[number])) return { ok: false, error: "Use a JPEG, PNG or WebP photo." };
  const real = sniffImage(p.bytes);
  if (!real) return { ok: false, error: "That file isn't a readable JPEG, PNG or WebP image." };
  return { ok: true, type: real };
}

/** Real lives one visitor may start per day (rehearsals are free and not counted). */
export const perIpDaily = (env: Env = process.env) => {
  const v = Number(env.CREATE_PER_IP_DAILY ?? 2);
  return Number.isFinite(v) && v >= 0 ? v : 2;
};

/** The visitor's address as the proxy reports it (first X-Forwarded-For hop), else "local". */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || headers.get("x-real-ip")?.trim() || "local").slice(0, 64);
}

/**
 * Starts per visitor per local day, kept in memory (a restart forgets; the daily dollar cap
 * still holds). `check` before starting, `hit` once a real life has started.
 */
export class IpLimit {
  private seen = new Map<string, number[]>();
  constructor(private max: () => number) {}
  private today(ip: string, now: Date) {
    const from = startOfDay(now).getTime();
    const kept = (this.seen.get(ip) ?? []).filter((t) => t >= from);
    this.seen.set(ip, kept);
    return kept;
  }
  check(ip: string, now = new Date()): Refusal | null {
    const max = this.max();
    return this.today(ip, now).length >= max
      ? { status: 429, error: `One visitor can make ${max} ${max === 1 ? "life" : "lives"} a day, and you’ve made yours. Rehearsals are still free; try again tomorrow.` }
      : null;
  }
  hit(ip: string, now = new Date()) {
    this.today(ip, now).push(now.getTime());
  }
}
