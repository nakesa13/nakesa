"use client";
import type { InlineRun } from "@/lib/markup";
import type { Seg } from "@/lib/citations";
import type { PreviewBlock, PreviewDoc } from "@/lib/preview";

/**
 * T12: pratinjau dokumen + PDF lewat cetak peramban.
 * Mekanisme PDF: "Simpan sebagai PDF" dari dialog cetak, memakai pratinjau ini. Dipilih karena berjalan sama di Vercel
 * maupun VPS (tanpa biner server, tanpa dependensi baru). Hasilnya PERKIRAAN: bukan salinan persis file .docx
 * (font, nomor halaman, daftar isi, dan template kampus tidak ditiru). Untuk tampilan persis, unduh .docx lalu simpan PDF dari Word.
 */

// Hanya area pratinjau yang dicetak; tepi halaman mengikuti default builder (A4, atas/kiri 4 cm, kanan/bawah 3 cm).
const PRINT_CSS = `
.nk-paper { background:#fff; color:#000; font-family:"Times New Roman",Times,serif; font-size:12pt; line-height:1.5; padding:2cm; border:1px solid #c8c8c8; border-radius:6px; overflow-x:auto; }
.nk-paper p { margin:0 0 6pt; text-align:justify; text-indent:1cm; }
.nk-paper p.nk-label { text-indent:0; font-weight:700; margin-top:4pt; margin-bottom:2pt; }
.nk-paper h1,.nk-paper h2,.nk-paper h3 { font-weight:700; margin:12pt 0 6pt; font-size:12pt; color:#000; }
.nk-paper h3 { font-style:italic; }
.nk-paper .nk-center { text-align:center; }
.nk-paper ul,.nk-paper ol { margin:0 0 6pt; padding-left:1.4cm; text-align:justify; }
.nk-paper table { border-collapse:collapse; width:100%; margin:0 0 8pt; font-size:11pt; line-height:1.25; }
.nk-paper th,.nk-paper td { border:1px solid #808080; padding:2pt 5pt; vertical-align:top; text-align:left; }
.nk-paper th { background:#e7e6e6; }
.nk-cover { text-align:center; min-height:20cm; display:flex; flex-direction:column; justify-content:space-between; padding-bottom:1cm; }
.nk-cover p { text-indent:0; text-align:center; margin:0 0 4pt; }
.nk-bib p { text-indent:-1.27cm; padding-left:1.27cm; text-align:left; margin-bottom:6pt; line-height:1.15; }
@media print {
  @page { size: A4; margin: 4cm 3cm 3cm 4cm; }
  body * { visibility: hidden !important; }
  #nakesa-print-area, #nakesa-print-area * { visibility: visible !important; }
  #nakesa-print-area { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; }
  #nakesa-print-area .nk-paper { border: 0; border-radius: 0; padding: 0; overflow: visible; }
  .nk-no-print { display: none !important; }
  .nk-cover { break-after: page; min-height: 22cm; }
  .nk-break { break-before: page; }
  .nk-paper h1,.nk-paper h2,.nk-paper h3 { break-after: avoid; }
  .nk-paper table, .nk-paper tr { break-inside: avoid; }
}
`;

function Runs({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((r, i) => (r.bold ? <strong key={i}>{r.text}</strong> : <span key={i}>{r.text}</span>))}
    </>
  );
}

function SegRuns({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) => (s.i ? <em key={i}>{s.t}</em> : <span key={i}>{s.t}</span>))}
    </>
  );
}

function Block({ b }: { b: PreviewBlock }) {
  if (b.t === "h") {
    const cls = `${b.center ? "nk-center" : ""} ${b.pageBreak ? "nk-break" : ""}`.trim() || undefined;
    if (b.level === 1) return <h1 className={cls}>{b.text}</h1>;
    if (b.level === 2) return <h2 className={cls}>{b.text}</h2>;
    return <h3 className={cls}>{b.text}</h3>;
  }
  if (b.t === "p") {
    return (
      <p className={b.label ? "nk-label" : undefined}>
        <Runs runs={b.runs} />
      </p>
    );
  }
  if (b.t === "list") {
    const items = b.items.map((it, i) => (
      <li key={i}>
        <Runs runs={it} />
      </li>
    ));
    return b.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
  }
  return (
    <table>
      <tbody>
        {b.rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, ci) => (ri === 0 ? <th key={ci}><Runs runs={c} /></th> : <td key={ci}><Runs runs={c} /></td>))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PreviewPane({ doc, formatLabel, onClose }: { doc: PreviewDoc; formatLabel: string; onClose: () => void }) {
  return (
    <section className="space-y-3" aria-label="Pratinjau dokumen (perkiraan)">
      <style>{PRINT_CSS}</style>
      <div className="nk-no-print card space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-warn">Pratinjau perkiraan</span>
          <p className="flex-1 text-sm font-medium">Tampilan akhir di Word bisa berbeda.</p>
          <button className="btn btn-sm btn-primary" onClick={() => window.print()}>
            Cetak / simpan PDF
          </button>
          <button className="btn btn-sm" onClick={onClose}>
            Tutup
          </button>
        </div>
        <p className="text-xs text-muted">
          Pratinjau memakai format bawaan NAKESA (Times New Roman 12, spasi 1,5, A4). Format yang sedang dipilih: {formatLabel}. Font, nomor halaman, daftar isi, dan susunan template kampus tidak ditiru. Untuk PDF: klik &quot;Cetak / simpan PDF&quot;, pilih &quot;Simpan sebagai PDF&quot;, dan matikan &quot;Header dan footer&quot; di dialog cetak. PDF ini perkiraan; untuk hasil yang persis sesuai template kampus, unduh .docx lalu simpan sebagai PDF dari Word.
        </p>
      </div>

      <div id="nakesa-print-area">
        <div className="nk-paper">
          <div className="nk-cover">
            <div>
              <p style={{ fontWeight: 700, fontSize: "16pt", marginTop: "1cm" }}>{doc.cover.title}</p>
              <p style={{ fontWeight: 700, fontSize: "14pt", marginTop: "1cm" }}>{doc.cover.judul}</p>
            </div>
            <div>
              {doc.cover.lines.map((l, i) => (
                <p key={i} style={i === 1 ? { fontWeight: 700 } : undefined}>
                  {l}
                </p>
              ))}
            </div>
            <div>
              {doc.cover.bottom.map((l, i) => (
                <p key={i} style={i < doc.cover.bottom.length - 1 ? { fontWeight: 700 } : undefined}>
                  {l}
                </p>
              ))}
            </div>
          </div>

          {doc.blocks.map((b, i) => (
            <Block key={i} b={b} />
          ))}

          {doc.bibliography && (
            <div className="nk-bib nk-break">
              <h1 className={doc.bibliography.center ? "nk-center" : undefined}>{doc.bibliography.heading}</h1>
              {doc.bibliography.entries.map((e, i) => (
                <p key={i}>
                  {e.number !== undefined ? `${e.number}. ` : ""}
                  <SegRuns segs={e.segs} />
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
