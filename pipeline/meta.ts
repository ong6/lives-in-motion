/**
 * The one Meta Model API client (https://dev.meta.ai/docs). One key covers every model: Muse
 * Spark, Muse Image, SAM 3.1, Muse Wonder and Muse Voice Transcribe. Every call goes through
 * `send` (auth, retries) inside `guard` (pipeline/budget.ts: the stop line, the ledger), priced
 * from budget.ts's PRICES. Shapes the docs give no full example for are marked UNVERIFIED.
 */
import { PRICES, currentScope, guard, sparkCost, sparkWorst, transcribeCost, wonderCost, wonderWorst } from "./budget";

const BASE = process.env.META_API_BASE ?? "https://api.meta.ai/v1";

/** Every model id, overridable from the environment. */
export const MODELS = {
  spark: process.env.META_SPARK_MODEL ?? "muse-spark-1.3",
  image: process.env.META_IMAGE_MODEL ?? "muse-image-1.0",
  sam: process.env.META_SAM_MODEL ?? "sam-3.1",
  wonder: process.env.META_WONDER_MODEL ?? "muse-wonder-1.0",
  transcribe: process.env.META_TRANSCRIBE_MODEL ?? "muse-voice-transcribe-1.0",
};

const auth = () => {
  const k = process.env.MODEL_API_KEY;
  if (!k) throw new Error("MODEL_API_KEY is not set: put it in .env (gitignored)");
  return { Authorization: `Bearer ${k}` };
};

/** When `send` tries again. Nothing is billed for a failed connection, a 429 or a 5xx. */
export interface Retry {
  /** Most attempts in all. */
  tries: number;
  /** Most attempts when the connection fails before any response. */
  networkTries: number;
  /** Wait before attempt `attempt + 1` after a connection failure, in ms. */
  networkWait: (attempt: number) => number;
  /** Whether an HTTP status is worth another attempt. */
  retryable: (status: number, attempt: number) => boolean;
}

/** The JSON endpoints: back off on 429 and 5xx, six attempts. */
export const JSON_RETRY: Retry = { tries: 6, networkTries: 6, networkWait: (a) => 2000 * 2 ** a, retryable: (s) => s === 429 || s >= 500 };
/** Muse Voice Transcribe: the docs say retry a 500 once and back off on 429. */
export const TRANSCRIBE_RETRY: Retry = { tries: 5, networkTries: 4, networkWait: (a) => 1000 * 2 ** a, retryable: (s, a) => s === 429 || (s >= 500 && a < 2) };

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One request with retries. `init` builds the request afresh for each attempt (a multipart body
 * can't be sent twice). A response that arrives but can't be read may have been billed, so it is
 * never retried: the error carries `maybeBilled` and `guard` records the worst case.
 */
export async function send<T>(path: string, init: () => RequestInit, retry: Retry = JSON_RETRY): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, init());
    } catch (e) {
      if (attempt >= retry.networkTries) throw e;
      const wait = retry.networkWait(attempt);
      currentScope()?.onRetry?.(`network error (${String((e as Error)?.message ?? e).slice(0, 60)}); retrying in ${wait / 1000} s`);
      await sleep(wait);
      continue;
    }
    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch (e) {
        throw Object.assign(new Error(`${path}: response lost mid-read (${String(e).slice(0, 120)})`), { maybeBilled: true });
      }
    }
    const text = await res.text();
    if (!retry.retryable(res.status, attempt) || attempt >= retry.tries) throw new Error(`${path} ${res.status}: ${text.slice(0, 600)}`);
    const wait = Number(res.headers.get("retry-after")) * 1000 || 1500 * 2 ** attempt;
    currentScope()?.onRetry?.(`${res.status === 429 ? "rate limited" : `server error ${res.status}`}; retrying in ${Math.round(wait / 1000)} s`);
    await sleep(wait);
  }
}

const post = <T = any>(path: string, body: unknown) =>
  send<T>(path, () => ({ method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify(body) }));

export interface Cited {
  text: string;
  citations: { url: string; title: string; start: number; end: number }[];
}

/** Muse Spark with web search (Responses API only); citations are url_citation annotations. */
const SEARCH_OUTPUT_CAP = 16000;
/** Searches one research call may run; only used to price the worst case. */
const SEARCH_WORST = 40;

/**
 * Muse Spark with web search. `opts` (all optional) trims a small lookup: a lower search context,
 * a smaller output cap and search count for the worst case, and the ledger note.
 */
export async function sparkSearch(prompt: string, opts: { context?: "low" | "medium" | "high"; maxOutput?: number; maxSearches?: number; note?: string } = {}): Promise<Cited> {
  const cap = opts.maxOutput ?? SEARCH_OUTPUT_CAP;
  const r = await guard(
    "search",
    sparkWorst(prompt.length, cap, opts.maxSearches ?? SEARCH_WORST),
    () => post("/responses", { model: MODELS.spark, input: prompt, max_output_tokens: cap, tools: [{ type: "web_search", search_context_size: opts.context ?? "high" }] }),
    (r: any) => sparkCost(r.usage, (r.output ?? []).filter((o: any) => o.type === "web_search_call").length),
    opts.note ?? prompt.slice(0, 60),
  );
  const out: Cited = { text: "", citations: [] };
  for (const item of r.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      const offset = out.text.length;
      out.text += part.text;
      for (const a of part.annotations ?? [])
        if (a.type === "url_citation") out.citations.push({ url: a.url, title: a.title ?? a.url, start: offset + a.start_index, end: offset + a.end_index });
    }
  }
  return out;
}

/** Muse Spark structured output (Chat Completions, json_schema). */
export async function sparkJson<T>(system: string, user: string, name: string, schema: object, opts: { maxTokens?: number; effort?: "low" | "medium" | "high" } = {}): Promise<T> {
  const maxTokens = opts.maxTokens ?? 16000;
  const r = await guard(
    "spark",
    sparkWorst(system.length + user.length + JSON.stringify(schema).length, maxTokens),
    () =>
      post("/chat/completions", {
        model: MODELS.spark,
        max_tokens: maxTokens,
        ...(opts.effort ? { reasoning_effort: opts.effort } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name, schema } },
      }),
    (r: any) => sparkCost(r.usage),
    name,
  );
  const msg = r.choices?.[0]?.message;
  // Paid either way: say why there is no answer rather than parsing nothing.
  if (!msg?.content) throw new Error(`Muse Spark returned no content for ${name} (finish_reason ${r.choices?.[0]?.finish_reason ?? "?"}${msg?.refusal ? `, refusal: ${String(msg.refusal).slice(0, 200)}` : ""}; usage ${JSON.stringify(r.usage ?? {})})`);
  const value = JSON.parse(msg.content);
  if (value == null) throw new Error(`Muse Spark answered ${name} with null (finish_reason ${r.choices?.[0]?.finish_reason ?? "?"}; usage ${JSON.stringify(r.usage ?? {})})`);
  return value as T;
}

/** Muse Image bills per image returned, so a response with no image costs nothing. */
const imagesCost = (r: any) => (r.output ?? []).filter((o: any) => o.type === "image_generation_call" && o.result).length * PRICES.image;

const imageFrom = async (d: any): Promise<Buffer> => {
  if (d?.b64_json) return Buffer.from(d.b64_json, "base64");
  if (d?.url) return Buffer.from(await (await fetch(d.url)).arrayBuffer());
  throw new Error("Muse Image returned no image");
};

/**
 * Muse Image through the Responses API, which takes reference images (up to 10) so a story's
 * plates share one hand. `size` is "WxH" and sets the aspect ratio only (docs: /docs/image-generation).
 */
export async function museImage(prompt: string, refs: Buffer[] = [], size = "1024x1024"): Promise<Buffer> {
  const content: any[] = [{ type: "input_text", text: prompt }];
  for (const ref of refs.slice(0, 10)) content.push({ type: "input_image", image_url: `data:image/png;base64,${ref.toString("base64")}` });
  const r = await guard(
    "image",
    PRICES.image,
    () =>
      post("/responses", {
        model: MODELS.image,
        input: [{ role: "user", content }],
        tools: [{ type: "image_generation", size, output_format: "png" }],
      }),
    imagesCost,
    prompt.slice(0, 60),
  );
  const call = (r.output ?? []).find((o: any) => o.type === "image_generation_call");
  if (call?.result) return Buffer.from(call.result, "base64");
  // Fallback: the OpenAI-Images-compatible route (no references).
  const g = await guard(
    "image",
    PRICES.image,
    () => post("/images/generations", { model: MODELS.image, prompt, size, output_format: "png" }),
    (g: any) => (g.data?.length ?? 0) * PRICES.image,
    prompt.slice(0, 60),
  );
  return imageFrom(g.data?.[0]);
}

/** Muse Image edit ("change only this"): the image plus an instruction on the Responses API. */
export async function museEdit(image: Buffer, prompt: string): Promise<Buffer> {
  const r = await guard(
    "image",
    PRICES.image,
    () =>
      post("/responses", {
        model: MODELS.image,
        input: [
          {
            role: "user",
            content: [
              { type: "input_image", image_url: `data:image/png;base64,${image.toString("base64")}` },
              { type: "input_text", text: prompt },
            ],
          },
        ],
        tools: [{ type: "image_generation", output_format: "png" }],
      }),
    imagesCost,
    `edit: ${prompt.slice(0, 54)}`,
  );
  const call = (r.output ?? []).find((o: any) => o.type === "image_generation_call");
  if (!call?.result) throw new Error("Muse Image edit returned no image");
  return Buffer.from(call.result, "base64");
}

/** SAM 3.1 concept segmentation: one short noun phrase per request; returns the raw token text. */
export async function samRaw(image: Buffer, concept: string): Promise<string> {
  const r = await guard("sam", PRICES.samImage, () => post("/responses", {
    model: MODELS.sam,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: concept },
          { type: "input_image", image_url: `data:image/png;base64,${image.toString("base64")}` },
        ],
      },
    ],
    metadata: { include_confidence: "true" },
  }), () => PRICES.samImage, concept);
  return (r.output ?? [])
    .flatMap((o: any) => (o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text))
    .join("");
}

export interface WonderImage {
  /** Short caption placed just before the image so the model knows what it is looking at. */
  label: string;
  data: Buffer;
  mime?: "image/png" | "image/jpeg" | "image/webp";
}

export interface WonderResult<T> {
  value: T;
  usd: number;
}

/**
 * Muse Wonder with image input and json_schema output (Chat Completions; the model takes images
 * as image_url parts and returns text only: https://dev.meta.ai/docs/models#muse-wonder).
 * Billed per token at $4 in / $20 out per million; reasoning tokens count as output, so the
 * worst case charges the whole max_tokens cap. A response lost mid-read is recorded at the worst
 * case by `guard` (the `maybeBilled` path `send` raises), the same as Muse Image.
 */
export async function museWonderJson<T>(
  system: string,
  user: string,
  images: WonderImage[],
  name: string,
  schema: object,
  opts: { maxTokens?: number; effort?: "minimal" | "low" | "medium" | "high" } = {},
): Promise<WonderResult<T>> {
  const maxTokens = opts.maxTokens ?? 12000;
  const content: any[] = [];
  for (const img of images) {
    content.push({ type: "text", text: img.label });
    content.push({ type: "image_url", image_url: { url: `data:${img.mime ?? "image/jpeg"};base64,${img.data.toString("base64")}` } });
  }
  content.push({ type: "text", text: user });
  const worst = wonderWorst(system.length + user.length + JSON.stringify(schema).length, images.length, maxTokens);
  let usd = worst;
  const r = await guard(
    "wonder",
    worst,
    () =>
      post("/chat/completions", {
        model: MODELS.wonder,
        max_tokens: maxTokens,
        reasoning_effort: opts.effort ?? "low",
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
        response_format: { type: "json_schema", json_schema: { name, schema, strict: true } },
      }),
    (r: any) => (usd = wonderCost(r.usage)),
    name,
  );
  const text = r.choices?.[0]?.message?.content;
  if (!text) throw new Error(`Muse Wonder returned no content (finish_reason ${r.choices?.[0]?.finish_reason ?? "?"})`);
  return { value: JSON.parse(text) as T, usd };
}

/**
 * Muse Voice Transcribe on a WAV file's bytes (POST /asr/transcribe, multipart: a `request` JSON
 * part and an `audio` part). The worst case is the whole file's length, rounded up; the ledger
 * gets the seconds the response says were processed. Returns the raw response.
 */
export async function museTranscribe(wav: Buffer, request: Record<string, unknown>, seconds: number, note: string): Promise<any> {
  const headers = { ...auth(), Accept: "application/json" };
  const body = { model: MODELS.transcribe, ...request };
  return guard(
    "transcribe",
    Math.ceil(seconds) * PRICES.transcribe,
    () =>
      send(
        "/asr/transcribe",
        () => {
          const form = new FormData();
          form.append("request", new Blob([JSON.stringify(body)], { type: "application/json" }));
          form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "recording.wav");
          return { method: "POST", headers, body: form };
        },
        TRANSCRIBE_RETRY,
      ),
    (r: any) => {
      const ms = Number(r?.audioDurationMs);
      if (!Number.isFinite(ms) || ms <= 0) throw new Error("no duration");
      return transcribeCost(ms);
    },
    note,
  );
}
