import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStory, lifespan, readingOrder } from "@/lib/stories";
import { portraitCredit, portraitSrc } from "@/lib/portraits";
import { StoryPlayer } from "@/components/StoryPlayer";
import { firstPages, pagesFor } from "@/components/book/pagination";

// Lives made on /create are written to stories/ while the server runs: read them per request.
export const dynamic = "force-dynamic";
export const dynamicParams = true;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const story = getStory(slug);
  return story ? { title: `${story.name} · Lives in Motion`, description: story.tagline } : {};
}

export default async function StoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ from?: string }> }) {
  const [{ slug }, { from }] = await Promise.all([params, searchParams]);
  // Unlisted lives (drafts, or taken off the shelf) still open by URL, read alone after the shelf.
  const order = readingOrder(slug);
  if (!order) notFound();
  const { stories, part } = order;
  const pages = firstPages(stories.map((s) => s.scenes.length));
  const totalPages = pages.at(-1)! + pagesFor(stories.at(-1)!.scenes.length);
  const lifeAt = (i: number) => ({
    story: stories[i],
    lifespan: lifespan(stories[i]),
    portrait: portraitSrc(stories[i].slug),
    credit: portraitCredit(stories[i].slug),
    part: i,
    firstPage: pages[i],
  });
  return (
    <StoryPlayer
      key={slug}
      life={lifeAt(part)}
      totalPages={totalPages}
      arrive={from === "turn"}
      next={part + 1 < stories.length && stories[part].listed !== false ? lifeAt(part + 1) : undefined}
    />
  );
}
