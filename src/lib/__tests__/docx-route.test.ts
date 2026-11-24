import PizZip from "pizzip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/docx/route";
import { inspectDocx } from "../docx-check";

// T12: /api/docx memeriksa struktur sebelum mengirim. File rusak tidak boleh sampai ke pengguna.
vi.mock("../docx-check", async (importOriginal) => {
  const m = await importOriginal<typeof import("../docx-check")>();
  return { ...m, inspectDocx: vi.fn(m.inspectDocx) };
});

let n = 0;
const call = (body: unknown) =>
  POST(new Request("http://localhost/api/docx", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.18.0.${(++n % 250) + 1}` }, body: JSON.stringify(body) }));

const S1 = { id: "S1", type: "jurnal", title: "Efektivitas tablet besi pada ibu hamil", authors: [{ family: "Rahma", given: "Siti" }], year: "2022", origin: "manual", verified: false };
const S2 = { ...S1, id: "S2", title: "Sumber yang tidak dikutip" };
const body = (o: Record<string, unknown> = {}) => ({
  docType: "LK",
  judul: "Asuhan Uji",
  style: "APA",
  identity: { nama: "Mahasiswa Uji" },
  sources: [S1, S2],
  sections: [{ id: "a", title: "A. Latar", level: 2, kind: "ai", text: "Anemia umum pada kehamilan [S1]." }],
  ...o,
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.mocked(inspectDocx).mockClear();
  vi.restoreAllMocks();
});

describe("T12: /api/docx dan pemeriksa struktur", () => {
  it("hanya sumber yang benar-benar dikutip yang diperiksa; berkas sah dikirim tanpa peringatan", async () => {
    const res = await call(body());
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Nakesa-Warnings")).toBeNull();
    const [, opts] = vi.mocked(inspectDocx).mock.calls[0];
    expect(opts?.cited?.map((s) => s.id)).toEqual(["S1"]); // S2 tidak dikutip, jadi tidak wajib ada di pustaka
    const xml = new PizZip(new Uint8Array(await res.arrayBuffer())).file("word/document.xml")!.asText();
    expect(xml).toContain("Efektivitas tablet besi pada ibu hamil"); // entri daftar pustaka
    expect(xml).not.toContain("Sumber yang tidak dikutip");
  });

  it("pemeriksa menolak: 500 dengan pesan, berkas tidak dikirim, galat dicatat tanpa isi dokumen", async () => {
    vi.mocked(inspectDocx).mockReturnValueOnce({ ok: false, paragraphs: [], problems: [{ level: "error", code: "pustaka-hilang", message: "Sumber S1 dikutip tetapi tidak ditemukan di daftar pustaka dokumen." }] });
    const res = await call(body({ sections: [{ id: "a", title: "A", level: 2, kind: "ai", text: "Isi rahasia uji [S1]." }] }));
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain("tidak lolos pemeriksaan");
    expect(error).toContain("S1");
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("pustaka-hilang");
    expect(logged).not.toContain("Isi rahasia uji");
  });

  it("peringatan dikirim lewat header; berkas tetap diberikan", async () => {
    vi.mocked(inspectDocx).mockReturnValueOnce({ ok: true, paragraphs: [], problems: [{ level: "warning", code: "penanda-mentah", message: "x" }] });
    const res = await call(body());
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Nakesa-Warnings")).toBe("penanda-mentah");
  });

  it("ujung ke ujung: penanda [S#] di judul bagian menghasilkan peringatan sungguhan", async () => {
    const res = await call(body({ sections: [{ id: "h", title: "Bab [S1]", level: 1, kind: "heading", text: "" }] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Nakesa-Warnings")).toBe("penanda-mentah");
  });
});
