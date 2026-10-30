/** GET /api/create/<slug> → the job as JSON (polling fallback for the event stream). */
import { getJob } from "@/pipeline/create";
import { budgetNow } from "@/pipeline/jobs/guard";
import { SLUG } from "@/pipeline/jobs/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) return Response.json({ error: "No such life." }, { status: 404 });
  const job = getJob(slug);
  if (!job) return Response.json({ error: "No such life." }, { status: 404 });
  return Response.json({ job, budget: budgetNow() }, { headers: { "Cache-Control": "no-store" } });
}
