import type { ProviderKind, RunInput, RunResult } from "./types";
import { runOpenAI } from "./openai";
import { runGemini } from "./gemini";
import { runChat } from "./chat";
import { searchWeb, withContext } from "../search/backends";

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
  const run = { ...input, question };

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

/** Ambil daftar model dari penyedia (untuk dropdown). */
export async function listModels(p: { provider: ProviderKind; apiKey: string; baseUrl: string }): Promise<string[]> {
  const b = (u: string) => (p.baseUrl || u).replace(/\/+$/, "");
  let res: Response;
  switch (p.provider) {
    case "anthropic": {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: p.apiKey, baseURL: p.baseUrl || undefined, dangerouslyAllowBrowser: true });
      const ids: string[] = [];
      for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
      return ids;
    }
    case "openai":
      res = await fetch(`${b("https://api.openai.com/v1")}/models`, { headers: { authorization: `Bearer ${p.apiKey}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()).data || []).map((m: any) => m.id).sort();
    case "gemini":
      res = await fetch(`${b("https://generativelanguage.googleapis.com/v1beta")}/models?pageSize=200`, {
        headers: { "x-goog-api-key": p.apiKey },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()).models || [])
        .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m: any) => String(m.name).replace(/^models\//, ""));
    case "openrouter":
      res = await fetch(`${b("https://openrouter.ai/api/v1")}/models`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()).data || []).map((m: any) => m.id).sort();
    case "compat": {
      if (!p.baseUrl) throw new Error("Isi Base URL dulu");
      const headers: Record<string, string> = {};
      if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
      res = await fetch(`${b("")}/models`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()).data || []).map((m: any) => m.id).sort();
    }
  }
}
