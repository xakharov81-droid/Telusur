import type { Profile, Source } from "./providers/types";

export interface Settings {
  version: 1;
  profiles: Profile[];
  activeId: string;
  theme: "auto" | "light" | "dark";
  systemExtra: string;
  saveHistory: boolean;
}

export interface Exchange {
  q: string;
  a: string;
  sources: Source[];
  servedBy?: string;
  profileName?: string;
  note?: string;
  widget?: string;
  error?: string;
  at: number;
}

export interface Thread {
  id: string;
  title: string;
  updated: number;
  items: Exchange[];
}

const SKEY = "telusur.settings.v1";
const HKEY = "telusur.history.v1";
const MAX_THREADS = 300;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newProfile(partial: Partial<Profile> = {}): Profile {
  return {
    id: uid(),
    name: "Claude",
    provider: "anthropic",
    apiKey: "",
    model: "claude-opus-5-5",
    baseUrl: "",
    search: "native",
    searchKey: "",
    searchUrl: "",
    effort: "medium",
    maxSearches: 5,
    ...partial,
  };
}

function defaults(): Settings {
  const p = newProfile();
  return { version: 1, profiles: [p], activeId: p.id, theme: "auto", systemExtra: "", saveHistory: true };
}

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, v: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings(): Settings {
  const s = read<Settings>(SKEY);
  if (!s || !Array.isArray(s.profiles) || !s.profiles.length) return defaults();
  s.profiles = s.profiles.map((p) => newProfile(p));
  if (!s.profiles.some((p) => p.id === s.activeId)) s.activeId = s.profiles[0].id;
  return { ...defaults(), ...s };
}

export const saveSettings = (s: Settings) => write(SKEY, s);

export function loadHistory(): Thread[] {
  const h = read<Thread[]>(HKEY);
  return Array.isArray(h) ? h : [];
}

export function saveHistory(h: Thread[]): void {
  h.sort((a, b) => b.updated - a.updated);
  let list = h.slice(0, MAX_THREADS);
  // Bila kuota penyimpanan penuh, buang riwayat terlama sampai muat.
  while (!write(HKEY, list) && list.length > 1) list = list.slice(0, Math.floor(list.length * 0.8));
}

// ---------- Sinkronisasi antar-perangkat (ekspor/impor terenkripsi) ----------

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 310000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface Bundle {
  settings: Settings;
  history?: Thread[];
}

/** Hasil: teks berawalan "TELUSUR1:" berisi data terenkripsi AES-GCM (kata sandi wajib). */
export async function exportBundle(b: Bundle, pass: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(b))));
  return `TELUSUR1:${b64(salt)}:${b64(iv)}:${b64(ct)}`;
}

export async function importBundle(text: string, pass: string): Promise<Bundle> {
  const parts = text.trim().split(":");
  if (parts[0] !== "TELUSUR1" || parts.length !== 4) throw new Error("Format data sinkronisasi tidak dikenali.");
  const key = await deriveKey(pass, unb64(parts[1]));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(parts[2]) as BufferSource }, key, unb64(parts[3]) as BufferSource);
  } catch {
    throw new Error("Kata sandi salah atau data rusak.");
  }
  const b = JSON.parse(dec.decode(plain)) as Bundle;
  if (!b?.settings?.profiles) throw new Error("Data tidak berisi pengaturan yang valid.");
  return b;
}
