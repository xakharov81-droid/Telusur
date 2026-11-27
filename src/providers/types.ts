// Tipe bersama untuk semua penyedia AI dan mesin pencari.

export type ProviderKind = "anthropic" | "openai" | "gemini" | "openrouter" | "compat";

export type SearchBackendKind = "native" | "wikipedia" | "tavily" | "brave" | "searxng" | "none";

export interface Profile {
  id: string;
  name: string;
  provider: ProviderKind;
  apiKey: string;
  model: string;
  /** Kosong = URL resmi penyedia. Isi dengan URL proxy/endpoint lain bila perlu. */
  baseUrl: string;
  /** "native" = pencarian web bawaan model; selain itu = aplikasi yang mencari lalu memberi konteks ke model. */
  search: SearchBackendKind;
  searchKey: string;
  /** URL instance SearXNG, atau URL proxy untuk Tavily/Brave. */
  searchUrl: string;
  /** Tingkat effort/reasoning: "" = bawaan model. */
  effort: "" | "low" | "medium" | "high" | "xhigh" | "max";
  maxSearches: number;
  /** Selalu pakai versi terbaru dari lini model yang dipilih. */
  autoLatest: boolean;
  /** Ikutkan model preview/eksperimental saat mencari versi terbaru. */
  allowPreview: boolean;
  /** Cache hasil pengecekan versi terbaru (terbaru di depan). */
  resolvedCandidates?: string[];
  resolvedAt?: number;
}

export interface Source {
  url: string;
  title: string;
  snippet?: string;
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface RunCallbacks {
  /** Potongan teks baru (streaming). */
  onText(delta: string): void;
  /** Ganti seluruh teks jawaban (mis. setelah sitasi disisipkan). */
  onReplaceText(full: string): void;
  /** Tambah sumber; mengembalikan nomor sitasi (1-based) untuk tiap sumber. */
  addSource(src: Source): number;
  onStatus(msg: string): void;
}

export interface RunInput {
  profile: Profile;
  system: string;
  history: Turn[];
  question: string;
  signal: AbortSignal;
  cb: RunCallbacks;
  /** Dipanggil bila data profil (cache model terbaru) berubah dan perlu disimpan. */
  onProfileChange?: () => void;
}

export interface RunResult {
  servedBy?: string;
  /** HTML "Google Search suggestions" yang wajib ditampilkan untuk Gemini grounding. */
  searchWidgetHtml?: string;
  note?: string;
}

export class FriendlyError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}
