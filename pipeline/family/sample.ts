/**
 * The demo recording: a fictional oral history (sample/script.txt), voiced on this Mac with the
 * system `say` voices and joined with ffmpeg. Nobody in it is real, and it says so everywhere it
 * appears. The voicing also writes the true timeline of every line, so a transcription can be
 * scored against what was actually said.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ROOT } from "../root";

const run = promisify(execFile);

export const SAMPLE = {
  slug: "ah-ma-sample",
  name: "Ah Ma",
  hint: "a Singaporean grandmother, a seamstress and hawker, telling her own story to a grandchild",
  label: "A fictional sample recording, voiced by a computer",
  /** Ah Ma, and the grandchild asking the questions. */
  voices: { A: { voice: "Grandma (English (UK))", rate: 158 }, G: { voice: "Samantha", rate: 175 } } as Record<string, { voice: string; rate: number }>,
  script: join(ROOT, "pipeline/family/sample/script.txt"),
  /** What a visitor downloads to try the upload themselves. */
  publicWav: join(ROOT, "public/family/ah-ma-sample.wav"),
  timeline: join(ROOT, "pipeline/family/sample/timeline.json"),
};

export interface ScriptLine {
  speaker: string;
  text: string;
}

export function parseScript(text: string): ScriptLine[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const m = l.match(/^([A-Z]):\s*(.+)$/);
      if (!m) throw new Error(`script line without a speaker: ${l}`);
      return { speaker: m[1], text: m[2] };
    });
}

const seconds = async (file: string) => Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])).stdout.trim());

/** Voice the script into public/family/ah-ma-sample.wav (24 kHz mono) and write its timeline. */
export async function voiceSample(gap = 0.7) {
  const lines = parseScript(await readFile(SAMPLE.script, "utf8"));
  const tmp = await mkdtemp(join(tmpdir(), "lim-voice-"));
  try {
    const parts: string[] = [];
    const timeline: { n: number; speaker: string; startMs: number; endMs: number; text: string }[] = [];
    let t = 0.5;
    const silence = join(tmp, "gap.wav");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `anullsrc=r=24000:cl=mono`, "-t", String(gap), "-c:a", "pcm_s16le", silence]);
    const lead = join(tmp, "lead.wav");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `anullsrc=r=24000:cl=mono`, "-t", "0.5", "-c:a", "pcm_s16le", lead]);
    parts.push(lead);
    for (const [i, line] of lines.entries()) {
      const v = SAMPLE.voices[line.speaker];
      if (!v) throw new Error(`no voice for speaker ${line.speaker}`);
      const aiff = join(tmp, `${i}.aiff`);
      const wav = join(tmp, `${i}.wav`);
      await run("say", ["-v", v.voice, "-r", String(v.rate), "-o", aiff, line.text]);
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", aiff, "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", wav]);
      const d = await seconds(wav);
      timeline.push({ n: i + 1, speaker: line.speaker, startMs: Math.round(t * 1000), endMs: Math.round((t + d) * 1000), text: line.text });
      t += d + gap;
      parts.push(wav, silence);
    }
    const list = join(tmp, "list.txt");
    await writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
    await mkdir(join(SAMPLE.publicWav, ".."), { recursive: true });
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", "-map_metadata", "-1", "-fflags", "+bitexact", SAMPLE.publicWav]);
    await writeFile(SAMPLE.timeline, JSON.stringify({ note: `${SAMPLE.label}. True start and end of each scripted line.`, seconds: +t.toFixed(2), lines: timeline }, null, 2) + "\n");
    return { file: SAMPLE.publicWav, seconds: await seconds(SAMPLE.publicWav), lines: timeline.length };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
