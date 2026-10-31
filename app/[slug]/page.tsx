import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStory, lifespan, readingOrder } from "@/lib/stories";
import { portraitCredit, portraitSrc } from "@/lib/portraits";
import { StoryPlayer } from "@/components/book/StoryPlayer";
import { directionsFor } from "@/components/book/direction.server";

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
  const { stories, index } = order;
  const lifeAt = (i: number) => ({
    story: stories[i],
    lifespan: lifespan(stories[i]),
    portrait: portraitSrc(stories[i].slug),
    credit: portraitCredit(stories[i].slug),
    index: i,
    directions: i === index ? directionsFor(stories[i].slug) : undefined,
  });
  return (
    <StoryPlayer
      key={slug}
      life={lifeAt(index)}
      arrive={from === "turn"}
      next={index + 1 < stories.length && stories[index].listed !== false ? lifeAt(index + 1) : undefined}
    />
  );
}
