import type { Metadata } from "next";
import { KasusPage } from "@/components/KasusPage";

export const metadata: Metadata = { title: "Kasus & Konsistensi — NAKESA" };

export default function Page() {
  return <KasusPage />;
}
