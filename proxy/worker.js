/**
 * Telusur Proxy — Cloudflare Worker (gratis) untuk mengatasi blokir CORS browser.
 *
 * Kapan perlu? Bila penyedia AI / pencarian menolak permintaan langsung dari browser
 * (mis. OpenAI, Brave Search, kadang Tavily). Claude, Gemini, OpenRouter & Wikipedia
 * umumnya tidak memerlukannya.
 *
 * Cara pasang (±3 menit):
 *   1. Buka https://dash.cloudflare.com → Workers & Pages → Create → "Hello World" Worker.
 *   2. Ganti seluruh kodenya dengan file ini → Deploy.
 *   3. (Disarankan) Settings → Variables → tambah ALLOWED_ORIGIN = URL aplikasi Telusur Anda,
 *      mis. https://namaanda.github.io  — agar proxy tidak bisa dipakai situs lain.
 *   4. Di Telusur → Pengaturan → Profil AI → Base URL, isi:
 *        OpenAI     : https://<worker>.workers.dev/openai/v1
 *        Anthropic  : https://<worker>.workers.dev/anthropic
 *        Gemini     : https://<worker>.workers.dev/gemini/v1beta
 *        OpenRouter : https://<worker>.workers.dev/openrouter/api/v1
 *        Groq       : https://<worker>.workers.dev/groq/openai/v1
 *        DeepSeek   : https://<worker>.workers.dev/deepseek/v1
 *      Untuk pencarian (kolom "URL proxy"):
 *        Tavily     : https://<worker>.workers.dev/tavily
 *        Brave      : https://<worker>.workers.dev/brave
 *
 * Privasi: Worker hanya meneruskan permintaan; tidak menyimpan API key maupun isi pertanyaan.
 */
const ROUTES = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  openrouter: "https://openrouter.ai",
  groq: "https://api.groq.com",
  deepseek: "https://api.deepseek.com",
  mistral: "https://api.mistral.ai",
  perplexity: "https://api.perplexity.ai",
  tavily: "https://api.tavily.com",
  brave: "https://api.search.brave.com",
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "*";
    if (allowed !== "*" && origin && origin !== allowed) {
      return new Response("Origin tidak diizinkan", { status: 403 });
    }
    const cors = {
      "Access-Control-Allow-Origin": allowed === "*" ? "*" : origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "*",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const [, service, ...rest] = url.pathname.split("/");
    const target = ROUTES[service];
    if (!target) {
      return new Response(`Telusur Proxy aktif. Rute: /${Object.keys(ROUTES).join(", /")}`, { status: 404, headers: cors });
    }
    const upstream = new URL(target + "/" + rest.join("/") + url.search);
    const headers = new Headers(request.headers);
    for (const h of ["Origin", "Referer", "Host", "Cookie", "CF-Connecting-IP", "X-Forwarded-For", "X-Real-IP"]) headers.delete(h);

    const res = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    });
    const out = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    out.delete("set-cookie");
    return new Response(res.body, { status: res.status, headers: out });
  },
};
