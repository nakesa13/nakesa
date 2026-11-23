"use client";
import Link from "next/link";
import { useMemo } from "react";
import type { DocType, Source } from "@/lib/types";
import { TEMPLATES } from "@/templates";
import { JENIS_ASUHAN } from "@/templates/common";
import { journalSourceFromInput } from "@/lib/case";
import { DRAFT_PREFIX, SETTINGS_DEFAULT, SETTINGS_KEY, type Settings } from "@/lib/client";
import { EMPTY_DRAFT, sectionsOf, type Draft } from "@/lib/draft";
import { CASE_KEY, EMPTY_CASE, buildInput, isLinked, searchKeywords, type SharedCase } from "@/lib/kasus";
import { checkConsistency, type DocSnap, type Severity } from "@/lib/consistency";
import { reviewClinical, type ClinicalLevel } from "@/lib/clinical/review";
import { clearLocal, useHydrated, useLocalState } from "@/lib/useLocalState";

const DOCS: { type: DocType; href: string; hint: string }[] = [
  { type: "LK", href: "/lk", hint: "Isi data pasien di sini. Bisa dimulai sendiri; jenis asuhan dan kasus mengikuti kasus bersama hanya bila dihubungkan." },
  { type: "LP", href: "/lp", hint: "Teori untuk satu kasus. Bisa dimulai sendiri. Tidak memuat data pasien." },
  { type: "RJ", href: "/rj", hint: "Telaah satu jurnal. Bisa dimulai sendiri; topik terisi dari kasus hanya bila dihubungkan." },
];

const SEV_LABEL: Record<Severity, string> = { error: "Perlu diperbaiki", warn: "Perlu dicek", info: "Saran" };
const SEV_BADGE: Record<Severity, string> = { error: "badge badge-bad", warn: "badge badge-warn", info: "badge badge-mute" };
const HREF: Record<DocType, string> = { LP: "/lp", LK: "/lk", RJ: "/rj" };
const SHORT: Record<DocType, string> = { LP: "LP", LK: "LK", RJ: "Jurnal" };
const CL_LABEL: Record<ClinicalLevel, string> = { periksa: "Perlu dicek", "belum-bisa": "Belum bisa dicek", sesuai: "Sesuai data" };
const CL_BADGE: Record<ClinicalLevel, string> = { periksa: "badge badge-warn", "belum-bisa": "badge badge-mute", sesuai: "badge badge-ok" };

function snapshot(type: DocType, draft: Draft, settings: Settings, c: SharedCase): DocSnap {
  const input = buildInput(type, draft.input, settings, c);
  const j = type === "RJ" ? journalSourceFromInput(input) : null;
  const sources: Source[] = type === "RJ" ? (j ? [j] : []) : draft.sources;
  const started = Object.values(draft.texts).some((t) => t.trim()) || Object.keys(draft.input).length > 0 || draft.sources.length > 0;
  return { type, started, input, sections: sectionsOf(type, draft), texts: draft.texts, sources };
}

export function KasusPage() {
  const hydrated = useHydrated();
  const [settings] = useLocalState<Settings>(SETTINGS_KEY, SETTINGS_DEFAULT);
  const [c, setC] = useLocalState<SharedCase>(CASE_KEY, EMPTY_CASE);
  const [lp] = useLocalState<Draft>(DRAFT_PREFIX + "LP", EMPTY_DRAFT);
  const [lk] = useLocalState<Draft>(DRAFT_PREFIX + "LK", EMPTY_DRAFT);
  const [rj] = useLocalState<Draft>(DRAFT_PREFIX + "RJ", EMPTY_DRAFT);

  const snaps = useMemo(
    () => [snapshot("LK", lk, settings, c), snapshot("LP", lp, settings, c), snapshot("RJ", rj, settings, c)],
    [lk, lp, rj, settings, c]
  );
  const findings = useMemo(() => checkConsistency(snaps, c), [snaps, c]);
  const lkSnap = snaps.find((s) => s.type === "LK")!;
  const clinical = useMemo(() => reviewClinical(lkSnap.input, lkSnap.texts), [lkSnap]);

  if (!hydrated) return <div className="card h-64 animate-pulse" />;

  const kw = searchKeywords(c);
  const startedCount = snaps.filter((s) => s.started).length;

  const newCase = () => {
    if (!window.confirm("Mulai kasus baru? Kasus bersama dikosongkan dan draf LK serta LP dihapus. Draf Reading Journal, pustaka, dan template tetap tersimpan.")) return;
    setC({});
    clearLocal(DRAFT_PREFIX + "LK");
    clearLocal(DRAFT_PREFIX + "LP");
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Kasus &amp; Konsistensi</h1>
        <p className="mt-1 text-sm text-muted">
          LK, LP, dan Reading Journal bisa dikerjakan sendiri-sendiri. Bila mau, hubungkan satu dokumen ke kasus bersama dari halaman dokumen itu (dengan konfirmasi) agar tidak mengisi ulang dan topiknya sama.
        </p>
      </div>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">Kasus bersama</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="k_jenis">
              Jenis asuhan
            </label>
            <select id="k_jenis" className="field" value={c.jenis_asuhan ?? ""} onChange={(e) => setC((x) => ({ ...x, jenis_asuhan: e.target.value }))}>
              <option value="">Pilih…</option>
              {JENIS_ASUHAN.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="k_kasus">
              Diagnosis / kasus
            </label>
            <input id="k_kasus" className="field" value={c.kasus ?? ""} onChange={(e) => setC((x) => ({ ...x, kasus: e.target.value }))} placeholder="mis. Anemia ringan dalam kehamilan" />
          </div>
        </div>
        <p className="help mt-3">Perubahan di sini berlaku di dokumen yang Anda hubungkan. Data pasien (inisial, TTV, tindakan) tetap hanya ada di LK dan tidak pernah dibawa ke dokumen lain.</p>
        <div className="mt-3">
          <button className="btn btn-sm" onClick={newCase}>
            Mulai kasus baru
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {DOCS.map((d) => {
          const s = snaps.find((x) => x.type === d.type)!;
          const ai = s.sections.filter((x) => x.kind === "ai");
          const done = ai.filter((x) => (s.texts[x.id] ?? "").trim()).length;
          const title = (s.input.judul || s.input.j_title || "").trim();
          return (
            <div key={d.type} className="card flex flex-col p-4">
              <h3 className="font-semibold">{TEMPLATES[d.type].name}</h3>
              <p className="mt-1 text-xs text-muted">{d.hint}</p>
              <div className="mt-3 space-y-1 text-sm">
                {s.started ? <span className="badge badge-ok">Draf ada</span> : <span className="badge badge-mute">Belum dimulai</span>}{" "}
                {isLinked(d.type, c) ? <span className="badge badge-ok">Terhubung ke kasus</span> : <span className="badge badge-mute">Mandiri</span>}
                {s.started && (
                  <p className="text-xs text-muted">
                    {done}/{ai.length} bagian AI terisi{title ? ` · ${title.slice(0, 50)}` : ""}
                  </p>
                )}
              </div>
              <Link href={d.href} className="mt-3 text-sm font-medium text-brand hover:underline">
                {s.started ? "Lanjutkan →" : "Mulai →"}
              </Link>
            </div>
          );
        })}
      </section>

      {kw && (
        <section className="card p-5">
          <h2 className="text-lg font-semibold">Cari jurnal untuk kasus ini</h2>
          <p className="mt-1 text-sm text-muted">
            Kata kunci dari kasus: <b>{kw}</b>
          </p>
          <a className="mt-2 inline-block text-sm text-brand underline" href={`https://scholar.google.com/scholar?q=${encodeURIComponent(kw)}`} target="_blank" rel="noreferrer">
            Cari di Google Scholar
          </a>
          <p className="help mt-2">Setelah menemukan jurnal, unggah file-nya (PDF/Word) atau tempel DOI-nya di Reading Journal atau Pustaka Referensi.</p>
        </section>
      )}

      <section className="card p-5">
        <h2 className="text-lg font-semibold">Pemeriksaan konsistensi</h2>
        {startedCount === 0 ? (
          <p className="mt-2 text-sm text-muted">Belum ada dokumen yang dimulai. Pemeriksaan berjalan otomatis setelah Anda mengisi salah satu dokumen.</p>
        ) : findings.length === 0 ? (
          <p className="mt-2 rounded-md bg-brand-soft p-3 text-sm">Tidak ada ketidakkonsistenan yang terdeteksi pada {startedCount} dokumen yang sudah dimulai.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {findings.map((f) => (
              <li key={f.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={SEV_BADGE[f.severity]}>{SEV_LABEL[f.severity]}</span>
                  <p className="flex-1 text-sm font-medium">{f.title}</p>
                  <span className="flex gap-1.5 text-xs">
                    {f.docs.map((t) => (
                      <Link key={t} href={HREF[t]} className="text-brand underline">
                        {SHORT[t]}
                      </Link>
                    ))}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">{f.detail}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="help mt-3">Pemeriksaan ini berbasis aturan, bukan penilaian dosen. Ia membantu menemukan ketidaksesuaian; keputusan akhir tetap di Anda.</p>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">Telaah klinis (penasihat)</h2>
        <p className="mt-1 text-sm text-muted">
          Mencocokkan diagnosis di LK dengan angka yang Anda isi, memakai acuan yang disebut di tiap temuan. Hasilnya bukan penilaian benar atau salah, dan tidak menggantikan pembimbing.
        </p>
        {!lkSnap.started ? (
          <p className="mt-2 text-sm text-muted">Belum ada data LK yang diisi.</p>
        ) : !clinical.applicable ? (
          <p className="mt-2 text-sm text-muted">{clinical.reason}</p>
        ) : (
          <>
            {clinical.findings.length === 0 ? (
              <p className="mt-3 rounded-md bg-brand-soft p-3 text-sm">Tidak ada aturan yang berlaku untuk data saat ini. Itu bukan tanda bahwa semua data sudah benar; lihat daftar &quot;Belum dicek&quot; di bawah.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {clinical.findings.map((f) => (
                  <li key={f.id} className="rounded-md border border-line p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={CL_BADGE[f.level]}>{CL_LABEL[f.level]}</span>
                      <p className="flex-1 text-sm font-medium">{f.title}</p>
                      <Link href="/lk" className="text-xs text-brand underline">
                        LK
                      </Link>
                    </div>
                    <p className="mt-1 text-xs text-muted">{f.detail}</p>
                    <details className="mt-1 text-xs text-muted">
                      <summary className="cursor-pointer">Acuan</summary>
                      <p className="mt-1">{f.basis}</p>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 space-y-1 text-xs text-muted">
              <p>
                <b>Dicek:</b> {clinical.checked.join("; ")}.
              </p>
              <p>
                <b>Belum dicek:</b> {clinical.notChecked.join("; ")}. Hal-hal ini tetap perlu ditinjau pembimbing.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
