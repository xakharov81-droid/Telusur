import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { FriendlyError, type RunInput, type RunResult } from "./types";
import { explainStatus } from "./sse";

// Model yang menerima server-side fallback `fallbacks: "default"` saat ditolak classifier.
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5(-1|-2)?|mythos-5(-1|-2)?|sonnet-5-5)$/;
// Model yang mendukung web_search_20260209 (dynamic filtering); model lain memakai varian dasar.
const DYNAMIC_SEARCH = /^claude-(fable|mythos|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6)/;
// Model lama yang tidak menerima output_config.effort.
const NO_EFFORT = /^claude-(haiku-4|sonnet-4-5|3)/;

export async function runAnthropic(input: RunInput, native: boolean): Promise<RunResult> {
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
        DYNAMIC_SEARCH.test(p.model)
          ? { type: "web_search_20260209", name: "web_search", max_uses: p.maxSearches || 5 }
          : { type: "web_search_20250305", name: "web_search", max_uses: p.maxSearches || 5 },
      ]
    : undefined;

  const useFallback = FALLBACK_MODELS.test(p.model);
  let servedBy: string | undefined;

  // Loop untuk pause_turn: server-side tool loop bisa berhenti sementara; kirim ulang untuk melanjutkan.
  for (let round = 0; round < 4; round++) {
    const stream = client.beta.messages.stream(
      {
        model: p.model,
        max_tokens: 16000,
        system: input.system,
        messages,
        ...(tools ? { tools } : {}),
        ...(p.effort && !NO_EFFORT.test(p.model) ? { output_config: { effort: p.effort } } : {}),
        ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal },
    );

    // Sitasi per blok teks; ditambahkan sebagai penanda [n] di akhir blok.
    const blockCites = new Map<number, Set<number>>();
    const toolInputs = new Map<number, string>();

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
          if (d.type === "text_delta") cb.onText(d.text);
          else if (d.type === "citations_delta" && d.citation.type === "web_search_result_location") {
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
    } catch (e) {
      throw mapError(e);
    }

    let msg;
    try {
      msg = await stream.finalMessage();
    } catch (e) {
      throw mapError(e);
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
  if (e instanceof Anthropic.APIUserAbortError) {
    const err = new Error("aborted");
    err.name = "AbortError";
    return err;
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new FriendlyError("Tidak bisa terhubung ke Anthropic. Periksa koneksi internet atau Base URL.");
  }
  if (e instanceof Anthropic.APIError && typeof e.status === "number") {
    return new FriendlyError(`${explainStatus(e.status, "Anthropic")}\n\nDetail: ${e.message}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}
