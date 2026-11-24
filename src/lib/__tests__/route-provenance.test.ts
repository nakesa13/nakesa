import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as doiPOST } from "@/app/api/doi/route";
import { POST as extractPOST } from "@/app/api/extract-source/route";

/**
 * T04: provenance yang dicatat route file dan route DOI. (Route /api/import-url diuji di import-url-route.test.ts.)
 * Tanpa jaringan: Crossref di-stub, dan setup.ts menolak fetch global selain itu.
 * Pembatas laju memakai Map tingkat modul, jadi tiap permintaan memakai IP sendiri.
 */
let n = 0;
const ip = () => ({ "x-forwarded-for": `192.0.2.${(++n % 250) + 1}` });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provenance di route lain", () => {
  it("POST /api/extract-source mencatat nama berkas bersih, ukuran, dan sha256 isi asli", async () => {
    const text = "Anemia pada kehamilan adalah masalah kesehatan masyarakat yang penting. ".repeat(5);
    const f = new FormData();
    f.set("file", new File([text], "../../rahasia/jurnal.txt"));
    const res = await extractPOST(new Request("http://localhost/x", { method: "POST", headers: ip(), body: f }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; provenance: { method: string; fileName: string; bytes: number; sha256: string; fetchedAt: string } };
    expect(body.text).toContain("Anemia");
    expect(body.provenance).toMatchObject({ method: "file", fileName: "jurnal.txt", bytes: new TextEncoder().encode(text).length });
    expect(body.provenance.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isNaN(Date.parse(body.provenance.fetchedAt))).toBe(false);
  });

  it("POST /api/doi mencatat provenance metode doi dan hanya memanggil Crossref", async () => {
    const f = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ message: { title: ["Judul Uji"], author: [{ family: "Rahma" }], issued: { "date-parts": [[2022]] }, type: "journal-article" } }), { status: 200 }))
    );
    vi.stubGlobal("fetch", f);
    const res = await doiPOST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", ...ip() }, body: JSON.stringify({ doi: "10.1234/abc.5" }) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: { provenance: { method: string; url: string; fetchedAt: string } } };
    expect(body.source.provenance.method).toBe("doi");
    expect(body.source.provenance.url).toMatch(/^https:\/\/api\.crossref\.org\/works\//);
    expect(new URL(String(f.mock.calls[0][0])).host).toBe("api.crossref.org");
  });
});
