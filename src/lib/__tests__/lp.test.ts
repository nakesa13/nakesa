import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../templates";
import type { Source } from "../types";
import { buildPrompt } from "../ai";
import { lpTitleFor, suggestedInput } from "../kasus";
import { PERLU_REFERENSI, countNeedsReference, hasUsableSource, markNeedsReference, needsReferenceMark, pendingAiSections } from "../lp";

const LONG = "Anemia adalah kondisi berkurangnya kadar hemoglobin dalam darah yang sering ditemukan pada ibu hamil di Indonesia.";
const src = (content?: string): Source => ({ id: "S1", type: "buku", title: "Buku Contoh", authors: [], year: "2020", content, origin: "manual", verified: false });
const LP = TEMPLATES.LP;
const sec = (id: string) => LP.sections.find((s) => s.id === id)!;

describe("T08: tanda [perlu referensi] untuk teori tanpa sumber", () => {
  it("paragraf panjang tanpa rujukan ditandai di akhirnya", () => {
    expect(markNeedsReference(LONG)).toBe(`${LONG} ${PERLU_REFERENSI}`);
  });

  it("paragraf bersumber, pendek, tabel, dan sub-judul tebal dibiarkan", () => {
    const cited = `${LONG} [S1]`;
    const table = "| Data | Keterangan |\n| a | b |";
    const text = [cited, "Poin singkat saja.", table, "**Faktor risiko**"].join("\n\n");
    expect(markNeedsReference(text)).toBe(text);
  });

  it("daftar poin yang panjang ditandai satu kali di akhir daftar", () => {
    const list = `- ${LONG}\n- Butir kedua yang juga cukup panjang untuk dibaca sebagai bagian dari daftar tanpa rujukan apa pun.`;
    const out = markNeedsReference(list);
    expect(countNeedsReference(out)).toBe(1);
    expect(out.endsWith(PERLU_REFERENSI)).toBe(true);
  });

  it("aman dipanggil berulang (idempoten) dan tiap paragraf dihitung sendiri", () => {
    const two = `${LONG}\n\n${LONG} Kalimat lain.`;
    const once = markNeedsReference(two);
    expect(countNeedsReference(once)).toBe(2);
    expect(markNeedsReference(once)).toBe(once);
  });

  it("hanya LP, bagian AI yang butuh rujukan, dan tanpa satu pun sumber berisi", () => {
    expect(needsReferenceMark("LP", sec("pengertian"), [])).toBe(true);
    expect(needsReferenceMark("LP", sec("pengertian"), [src("pendek")])).toBe(true);
    expect(needsReferenceMark("LP", sec("pengertian"), [src("x".repeat(300))])).toBe(false);
    expect(needsReferenceMark("LP", sec("h_a"), [])).toBe(false);
    expect(needsReferenceMark("LK", TEMPLATES.LK.sections.find((s) => s.kind === "ai")!, [])).toBe(false);
    expect(needsReferenceMark("RJ", TEMPLATES.RJ.sections.find((s) => s.kind === "ai")!, [])).toBe(false);
  });

  it("hasUsableSource memakai batas 200 karakter", () => {
    expect(hasUsableSource([src("x".repeat(199))])).toBe(false);
    expect(hasUsableSource([src("x".repeat(200))])).toBe(true);
  });
});

describe("T08: prompt LP tanpa sumber melarang angka dan nama sumber", () => {
  it("tanpa sumber berisi: ada STATUS SUMBER", () => {
    const { prompt } = buildPrompt("LP", sec("pengertian"), { kasus: "Anemia", jenis_asuhan: "Kehamilan (ANC)" }, []);
    expect(prompt).toContain("STATUS SUMBER: tidak ada sumber berisi");
  });
  it("dengan sumber berisi: tidak ada STATUS SUMBER", () => {
    const { prompt } = buildPrompt("LP", sec("pengertian"), { kasus: "Anemia" }, [src("x".repeat(300))]);
    expect(prompt).not.toContain("STATUS SUMBER");
  });
});

describe("T08: melanjutkan (resume) per subbab", () => {
  it("hanya bagian AI yang masih kosong, berurutan; judul dan bagian terisi dilewati", () => {
    const ai = LP.sections.filter((s) => s.kind === "ai");
    const texts = { [ai[0].id]: "sudah ada", [ai[2].id]: "  " };
    const pending = pendingAiSections(LP.sections, texts).map((s) => s.id);
    expect(pending).not.toContain(ai[0].id);
    expect(pending[0]).toBe(ai[1].id);
    expect(pending).toContain(ai[2].id);
    expect(pending.every((id) => ai.some((s) => s.id === id))).toBe(true);
    expect(pending).toHaveLength(ai.length - 1);
  });
  it("semua terisi: tidak ada yang tersisa", () => {
    const texts = Object.fromEntries(LP.sections.filter((s) => s.kind === "ai").map((s) => [s.id, "isi"]));
    expect(pendingAiSections(LP.sections, texts)).toEqual([]);
  });
});

describe("T08: LP bisa mulai dari topik saja", () => {
  it("judul cadangan dari kasus dan jenis asuhan; kosong bila kasus belum ada", () => {
    expect(lpTitleFor("Kehamilan (ANC)", "Anemia ringan")).toBe("Asuhan Kebidanan pada Ibu Hamil dengan Anemia ringan");
    expect(lpTitleFor("", "Anemia ringan")).toBe("Asuhan Kebidanan dengan Anemia ringan");
    expect(lpTitleFor("Kehamilan (ANC)", "  ")).toBe("");
  });
  it("judul LP tidak lagi wajib; kasus dan jenis asuhan tetap wajib", () => {
    const fields = LP.steps.flatMap((s) => s.fields);
    expect(fields.find((f) => f.id === "judul")?.required).toBeFalsy();
    expect(fields.find((f) => f.id === "kasus")?.required).toBe(true);
    expect(fields.find((f) => f.id === "jenis_asuhan")?.required).toBe(true);
  });
  it("konteks kasus bersama tetap hanya lewat tautan opt-in", () => {
    const c = { kasus: "Anemia", jenis_asuhan: "Kehamilan (ANC)" };
    expect(suggestedInput("LP", c)).toEqual({});
    expect(suggestedInput("LP", { ...c, linked: { LP: true } }).judul).toBe("Asuhan Kebidanan pada Ibu Hamil dengan Anemia");
  });
});
