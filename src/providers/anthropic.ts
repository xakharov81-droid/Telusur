import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { FriendlyError, type RunInput, type RunResult } from "./types";
import { explainStatus } from "./sse";
import { parseModel } from "./latest";

// Model yang diketahui menerima server-side fallback `fallbacks: "default"` saat ditolak classifier.
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5(-1|-2)?|mythos-5(-1|-2)?|sonnet-5-5)$/;
// Model lama yang hanya mendukung varian dasar web search (bukan web_search_20260209).
const BASIC_SEARCH = /^claude-(3|haiku|sonnet-4-5|sonnet-4-0|sonnet-4$|opus-4-[015]|opus-4$)/;
// Model lama yang tidak menerima output_config.effort.
const NO_EFFORT = /^claude-(haiku-4|sonnet-4-5|sonnet-4-0|3)/;

/** Model yang lebih baru dari yang dikenal aplikasi ini (mis. Opus 6): coba fitur terbaru dulu. */
function isFuture(model: string): boolean {
  const { family, version } = parseModel(model);
  const major = version[0] ?? 0;
  const minor = version[1] ?? 0;
  return /^claude-(opus|sonnet|fable|mythos)$/.test(family) && (major > 5 || (major === 5 && minor > 5));
}

export async function runAnthropic(input: RunInput, native: boolean): Promise<RunResult> {
  const { profile: p } = input;
  // Fitur yang dicoba; bila model menolak (400) sebelum ada jawaban, matikan satu per satu lalu ulangi.
  const feat = {
    fallback: FALLBACK_MODELS.test(p.model) || isFuture(p.model),
    dynamicSearch: !BASIC_SEARCH.test(p.model),
    effort: !!p.effort && !NO_EFFORT.test(p.model),
  };
  for (;;) {
    try {
      return await attempt(input, native, feat);
    } catch (e) {
      const st = e instanceof Anthropic.APIError ? e.status : undefined;
      if (st === 400 && !(e as any).__emitted) {
        if (feat.fallback) { feat.fallback = false; continue; }
        if (native && feat.dynamicSearch) { feat.dynamicSearch = false; continue; }
        if (feat.effort) { feat.effort = false; continue; }
      }
      throw mapError(e);
    }
  }
}

async function attempt(
  input: RunInput,
  native: boolean,
  feat: { fallback: boolean; dynamicSearch: boolean; effort: boolean },
): Promise<RunResult> {
  const { profile: p, cb, signal } = input;
  const client = new Anthropic({
    apiKey: p.apiKey,
    baseURL: p.baseUrl || undefined,
    // Aplikasi ini berjalan sepenuhnya di perangkat Anda; key disimpan lokal dan dikirim langsung ke Anthropic.
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  });

  const messages: BetaMessageParam[] = [
    ...input.history.map((t) => ({ role: t.role, content: t.text }) as BetaMessageParam),
    { role: "user", content: input.question },
  ];

  const tools: BetaToolUnion[] | undefined = native
    ? [
        feat.dynamicSearch
          ? { type: "web_search_20260209", name: "web_search", max_uses: p.maxSearches || 5 }
          : { type: "web_search_20250305", name: "web_search", max_uses: p.maxSearches || 5 },
      ]
    : undefined;

  let servedBy: string | undefined;
  let emitted = false;

  // Loop untuk pause_turn: server-side tool loop bisa berhenti sementara; kirim ulang untuk melanjutkan.
  for (let round = 0; round < 4; round++) {
    const stream = client.beta.messages.stream(
      {
        model: p.model,
        max_tokens: 16000,
        system: input.system,
        messages,
        ...(tools ? { tools } : {}),
        ...(feat.effort ? { output_config: { effort: p.effort as "low" | "medium" | "high" | "xhigh" | "max" } } : {}),
        ...(feat.fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal },
    );

    // Sitasi per blok teks; ditambahkan sebagai penanda [n] di akhir blok.
    const blockCites = new Map<number, Set<number>>();
    const toolInputs = new Map<number, string>();

    let msg;
    try {
      for await (const ev of stream) {
        if (ev.type === "content_block_start") {
          const b = ev.content_block;
          if (b.type === "server_tool_use") {
            toolInputs.set(ev.index, "");
            cb.onStatus("Mencari di web…");
          } else if (b.type === "web_search_tool_result") {
            if (Array.isArray(b.content)) {
              for (const r of b.content) {
                if (r.type === "web_search_result") cb.addSource({ url: r.url, title: r.title || r.url });
              }
              cb.onStatus("Membaca hasil & menyusun jawaban…");
            } else {
              cb.onStatus(`Pencarian gagal: ${b.content.error_code}`);
            }
          } else if (b.type === "fallback") {
            cb.onStatus("Model utama menolak; dialihkan ke model cadangan…");
          }
        } else if (ev.type === "content_block_delta") {
          const d = ev.delta;
          if (d.type === "text_delta") {
            if (d.text) emitted = true;
            cb.onText(d.text);
          } else if (d.type === "citations_delta" && d.citation.type === "web_search_result_location") {
            const n = cb.addSource({ url: d.citation.url, title: d.citation.title || d.citation.url });
            if (!blockCites.has(ev.index)) blockCites.set(ev.index, new Set());
            blockCites.get(ev.index)!.add(n);
          } else if (d.type === "input_json_delta" && toolInputs.has(ev.index)) {
            toolInputs.set(ev.index, toolInputs.get(ev.index)! + d.partial_json);
          }
        } else if (ev.type === "content_block_stop") {
          const cites = blockCites.get(ev.index);
          if (cites?.size) cb.onText([...cites].sort((a, b) => a - b).map((n) => `[${n}]`).join(""));
          const raw = toolInputs.get(ev.index);
          if (raw) {
            try {
              const q = JSON.parse(raw)?.query;
              if (q) cb.onStatus(`Mencari: “${q}”`);
            } catch {
              /* input parsial; abaikan */
            }
          }
        }
      }
      msg = await stream.finalMessage();
    } catch (e) {
      if (e && typeof e === "object") (e as any).__emitted = emitted;
      throw e;
    }
    servedBy = msg.model;

    if (msg.stop_reason === "refusal") {
      cb.onReplaceText("");
      const cat = msg.stop_details && "category" in msg.stop_details ? msg.stop_details.category : null;
      throw new FriendlyError(
        `Model menolak menjawab pertanyaan ini${cat ? ` (kategori: ${cat})` : ""}. Coba ubah pertanyaan atau pakai profil AI lain.`,
      );
    }
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      cb.onStatus("Melanjutkan pencarian…");
      continue;
    }
    if (msg.stop_reason === "max_tokens") {
      return { servedBy, note: "Jawaban terpotong karena mencapai batas panjang." };
    }
    break;
  }
  return { servedBy };
}

function mapError(e: unknown): Error {
  if (e instanceof FriendlyError) return e;
  if (e instanceof Anthropic.APIUserAbortError) {
    const err = new Error("aborted");
    err.name = "AbortError";
    return err;
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new FriendlyError("Tidak bisa terhubung ke Anthropic. Periksa koneksi internet atau Base URL.");
  }
  if (e instanceof Anthropic.APIError && typeof e.status === "number") {
    return new FriendlyError(`${explainStatus(e.status, "Anthropic")}\n\nDetail: ${e.message}`, e.status);
  }
  return e instanceof Error ? e : new Error(String(e));
}
