// Uji end-to-end dengan respons penyedia AI tiruan (tanpa API key sungguhan).
// Jalankan: npm run build && npx vite preview --port 4173 & node tests/e2e.cjs
const { chromium, devices } = require("playwright");
const fs = require("fs");
const OUT = process.env.OUT || "tests/out";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || "http://localhost:4173/";

const sse = (events) => events.map((e) => (e.event ? `event: ${e.event}\n` : "") + `data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`).join("");
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

function anthropicStream({ pause = false, text = "Harga emas Antam hari ini naik menjadi Rp1,9 juta per gram" } = {}) {
  const ev = (type, data) => ({ event: type, data: { type, ...data } });
  const list = [
    ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }),
    ev("content_block_start", { index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } }),
    ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"harga emas hari ini"}' } }),
    ev("content_block_stop", { index: 0 }),
    ev("content_block_start", { index: 1, content_block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [
      { type: "web_search_result", url: "https://www.logammulia.com/id/harga-emas-hari-ini", title: "Harga Emas Hari Ini - Logam Mulia", encrypted_content: "x", page_age: null },
      { type: "web_search_result", url: "https://www.cnbcindonesia.com/market/emas", title: "Harga emas naik lagi - CNBC Indonesia", encrypted_content: "y", page_age: null },
    ] } }),
    ev("content_block_stop", { index: 1 }),
  ];
  if (pause) {
    list.push(ev("message_delta", { delta: { stop_reason: "pause_turn", stop_sequence: null }, usage: { output_tokens: 5 } }), ev("message_stop", {}));
    return sse(list);
  }
  list.push(
    ev("content_block_start", { index: 2, content_block: { type: "text", text: "" } }),
    ev("content_block_delta", { index: 2, delta: { type: "text_delta", text: "**Ringkasnya:** " } }),
    ev("content_block_stop", { index: 2 }),
    ev("content_block_start", { index: 3, content_block: { type: "text", text: "", citations: [] } }),
    ev("content_block_delta", { index: 3, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://www.logammulia.com/id/harga-emas-hari-ini", title: "Harga Emas Hari Ini - Logam Mulia", cited_text: "Rp1.900.000", encrypted_index: "e" } } }),
    ev("content_block_delta", { index: 3, delta: { type: "text_delta", text } }),
    ev("content_block_stop", { index: 3 }),
    ev("content_block_start", { index: 4, content_block: { type: "text", text: "" } }),
    ev("content_block_delta", { index: 4, delta: { type: "text_delta", text: ".\n\n| Jenis | Harga |\n|---|---|\n| 1 gram | Rp1,9 jt |\n\n- Tren: naik dalam sepekan" } }),
    ev("content_block_stop", { index: 4 }),
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 50 } }),
    ev("message_stop", {}),
  );
  return sse(list);
}

const openaiStream = () => {
  const text = "Ibu kota Indonesia secara resmi dipindahkan ke Nusantara ([kompas.com](https://www.kompas.com/ikn)). Proses pemindahan bertahap.";
  const ann = { type: "url_citation", url: "https://www.kompas.com/ikn", title: "IKN Nusantara - Kompas", start_index: 0, end_index: 85 };
  const ann2 = { type: "url_citation", url: "https://ikn.go.id/", title: "Otorita IKN", start_index: 87, end_index: text.length };
  return sse([
    { data: { type: "response.created", response: { model: "gpt-6.2-astra" } } },
    { data: { type: "response.web_search_call.searching" } },
    { data: { type: "response.output_item.done", item: { type: "web_search_call", action: { type: "search", query: "ibu kota indonesia", sources: [{ type: "url", url: "https://ikn.go.id/" }] } } } },
    { data: { type: "response.output_text.delta", delta: text.slice(0, 40) } },
    { data: { type: "response.output_text.delta", delta: text.slice(40) } },
    { data: { type: "response.output_text.annotation.added", annotation: ann } },
    { data: { type: "response.completed", response: { model: "gpt-6.2-astra", output: [
      { type: "web_search_call", action: { sources: [{ type: "url", url: "https://ikn.go.id/" }] } },
      { type: "message", content: [{ type: "output_text", text, annotations: [ann, ann2] }] },
    ] } } },
  ]);
};

const geminiStream = () => {
  const t1 = "Rendang adalah masakan daging khas Minangkabau.";
  const t2 = " Dimasak lama dengan santan dan rempah.";
  return sse([
    { data: { candidates: [{ content: { role: "model", parts: [{ text: t1 }] } }], modelVersion: "gemini-3.5-flash" } },
    { data: { candidates: [{ content: { role: "model", parts: [{ text: t2 }] }, finishReason: "STOP", groundingMetadata: {
      webSearchQueries: ["apa itu rendang"],
      searchEntryPoint: { renderedContent: '<style>.c{display:inline-block;padding:6px 12px;border:1px solid #ccc;border-radius:16px;font:13px sans-serif;margin:4px}</style><a class="c" href="https://www.google.com/search?q=apa+itu+rendang">apa itu rendang</a>' },
      groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "wikipedia.org" } }, { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/def", title: "detik.com" } }],
      groundingSupports: [{ segment: { startIndex: 0, endIndex: 46, text: t1 }, groundingChunkIndices: [0] }, { segment: { text: t2.trim() }, groundingChunkIndices: [0, 1] }],
    } }], modelVersion: "gemini-3.5-flash" } },
  ]);
};

const chatStream = (model, text, extra = {}) =>
  sse([
    ...text.match(/.{1,20}/gs).map((c) => ({ data: { model, choices: [{ index: 0, delta: { content: c } }] } })),
    { data: { model, choices: [{ index: 0, delta: { annotations: extra.annotations || [] }, finish_reason: "stop" }] } },
    { data: "[DONE]" },
  ]);

async function seed(page, profile, extra = {}) {
  await page.addInitScript(([p, e]) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    const prof = Object.assign({ id: "p1", name: "Uji", provider: "anthropic", apiKey: "test-key", model: "claude-opus-5-5", baseUrl: "", search: "native", searchKey: "", searchUrl: "", effort: "medium", maxSearches: 5 }, p);
    localStorage.setItem("telusur.settings.v1", JSON.stringify(Object.assign({ version: 1, profiles: [prof], activeId: prof.id, theme: "auto", systemExtra: "", saveHistory: true }, e)));
    localStorage.setItem("telusur.welcomed", "1");
  }, [profile, extra]);
}

async function ask(page, q) {
  const before = await page.locator(".ex .actions:not([hidden])").count();
  const ta = page.locator(".searchbox textarea").first();
  await ta.fill(q);
  await ta.press("Enter");
  await page.locator(".ex .actions:not([hidden])").nth(before).waitFor({ timeout: 15000 });
}

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  → " + detail : ""}`);
};

(async () => {
  const browser = await chromium.launch();

  // 1. Sambutan pertama kali
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.locator("#setDlg[open]").waitFor();
    check("Dialog sambutan muncul saat pertama dibuka", await page.locator("#setDlg .callout").first().isVisible());
    await page.screenshot({ path: `${OUT}/01-sambutan.png` });
    await page.locator('#setDlg [data-close]').click();
    await page.screenshot({ path: `${OUT}/02-beranda-desktop.png` });
    await ctx.close();
  }

  // 2. Anthropic Claude dengan pause_turn + sitasi
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await seed(page, { name: "Claude", provider: "anthropic" });
    const bodies = [];
    let calls = 0;
    await page.route("https://api.anthropic.com/**", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      bodies.push({ body: JSON.parse(route.request().postData()), headers: route.request().headers() });
      calls++;
      await route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: anthropicStream({ pause: calls === 1 }) });
    });
    await page.goto(BASE);
    await ask(page, "Berapa harga emas hari ini?");
    const b = bodies[0];
    check("Claude: tool web_search_20260209 dikirim", b?.body.tools?.[0]?.type === "web_search_20260209", JSON.stringify(b?.body.tools));
    check("Claude: fallbacks default + beta header", b?.body.fallbacks === "default" && /server-side-fallback-2026-07-01/.test(b?.headers["anthropic-beta"] || ""), JSON.stringify([b?.body.fallbacks, b?.headers["anthropic-beta"]]));
    check("Claude: effort dikirim di output_config", b?.body.output_config?.effort === "medium");
    check("Claude: header akses browser langsung", b?.headers["anthropic-dangerous-direct-browser-access"] === "true");
    check("Claude: pause_turn dilanjutkan (2 panggilan, konten asisten dikirim ulang)", calls === 2 && bodies[1].body.messages.at(-1).role === "assistant", `calls=${calls}`);
    check("Claude: 2 kartu sumber tampil", (await page.locator(".src:not(.more)").count()) === 2);
    check("Claude: sitasi [1] jadi tautan", (await page.locator(".answer a.cite").count()) >= 1);
    check("Claude: tabel markdown dirender", (await page.locator(".answer table").count()) === 1);
    check("Claude: model penjawab tampil", /claude-opus-5-5/.test(await page.locator(".actions .by").innerText()));
    await page.screenshot({ path: `${OUT}/03-claude-desktop.png`, fullPage: true });

    // Tanya lanjutan memakai konteks
    await ask(page, "Bagaimana tren minggu depan?");
    const last = bodies.at(-1).body.messages;
    check("Tanya lanjutan membawa riwayat percakapan", last.length === 3 && last[0].content.includes("harga emas"), JSON.stringify(last.map((m) => m.role)));

    // Riwayat tersimpan
    await page.locator("#histBtn").click();
    check("Riwayat menyimpan pencarian", (await page.locator(".hitem").count()) === 1);
    await page.screenshot({ path: `${OUT}/04-riwayat.png` });
    await ctx.close();
  }

  // 3. OpenAI
  {
    const ctx = await browser.newContext({ ...devices["iPhone 15"] });
    const page = await ctx.newPage();
    await seed(page, { name: "GPT", provider: "openai", model: "gpt-6.2-astra", effort: "" });
    let body;
    await page.route("https://api.openai.com/**", async (route) => {
      body = JSON.parse(route.request().postData());
      await route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: openaiStream() });
    });
    await page.goto(BASE);
    await page.screenshot({ path: `${OUT}/05-beranda-ponsel.png` });
    await ask(page, "Di mana ibu kota Indonesia sekarang?");
    check("OpenAI: tool web_search + include sources", body?.tools?.[0]?.type === "web_search" && body.include?.includes("web_search_call.action.sources"));
    const html = await page.locator(".answer").innerHTML();
    check("OpenAI: tautan inline dipertahankan, tidak dobel penanda", /kompas\.com\/ikn/.test(html) && (html.match(/class="cite"/g) || []).length === 1, html.slice(0, 300));
    check("OpenAI: 2 sumber (dedup)", (await page.locator(".src:not(.more)").count()) === 2);
    await page.screenshot({ path: `${OUT}/06-openai-ponsel.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check("Ponsel: tidak ada scroll horizontal", !overflow);
    await ctx.close();
  }

  // 4. Gemini
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, colorScheme: "dark", deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await seed(page, { name: "Gemini", provider: "gemini", model: "gemini-3.5-flash", effort: "" });
    let url, body;
    await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
      url = route.request().url();
      body = JSON.parse(route.request().postData());
      await route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: geminiStream() });
    });
    await page.goto(BASE);
    await ask(page, "Apa itu rendang?");
    check("Gemini: endpoint streamGenerateContent?alt=sse", /gemini-3\.5-flash:streamGenerateContent\?alt=sse/.test(url));
    check("Gemini: tool google_search", JSON.stringify(body?.tools) === '[{"google_search":{}}]');
    check("Gemini: sitasi grounding disisipkan", (await page.locator(".answer a.cite").count()) === 3);
    check("Gemini: widget saran Google ditampilkan", (await page.locator("iframe.gwidget").count()) === 1);
    await page.screenshot({ path: `${OUT}/07-gemini-gelap.png`, fullPage: true });
    await ctx.close();
  }

  // 5. OpenRouter
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await ctx.newPage();
    await seed(page, { name: "OpenRouter", provider: "openrouter", model: "openrouter/auto", effort: "" });
    let body;
    await page.route("https://openrouter.ai/**", async (route) => {
      body = JSON.parse(route.request().postData());
      const text = "Borobudur dibangun pada abad ke-8 oleh Dinasti Syailendra.";
      await route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: chatStream("deepseek/deepseek-chat", text, { annotations: [{ type: "url_citation", url_citation: { url: "https://id.wikipedia.org/wiki/Borobudur", title: "Borobudur", start_index: 0, end_index: text.length } }] }) });
    });
    await page.goto(BASE);
    await ask(page, "Kapan Borobudur dibangun?");
    check("OpenRouter: tool openrouter:web_search", body?.tools?.[0]?.type === "openrouter:web_search");
    check("OpenRouter: anotasi jadi sitasi", (await page.locator(".answer a.cite").count()) === 1 && (await page.locator(".src").count()) === 1);
    await ctx.close();
  }

  // 6. Ollama/OpenAI-compatible + Wikipedia
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await ctx.newPage();
    await seed(page, { name: "Ollama", provider: "compat", apiKey: "", model: "llama3.2", baseUrl: "http://localhost:11434/v1", search: "wikipedia", effort: "" });
    let chatBody, chatHeaders;
    await page.route("https://*.wikipedia.org/**", async (route) => {
      const lang = new URL(route.request().url()).hostname.split(".")[0];
      await route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ query: { pages: { 1: { index: 1, title: lang === "id" ? "Danau Toba" : "Lake Toba", fullurl: `https://${lang}.wikipedia.org/wiki/${lang === "id" ? "Danau_Toba" : "Lake_Toba"}`, extract: "Danau vulkanik terbesar di dunia." } } } }) });
    });
    await page.route("http://localhost:11434/**", async (route) => {
      chatBody = JSON.parse(route.request().postData());
      chatHeaders = route.request().headers();
      await route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: chatStream("llama3.2", "Danau Toba adalah danau vulkanik terbesar di dunia [1][2].") });
    });
    await page.goto(BASE);
    await ask(page, "Apa itu Danau Toba?");
    const userMsg = chatBody?.messages?.at(-1)?.content || "";
    check("Lokal: hasil Wikipedia dimasukkan sebagai konteks bernomor", /\[1\] Danau Toba/.test(userMsg) && /\[2\] Lake Toba/.test(userMsg), userMsg.slice(0, 200));
    check("Lokal: tanpa header Authorization bila key kosong", !chatHeaders?.authorization);
    check("Lokal: sitasi [1][2] tertaut", (await page.locator(".answer a.cite").count()) === 2);
    await ctx.close();
  }

  // 7. Galat 401 ditampilkan dengan jelas
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await seed(page, { provider: "openai", model: "gpt-6.2-astra", effort: "" });
    await page.route("https://api.openai.com/**", (route) => route.fulfill({ status: 401, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ error: { message: "Incorrect API key provided" } }) }));
    await page.goto(BASE);
    await ask(page, "tes");
    check("Galat 401 dijelaskan dalam bahasa Indonesia", /API key OpenAI tidak valid/.test(await page.locator(".err").innerText()));
    await ctx.close();
  }

  // 8. Sinkron: ekspor → impor di "perangkat" lain
  {
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    await seed(p1, { id: "pX", name: "Claude Kantor", apiKey: "sk-rahasia-123" });
    await p1.goto(BASE);
    await p1.locator("#setBtn").click();
    await p1.locator('[data-tab="sinkron"]').click();
    await p1.locator("[data-xpass]").fill("katasandi-kuat");
    await p1.locator("[data-export]").click();
    await p1.locator("[data-xout]:not([hidden])").waitFor();
    const code = await p1.locator("[data-xcode]").inputValue();
    check("Sinkron: kode terenkripsi tidak memuat key mentah", code.startsWith("TELUSUR1:") && !code.includes("sk-rahasia"));
    await p1.screenshot({ path: `${OUT}/08-sinkron.png` });
    await ctx1.close();

    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await seed(p2, { id: "pY", name: "Default", apiKey: "" });
    await p2.goto(BASE);
    await p2.locator("#setBtn").click();
    await p2.locator('[data-tab="sinkron"]').click();
    await p2.locator("[data-icode]").fill(code);
    await p2.locator("[data-ipass]").fill("salah-sandi");
    await p2.locator("[data-import]").click();
    await p2.locator(".toast").waitFor();
    check("Sinkron: kata sandi salah ditolak", /Kata sandi salah/.test(await p2.locator(".toast").innerText()));
    await p2.locator("[data-ipass]").fill("katasandi-kuat");
    await p2.locator("[data-import]").click();
    await p2.locator(".toast", { hasText: "Berhasil" }).waitFor();
    const s = JSON.parse(await p2.evaluate(() => localStorage.getItem("telusur.settings.v1")));
    check("Sinkron: profil + key berhasil diimpor", s.profiles.some((p) => p.name === "Claude Kantor" && p.apiKey === "sk-rahasia-123"));
    await p2.screenshot({ path: `${OUT}/09-pengaturan-profil.png` });
    await ctx2.close();
  }

  // 9. ?q= dari bilah alamat / share target
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await seed(page, { name: "Claude" });
    await page.route("https://api.anthropic.com/**", (route) =>
      route.request().method() === "OPTIONS" ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: anthropicStream() }),
    );
    await page.goto(BASE + "?q=" + encodeURIComponent("harga emas"));
    await page.locator(".ex .actions:not([hidden])").waitFor({ timeout: 15000 });
    check("URL ?q= langsung menjalankan pencarian", (await page.locator(".ex h2").innerText()) === "harga emas");
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} lulus`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
