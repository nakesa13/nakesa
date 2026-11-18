import type { Metadata } from "next";
import { SettingsPage } from "@/components/SettingsPage";

export const metadata: Metadata = { title: "Pengaturan — NAKESA" };

export default function Page() {
  return <SettingsPage />;
}
