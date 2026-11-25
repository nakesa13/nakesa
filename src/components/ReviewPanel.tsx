"use client";
import { CATEGORY_LABEL, type ReviewCategory, type ReviewFinding, type ReviewReport } from "@/lib/reviewer";

const ORDER: ReviewCategory[] = ["struktur", "kelengkapan", "bahasa", "sitasi"];

function Finding({ f }: { f: ReviewFinding }) {
  const loc = f.location;
  return (
    <li className="rounded-md border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge ${f.level === "perlu" ? "badge-bad" : "badge-warn"}`}>{f.level === "perlu" ? "Perlu diperbaiki" : "Saran"}</span>
        <span className="text-xs text-muted">
          Lokasi:{" "}
          {loc.sectionId ? (
            <a href={`#sec-${loc.sectionId}`} className="text-brand underline">
              {loc.sectionTitle}
            </a>
          ) : (
            loc.sectionTitle
          )}
          {loc.paragraph ? `, paragraf ${loc.paragraph}` : ""}
        </span>
      </div>
      {loc.excerpt && <p className="mt-2 border-l-2 border-line pl-2 text-xs italic text-muted">{loc.excerpt}</p>}
      <p className="mt-2">
        <b>Alasan:</b> {f.reason}
      </p>
      <p className="mt-1">
        <b>Saran:</b> {f.suggestion}
      </p>
    </li>
  );
}

/**
 * T14: daftar temuan Academic Reviewer. Hanya menampilkan; tidak ada tombol perbaiki otomatis, skor, atau label kelayakan.
 */
export function ReviewPanel({ report, onClose }: { report: ReviewReport; onClose: () => void }) {
  return (
    <section className="card space-y-4 p-5" aria-label="Tinjauan dokumen">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Tinjauan dokumen</h2>
          <p className="mt-1 text-xs text-muted">{report.note}</p>
        </div>
        <button className="btn btn-sm" onClick={onClose}>
          Tutup
        </button>
      </div>

      {ORDER.map((c) => {
        const list = report.findings.filter((f) => f.category === c);
        return (
          <div key={c}>
            <h3 className="text-sm font-semibold">
              {CATEGORY_LABEL[c]} <span className="font-normal text-muted">({list.length} temuan)</span>
            </h3>
            {list.length === 0 ? (
              <p className="mt-1 text-sm text-muted">Tidak ada temuan dari aturan yang dijalankan. Ini tidak berarti bagian itu sempurna; hanya pola yang diperiksa tidak ditemukan.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {list.map((f, i) => (
                  <Finding key={`${f.ruleId}-${f.location.sectionId ?? "x"}-${f.location.paragraph ?? 0}-${i}`} f={f} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted">{report.rulesChecked.length} aturan dijalankan. Tinjau setiap temuan sendiri dan tanyakan pada pembimbing bila ragu.</p>
    </section>
  );
}
