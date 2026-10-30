/**
 * Audio for family books: an upload or browser recording is sniffed, re-encoded with ffmpeg into
 * the two files a family book keeps, and its metadata (device, GPS, tags) dropped on the way:
 *
 * - recording.wav: mono 16-bit PCM at 24 kHz, the format Muse Voice Transcribe accepts
 *   (https://dev.meta.ai/docs/speech-to-text#convert-audio) and its native rate.
 * - recording.m4a: AAC for the browser, which the timestamp citations play from.
 *
 * The original upload is never kept.
 */
import { execFile } from "node:child_process";
import { stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Muse Voice Transcribe's file limits: 10 minutes of audio, 32 MB of request body. */
export const API_LIMITS = { seconds: 600, bytes: 32 * 1024 * 1024 };
/** What we accept from a visitor: the API's 10 minutes, a few seconds at least, and an upload cap. */
export const AUDIO_LIMITS = { seconds: API_LIMITS.seconds, minSeconds: 5, uploadBytes: 60 * 1024 * 1024 };

export type AudioKind = "webm" | "ogg" | "wav" | "mp4" | "mp3" | "flac" | "aac";

/** Sniff the container from its first bytes, so ffmpeg is only ever handed a real audio file. */
export function sniffAudio(b: Uint8Array): AudioKind | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length < 12) return null;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (ascii(0, 4) === "OggS") return "ogg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  if (ascii(4, 8) === "ftyp") return "mp4";
  if (ascii(0, 4) === "fLaC") return "flac";
  if (ascii(0, 3) === "ID3") return "mp3";
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "aac";
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3";
  return null;
}

/** Seconds of audio in a canonical 24 kHz mono 16-bit WAV (48,000 bytes a second after the header). */
export const wavSeconds = (bytes: number) => Math.max(0, bytes - 44) / 48000;

/**
 * ffmpeg with the input locked to local files: a crafted playlist can't make it fetch URLs.
 * Only the first audio stream is read; video, cover art and metadata are dropped.
 */
async function ffmpeg(input: string, args: string[]) {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "file", "-i", input, "-vn", "-sn", "-dn", "-map", "0:a:0", "-map_metadata", "-1", ...args], {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

/** Re-encode one input (a path) into dir/recording.wav and dir/recording.m4a; returns the length in seconds. */
export async function encodeRecording(input: string, dir: string): Promise<{ seconds: number; wav: string; m4a: string }> {
  const wav = join(dir, "recording.wav");
  const m4a = join(dir, "recording.m4a");
  // Capped a little past the limit so an over-long file is caught without decoding all of it.
  await ffmpeg(input, ["-t", String(AUDIO_LIMITS.seconds + 1), "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-fflags", "+bitexact", wav]);
  const seconds = wavSeconds((await stat(wav)).size);
  await ffmpeg(wav, ["-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", m4a]);
  return { seconds, wav, m4a };
}

/** Write uploaded bytes to a temporary file, re-encode them, and remove the original. */
export async function encodeUpload(bytes: Uint8Array, dir: string) {
  const tmp = join(dir, `upload.${process.pid}.${Date.now()}.bin`);
  await writeFile(tmp, bytes);
  try {
    return await encodeRecording(tmp, dir);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

/** "m:ss" (or "h:mm:ss") for a position in seconds. */
export function clock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
