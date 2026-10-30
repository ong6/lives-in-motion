/**
 * Turns a pipeline error line into something a visitor can read. The raw text (often an API
 * response body) is kept as `detail` for a disclosure, never shown as the message itself.
 */
export interface Explained {
  text: string;
  detail?: string;
}

const LEADS: [RegExp, string][] = [
  [/^no frontispiece:\s*/i, "No frontispiece; the book opens without one. "],
  [/^plate failed:\s*/i, "This plate wasn’t painted. "],
  [/^cut-outs failed:\s*/i, "This plate wasn’t cut into layers; it stays flat. "],
];

const CAUSES: [RegExp, string][] = [
  [/^budget guard|budget:/i, "Stopped by the spending guard before going over budget. Nothing more was charged."],
  [/\b429\b|rate.?limit|too many requests/i, "Meta’s API was busy and asked us to slow down, more times than we retry."],
  [/\b5\d\d\b|timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up|network/i, "Meta’s API didn’t answer in time."],
  [/\b40[13]\b|unauthori[sz]ed|forbidden|api key/i, "This server’s Meta API key was refused."],
  [/\b4\d\d\b|invalid_request|unknown value|param|schema|validation/i, "Meta’s API rejected a setting in our request. That’s a bug on our side, not something you typed."],
  [/ffmpeg|sharp|ENOENT|EACCES/i, "A local tool on the server failed."],
];

/** Already plain English: short, no braces, quotes or status codes. */
const plain = (s: string) => s.length <= 160 && !/[{}[\]`]|HTTP \d|\/\w+ \d{3}|"\w+":/.test(s);

export function explain(raw: string | undefined | null): Explained {
  const r = (raw ?? "").trim();
  if (!r) return { text: "" };
  if (/content policy|declined/i.test(r) || /renderer stopped/i.test(r)) return { text: r };
  let lead = "";
  let rest = r;
  for (const [re, l] of LEADS)
    if (re.test(rest)) {
      lead = l;
      rest = rest.replace(re, "");
      break;
    }
  const cause = CAUSES.find(([re]) => re.test(rest))?.[1];
  if (cause) return { text: `${lead}${cause}`, detail: r };
  if (!lead && plain(r)) return { text: r };
  return { text: `${lead}${lead ? "" : "This step hit an unexpected error."}`.trim(), detail: r };
}
