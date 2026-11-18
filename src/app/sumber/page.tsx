import type { Metadata } from "next";
import { LibraryPage } from "@/components/LibraryPage";

export const metadata: Metadata = { title: "Pustaka Referensi — NAKESA" };

export default function Page() {
  return <LibraryPage />;
}
