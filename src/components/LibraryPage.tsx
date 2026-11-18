"use client";
import type { Source } from "@/lib/types";
import { LIBRARY_KEY, SETTINGS_DEFAULT, SETTINGS_KEY, type Settings } from "@/lib/client";
import { useHydrated, useLocalState } from "@/lib/useLocalState";
import { SourceManager } from "./SourceManager";

const EMPTY: Source[] = [];

export function LibraryPage() {
  const hydrated = useHydrated();
  const [lib, setLib] = useLocalState<Source[]>(LIBRARY_KEY, EMPTY);
  const [settings] = useLocalState<Settings>(SETTINGS_KEY, SETTINGS_DEFAULT);
  if (!hydrated) return <div className="card h-40 animate-pulse" />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Pustaka Referensi</h1>
        <p className="mt-1 text-sm text-muted">
          Simpan sumber yang sering dipakai, lalu ambil di langkah Referensi pada LP/LK. Tersimpan di peramban perangkat ini saja.
        </p>
      </div>
      <SourceManager sources={lib} onChange={setLib} accessCode={settings.accessCode} />
    </div>
  );
}
