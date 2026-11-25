export interface Settings {
  nama: string;
  nim: string;
  prodi: string;
  kampus: string;
  pembimbing: string;
  tahun: string;
  style: "APA" | "Vancouver";
  accessCode: string;
}

export const SETTINGS_KEY = "nakesa.settings";
export const LIBRARY_KEY = "nakesa.library";
export const DRAFT_PREFIX = "nakesa.draft.";

export const SETTINGS_DEFAULT: Settings = {
  nama: "",
  nim: "",
  prodi: "",
  kampus: "",
  pembimbing: "",
  tahun: String(new Date().getFullYear()),
  style: "APA",
  accessCode: "",
};

export const IDENTITY_IDS = ["nama", "nim", "prodi", "kampus", "pembimbing", "tahun"] as const;

function headers(accessCode: string, json: boolean): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (accessCode) h["x-access-code"] = accessCode;
  return h;
}

/** T38: galat dari server dengan status HTTP dan petunjuk apakah aman dicoba ulang. Tetap sebuah Error (pemanggil lama cukup membaca .message). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fail(res: Response): Promise<never> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; retryable?: boolean };
  throw new ApiError(data.error ?? `Terjadi kesalahan (${res.status}).`, res.status, data.retryable === true);
}

export const apiHeaders = headers;
export const apiFail = fail;

export async function apiPost<T>(url: string, body: unknown, accessCode: string): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: headers(accessCode, true), body: JSON.stringify(body) });
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

export async function apiUpload<T>(url: string, file: File, accessCode: string): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(url, { method: "POST", headers: headers(accessCode, false), body: form });
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

export async function apiDocx(body: unknown, accessCode: string, template?: { data: ArrayBuffer; mapping: unknown }, onWarnings?: (codes: string[]) => void): Promise<Blob> {
  let res: Response;
  if (template) {
    const form = new FormData();
    form.append("data", JSON.stringify(body));
    form.append("mapping", JSON.stringify(template.mapping));
    form.append("template", new Blob([template.data]), "template.docx");
    res = await fetch("/api/docx", { method: "POST", headers: headers(accessCode, false), body: form });
  } else {
    res = await fetch("/api/docx", { method: "POST", headers: headers(accessCode, true), body: JSON.stringify(body) });
  }
  if (!res.ok) return fail(res);
  const warn = res.headers.get("x-nakesa-warnings");
  if (warn && onWarnings) onWarnings(warn.split(",").filter(Boolean));
  return res.blob();
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function safeFileName(s: string, fallback: string): string {
  const n = s.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return (n || fallback) + ".docx";
}
