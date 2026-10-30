/**
 * GET  /api/family → FamilyInfo: whether making is on, the budget, limits, the sample, the live job.
 * POST /api/family (multipart: name, hint?, keywords?, audio, photos[]?, consent?, token?, mock?)
 *      → 202 { slug, key } (key: the book's delete key, shown once) or { error } with 400 bad
 *      input, 401 passcode, 402 budget headroom, 403 off, 409 busy, 429 daily cap or this
 *      visitor's limit (CREATE_PER_IP_DAILY, shared with /create's rules; replays don't count).
 */
import { info, start } from "@/pipeline/family";
import { IpLimit, clientIp, mockForced, perIpDaily } from "@/pipeline/create/guard";
import { AUDIO_LIMITS } from "@/pipeline/family/audio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const G = globalThis as unknown as { __limFamilyIpLimit?: IpLimit };
const perIp = (G.__limFamilyIpLimit ??= new IpLimit(() => perIpDaily()));

/** Where this visitor reached the site: citation links point back here, where the recording is kept. */
function originOf(req: Request): string {
  if (process.env.FAMILY_ORIGIN) return process.env.FAMILY_ORIGIN.replace(/\/$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function GET() {
  return Response.json(info(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > AUDIO_LIMITS.uploadBytes + 30 * 1024 * 1024) return Response.json({ error: "That upload is too large." }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Send the form as multipart/form-data." }, { status: 400 });
  }
  const mock = form.get("mock") === "1" || mockForced();
  const ip = clientIp(req.headers);
  if (!mock) {
    const limited = perIp.check(ip);
    if (limited) return Response.json({ error: limited.error.replace("lives", "books").replace("life", "book") }, { status: limited.status });
  }
  const audio = form.get("audio");
  const photos = form.getAll("photos").filter((p): p is File => p instanceof File && p.size > 0);
  if (photos.length && form.get("consent") !== "on")
    return Response.json({ error: "Tick the box to confirm the family agrees to these photos being used, or remove them." }, { status: 400 });
  const r = await start({
    name: form.get("name"),
    hint: form.get("hint") ?? "",
    keywords: form.get("keywords") ?? "",
    audio: audio instanceof File && audio.size > 0 ? { size: audio.size, bytes: new Uint8Array(await audio.arrayBuffer()) } : null,
    photos: await Promise.all(photos.map(async (p) => ({ type: p.type, size: p.size, bytes: new Uint8Array(await p.arrayBuffer()) }))),
    token: (form.get("token") as string | null) ?? req.headers.get("x-create-token"),
    mock,
    origin: originOf(req),
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  if (!mock) perIp.hit(ip);
  return Response.json({ slug: r.slug, key: r.key }, { status: 202 });
}
