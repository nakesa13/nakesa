"use client";
import { DRAFT_PREFIX, LIBRARY_KEY, SETTINGS_DEFAULT, SETTINGS_KEY, type Settings } from "@/lib/client";
import { clearLocal, useHydrated, useLocalState } from "@/lib/useLocalState";

const FIELDS: { id: keyof Settings; label: string; half?: boolean }[] = [
  { id: "nama", label: "Nama mahasiswa", half: true },
  { id: "nim", label: "NIM", half: true },
  { id: "prodi", label: "Program studi", half: true },
  { id: "kampus", label: "Institusi / kampus", half: true },
  { id: "pembimbing", label: "Dosen pembimbing", half: true },
  { id: "tahun", label: "Tahun", half: true },
];

export function SettingsPage() {
  const hydrated = useHydrated();
  const [s, setS] = useLocalState<Settings>(SETTINGS_KEY, SETTINGS_DEFAULT);
  if (!hydrated) return <div className="card h-40 animate-pulse" />;
  const set = (p: Partial<Settings>) => setS((x) => ({ ...SETTINGS_DEFAULT, ...x, ...p }));

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Pengaturan</h1>

      <section className="card p-5">
        <h2 className="font-semibold">Identitas untuk sampul</h2>
        <p className="mb-3 text-sm text-muted">Terisi otomatis di semua dokumen. Tersimpan di peramban ini saja.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.id}>
              <label className="label" htmlFor={`s_${f.id}`}>{f.label}</label>
              <input id={`s_${f.id}`} className="field" value={s[f.id] ?? ""} onChange={(e) => set({ [f.id]: e.target.value })} />
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Gaya rujukan</h2>
        <p className="mb-3 text-sm text-muted">Ikuti pedoman kampus Anda.</p>
        <div className="flex flex-wrap gap-3">
          {(["APA", "Vancouver"] as const).map((x) => (
            <label key={x} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${s.style === x ? "border-brand bg-brand-soft" : "border-line"}`}>
              <input type="radio" name="style" checked={s.style === x} onChange={() => set({ style: x })} />
              {x === "APA" ? "APA (Penulis, Tahun)" : "Vancouver (nomor [1])"}
            </label>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Kode akses (opsional)</h2>
        <p className="mb-3 text-sm text-muted">Diperlukan hanya jika pemilik server mengatur ACCESS_CODE. Kosongkan bila tidak.</p>
        <input type="password" className="field max-w-sm" value={s.accessCode ?? ""} onChange={(e) => set({ accessCode: e.target.value })} autoComplete="off" />
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Data di perangkat ini</h2>
        <p className="mb-3 text-sm text-muted">Draf dan pustaka hanya tersimpan di peramban ini. Jika data peramban dihapus, draf ikut hilang, jadi unduh dokumen Anda secara berkala.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => window.confirm("Hapus semua draf dokumen?") && clearLocal(DRAFT_PREFIX)}>
            Hapus semua draf
          </button>
          <button className="btn" onClick={() => window.confirm("Hapus Pustaka Referensi?") && clearLocal(LIBRARY_KEY)}>
            Hapus pustaka
          </button>
        </div>
      </section>
    </div>
  );
}
