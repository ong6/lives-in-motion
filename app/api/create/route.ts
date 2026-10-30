/**
 * GET  /api/create → CreateInfo: whether making is on, the budget, the estimate, the live job.
 * POST /api/create (multipart: name, hint?, photo?, rights?, token?, mock?, resume?) → 202 { slug }
 *      or { error } with 400 bad input, 401 passcode, 402 budget headroom, 403 off, 409 busy,
 *      429 daily cap or this visitor's 2 lives a day (CREATE_PER_IP_DAILY; rehearsals don't count).
 *      A visitor is told apart by X-Forwarded-For only with TRUST_PROXY=1 (behind a proxy that sets
 *      it); otherwise every visitor shares one bucket, since the header can be spoofed.
 */
import { info, start } from "@/pipeline/create";
import { IpLimit, clientIp, mockForced, perIpDaily } from "@/pipeline/jobs/guard";
import { withShelf } from "@/components/create/shelf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One limiter per server process; it lives on globalThis so hot reloads keep the counts.
const G = globalThis as unknown as { __limIpLimit?: IpLimit };
const perIp = (G.__limIpLimit ??= new IpLimit(() => perIpDaily()));

export function GET() {
  return Response.json(withShelf(info()), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Send the form as multipart/form-data." }, { status: 400 });
  }
  const mock = form.get("mock") === "1" || mockForced();
  // Route handlers get no socket address, so without a trusted proxy this is the shared bucket.
  const ip = clientIp(req.headers);
  // Picking up a stopped life isn't a new one.
  const counted = !mock && !form.get("resume");
  if (counted) {
    const limited = perIp.check(ip);
    if (limited) return Response.json({ error: limited.error }, { status: limited.status });
  }
  const file = form.get("photo");
  const photo = file instanceof File && file.size > 0 ? file : null;
  if (photo && form.get("rights") !== "on")
    return Response.json({ error: "Tick the box to confirm you have the right to use this photo, or remove it." }, { status: 400 });
  if (photo && photo.size > 8 * 1024 * 1024) return Response.json({ error: "The photo is over 8 MB; use a smaller one." }, { status: 400 });
  const r = await start({
    name: form.get("name"),
    hint: form.get("hint") ?? "",
    photo: photo ? { type: photo.type, size: photo.size, bytes: new Uint8Array(await photo.arrayBuffer()) } : null,
    token: (form.get("token") as string | null) ?? req.headers.get("x-create-token"),
    mock,
    resume: (form.get("resume") as string | null) || null,
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  // Counted once a real life has started (a declined name counts too: its check was a paid call).
  if (counted) perIp.hit(ip);
  return Response.json({ slug: r.slug }, { status: 202 });
}
