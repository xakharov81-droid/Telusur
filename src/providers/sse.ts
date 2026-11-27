import { FriendlyError } from "./types";

/** Membaca stream Server-Sent Events dan memanggil onData untuk tiap field `data:`. */
export async function readSSE(
  res: Response,
  onData: (data: string, event?: string) => void,
): Promise<void> {
  if (!res.body) throw new FriendlyError("Respons tidak memiliki body stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event: string | undefined;
  let dataLines: string[] = [];
  const flush = () => {
    if (dataLines.length) onData(dataLines.join("\n"), event);
    dataLines = [];
    event = undefined;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") flush();
      else if (line.startsWith(":")) continue;
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      else if (line.startsWith("event:")) event = line.slice(6).trim();
    }
  }
  if (buf.trim().startsWith("data:")) dataLines.push(buf.trim().slice(5).replace(/^ /, ""));
  flush();
}

/** Ubah respons HTTP gagal menjadi pesan yang mudah dipahami. */
export async function httpError(res: Response, provider: string): Promise<FriendlyError> {
  let detail = "";
  try {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      detail = j?.error?.message || j?.message || j?.error || t;
      if (typeof detail !== "string") detail = JSON.stringify(detail);
    } catch {
      detail = t;
    }
  } catch {
    /* abaikan */
  }
  return new FriendlyError(explainStatus(res.status, provider) + (detail ? `\n\nDetail: ${detail.slice(0, 500)}` : ""));
}

export function explainStatus(status: number, provider: string): string {
  switch (status) {
    case 400: return `${provider} menolak permintaan (400). Periksa nama model dan pengaturan profil.`;
    case 401: return `API key ${provider} tidak valid atau kedaluwarsa (401).`;
    case 403: return `Akses ditolak oleh ${provider} (403). Pastikan key punya izin untuk model/fitur ini.`;
    case 404: return `Model atau endpoint tidak ditemukan di ${provider} (404). Periksa nama model / Base URL.`;
    case 429: return `Batas penggunaan ${provider} tercapai (429). Tunggu sebentar atau periksa kuota/saldo.`;
    default:
      if (status >= 500) return `Server ${provider} sedang bermasalah (${status}). Coba lagi sebentar lagi.`;
      return `${provider} mengembalikan galat ${status}.`;
  }
}

/** fetch yang memberi pesan jelas bila diblokir CORS / jaringan. */
export async function safeFetch(url: string, init: RequestInit, provider: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new FriendlyError(
      `Tidak bisa menghubungi ${provider}. Kemungkinan koneksi terputus, atau browser memblokir permintaan (CORS).\n` +
        `Solusi: isi "Base URL" profil dengan URL proxy Telusur (lihat proxy/worker.js di README).`,
    );
  }
}

export function trimSlash(u: string): string {
  return u.replace(/\/+$/, "");
}
