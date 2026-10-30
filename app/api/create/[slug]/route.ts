/** GET /api/create/<slug> → the job as JSON (polling fallback for the event stream). */
import { budget, getJob } from "@/pipeline/create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return Response.json({ error: "No such life." }, { status: 404 });
  const job = getJob(slug);
  if (!job) return Response.json({ error: "No such life." }, { status: 404 });
  return Response.json({ job, budget: budget() }, { headers: { "Cache-Control": "no-store" } });
}
