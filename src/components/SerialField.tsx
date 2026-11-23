"use client";
import { useState } from "react";
import { MEASURE_KINDS, addMeasurement, formatAt, parseSerial, removeMeasurement, serializeSerial, sortMeasurements } from "@/lib/anc";

/** Waktu setempat sekarang untuk input datetime-local ("YYYY-MM-DDTHH:mm"). Hanya diisi bila pengguna menekan tombolnya. */
function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Pengukuran serial (T09). Setiap pengukuran punya waktu sendiri; menambah tidak pernah menimpa yang sudah ada.
 * Nilai disimpan persis seperti yang diketik. Tidak ada nilai awal dan tidak ada tafsiran klinis di sini.
 */
export function SerialField({ label, help, value, onChange }: { label: string; help?: string; value: string; onChange: (v: string) => void }) {
  const parsed = parseSerial(value);
  const [at, setAt] = useState("");
  const [kind, setKind] = useState("td");
  const [val, setVal] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const meta = MEASURE_KINDS.find((k) => k.id === kind);

  const add = () => {
    const r = addMeasurement(parsed.items, { at, kind, value: val, note });
    if (r.error) {
      setErr(r.error);
      return;
    }
    setErr("");
    onChange(serializeSerial(r.items));
    // Waktu dibiarkan agar beberapa pemeriksaan pada waktu yang sama mudah dicatat berurutan.
    setVal("");
    setNote("");
  };

  const remove = (id: string) => {
    if (!window.confirm("Hapus pengukuran ini?")) return;
    onChange(serializeSerial(removeMeasurement(parsed.items, id)));
  };

  return (
    <div>
      <p className="label">{label}</p>
      {help && <p className="help">{help}</p>}

      {parsed.corrupt && <p className="mt-2 rounded-md bg-[var(--warn-bg)] p-2 text-xs text-[var(--warn-ink)]">Data pengukuran tidak terbaca dan tidak ditampilkan. Menambah pengukuran baru akan memulai daftar baru.</p>}
      {parsed.dropped > 0 && <p className="mt-2 rounded-md bg-[var(--warn-bg)] p-2 text-xs text-[var(--warn-ink)]">{parsed.dropped} entri tidak sah diabaikan.</p>}

      <div className="mt-2 grid gap-2 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="ser_at">
            Waktu pengukuran
          </label>
          <div className="flex gap-1">
            <input id="ser_at" type="datetime-local" className="field" value={at} onChange={(e) => setAt(e.target.value)} />
            <button type="button" className="btn btn-sm" onClick={() => setAt(nowLocal())}>
              Sekarang
            </button>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="ser_kind">
            Pemeriksaan
          </label>
          <select id="ser_kind" className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
            {MEASURE_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ser_val">
            Hasil{meta ? ` (${meta.unit})` : ""}
          </label>
          <input id="ser_val" className="field" value={val} placeholder={meta?.placeholder} onChange={(e) => setVal(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="ser_note">
            Keterangan (opsional)
          </label>
          <input id="ser_note" className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className="btn btn-sm" onClick={add}>
          Tambah pengukuran
        </button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>

      {parsed.items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Belum ada pengukuran. Di dokumen akan tertulis [belum diisi].</p>
      ) : (
        <ul className="mt-3 space-y-1 text-sm">
          {sortMeasurements(parsed.items).map((i) => {
            const k = MEASURE_KINDS.find((x) => x.id === i.kind);
            return (
              <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-1.5">
                <span className="text-xs text-muted">{formatAt(i.at)}</span>
                <span className="font-medium">{k?.label ?? i.kind}</span>
                <span>
                  {i.value} {k?.unit}
                </span>
                {i.note && <span className="text-xs text-muted">({i.note})</span>}
                <button type="button" className="ml-auto text-xs text-brand underline" onClick={() => remove(i.id)}>
                  Hapus
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
