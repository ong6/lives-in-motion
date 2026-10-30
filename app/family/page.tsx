import type { Metadata } from "next";
import { info } from "@/pipeline/family";
import { FamilyBench } from "@/components/family/FamilyBench";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your family’s story · Lives in Motion",
  description:
    "Record a grandparent telling their life. Muse Voice Transcribe writes it down, Muse Spark finds the dated moments and cites each to the second it was said, and Muse Image and SAM 3.1 make it a private illustrated book.",
};

export default function FamilyPage() {
  return <FamilyBench initial={info()} />;
}
