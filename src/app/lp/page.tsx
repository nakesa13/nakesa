import type { Metadata } from "next";
import { Wizard } from "@/components/Wizard";
import { TEMPLATES } from "@/templates";

export const metadata: Metadata = { title: `${TEMPLATES.LP.name} — NAKESA` };

export default function Page() {
  return <Wizard docType="LP" />;
}
