/**
 * GET  /api/create → CreateInfo: whether making is on, the budget, the estimate, the live job.
 * POST /api/create (multipart: name, hint?, photo?, rights?, token?, mock?, resume?) → 202 { slug }
 *      or { error } with 400 bad input, 401 passcode, 402 budget headroom, 403 off, 409 busy, 429 daily cap.
 */
import { info, start } from "@/pipeline/create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(info(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Send the form as multipart/form-data." }, { status: 400 });
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
    mock: form.get("mock") === "1",
    resume: (form.get("resume") as string | null) || null,
  });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ slug: r.slug }, { status: 202 });
}
