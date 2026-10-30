import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allStories, getStory, lifespan } from "@/lib/stories";
import { portraitCredit, portraitSrc } from "@/lib/portraits";
import { StoryPlayer } from "@/components/StoryPlayer";

export const dynamicParams = false;

export function generateStaticParams() {
  return allStories().map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const story = getStory((await params).slug);
  return story ? { title: `${story.name} · Lives in Motion`, description: story.tagline } : {};
}

export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const story = getStory(slug);
  if (!story) notFound();
  return <StoryPlayer story={story} lifespan={lifespan(story)} portrait={portraitSrc(slug)} credit={portraitCredit(slug)} />;
}
