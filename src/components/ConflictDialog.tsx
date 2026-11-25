"use client";
import { useEffect, useRef, useState } from "react";
import { canKeepBoth, previewValue, type Choice, type Conflict } from "@/lib/conflict";

/**
 * T40: dialog pilihan saat perubahan Anda bertabrakan dengan perubahan dari tab/perangkat lain.
 * Tidak ada yang ditimpa diam-diam: versi tab lain tetap tersimpan sampai Anda memilih, dan dialog ini tidak bisa ditutup
 * tanpa memilih. Tiap bagian yang bertabrakan dipilih sendiri-sendiri.
 */
export function ConflictDialog({ conflicts, labelOf, onResolve }: { conflicts: Conflict[]; labelOf: (slot: string) => string; onResolve: (choices: Record<string, Choice>) => void }) {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);

  const allChosen = conflicts.every((c) => choices[c.slot]);
  const setAll = (ch: Choice) => setChoices(Object.fromEntries(conflicts.map((c) => [c.slot, ch])));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div ref={box} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="konflik-judul" aria-describedby="konflik-isi" className="card max-h-[88vh] w-full max-w-3xl overflow-y-auto p-5 outline-none">
        <h2 id="konflik-judul" className="text-lg font-semibold">
          Dokumen ini juga diubah di tempat lain
        </h2>
        <p id="konflik-isi" className="mt-1 text-sm text-muted">
          {conflicts.length} bagian diubah di tab atau perangkat lain pada saat yang sama dengan perubahan Anda. Versi dari tempat lain masih tersimpan dan belum ditimpa. Pilih versi yang dipakai untuk setiap bagian.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm" onClick={() => setAll("mine")}>
            Pakai semua versi saya
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setAll("theirs")}>
            Pakai semua versi dari tempat lain
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {conflicts.map((c) => {
            const name = `konflik-${c.slot}`;
            const pick = (ch: Choice) => setChoices((m) => ({ ...m, [c.slot]: ch }));
            return (
              <fieldset key={c.slot} className="rounded-md border border-line p-3">
                <legend className="px-1 text-sm font-semibold">{labelOf(c.slot)}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={`block cursor-pointer rounded-md border p-2 ${choices[c.slot] === "mine" ? "border-brand" : "border-line"}`}>
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <input type="radio" name={name} checked={choices[c.slot] === "mine"} onChange={() => pick("mine")} /> Versi saya
                    </span>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{previewValue(c.mine)}</pre>
                  </label>
                  <label className={`block cursor-pointer rounded-md border p-2 ${choices[c.slot] === "theirs" ? "border-brand" : "border-line"}`}>
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <input type="radio" name={name} checked={choices[c.slot] === "theirs"} onChange={() => pick("theirs")} /> Versi dari tempat lain
                    </span>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{previewValue(c.theirs)}</pre>
                  </label>
                </div>
                {canKeepBoth(c) && (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name={name} checked={choices[c.slot] === "both"} onChange={() => pick("both")} /> Simpan keduanya (versi dari tempat lain, lalu versi saya di bawahnya)
                  </label>
                )}
              </fieldset>
            );
          })}
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" className="btn btn-primary" disabled={!allChosen} onClick={() => {
              onResolve(choices);
              setChoices({});
            }}>
            Terapkan pilihan
          </button>
        </div>
      </div>
    </div>
  );
}
