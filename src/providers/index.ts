import type { ProviderKind, RunInput, RunResult } from "./types";
import { runOpenAI } from "./openai";
import { runGemini } from "./gemini";
import { runChat } from "./chat";
import { searchWeb, withContext } from "../search/backends";
import { fetchModels, resolveModels } from "./latest";
import { FriendlyError } from "./types";

export const PROVIDERS: Record<
  ProviderKind,
  { label: string; native: boolean; keyUrl: string; models: string[]; keyRequired: boolean; hint: string }
> = {
  anthropic: {
    label: "Anthropic Claude",
    native: true,
    keyUrl: "https://platform.claude.com/settings/keys",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"],
    keyRequired: true,
    hint: "Pencarian web bawaan Claude (web_search) dengan sitasi.",
  },
  openai: {
    label: "OpenAI",
    native: true,
    keyUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6-astra", "gpt-6.1-sol"],
    keyRequired: true,
    hint: "Responses API + tool web_search. Bila browser memblokir (CORS), pakai proxy.",
  },
  gemini: {
    label: "Google Gemini",
    native: true,
    keyUrl: "https://aistudio.google.com/apikey",
    models: ["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-flash"],
    keyRequired: true,
    hint: "Grounding with Google Search. Ada tier gratis di AI Studio.",
  },
  openrouter: {
    label: "OpenRouter (ratusan model)",
    native: true,
    keyUrl: "https://openrouter.ai/keys",
    models: ["openrouter/auto"],
    keyRequired: true,
    hint: "Satu key untuk banyak model; pencarian via tool openrouter:web_search.",
  },
  compat: {
    label: "OpenAI-compatible / Lokal (Ollama, LM Studio, Groq, DeepSeek, Perplexity…)",
    native: false,
    keyUrl: "",
    models: ["llama3.2", "qwen3", "gemma3", "sonar"],
    keyRequired: false,
    hint: "Isi Base URL, mis. http://localhost:11434/v1 (Ollama) atau https://api.groq.com/openai/v1.",
  },
};

/** Jalankan satu pencarian: (opsional) cari web oleh aplikasi, lalu minta model menjawab. */
export async function runSearch(input: RunInput): Promise<RunResult> {
  const p = input.profile;
  const meta = PROVIDERS[p.provider];
  const native = p.search === "native" && meta.native;

  let question = input.question;
  if (!native && p.search !== "none" && p.search !== "native") {
    input.cb.onStatus("Mencari di web…");
    const hits = await searchWeb(p, input.question, input.signal);
    const numbered = hits.map((hit) => ({ n: input.cb.addSource(hit), hit }));
    input.cb.onStatus(numbered.length ? `Menemukan ${numbered.length} sumber; menyusun jawaban…` : "Tidak ada hasil; menjawab dari pengetahuan model…");
    question = withContext(input.question, numbered);
  }
  // "Selalu terbaru": coba model terbaru dulu; bila ditolak (belum tersedia untuk key ini), mundur ke versi sebelumnya.
  let candidates = [p.model];
  if (p.autoLatest) {
    input.cb.onStatus("Memeriksa versi model terbaru…");
    candidates = await resolveModels(p);
    input.onProfileChange?.();
  }
  let emitted = false;
  const cb = { ...input.cb, onText: (d: string) => { if (d) emitted = true; input.cb.onText(d); } };
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      const res = await runOnce({ ...input, cb, question, profile: { ...p, model } }, native);
      return { ...res, servedBy: res.servedBy || model };
    } catch (e) {
      const st = e instanceof FriendlyError ? e.status : undefined;
      const retryable = st === 400 || st === 403 || st === 404;
      if (!retryable || emitted || i === candidates.length - 1) throw e;
      input.cb.onStatus(`${model} belum bisa dipakai, mencoba ${candidates[i + 1]}…`);
      if (p.resolvedCandidates?.[0] === model) {
        // Jangan coba model yang gagal itu lagi sampai pengecekan berikutnya.
        p.resolvedCandidates = p.resolvedCandidates.filter((m) => m !== model);
        input.onProfileChange?.();
      }
    }
  }
  throw new FriendlyError("Tidak ada model yang bisa dipakai.");
}

async function runOnce(run: RunInput & { question: string }, native: boolean): Promise<RunResult> {
  const p = run.profile;
  switch (p.provider) {
    case "anthropic": {
      // SDK Anthropic dimuat saat dibutuhkan agar aplikasi terbuka lebih cepat.
      const { runAnthropic } = await import("./anthropic");
      return runAnthropic(run, native);
    }
    case "openai":
      return runOpenAI(run, native);
    case "gemini":
      return runGemini(run, native);
    case "openrouter":
      return runChat(run, {
        name: "OpenRouter",
        defaultBase: "https://openrouter.ai/api/v1",
        native,
        extraHeaders: { "X-Title": "Telusur AI" },
      });
    case "compat":
      return runChat(run, { name: "Penyedia AI", defaultBase: "", native: false });
  }
}

/** Ambil daftar model dari penyedia (untuk dropdown), terbaru di atas bila waktu rilis tersedia. */
export async function listModels(p: { provider: ProviderKind; apiKey: string; baseUrl: string }): Promise<string[]> {
  const ms = await fetchModels(p);
  return ms.sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id)).map((m) => m.id);
}
