import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecordView } from "@/components/family/RecordView";
import { recordProps } from "./record";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = recordProps((await params).slug);
  return p ? { title: `${p.name}: the recording · Lives in Motion`, robots: { index: false, follow: false } } : {};
}

export default async function FamilyRecordPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = recordProps((await params).slug);
  if (!p) notFound();
  return <RecordView {...p} />;
}
