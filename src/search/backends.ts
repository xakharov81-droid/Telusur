import { FriendlyError, type Profile, type Source } from "../providers/types";
import { httpError, safeFetch, trimSlash } from "../providers/sse";

export interface SearchHit extends Source {
  snippet: string;
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'");

/** Pencarian oleh aplikasi sendiri (untuk model tanpa pencarian bawaan, mis. Ollama). */
export async function searchWeb(p: Profile, query: string, signal: AbortSignal): Promise<SearchHit[]> {
  const n = Math.min(Math.max(p.maxSearches || 5, 3), 10);
  switch (p.search) {
    case "wikipedia":
      return wikipedia(query, n, signal);
    case "tavily": {
      if (!p.searchKey) throw new FriendlyError("Isi API key Tavily di pengaturan profil (gratis di tavily.com).");
      const base = trimSlash(p.searchUrl || "https://api.tavily.com");
      const res = await safeFetch(
        `${base}/search`,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${p.searchKey}` },
          body: JSON.stringify({ query, max_results: n, search_depth: "basic", include_answer: false }),
          signal,
        },
        "Tavily",
      );
      if (!res.ok) throw await httpError(res, "Tavily");
      const j = await res.json();
      return (j.results || []).map((r: any) => ({ url: r.url, title: r.title || r.url, snippet: r.content || "" }));
    }
    case "brave": {
      if (!p.searchKey) throw new FriendlyError("Isi API key Brave Search di pengaturan profil.");
      const base = trimSlash(p.searchUrl || "https://api.search.brave.com");
      const res = await safeFetch(
        `${base}/res/v1/web/search?q=${encodeURIComponent(query)}&count=${n}`,
        { headers: { accept: "application/json", "x-subscription-token": p.searchKey }, signal },
        "Brave Search",
      );
      if (!res.ok) throw await httpError(res, "Brave Search");
      const j = await res.json();
      return (j.web?.results || []).map((r: any) => ({ url: r.url, title: stripHtml(r.title || r.url), snippet: stripHtml(r.description || "") }));
    }
    case "searxng": {
      if (!p.searchUrl) throw new FriendlyError("Isi URL instance SearXNG Anda di pengaturan profil.");
      const res = await safeFetch(
        `${trimSlash(p.searchUrl)}/search?q=${encodeURIComponent(query)}&format=json`,
        { headers: { accept: "application/json" }, signal },
        "SearXNG",
      );
      if (!res.ok) throw await httpError(res, "SearXNG");
      const j = await res.json();
      return (j.results || []).slice(0, n).map((r: any) => ({ url: r.url, title: r.title || r.url, snippet: r.content || "" }));
    }
    default:
      return [];
  }
}

async function wikipedia(query: string, n: number, signal: AbortSignal): Promise<SearchHit[]> {
  const one = async (lang: string, limit: number): Promise<SearchHit[]> => {
    const u =
      `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search` +
      `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${limit}&prop=extracts|info&exintro=1&explaintext=1` +
      `&exlimit=max&exchars=1200&inprop=url`;
    const res = await safeFetch(u, { signal }, "Wikipedia");
    if (!res.ok) throw await httpError(res, "Wikipedia");
    const j = await res.json();
    const pages = Object.values(j.query?.pages || {}) as any[];
    pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return pages.map((pg) => ({ url: pg.fullurl, title: `${pg.title} — Wikipedia ${lang.toUpperCase()}`, snippet: pg.extract || "" }));
  };
  const half = Math.ceil(n / 2);
  const [id, en] = await Promise.allSettled([one("id", half), one("en", half)]);
  const hits = [
    ...(id.status === "fulfilled" ? id.value : []),
    ...(en.status === "fulfilled" ? en.value : []),
  ];
  if (!hits.length && id.status === "rejected") throw id.reason;
  return hits;
}

/** Bangun pertanyaan berkonteks: hasil pencarian bernomor + instruksi sitasi. */
export function withContext(question: string, hits: { n: number; hit: SearchHit }[]): string {
  if (!hits.length) return question;
  const ctx = hits
    .map(({ n, hit }) => `[${n}] ${hit.title}\nURL: ${hit.url}\n${hit.snippet.slice(0, 1500)}`)
    .join("\n\n");
  return (
    `Hasil pencarian web (gunakan sebagai rujukan, kutip dengan [nomor]):\n\n${ctx}\n\n---\n` +
    `Pertanyaan: ${question}`
  );
}
