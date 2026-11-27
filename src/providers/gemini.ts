import { FriendlyError, type RunInput, type RunResult } from "./types";
import { httpError, readSSE, safeFetch, trimSlash } from "./sse";
import { insertAfterSegments } from "./cite";

/** Google Gemini (generateContent) dengan Grounding with Google Search. */
export async function runGemini(input: RunInput, native: boolean): Promise<RunResult> {
  const { profile: p, cb, signal } = input;
  const base = trimSlash(p.baseUrl || "https://generativelanguage.googleapis.com/v1beta");
  const model = p.model.replace(/^models\//, "");
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: input.system }] },
    contents: [
      ...input.history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
      { role: "user", parts: [{ text: input.question }] },
    ],
  };
  if (native) body.tools = [{ google_search: {} }];
  if (p.effort) body.generationConfig = { thinkingConfig: { thinkingLevel: p.effort === "low" ? "low" : "high" } };

  const res = await safeFetch(
    `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": p.apiKey },
      body: JSON.stringify(body),
      signal,
    },
    "Google Gemini",
  );
  if (!res.ok) throw await httpError(res, "Google Gemini");

  let text = "";
  let grounding: any;
  let servedBy: string | undefined;
  let blocked: string | undefined;
  let finish: string | undefined;
  if (native) cb.onStatus("Mencari dengan Google…");

  await readSSE(res, (data) => {
    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.error) {
      blocked = chunk.error.message || "Galat dari Gemini.";
      return;
    }
    servedBy = chunk.modelVersion || servedBy;
    if (chunk.promptFeedback?.blockReason) blocked = `Pertanyaan diblokir (${chunk.promptFeedback.blockReason}).`;
    const cand = chunk.candidates?.[0];
    if (!cand) return;
    for (const part of cand.content?.parts || []) {
      if (part.thought || typeof part.text !== "string") continue;
      text += part.text;
      cb.onText(part.text);
    }
    if (cand.groundingMetadata) {
      grounding = cand.groundingMetadata;
      const qs: string[] = grounding.webSearchQueries || [];
      if (qs.length) cb.onStatus(`Mencari: ${qs.map((q) => `“${q}”`).join(", ")}`);
    }
    if (cand.finishReason) finish = cand.finishReason;
  });

  if (blocked) throw new FriendlyError(`Gemini: ${blocked}`);
  if (!text && finish && finish !== "STOP") {
    throw new FriendlyError(`Gemini berhenti tanpa jawaban (alasan: ${finish}). Coba ubah pertanyaan.`);
  }

  let searchWidgetHtml: string | undefined;
  if (grounding) {
    const chunkToN: number[] = [];
    (grounding.groundingChunks || []).forEach((c: any, i: number) => {
      const w = c.web || c.retrievedContext;
      if (w?.uri) chunkToN[i] = cb.addSource({ url: w.uri, title: w.title || w.uri });
    });
    const segs = (grounding.groundingSupports || []).map((s: any) => ({
      text: s.segment?.text || "",
      ns: (s.groundingChunkIndices || []).map((i: number) => chunkToN[i]).filter(Boolean),
    }));
    if (segs.length) cb.onReplaceText(insertAfterSegments(text, segs));
    searchWidgetHtml = grounding.searchEntryPoint?.renderedContent;
  }
  return {
    servedBy,
    searchWidgetHtml,
    note: finish === "MAX_TOKENS" ? "Jawaban terpotong karena mencapai batas panjang." : undefined,
  };
}
