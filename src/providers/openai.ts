import { FriendlyError, type RunInput, type RunResult } from "./types";
import { httpError, readSSE, safeFetch, trimSlash } from "./sse";
import { insertMarkers, type Span } from "./cite";

/** OpenAI Responses API dengan tool `web_search` bawaan. */
export async function runOpenAI(input: RunInput, native: boolean): Promise<RunResult> {
  const { profile: p, cb, signal } = input;
  const base = trimSlash(p.baseUrl || "https://api.openai.com/v1");
  const body: Record<string, unknown> = {
    model: p.model,
    instructions: input.system,
    input: [
      ...input.history.map((t) => ({ role: t.role, content: t.text })),
      { role: "user", content: input.question },
    ],
    stream: true,
  };
  if (native) {
    body.tools = [{ type: "web_search" }];
    body.include = ["web_search_call.action.sources"];
  }
  if (p.effort) body.reasoning = { effort: p.effort === "max" || p.effort === "xhigh" ? "high" : p.effort };

  // Model baru/berbeda bisa menolak parameter tertentu (400): ulangi tanpa parameter opsional itu.
  let res: Response;
  for (;;) {
    res = await safeFetch(
      `${base}/responses`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${p.apiKey}` },
        body: JSON.stringify(body),
        signal,
      },
      "OpenAI",
    );
    if (res.ok) break;
    if (res.status === 400 && body.reasoning) { delete body.reasoning; continue; }
    if (res.status === 400 && body.include) { delete body.include; continue; }
    throw await httpError(res, "OpenAI");
  }

  let servedBy: string | undefined;
  let failure: string | undefined;
  let incomplete = false;
  let finalResponse: any;

  await readSSE(res, (data) => {
    if (data === "[DONE]") return;
    let ev: any;
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    switch (ev.type) {
      case "response.created":
        servedBy = ev.response?.model;
        break;
      case "response.output_text.delta":
        cb.onText(ev.delta || "");
        break;
      case "response.web_search_call.in_progress":
      case "response.web_search_call.searching":
        cb.onStatus("Mencari di web…");
        break;
      case "response.web_search_call.completed":
        cb.onStatus("Membaca hasil & menyusun jawaban…");
        break;
      case "response.output_item.done": {
        const it = ev.item;
        if (it?.type === "web_search_call") {
          if (it.action?.query) cb.onStatus(`Mencari: “${it.action.query}”`);
          for (const s of it.action?.sources || []) if (s?.url) cb.addSource({ url: s.url, title: s.title || s.url });
        }
        break;
      }
      case "response.output_text.annotation.added": {
        const a = ev.annotation;
        if (a?.type === "url_citation" && a.url) cb.addSource({ url: a.url, title: a.title || a.url });
        break;
      }
      case "response.completed":
        finalResponse = ev.response;
        servedBy = ev.response?.model || servedBy;
        break;
      case "response.incomplete":
        finalResponse = ev.response;
        incomplete = true;
        break;
      case "response.failed":
        failure = ev.response?.error?.message || "Permintaan gagal.";
        break;
      case "error":
        failure = ev.message || ev.error?.message || "Terjadi galat.";
        break;
    }
  });

  if (failure) throw new FriendlyError(`OpenAI: ${failure}`);

  // Susun ulang teks final dari objek respons (lebih andal daripada delta) + sisipkan penanda sitasi.
  if (finalResponse?.output) {
    let text = "";
    const spans: Span[] = [];
    for (const item of finalResponse.output) {
      if (item.type === "web_search_call") {
        for (const s of item.action?.sources || []) if (s?.url) cb.addSource({ url: s.url, title: s.title || s.url });
      }
      if (item.type !== "message") continue;
      for (const part of item.content || []) {
        if (part.type === "refusal") throw new FriendlyError(`Model menolak: ${part.refusal}`);
        if (part.type !== "output_text") continue;
        const offset = text.length;
        for (const a of part.annotations || []) {
          if (a.type !== "url_citation" || !a.url) continue;
          spans.push({ end: offset + (a.end_index ?? part.text.length), url: a.url, n: cb.addSource({ url: a.url, title: a.title || a.url }) });
        }
        text += part.text;
      }
    }
    if (text) cb.onReplaceText(insertMarkers(text, spans));
  }
  return { servedBy, note: incomplete ? "Jawaban tidak lengkap (dihentikan oleh penyedia)." : undefined };
}
