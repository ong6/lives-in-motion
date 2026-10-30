/**
 * GET /api/family/<slug>/stream → Server-Sent Events. Each `data:` is { job, budget }, sent on
 * every change (at most four a second) and closed once the job has finished.
 */
import { budgetNow, getJob, subscribe } from "@/pipeline/family";
import type { FamilyJob } from "@/pipeline/family/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !getJob(slug)) return Response.json({ error: "No such family book." }, { status: 404 });
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      let closed = false;
      const send = (job: FamilyJob) => {
        if (closed) return;
        try {
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ job, budget: budgetNow() })}\n\n`));
        } catch {
          return stop();
        }
        if (job.status !== "running") stop();
      };
      const off = subscribe((job) => job.slug === slug && send(job));
      const beat = setInterval(() => !closed && ctrl.enqueue(enc.encode(`: still here\n\n`)), 15000);
      stop = () => {
        if (closed) return;
        closed = true;
        off();
        clearInterval(beat);
        try {
          ctrl.close();
        } catch {}
      };
      req.signal.addEventListener("abort", stop);
      send(getJob(slug)!);
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
