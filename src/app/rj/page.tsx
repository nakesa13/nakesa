import type { Metadata } from "next";
import { Wizard } from "@/components/Wizard";
import { TEMPLATES } from "@/templates";

export const metadata: Metadata = { title: `${TEMPLATES.RJ.name} — NAKESA` };

export default function Page() {
  return <Wizard docType="RJ" />;
}
