import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allStories, lifespan } from "@/lib/stories";
import { portraitCredit, portraitSrc } from "@/lib/portraits";
import { StoryPlayer } from "@/components/StoryPlayer";
import { firstPages, pagesFor } from "@/components/book/pagination";

// Lives made on /create are written to stories/ while the server runs: read them per request.
export const dynamic = "force-dynamic";
export const dynamicParams = true;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const story = allStories().find((s) => s.slug === slug);
  return story ? { title: `${story.name} · Lives in Motion`, description: story.tagline } : {};
}

export default async function StoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ from?: string }> }) {
  const [{ slug }, { from }] = await Promise.all([params, searchParams]);
  const stories = allStories();
  const part = stories.findIndex((s) => s.slug === slug);
  if (part < 0) notFound();
  const story = stories[part];
  const pages = firstPages(stories.map((s) => s.scenes.length));
  const totalPages = pages.at(-1)! + pagesFor(stories.at(-1)!.scenes.length);
  const after = stories[part + 1];
  return (
    <StoryPlayer
      key={slug}
      story={story}
      lifespan={lifespan(story)}
      portrait={portraitSrc(slug)}
      credit={portraitCredit(slug)}
      part={part}
      firstPage={pages[part]}
      totalPages={totalPages}
      arrive={from === "turn"}
      next={
        after && {
          slug: after.slug,
          name: after.name,
          lifespan: lifespan(after),
          tagline: after.tagline,
          part: part + 1,
          portrait: portraitSrc(after.slug),
          credit: portraitCredit(after.slug),
          firstYear: after.scenes[0].year,
          plate: after.scenes[0].plate,
        }
      }
    />
  );
}
