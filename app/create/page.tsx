import type { Metadata } from "next";
import { info } from "@/pipeline/create";
import { Workbench } from "@/components/create/Workbench";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Make a new life · Lives in Motion",
  description: "Type a Singaporean's name and watch Meta's Muse Spark research it with citations, Muse Image paint its seven scenes and SAM 3.1 cut them into layers.",
};

export default function CreatePage() {
  return <Workbench initial={info()} />;
}
