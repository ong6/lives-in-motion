/**
 * Meta Muse Voice Transcribe (muse-voice-transcribe-1.0) for family recordings.
 *
 * File endpoint: POST https://api.meta.ai/v1/asr/transcribe, multipart with a `request` JSON part
 * and an `audio` part. It takes RIFF/WAVE, mono, 16-bit PCM at 16 or 24 kHz; at most 10 minutes
 * of audio and a 32 MB body. In ENDPOINTING or DIARIZATION mode it returns `turns`, each with
 * `startMs`/`endMs` (turn-level timestamps; there are no word timestamps) and, with diarization,
 * a session-scoped speaker label ("A", "B"). 25 languages with code-switching, including English,
 * Malay, Mandarin Chinese and Tamil; Hokkien, Teochew and Cantonese are not on the list.
 * Docs: https://dev.meta.ai/docs/speech-to-text, https://dev.meta.ai/docs/api-reference/voice/transcribe
 *
 * Price: $0.18 an hour of audio processed, rounded down to whole seconds; failed and rate-limited
 * (429) requests are not billed (https://dev.meta.ai/docs/pricing-rate-limits#muse-voice-transcribe-pricing).
 * pipeline/budget.ts has no price for it, so it lives here, and every call goes through `guard`.
 */
import { readFile } from "node:fs/promises";
import { currentScope, guard, type Entry } from "../budget";
import { wavSeconds } from "./audio";

const BASE = process.env.META_API_BASE ?? "https://api.meta.ai/v1";
export const TRANSCRIBE_MODEL = process.env.META_TRANSCRIBE_MODEL ?? "muse-voice-transcribe-1.0";
/** USD per second of audio processed ($0.18 an hour). */
export const TRANSCRIBE_PER_SECOND = 0.18 / 3600;
/**
 * The ledger kind for transcription. budget.ts's `Entry["kind"]` union predates this model and
 * isn't ours to edit; the ledger and `pnpm spend` group kinds by their string, so this one
 * shows up as its own line.
 */
export const TRANSCRIBE_KIND = "transcribe" as Entry["kind"];

/** Languages the model is steered toward for Singapore recordings (it still detects others). */
export const SG_LANGUAGES = ["English", "Malay", "Mandarin Chinese", "Tamil"];
/** Words a Singapore oral history is full of, so they come back spelled the local way. */
export const SG_KEYWORDS = ["kampong", "HDB", "hawker", "samfoo", "cheongsam", "attap", "Ah Ma", "Ah Gong", "makan", "lah", "aiyoh", "Teluk Ayer", "Tiong Bahru", "Queenstown", "Toa Payoh"];

export interface Turn {
  /** 1-based, in recording order. */
  n: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}

export interface Transcript {
  model: string;
  mode: string;
  sessionId?: string;
  durationMs: number;
  text: string;
  turns: Turn[];
  usd: number;
  /** True when the model returned no turns and the text was split into lines without timestamps. */
  untimed?: boolean;
}

/** Billed seconds: the audio processed, rounded down. */
export const transcribeCost = (durationMs: number) => Math.floor(durationMs / 1000) * TRANSCRIBE_PER_SECOND;

/** The API response → numbered turns; a response without turns falls back to sentences without timestamps. */
export function parseTranscribe(r: any, mode: string): Transcript {
  const raw: any[] = Array.isArray(r?.turns) ? r.turns : [];
  let turns: Turn[] = raw
    .filter((t) => typeof t?.transcript === "string" && t.transcript.trim())
    .map((t) => ({ startMs: Number(t.startMs) || 0, endMs: Number(t.endMs) || 0, text: String(t.transcript).trim(), ...(t.speaker ? { speaker: String(t.speaker) } : {}) }))
    .sort((a, b) => a.startMs - b.startMs)
    .map((t, i) => ({ n: i + 1, ...t }));
  const text = String(r?.transcript ?? turns.map((t) => t.text).join(" ")).trim();
  let untimed = false;
  if (!turns.length && text) {
    // No timestamps to cite: cite line numbers of the transcript instead (startMs stays -1).
    untimed = true;
    turns = text
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean)
      .map((t, i) => ({ n: i + 1, startMs: -1, endMs: -1, text: t }));
  }
  return { model: TRANSCRIBE_MODEL, mode, sessionId: r?.sessionId, durationMs: Number(r?.audioDurationMs) || 0, text, turns, usd: transcribeCost(Number(r?.audioDurationMs) || 0), ...(untimed ? { untimed } : {}) };
}

export interface TranscribeOptions {
  mode?: "DIARIZATION" | "ENDPOINTING" | "PUSH_TO_TALK";
  languages?: string[];
  keywords?: string[];
  note?: string;
}

/**
 * Transcribe a 24 kHz mono WAV (see audio.ts). Retries 429s and 5xx with backoff (neither is
 * billed); the worst case priced into the guard is the whole file's length, rounded up.
 */
export async function transcribe(wavFile: string, opts: TranscribeOptions = {}): Promise<Transcript> {
  const wav = await readFile(wavFile);
  const seconds = wavSeconds(wav.length);
  if (seconds > 600) throw new Error(`the recording is ${Math.round(seconds)} s; Muse Voice Transcribe takes at most 10 minutes`);
  const mode = opts.mode ?? "DIARIZATION";
  const request = {
    model: TRANSCRIBE_MODEL,
    audioEncoding: "WAV",
    mode,
    languageBias: opts.languages ?? SG_LANGUAGES,
    keywords: [...new Set([...SG_KEYWORDS, ...(opts.keywords ?? [])])].slice(0, 100),
  };
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY is not set: put it in .env (gitignored)");
  const call = async () => {
    for (let attempt = 1; ; attempt++) {
      const form = new FormData();
      form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }));
      form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "recording.wav");
      let res: Response;
      try {
        res = await fetch(`${BASE}/asr/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, body: form });
      } catch (e) {
        if (attempt >= 4) throw e;
        currentScope()?.onRetry?.(`network error; retrying in ${2 ** attempt} s`);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (res.ok) {
        try {
          return await res.json();
        } catch (e) {
          throw Object.assign(new Error(`/asr/transcribe: response lost mid-read (${String(e).slice(0, 120)})`), { maybeBilled: true });
        }
      }
      const text = await res.text();
      // The docs: retry a 500 once; back off on 429.
      if (!(res.status === 429 || (res.status >= 500 && attempt < 2)) || attempt >= 5) throw new Error(`/asr/transcribe ${res.status}: ${text.slice(0, 600)}`);
      const wait = Number(res.headers.get("retry-after")) * 1000 || 1500 * 2 ** attempt;
      currentScope()?.onRetry?.(`${res.status === 429 ? "rate limited" : `server error ${res.status}`}; retrying in ${Math.round(wait / 1000)} s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  };
  const r = await guard(TRANSCRIBE_KIND, Math.ceil(seconds) * TRANSCRIBE_PER_SECOND, call, (r: any) => {
    const ms = Number(r?.audioDurationMs);
    if (!Number.isFinite(ms) || ms <= 0) throw new Error("no duration");
    return transcribeCost(ms);
  }, opts.note ?? `transcribe ${Math.round(seconds)} s`);
  const t = parseTranscribe(r, mode);
  if (!t.durationMs) t.durationMs = Math.round(seconds * 1000);
  return t;
}
