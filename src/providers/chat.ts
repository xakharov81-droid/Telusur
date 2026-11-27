import { FriendlyError, type RunInput, type RunResult } from "./types";
import { httpError, readSSE, safeFetch, trimSlash } from "./sse";
import { insertMarkers, type Span } from "./cite";

interface ChatOpts {
  name: string;
  defaultBase: string;
  native: boolean;
  extraHeaders?: Record<string, string>;
}

/**
 * Chat Completions (format OpenAI) — dipakai untuk OpenRouter dan semua API "OpenAI-compatible"
 * (Ollama, LM Studio, Groq, DeepSeek, Mistral, Together, Perplexity, dll).
 */
export async function runChat(input: RunInput, o: ChatOpts): Promise<RunResult> {
  const { profile: p, cb, signal } = input;
  const base = trimSlash(p.baseUrl || o.defaultBase);
  if (!base) throw new FriendlyError("Isi Base URL untuk penyedia OpenAI-compatible (mis. http://localhost:11434/v1 untuk Ollama).");

  const body: Record<string, unknown> = {
    model: p.model,
    stream: true,
    messages: [
      { role: "system", content: input.system },
      ...input.history.map((t) => ({ role: t.role, content: t.text })),
      { role: "user", content: input.question },
    ],
  };
  if (o.native) body.tools = [{ type: "openrouter:web_search" }];
  if (p.effort && o.name === "OpenRouter") body.reasoning = { effort: p.effort === "max" || p.effort === "xhigh" ? "high" : p.effort };

  const headers: Record<string, string> = { "content-type": "application/json", ...o.extraHeaders };
  if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;

  let res: Response;
  for (;;) {
    res = await safeFetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal }, o.name);
    if (res.ok) break;
    if (res.status === 400 && body.reasoning) { delete body.reasoning; continue; }
    throw await httpError(res, o.name);
  }
  if (o.native) cb.onStatus("Mencari di web…");

  let text = "";
  let servedBy: string | undefined;
  let finish: string | undefined;
  let failure: string | undefined;
  const annotations: any[] = [];
  let pplxCitations: string[] | undefined;
  let searchResults: { url: string; title?: string }[] | undefined;
  let gotFirstText = false;

  await readSSE(res, (data) => {
    if (data === "[DONE]") return;
    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.error) {
      failure = chunk.error.message || JSON.stringify(chunk.error);
      return;
    }
    servedBy = chunk.model || servedBy;
    if (Array.isArray(chunk.citations)) pplxCitations = chunk.citations;
    if (Array.isArray(chunk.search_results)) searchResults = chunk.search_results;
    const ch = chunk.choices?.[0];
    if (!ch) return;
    const d = ch.delta || ch.message || {};
    if (typeof d.content === "string" && d.content) {
      if (!gotFirstText && o.native) cb.onStatus("Menyusun jawaban…");
      gotFirstText = true;
      text += d.content;
      cb.onText(d.content);
    }
    for (const a of d.annotations || ch.annotations || []) annotations.push(a);
    if (ch.finish_reason) finish = ch.finish_reason;
  });

  if (failure) throw new FriendlyError(`${o.name}: ${failure}`);

  const spans: Span[] = [];
  for (const a of annotations) {
    const c = a?.url_citation || a;
    if (!c?.url) continue;
    const n = cb.addSource({ url: c.url, title: c.title || c.url, snippet: c.content?.slice(0, 300) });
    if (typeof c.end_index === "number") spans.push({ end: c.end_index, url: c.url, n });
  }
  let finalText = spans.length ? insertMarkers(text, spans) : text;

  // Perplexity: penanda [k] di teks merujuk ke urutan array `citations`; petakan ke nomor sumber aplikasi.
  const list = pplxCitations?.length ? pplxCitations.map((url) => ({ url, title: url })) : searchResults;
  if (list?.length) {
    const map = list.map((s) => cb.addSource({ url: s.url, title: s.title || s.url }));
    finalText = finalText.replace(/\[(\d{1,2})\](?!\()/g, (m, k) => (map[+k - 1] ? `[${map[+k - 1]}]` : m));
  }
  if (finalText !== text) cb.onReplaceText(finalText);

  return { servedBy, note: finish === "length" ? "Jawaban terpotong karena mencapai batas panjang." : undefined };
}
