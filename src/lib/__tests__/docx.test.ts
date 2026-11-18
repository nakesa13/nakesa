import { describe, expect, it } from "vitest";
import { buildDocx } from "../docx-builder";
import { renderDataSection } from "../case";
import type { DocSection, Source } from "../types";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const sources: Source[] = [
  {
    id: "S1",
    type: "jurnal",
    title: "Efektivitas tablet besi pada ibu hamil",
    authors: [{ family: "Rahma", given: "Siti" }, { family: "Putri", given: "Dewi" }],
    year: "2022",
    journal: "Jurnal Kebidanan",
    volume: "10",
    issue: "2",
    pages: "45-52",
    doi: "10.1234/jk.2022.10",
    origin: "crossref",
    verified: true,
  },
];

const sections: DocSection[] = [
  { id: "h1", title: "BAB I PENDAHULUAN", level: 1, kind: "heading", text: "" },
  { id: "a", title: "A. Latar Belakang", level: 2, kind: "ai", text: "Anemia sering terjadi pada kehamilan [S1].\n\n- Poin satu\n- Poin **dua**\n\n1. Langkah satu\n2. Langkah dua" },
  { id: "h2", title: "BAB III TINJAUAN KASUS", level: 1, kind: "heading", text: "" },
  { id: "b", title: "A. Data Objektif", level: 2, kind: "data", text: renderDataSection("LK", "objektif", { td: "110/70 mmHg" }) },
];

describe("builder docx", () => {
  it("menghasilkan file .docx valid dengan sitasi dan daftar pustaka", async () => {
    const { buffer, citedCount } = await buildDocx({
      coverTitle: "LAPORAN KASUS",
      judul: "Asuhan Kebidanan Ny. S",
      identity: { nama: "Mahasiswa Uji", nim: "123", prodi: "D3 Kebidanan", kampus: "Kampus Uji", pembimbing: "", tahun: "2026" },
      sections,
      sources,
      style: "APA",
      chapterStyle: "center",
    });
    expect(citedCount).toBe(1);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");

    const dir = mkdtempSync(path.join(tmpdir(), "nakesa-"));
    const f = path.join(dir, "t.docx");
    writeFileSync(f, buffer);
    let md = "";
    try {
      md = execFileSync("pandoc", ["-t", "plain", f], { encoding: "utf8" });
    } catch {
      return; // pandoc tidak terpasang: lewati pemeriksaan isi
    }
    expect(md).toContain("(Rahma & Putri, 2022)");
    expect(md).toContain("DAFTAR PUSTAKA");
    expect(md).toContain("https://doi.org/10.1234/jk.2022.10");
    expect(md).not.toContain("[S1]");
    expect(md).toContain("110/70 mmHg");
  });
});
