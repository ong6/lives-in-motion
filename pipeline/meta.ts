/**
 * Minimal Meta Model API client (https://dev.meta.ai/docs). One key covers Muse Spark,
 * Muse Image and SAM 3.1. Shapes the docs give no full example for are marked UNVERIFIED.
 */
const BASE = process.env.META_API_BASE ?? "https://api.meta.ai/v1";

export const MODELS = {
  spark: process.env.META_SPARK_MODEL ?? "muse-spark-1.3",
  image: process.env.META_IMAGE_MODEL ?? "muse-image-1.0",
  sam: process.env.META_SAM_MODEL ?? "sam-3.1",
};

const auth = () => {
  const k = process.env.MODEL_API_KEY;
  if (!k) throw new Error("MODEL_API_KEY is not set: put it in .env (gitignored)");
  return { Authorization: `Bearer ${k}` };
};

async function send<T>(path: string, init: () => RequestInit, tries = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, init());
    if (res.ok) return (await res.json()) as T;
    const text = await res.text();
    if (!(res.status === 429 || res.status >= 500) || attempt >= tries) throw new Error(`${path} ${res.status}: ${text.slice(0, 600)}`);
    await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after")) * 1000 || 1500 * 2 ** attempt));
  }
}

const post = <T = any>(path: string, body: unknown) =>
  send<T>(path, () => ({ method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify(body) }));

export interface Cited {
  text: string;
  citations: { url: string; title: string; start: number; end: number }[];
}

/** Muse Spark with web search (Responses API only); citations are url_citation annotations. */
export async function sparkSearch(prompt: string): Promise<Cited> {
  const r = await post("/responses", { model: MODELS.spark, input: prompt, tools: [{ type: "web_search", search_context_size: "high" }] });
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
export async function sparkJson<T>(system: string, user: string, name: string, schema: object): Promise<T> {
  const r = await post("/chat/completions", {
    model: MODELS.spark,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: { name, schema } },
  });
  return JSON.parse(r.choices[0].message.content) as T;
}

const imageFrom = async (d: any): Promise<Buffer> => {
  if (d?.b64_json) return Buffer.from(d.b64_json, "base64");
  if (d?.url) return Buffer.from(await (await fetch(d.url)).arrayBuffer());
  throw new Error("Muse Image returned no image");
};

/**
 * Muse Image through the Responses API, which takes reference images (up to 10) so a story's
 * plates share one hand. UNVERIFIED: the image_generation tool's option names.
 */
export async function museImage(prompt: string, refs: Buffer[] = [], size = "1:1"): Promise<Buffer> {
  const content: any[] = [{ type: "input_text", text: prompt }];
  for (const ref of refs.slice(0, 10)) content.push({ type: "input_image", image_url: `data:image/png;base64,${ref.toString("base64")}` });
  const r = await post("/responses", {
    model: MODELS.image,
    input: [{ type: "message", role: "user", content }],
    tools: [{ type: "image_generation", size, output_format: "png" }],
  });
  const call = (r.output ?? []).find((o: any) => o.type === "image_generation_call");
  if (call?.result) return Buffer.from(call.result, "base64");
  // Fallback: the OpenAI-Images-compatible route (no references).
  const g = await post("/images/generations", { model: MODELS.image, prompt, size, output_format: "png" });
  return imageFrom(g.data?.[0]);
}

/** Muse Image edit ("change only this"), OpenAI-Images-compatible multipart route. UNVERIFIED field names. */
export async function museEdit(image: Buffer, prompt: string): Promise<Buffer> {
  const r = await send<any>("/images/edits", () => {
    const form = new FormData();
    form.append("model", MODELS.image);
    form.append("prompt", prompt);
    form.append("image", new Blob([new Uint8Array(image)], { type: "image/png" }), "plate.png");
    return { method: "POST", headers: auth(), body: form };
  });
  return imageFrom(r.data?.[0]);
}

/** SAM 3.1 concept segmentation: one short noun phrase per request; returns the raw token text. */
export async function samRaw(image: Buffer, concept: string): Promise<string> {
  const r = await post("/responses", {
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
  });
  return (r.output ?? [])
    .flatMap((o: any) => (o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text))
    .join("");
}
