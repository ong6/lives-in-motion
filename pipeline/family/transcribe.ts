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
 * Price: $0.18 an hour of audio processed (PRICES.transcribe in pipeline/budget.ts); the HTTP call
 * itself, its retries and its billing are `museTranscribe` in pipeline/meta.ts.
 */
import { readFile } from "node:fs/promises";
import { transcribeCost } from "../budget";
import { MODELS, museTranscribe } from "../meta";
import { wavSeconds } from "./audio";

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
  return { model: MODELS.transcribe, mode, sessionId: r?.sessionId, durationMs: Number(r?.audioDurationMs) || 0, text, turns, usd: transcribeCost(Number(r?.audioDurationMs) || 0), ...(untimed ? { untimed } : {}) };
}

export interface TranscribeOptions {
  mode?: "DIARIZATION" | "ENDPOINTING" | "PUSH_TO_TALK";
  languages?: string[];
  keywords?: string[];
  note?: string;
}

/** Transcribe a 24 kHz mono WAV (see audio.ts), at most 10 minutes long. */
export async function transcribe(wavFile: string, opts: TranscribeOptions = {}): Promise<Transcript> {
  const wav = await readFile(wavFile);
  const seconds = wavSeconds(wav.length);
  if (seconds > 600) throw new Error(`the recording is ${Math.round(seconds)} s; Muse Voice Transcribe takes at most 10 minutes`);
  const mode = opts.mode ?? "DIARIZATION";
  const request = {
    audioEncoding: "WAV",
    mode,
    languageBias: opts.languages ?? SG_LANGUAGES,
    keywords: [...new Set([...SG_KEYWORDS, ...(opts.keywords ?? [])])].slice(0, 100),
  };
  const r = await museTranscribe(wav, request, seconds, opts.note ?? `transcribe ${Math.round(seconds)} s`);
  const t = parseTranscribe(r, mode);
  if (!t.durationMs) t.durationMs = Math.round(seconds * 1000);
  return t;
}
