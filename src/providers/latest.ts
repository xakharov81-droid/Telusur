import type { Profile, ProviderKind } from "./types";

/**
 * "Selalu versi terbaru": menebak lini (family) dari nama model yang dipilih pengguna,
 * lalu memilih versi tertinggi di lini yang sama dari daftar model resmi penyedia.
 *   claude-opus-5-5      → lini "claude-opus"     → mis. claude-opus-6 bila sudah rilis
 *   gpt-6.2-astra        → lini "gpt-astra"       → mis. gpt-6.3-astra
 *   gemini-3.5-flash     → lini "gemini-flash"    → mis. gemini-4-flash
 * Varian berbeda (mini, lite, fast, dll.) dianggap lini lain sehingga tidak tertukar.
 */

export interface ModelInfo {
  id: string;
  /** Waktu rilis (ms) bila penyedia memberikannya. */
  created?: number;
}

const PREVIEW = new Set(["preview", "exp", "experimental", "beta", "alpha", "rc"]);
const NUM = /^\d+(\.\d+)*$/;

export function parseModel(rawId: string): { family: string; version: number[]; preview: boolean; dated: boolean } {
  let id = rawId.toLowerCase().replace(/^models\//, "");
  const dated = /(-|@)\d{8}$|-\d{4}-\d{2}-\d{2}$|-\d{4}$/.test(id);
  id = id.replace(/(-|@)\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const slash = id.lastIndexOf("/");
  const vendor = slash >= 0 ? id.slice(0, slash + 1) : "";
  const tokens = id.slice(slash + 1).split(/[-_:]/).filter(Boolean);

  const fam: string[] = [];
  const version: number[] = [];
  let preview = false;
  for (const t of tokens) {
    if (PREVIEW.has(t)) {
      preview = true;
      break; // sisanya (mis. tanggal preview "06-05") bukan bagian lini/versi
    }
    if (t === "latest") continue;
    if (NUM.test(t)) version.push(...t.split(".").map(Number));
    else fam.push(t);
  }
  return { family: vendor + fam.join("-"), version, preview, dated };
}

function cmpVersion(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** Kandidat di lini yang sama, terbaru lebih dulu. */
export function rankLatest(models: ModelInfo[], currentModel: string, allowPreview: boolean): string[] {
  const target = parseModel(currentModel).family;
  if (!target) return [];
  const rows = models
    .map((m) => ({ ...m, ...parseModel(m.id) }))
    .filter((m) => m.family === target && (allowPreview || !m.preview || m.id === currentModel));
  rows.sort(
    (a, b) =>
      cmpVersion(b.version, a.version) ||
      Number(a.preview) - Number(b.preview) ||
      Number(a.dated) - Number(b.dated) ||
      (b.created ?? 0) - (a.created ?? 0) ||
      a.id.length - b.id.length,
  );
  return [...new Set(rows.map((r) => r.id))];
}

/** Daftar model (beserta waktu rilis bila ada) langsung dari penyedia. */
export async function fetchModels(p: { provider: ProviderKind; apiKey: string; baseUrl: string }): Promise<ModelInfo[]> {
  const b = (u: string) => (p.baseUrl || u).replace(/\/+$/, "");
  let res: Response;
  switch (p.provider) {
    case "anthropic": {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: p.apiKey, baseURL: p.baseUrl || undefined, dangerouslyAllowBrowser: true });
      const out: ModelInfo[] = [];
      for await (const m of client.models.list({ limit: 100 })) out.push({ id: m.id, created: Date.parse(m.created_at) || undefined });
      return out;
    }
    case "openai":
      res = await fetch(`${b("https://api.openai.com/v1")}/models`, { headers: { authorization: `Bearer ${p.apiKey}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()).data || []).map((m: any) => ({ id: m.id, created: m.created ? m.created * 1000 : undefined }));
    case "gemini": {
      const out: ModelInfo[] = [];
      let token = "";
      for (let page = 0; page < 5; page++) {
        res = await fetch(`${b("https://generativelanguage.googleapis.com/v1beta")}/models?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, {
          headers: { "x-goog-api-key": p.apiKey },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        for (const m of j.models || []) {
          if ((m.supportedGenerationMethods || []).includes("generateContent")) out.push({ id: String(m.name).replace(/^models\//, "") });
        }
        token = j.nextPageToken || "";
        if (!token) break;
      }
      return out;
    }
    case "openrouter":
      res = await fetch(`${b("https://openrouter.ai/api/v1")}/models`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()).data || []).map((m: any) => ({ id: m.id, created: m.created ? m.created * 1000 : undefined }));
    case "compat": {
      if (!p.baseUrl) throw new Error("Isi Base URL dulu");
      const headers: Record<string, string> = {};
      if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
      res = await fetch(`${b("")}/models`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()).data || []).map((m: any) => ({ id: m.id, created: m.created ? m.created * 1000 : undefined }));
    }
  }
}

export const RECHECK_MS = 6 * 60 * 60 * 1000; // cek ulang tiap 6 jam

/**
 * Tentukan model yang dipakai. Mengembalikan daftar kandidat (terbaru dulu) agar bisa mundur
 * otomatis bila versi terbaru belum tersedia untuk key pengguna. Memperbarui cache di profil.
 */
export async function resolveModels(p: Profile, force = false): Promise<string[]> {
  if (!p.autoLatest) return [p.model];
  const fresh = Date.now() - (p.resolvedAt || 0) < RECHECK_MS;
  if (!force && fresh && p.resolvedCandidates?.length) return withBase(p.resolvedCandidates, p.model);
  try {
    const ranked = rankLatest(await fetchModels(p), p.model, p.allowPreview);
    if (ranked.length) {
      p.resolvedCandidates = ranked.slice(0, 3);
      p.resolvedAt = Date.now();
    }
  } catch {
    // Gagal mengecek (offline, key salah): pakai hasil terakhir atau model pilihan.
  }
  return withBase(p.resolvedCandidates || [], p.model);
}

const withBase = (c: string[], base: string) => [...new Set([...c, base])].slice(0, 4);
