import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allStories, lifespan } from "@/lib/stories";
import { portraitCredit, portraitSrc } from "@/lib/portraits";
import { StoryPlayer } from "@/components/StoryPlayer";
import { firstPages } from "@/components/book/pagination";

export const dynamicParams = false;

export function generateStaticParams() {
  return allStories().map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const story = allStories().find((s) => s.slug === slug);
  return story ? { title: `${story.name} · Lives in Motion`, description: story.tagline } : {};
}

export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const stories = allStories();
  const part = stories.findIndex((s) => s.slug === slug);
  if (part < 0) notFound();
  const story = stories[part];
  const pages = firstPages(stories.map((s) => s.scenes.length));
  const after = stories[part + 1];
  return (
    <StoryPlayer
      story={story}
      lifespan={lifespan(story)}
      portrait={portraitSrc(slug)}
      credit={portraitCredit(slug)}
      part={part}
      firstPage={pages[part]}
      next={after && { slug: after.slug, name: after.name, part: part + 1, page: pages[part + 1] + 1 }}
    />
  );
}
