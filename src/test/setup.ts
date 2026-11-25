/**
 * T01: pagar test. Dijalankan sebelum setiap berkas test (lihat vitest.config.mts).
 * Tujuannya satu: `npm test` tidak boleh memakai API key sungguhan atau menyentuh jaringan,
 * walau mesin pengembang punya GROQ_API_KEY / ANTHROPIC_API_KEY di environment.
 *
 * - Variabel AI dan akses dihapus agar hasil test tidak bergantung pada mesin.
 * - `fetch` global diganti penolak. Test yang butuh fetch harus men-stub-nya sendiri (vi.stubGlobal).
 *   `fetch` diganti lewat penugasan langsung, bukan vi.stubGlobal, supaya vi.unstubAllGlobals() di test
 *   mengembalikan ke penolak ini, bukan ke fetch asli.
 */
const CLEARED = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "GROQ_API_KEY", "GROQ_MODEL", "GROQ_MODEL_LONG", "GROQ_JOURNAL_CHARS", "AI_PROVIDER", "ACCESS_CODE", "RATE_LIMIT_PER_HOUR", "CROSSREF_MAILTO", "NAKESA_MOCK_AI", "NAKESA_GENERATE_BUDGET_MS"];
for (const k of CLEARED) delete process.env[k];

globalThis.fetch = (() => Promise.reject(new Error("Jaringan dinonaktifkan di test. Stub fetch di test yang membutuhkannya."))) as unknown as typeof fetch;
