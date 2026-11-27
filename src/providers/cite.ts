export interface Span {
  /** Indeks karakter (UTF-16) tempat penanda disisipkan. */
  end: number;
  url: string;
  n: number;
}

/**
 * Sisipkan penanda [n] pada posisi akhir tiap span.
 * Bila model sudah menulis tautan ke URL yang sama di teks (mis. "([situs](url))"), penanda dilewati
 * agar tidak dobel.
 */
export function insertMarkers(text: string, spans: Span[]): string {
  const byPos = new Map<number, Set<number>>();
  for (const s of spans) {
    if (text.includes(s.url)) continue;
    const pos = Math.max(0, Math.min(text.length, s.end));
    if (!byPos.has(pos)) byPos.set(pos, new Set());
    byPos.get(pos)!.add(s.n);
  }
  const positions = [...byPos.keys()].sort((a, b) => b - a);
  let out = text;
  for (const pos of positions) {
    const marks = [...byPos.get(pos)!].sort((a, b) => a - b).map((n) => `[${n}]`).join("");
    out = out.slice(0, pos) + marks + out.slice(pos);
  }
  return out;
}

/** Sisipkan penanda setelah kemunculan potongan teks (dipakai untuk grounding Gemini). */
export function insertAfterSegments(text: string, segs: { text: string; ns: number[] }[]): string {
  const spans: Span[] = [];
  let from = 0;
  for (const s of segs) {
    if (!s.text) continue;
    let i = text.indexOf(s.text, from);
    if (i < 0) i = text.indexOf(s.text);
    if (i < 0) continue;
    from = i + s.text.length;
    for (const n of s.ns) spans.push({ end: i + s.text.length, url: `\u0000${n}`, n });
  }
  return insertMarkers(text, spans);
}
