/**
 * Pembuat PDF satu halaman berteks, ditulis tangan (tanpa pustaka) agar test tidak butuh berkas biner.
 * Disalin dari routes.test.ts (T01) supaya test T04 bisa memakainya tanpa mengubah berkas test lama.
 */
export function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, "\\$&");
  const stream = `BT /F1 10 Tf 12 780 Td 12 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

/** Baris-baris teks panjang yang dipecah agar muat di satu halaman PDF uji. */
export function wrapLines(text: string, width = 70): string[] {
  return (text.match(new RegExp(`.{1,${width}}(\\s|$)`, "g")) ?? []).map((l) => l.trim());
}
