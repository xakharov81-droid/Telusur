// Uji logika pemilihan "versi terbaru". Jalankan: node tests/latest.test.mjs
import assert from "node:assert/strict";
const { parseModel, rankLatest } = await import("../src/providers/latest.ts");

const m = (ids) => ids.map((id) => (typeof id === "string" ? { id } : id));
const cases = [
  ["Claude Opus naik versi", rankLatest(m(["claude-opus-4-8", "claude-opus-5", "claude-opus-5-5", "claude-opus-6", "claude-sonnet-6-5", "claude-haiku-5-5", "claude-opus-6-fast"]), "claude-opus-5-5", false)[0], "claude-opus-6"],
  ["Lini Sonnet tidak tertukar dengan Opus", rankLatest(m(["claude-opus-6", "claude-sonnet-5-5", "claude-sonnet-5"]), "claude-sonnet-5-5", false)[0], "claude-sonnet-5-5"],
  ["Snapshot bertanggal kalah dari alias", rankLatest(m(["claude-3-5-sonnet-20241022", "claude-sonnet-4-6", "claude-sonnet-4-5-20250929"]), "claude-sonnet-4-5", false)[0], "claude-sonnet-4-6"],
  ["OpenAI: astra terbaru, bukan mini/sol", rankLatest(m(["gpt-6-astra", "gpt-6.2-astra", "gpt-6.2-astra-2026-11-17", "gpt-6.3-astra-mini", "gpt-6.2-sol"]), "gpt-6-astra", false)[0], "gpt-6.2-astra"],
  ["Gemini: preview dilewati bila tidak diizinkan", rankLatest(m(["gemini-3.5-flash", "gemini-3.6-flash-preview", "gemini-3.5-flash-lite", "gemini-2.5-flash"]), "gemini-2.5-flash", false)[0], "gemini-3.5-flash"],
  ["Gemini: preview dipakai bila diizinkan", rankLatest(m(["gemini-3.5-flash", "gemini-3.6-flash-preview-11-20"]), "gemini-3.5-flash", true)[0], "gemini-3.6-flash-preview-11-20"],
  ["Gemini Pro preview ke GA", rankLatest(m(["gemini-3.1-pro-preview", "gemini-3.5-pro"]), "gemini-3.1-pro-preview", false)[0], "gemini-3.5-pro"],
  ["OpenRouter vendor dipertahankan", rankLatest(m(["anthropic/claude-opus-5.5", "anthropic/claude-opus-6", "openai/gpt-6.2-astra"]), "anthropic/claude-opus-5.5", false)[0], "anthropic/claude-opus-6"],
  ["Fable tetap di lini Fable", rankLatest(m(["claude-fable-5-1", "claude-fable-5-2", "claude-opus-6", "claude-mythos-5-2"]), "claude-fable-5-1", false)[0], "claude-fable-5-2"],
  ["Lini tak dikenal → kosong (pakai model manual)", rankLatest(m(["a", "b"]), "zzz-1", false).length, 0],
];
let ok = 0;
for (const [name, got, want] of cases) {
  try { assert.equal(got, want); ok++; console.log("PASS ", name); }
  catch { console.log("FAIL ", name, "→ dapat", got, "harusnya", want); }
}
assert.deepEqual(parseModel("claude-opus-5-5"), { family: "claude-opus", version: [5, 5], preview: false, dated: false });
console.log(`${ok}/${cases.length} lulus`);
process.exit(ok === cases.length ? 0 : 1);
