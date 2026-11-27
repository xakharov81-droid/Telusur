import "./style.css";
import { PROVIDERS, listModels, runSearch } from "./providers";
import { FriendlyError, type Profile, type ProviderKind, type SearchBackendKind, type Source, type Turn } from "./providers/types";
import {
  exportBundle, importBundle, loadHistory, loadSettings, newProfile, saveHistory, saveSettings, uid,
  type Exchange, type Settings, type Thread,
} from "./store";
import { esc, hostOf, renderAnswer } from "./render";

// ---------- Ikon (inline SVG) ----------
const I = {
  logo: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--accent)"/><circle cx="14" cy="14" r="6.5" fill="none" stroke="var(--accent-ink)" stroke-width="2.6"/><path d="M19 19l5.5 5.5" stroke="var(--accent-ink)" stroke-width="2.8" stroke-linecap="round"/><path d="M14 10.2l1 2.6 2.7 1-2.7 1-1 2.7-1-2.7-2.6-1 2.6-1z" fill="var(--accent-ink)"/></svg>`,
  history: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`,
  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4M12 2v14"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>`,
  link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>`,
};

// ---------- State ----------
let settings: Settings = loadSettings();
let threads: Thread[] = loadHistory();
let current: Thread | null = null;
let controller: AbortController | null = null;

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const active = (): Profile => settings.profiles.find((p) => p.id === settings.activeId) || settings.profiles[0];
const persist = () => saveSettings(settings);

function applyTheme() {
  const t = settings.theme;
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

function toast(msg: string) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function systemPrompt(): string {
  const today = new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return [
    `Kamu adalah Telusur, mesin pencari pribadi bertenaga AI. Hari ini: ${today}.`,
    "Tugasmu: menjawab pertanyaan pengguna secara akurat, padat, dan mudah dipindai, seperti hasil mesin pencari terbaik.",
    "- Mulai langsung dengan jawaban inti (1–3 kalimat), lalu rincian seperlunya memakai Markdown: paragraf pendek, poin, atau tabel bila membantu.",
    "- Gunakan pencarian web untuk informasi terbaru atau faktual, dan dasarkan jawaban pada sumber.",
    "- Bila hasil pencarian diberikan dengan nomor, kutip dengan format [n] tepat setelah kalimat yang didukung. Jangan mengarang nomor atau URL.",
    "- Jawab dalam bahasa yang sama dengan pertanyaan pengguna.",
    "- Bila informasi tidak ditemukan, saling bertentangan, atau tidak pasti, katakan dengan jujur.",
    settings.systemExtra.trim() ? `\nPreferensi tambahan pengguna:\n${settings.systemExtra.trim()}` : "",
  ].join("\n");
}

// ---------- Layout ----------
const app = $("#app");
app.innerHTML = `
  <header class="top">
    <button class="brand" id="home" aria-label="Beranda">${I.logo}<span>Telusur</span></button>
    <div class="spacer"></div>
    <label class="sr" for="pp">Profil AI aktif</label>
    <select class="profile-pick" id="pp" title="Pilih AI"></select>
    <button class="icon-btn" id="newBtn" title="Pencarian baru" aria-label="Pencarian baru">${I.plus}</button>
    <button class="icon-btn" id="histBtn" title="Riwayat" aria-label="Riwayat">${I.history}</button>
    <button class="icon-btn" id="setBtn" title="Pengaturan" aria-label="Pengaturan">${I.gear}</button>
  </header>
  <main id="main"></main>
  <div class="dock" id="dock" hidden></div>
  <dialog class="drawer" id="histDlg"></dialog>
  <dialog class="sheet" id="setDlg"></dialog>
`;
const main = $("#main");
const dock = $("#dock");

function renderProfilePick() {
  const pp = $<HTMLSelectElement>("#pp");
  pp.innerHTML = settings.profiles
    .map((p) => `<option value="${p.id}" ${p.id === settings.activeId ? "selected" : ""}>${esc(p.name)} · ${esc(shortModel(p.model))}</option>`)
    .join("");
}
const shortModel = (m: string) => (m.length > 24 ? m.slice(0, 22) + "…" : m);

$("#pp").addEventListener("change", (e) => {
  settings.activeId = (e.target as HTMLSelectElement).value;
  persist();
  toast(`AI aktif: ${active().name}`);
});
$("#home").addEventListener("click", () => goHome());
$("#newBtn").addEventListener("click", () => goHome());
$("#histBtn").addEventListener("click", () => openHistory());
$("#setBtn").addEventListener("click", () => openSettings());

// ---------- Kotak pencarian ----------
function searchBox(placeholder: string, onSubmit: (q: string) => void): HTMLElement {
  const box = document.createElement("form");
  box.className = "searchbox";
  const id = "q-" + uid();
  box.innerHTML = `
    <label class="sr" for="${id}">Pertanyaan</label>
    <textarea rows="1" id="${id}" placeholder="${esc(placeholder)}" enterkeyhint="search" autocomplete="off"></textarea>
    <button class="go" type="submit" aria-label="Cari" disabled>${I.arrow}</button>`;
  const ta = $<HTMLTextAreaElement>("textarea", box);
  const go = $<HTMLButtonElement>(".go", box);
  const fit = () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    if (!go.classList.contains("stop")) go.disabled = !ta.value.trim();
  };
  ta.addEventListener("input", fit);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      box.requestSubmit();
    }
  });
  box.addEventListener("submit", (e) => {
    e.preventDefault();
    if (go.classList.contains("stop")) return controller?.abort();
    const q = ta.value.trim();
    if (!q) return;
    ta.value = "";
    fit();
    onSubmit(q);
  });
  return box;
}

function setBusy(busy: boolean) {
  document.querySelectorAll<HTMLButtonElement>(".go").forEach((b) => {
    b.classList.toggle("stop", busy);
    b.innerHTML = busy ? I.stop : I.arrow;
    b.setAttribute("aria-label", busy ? "Hentikan" : "Cari");
    b.disabled = busy ? false : !$<HTMLTextAreaElement>("textarea", b.parentElement!).value.trim();
  });
}

// ---------- Beranda ----------
const SUGGESTIONS = [
  "Berita teknologi terbaru minggu ini",
  "Bandingkan harga dan spesifikasi HP flagship 2026",
  "Cara membuat kopi susu gula aren ala kafe",
  "Apa itu vibe coding dan alat terbaiknya?",
];

function goHome() {
  controller?.abort();
  current = null;
  history.replaceState(null, "", location.pathname);
  dock.hidden = true;
  main.innerHTML = `
    <section class="home">
      <h1>${I.logo} Telusur</h1>
      <p class="tag">Mesin pencari pribadi Anda — ditenagai AI pilihan Anda sendiri.</p>
      <div id="homeBox" style="width:100%"></div>
      <div class="suggest">${SUGGESTIONS.map((s) => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
    </section>`;
  const box = searchBox("Tanyakan apa saja…", (q) => ask(q, false));
  $("#homeBox").appendChild(box);
  main.querySelectorAll<HTMLButtonElement>(".chip[data-q]").forEach((c) => c.addEventListener("click", () => ask(c.dataset.q!, false)));
  if (matchMedia("(pointer: fine)").matches) $<HTMLTextAreaElement>("textarea", box).focus();
}

function ensureThreadView() {
  if (!main.querySelector(".thread")) {
    main.innerHTML = `<div class="thread" aria-live="polite"></div>`;
    dock.innerHTML = "";
    dock.appendChild(searchBox("Tanya lanjutan…", (q) => ask(q, true)));
    dock.hidden = false;
  }
  return $(".thread", main);
}

// ---------- Tampilan satu tanya-jawab ----------
function sourceCards(sources: Source[], expanded: boolean): string {
  const max = 6;
  const shown = expanded ? sources : sources.slice(0, max);
  return (
    shown
      .map(
        (s, i) => `<a class="src" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title)}">
        <span class="t">${esc(s.title)}</span>
        <span class="h"><span class="num">${i + 1}</span>${esc(displayHost(s))}</span></a>`,
      )
      .join("") +
    (!expanded && sources.length > max ? `<button class="src more" data-more>+${sources.length - max} sumber lainnya</button>` : "")
  );
}

// Grounding Gemini memakai URL redirect Google; judulnya berisi domain asli.
const displayHost = (s: Source) => (/vertexaisearch\.cloud\.google\.com$/.test(hostOf(s.url)) ? s.title : hostOf(s.url));

function exchangeEl(ex: Exchange, idx: number): HTMLElement {
  const el = document.createElement("article");
  el.className = "ex";
  el.dataset.idx = String(idx);
  el.innerHTML = `
    <h2>${esc(ex.q)}</h2>
    <div class="status" hidden></div>
    <div class="srcwrap" hidden><div class="label">${I.link} Sumber</div><div class="sources"></div></div>
    <div class="label ansl" hidden>Jawaban</div>
    <div class="answer"></div>
    <div class="extra"></div>
    <div class="actions" hidden></div>`;
  return el;
}

function paint(el: HTMLElement, ex: Exchange, live: boolean) {
  const srcwrap = $(".srcwrap", el);
  srcwrap.hidden = !ex.sources.length;
  const grid = $(".sources", srcwrap);
  if (grid.dataset.count !== String(ex.sources.length) || !live) {
    grid.innerHTML = sourceCards(ex.sources, grid.dataset.expanded === "1");
    grid.dataset.count = String(ex.sources.length);
    grid.querySelector("[data-more]")?.addEventListener("click", () => {
      grid.dataset.expanded = "1";
      grid.innerHTML = sourceCards(ex.sources, true);
    });
  }
  $(".ansl", el).hidden = !ex.a;
  const ans = $(".answer", el);
  ans.innerHTML = ex.a ? renderAnswer(ex.a, ex.sources) : "";
  ans.classList.toggle("caret", live && !!ex.a);

  const extra = $(".extra", el);
  extra.innerHTML = "";
  if (ex.error) extra.innerHTML = `<div class="err"><b>Gagal:</b> ${esc(ex.error)}</div>`;
  if (ex.note) extra.insertAdjacentHTML("beforeend", `<div class="note">${esc(ex.note)}</div>`);
  if (ex.widget && !live) {
    // "Google Search suggestions" wajib ditampilkan saat memakai grounding Gemini.
    const f = document.createElement("iframe");
    f.className = "gwidget";
    f.title = "Saran Google Penelusuran";
    f.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    f.srcdoc = `<meta name="color-scheme" content="light dark"><base target="_blank"><style>body{margin:0;background:transparent}</style>${ex.widget}`;
    extra.appendChild(f);
  }

  const acts = $(".actions", el);
  acts.hidden = live;
  if (!live) {
    acts.innerHTML = `
      <span class="by">${esc([ex.profileName, ex.servedBy].filter(Boolean).join(" · "))}</span>
      ${ex.a ? `<button class="act" data-a="copy">${I.copy}Salin</button><button class="act" data-a="share">${I.share}Bagikan</button>` : ""}
      <button class="act" data-a="redo">${I.redo}Ulangi</button>`;
    acts.querySelector('[data-a="copy"]')?.addEventListener("click", () => copyAnswer(ex));
    acts.querySelector('[data-a="share"]')?.addEventListener("click", () => shareAnswer(ex));
    acts.querySelector('[data-a="redo"]')?.addEventListener("click", () => {
      if (controller) return toast("Tunggu pencarian saat ini selesai atau hentikan dulu.");
      ask(ex.q, true, Number(el.dataset.idx));
    });
  }
}

function plainAnswer(ex: Exchange): string {
  const refs = ex.sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join("\n");
  return `${ex.q}\n\n${ex.a}${refs ? `\n\nSumber:\n${refs}` : ""}`;
}

async function copyAnswer(ex: Exchange) {
  try {
    await navigator.clipboard.writeText(plainAnswer(ex));
    toast("Jawaban disalin");
  } catch {
    toast("Tidak bisa menyalin di perangkat ini");
  }
}

async function shareAnswer(ex: Exchange) {
  const url = `${location.origin}${location.pathname}?q=${encodeURIComponent(ex.q)}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: ex.q, text: plainAnswer(ex), url });
    } catch {
      /* dibatalkan */
    }
  } else copyAnswer(ex);
}

function renderThread() {
  const box = ensureThreadView();
  box.innerHTML = "";
  current!.items.forEach((ex, i) => {
    const el = exchangeEl(ex, i);
    box.appendChild(el);
    paint(el, ex, false);
  });
}

// ---------- Menjalankan pencarian ----------
function normUrl(u: string) {
  return u.replace(/#.*$/, "").replace(/\/+$/, "");
}

async function ask(q: string, followUp: boolean, redoIndex?: number) {
  if (controller) return;
  const p = active();
  if (PROVIDERS[p.provider].keyRequired && !p.apiKey) {
    openSettings(`Masukkan API key untuk profil “${p.name}” terlebih dahulu.`);
    return;
  }

  if (!followUp || !current) {
    current = { id: uid(), title: q, updated: Date.now(), items: [] };
    threads.unshift(current);
    main.innerHTML = "";
  }
  const thread = current;
  const prior = thread.items.slice(0, redoIndex ?? thread.items.length).filter((x) => x.a);
  const turns: Turn[] = prior.slice(-6).flatMap((x) => [
    { role: "user", text: x.q },
    { role: "assistant", text: x.a },
  ]);

  const ex: Exchange = { q, a: "", sources: [], profileName: p.name, at: Date.now() };
  const box = ensureThreadView();
  let el: HTMLElement;
  if (redoIndex !== undefined) {
    thread.items[redoIndex] = ex;
    el = box.querySelector<HTMLElement>(`.ex[data-idx="${redoIndex}"]`)!;
    const fresh = exchangeEl(ex, redoIndex);
    el.replaceWith(fresh);
    el = fresh;
  } else {
    thread.items.push(ex);
    el = exchangeEl(ex, thread.items.length - 1);
    box.appendChild(el);
  }
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", `${location.pathname}?q=${encodeURIComponent(thread.items[0].q)}`);

  const status = $(".status", el);
  const setStatus = (m: string) => {
    status.hidden = !m;
    status.innerHTML = m ? `<span class="dot"></span><span>${esc(m)}</span>` : "";
  };
  setStatus("Memulai…");

  let raf = 0;
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      paint(el, ex, true);
    });
  };

  controller = new AbortController();
  setBusy(true);
  try {
    const res = await runSearch({
      profile: p,
      system: systemPrompt(),
      history: turns,
      question: q,
      signal: controller.signal,
      cb: {
        onText(d) {
          ex.a += d;
          if (ex.a.trim()) setStatus("");
          schedule();
        },
        onReplaceText(full) {
          ex.a = full;
          schedule();
        },
        addSource(s) {
          const key = normUrl(s.url);
          const i = ex.sources.findIndex((x) => normUrl(x.url) === key);
          if (i >= 0) {
            if (s.title && ex.sources[i].title === ex.sources[i].url) ex.sources[i].title = s.title;
            return i + 1;
          }
          ex.sources.push({ url: s.url, title: s.title || s.url });
          schedule();
          return ex.sources.length;
        },
        onStatus(m) {
          if (!ex.a.trim()) setStatus(m);
        },
      },
    });
    ex.servedBy = res.servedBy;
    ex.note = res.note;
    ex.widget = res.searchWidgetHtml;
    if (!ex.a.trim() && !ex.error) ex.error = "Model tidak mengembalikan jawaban.";
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") ex.note = "Dihentikan.";
    else if (err instanceof FriendlyError) ex.error = err.message;
    else ex.error = `Terjadi galat tak terduga: ${err.message || err}`;
    console.error(e);
  } finally {
    cancelAnimationFrame(raf);
    controller = null;
    setBusy(false);
    setStatus("");
    paint(el, ex, false);
    thread.updated = Date.now();
    if (settings.saveHistory) saveHistory(threads);
  }
}

// ---------- Riwayat ----------
function fmtWhen(t: number) {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function openHistory() {
  const dlg = $<HTMLDialogElement>("#histDlg");
  dlg.innerHTML = `
    <div class="dhead"><h3>Riwayat</h3><button class="icon-btn" data-close aria-label="Tutup">${I.x}</button></div>
    <div class="dbody">
      <input class="hsearch" type="search" placeholder="Cari di riwayat…" aria-label="Cari di riwayat" />
      <div class="hlist"></div>
      ${threads.length ? `<div class="btns"><button class="btn danger" data-clear>${I.trash} Hapus semua riwayat</button></div>` : ""}
      ${!settings.saveHistory ? `<p class="hint">Penyimpanan riwayat sedang dimatikan (Pengaturan → Umum).</p>` : ""}
    </div>`;
  const list = $(".hlist", dlg);
  const draw = (filter = "") => {
    const f = filter.toLowerCase();
    const items = threads.filter((t) => !f || t.title.toLowerCase().includes(f) || t.items.some((x) => x.q.toLowerCase().includes(f)));
    list.innerHTML = items.length
      ? items
          .map(
            (t) => `<div class="hitem"><button class="open" data-id="${t.id}"><span class="ttl">${esc(t.title)}</span><span class="when">${fmtWhen(t.updated)} · ${t.items.length} pertanyaan</span></button>
            <button class="icon-btn" data-del="${t.id}" aria-label="Hapus">${I.trash}</button></div>`,
          )
          .join("")
      : `<div class="empty">${threads.length ? "Tidak ada yang cocok." : "Belum ada riwayat pencarian."}</div>`;
  };
  draw();
  $<HTMLInputElement>(".hsearch", dlg).addEventListener("input", (e) => draw((e.target as HTMLInputElement).value));
  dlg.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t === dlg || t.closest("[data-close]")) return dlg.close();
    const open = t.closest<HTMLElement>("[data-id]");
    if (open) {
      controller?.abort();
      current = threads.find((x) => x.id === open.dataset.id) || null;
      if (current) {
        main.innerHTML = "";
        renderThread();
        history.replaceState(null, "", location.pathname);
        window.scrollTo(0, 0);
      }
      return dlg.close();
    }
    const del = t.closest<HTMLElement>("[data-del]");
    if (del) {
      threads = threads.filter((x) => x.id !== del.dataset.del);
      if (current?.id === del.dataset.del) goHome();
      saveHistory(threads);
      draw($<HTMLInputElement>(".hsearch", dlg).value);
      return;
    }
    if (t.closest("[data-clear]") && confirm("Hapus semua riwayat pencarian di perangkat ini?")) {
      threads = [];
      saveHistory(threads);
      goHome();
      dlg.close();
    }
  };
  dlg.showModal();
}

// ---------- Pengaturan ----------
const SEARCH_LABELS: Record<SearchBackendKind, string> = {
  native: "Bawaan AI (direkomendasikan)",
  wikipedia: "Wikipedia (gratis, tanpa key)",
  tavily: "Tavily (key gratis tersedia)",
  brave: "Brave Search API (perlu proxy)",
  searxng: "SearXNG milik sendiri",
  none: "Tanpa pencarian (pengetahuan model saja)",
};

let settingsTab: "ai" | "umum" | "sinkron" = "ai";
let editingId = "";

function openSettings(notice = "") {
  const dlg = $<HTMLDialogElement>("#setDlg");
  if (!editingId || !settings.profiles.some((p) => p.id === editingId)) editingId = settings.activeId;
  if (notice) settingsTab = "ai";
  dlg.innerHTML = `
    <div class="dhead"><h3>Pengaturan</h3><button class="icon-btn" data-close aria-label="Tutup">${I.x}</button></div>
    <div class="dbody">
      ${notice ? `<div class="callout">${esc(notice)}</div>` : ""}
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="ai" aria-selected="${settingsTab === "ai"}">Profil AI</button>
        <button role="tab" data-tab="umum" aria-selected="${settingsTab === "umum"}">Umum</button>
        <button role="tab" data-tab="sinkron" aria-selected="${settingsTab === "sinkron"}">Sinkron perangkat</button>
      </div>
      <div class="tabbody"></div>
    </div>`;
  dlg.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      settingsTab = b.dataset.tab as typeof settingsTab;
      openSettings();
    }),
  );
  dlg.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t === dlg || t.closest("[data-close]")) dlg.close();
  };
  dlg.onclose = () => renderProfilePick();
  const body = $(".tabbody", dlg);
  if (settingsTab === "ai") profileTab(body);
  else if (settingsTab === "umum") generalTab(body);
  else syncTab(body);
  if (!dlg.open) dlg.showModal();
}

function profileTab(body: HTMLElement) {
  const p = settings.profiles.find((x) => x.id === editingId)!;
  const meta = PROVIDERS[p.provider];
  const searchOpts = (Object.keys(SEARCH_LABELS) as SearchBackendKind[]).filter((k) => k !== "native" || meta.native);
  if (!searchOpts.includes(p.search)) p.search = "wikipedia";
  const needSearchKey = p.search === "tavily" || p.search === "brave";
  const needSearchUrl = p.search === "searxng" || p.search === "tavily" || p.search === "brave";

  body.innerHTML = `
    <div class="plist">
      ${settings.profiles
        .map((x) => `<button class="chip" data-pid="${x.id}" aria-pressed="${x.id === editingId}">${esc(x.name)}${x.id === settings.activeId ? " ✓" : ""}</button>`)
        .join("")}
      <button class="chip" data-add>${"+ Tambah profil"}</button>
    </div>
    <p class="hint" style="margin-top:-6px">Buat beberapa profil (mis. “Claude cepat”, “Gemini gratis”, “Ollama offline”) dan ganti kapan saja dari menu di atas.</p>

    <div class="grid2">
      <label class="field"><span>Nama profil</span><input data-k="name" value="${esc(p.name)}" maxlength="40" /></label>
      <label class="field"><span>Penyedia AI</span>
        <select data-k="provider">${(Object.keys(PROVIDERS) as ProviderKind[])
          .map((k) => `<option value="${k}" ${k === p.provider ? "selected" : ""}>${esc(PROVIDERS[k].label)}</option>`)
          .join("")}</select></label>
    </div>
    <p class="hint" style="margin:-6px 0 14px">${esc(meta.hint)}</p>

    <label class="field"><span>API key ${meta.keyRequired ? "" : "(opsional)"}</span>
      <div class="row"><input data-k="apiKey" type="password" value="${esc(p.apiKey)}" autocomplete="off" spellcheck="false" placeholder="${meta.keyRequired ? "Tempel API key Anda" : "Kosongkan bila tidak perlu"}" style="flex:1" />
      <button class="btn" type="button" data-show>Lihat</button></div>
      <small>${meta.keyUrl ? `Dapatkan key di <a href="${meta.keyUrl}" target="_blank" rel="noopener">${esc(hostOf(meta.keyUrl))}</a>. ` : ""}Key hanya disimpan di perangkat ini dan dikirim langsung ke penyedia.</small></label>

    <label class="field"><span>Model</span>
      <div class="row"><input data-k="model" list="models-dl" value="${esc(p.model)}" spellcheck="false" style="flex:1" />
      <button class="btn" type="button" data-load>Muat daftar</button></div>
      <datalist id="models-dl">${meta.models.map((m) => `<option value="${esc(m)}"></option>`).join("")}</datalist>
      <small data-modelhint>Ketik nama model, atau tekan “Muat daftar” untuk mengambil model yang tersedia untuk key Anda.</small></label>

    <div class="grid2">
      <label class="field"><span>Sumber pencarian</span>
        <select data-k="search">${searchOpts.map((k) => `<option value="${k}" ${k === p.search ? "selected" : ""}>${SEARCH_LABELS[k]}</option>`).join("")}</select></label>
      <label class="field"><span>Maks. pencarian / hasil</span><input data-k="maxSearches" type="number" min="1" max="10" value="${p.maxSearches}" /></label>
    </div>
    ${needSearchKey ? `<label class="field"><span>API key ${p.search === "tavily" ? "Tavily" : "Brave"}</span><input data-k="searchKey" type="password" value="${esc(p.searchKey)}" autocomplete="off" /></label>` : ""}
    ${needSearchUrl ? `<label class="field"><span>${p.search === "searxng" ? "URL instance SearXNG" : "URL proxy (opsional)"}</span><input data-k="searchUrl" value="${esc(p.searchUrl)}" placeholder="${p.search === "searxng" ? "https://searx.contoh.id" : "https://telusur-proxy.anda.workers.dev/" + p.search}" spellcheck="false" />
      <small>${p.search === "searxng" ? "Aktifkan format JSON dan CORS di instance Anda." : p.search === "brave" ? "Brave tidak mengizinkan akses langsung dari browser; gunakan proxy Telusur (lihat README)." : "Kosongkan untuk akses langsung."}</small></label>` : ""}

    <div class="grid2">
      <label class="field"><span>Tingkat penalaran (effort)</span>
        <select data-k="effort">${["", "low", "medium", "high", "xhigh", "max"]
          .map((v) => `<option value="${v}" ${v === p.effort ? "selected" : ""}>${{ "": "Bawaan model", low: "Rendah (tercepat)", medium: "Sedang", high: "Tinggi", xhigh: "Sangat tinggi", max: "Maksimal" }[v]}</option>`)
          .join("")}</select>
        <small>Lebih tinggi = lebih teliti tapi lebih lambat & mahal.</small></label>
      <label class="field"><span>Base URL (opsional)</span><input data-k="baseUrl" value="${esc(p.baseUrl)}" spellcheck="false" placeholder="${p.provider === "compat" ? "http://localhost:11434/v1" : "Kosong = URL resmi"}" />
        <small>Untuk proxy CORS, gateway, atau server lokal.</small></label>
    </div>

    <div class="btns">
      <button class="btn primary" data-use>${p.id === settings.activeId ? "✓ Profil aktif" : "Jadikan profil aktif"}</button>
      <button class="btn" data-dup>Duplikat</button>
      ${settings.profiles.length > 1 ? `<button class="btn danger" data-delp>Hapus profil</button>` : ""}
    </div>`;

  const save = () => {
    persist();
    renderProfilePick();
  };
  body.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-k]").forEach((inp) => {
    const k = inp.dataset.k as keyof Profile;
    inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", () => {
      const v = inp.value;
      if (k === "maxSearches") p.maxSearches = Math.max(1, Math.min(10, Number(v) || 5));
      else if (k === "provider") {
        const prev = PROVIDERS[p.provider];
        p.provider = v as ProviderKind;
        const nm = PROVIDERS[p.provider];
        if (!p.model || prev.models.includes(p.model)) p.model = nm.models[0];
        if (p.name === prev.label.split(" ")[0] || p.name === "Claude" || !p.name) p.name = nm.label.split(" ")[0].replace(/[()]/g, "");
        p.search = nm.native ? "native" : "wikipedia";
        p.effort = p.provider === "anthropic" ? "medium" : "";
        save();
        return profileTab(body);
      } else (p as any)[k] = v;
      save();
      if (k === "search") profileTab(body);
    });
  });
  body.querySelector("[data-show]")?.addEventListener("click", (e) => {
    const inp = $<HTMLInputElement>('[data-k="apiKey"]', body);
    inp.type = inp.type === "password" ? "text" : "password";
    (e.target as HTMLButtonElement).textContent = inp.type === "password" ? "Lihat" : "Sembunyikan";
  });
  body.querySelector("[data-load]")?.addEventListener("click", async () => {
    const hint = $("[data-modelhint]", body);
    hint.textContent = "Memuat daftar model…";
    try {
      const ids = await listModels(p);
      $("#models-dl", body).innerHTML = ids.map((m) => `<option value="${esc(m)}"></option>`).join("");
      hint.textContent = `${ids.length} model tersedia. Klik kolom Model untuk memilih.`;
    } catch (e) {
      hint.textContent = `Gagal memuat (${(e as Error).message}). Periksa API key / Base URL, atau ketik nama model manual.`;
    }
  });
  body.querySelectorAll<HTMLElement>("[data-pid]").forEach((b) =>
    b.addEventListener("click", () => {
      editingId = b.dataset.pid!;
      profileTab(body);
    }),
  );
  body.querySelector("[data-add]")?.addEventListener("click", () => {
    const np = newProfile({ name: `Profil ${settings.profiles.length + 1}` });
    settings.profiles.push(np);
    editingId = np.id;
    save();
    profileTab(body);
  });
  body.querySelector("[data-use]")?.addEventListener("click", () => {
    settings.activeId = p.id;
    save();
    toast(`AI aktif: ${p.name}`);
    profileTab(body);
  });
  body.querySelector("[data-dup]")?.addEventListener("click", () => {
    const np = { ...p, id: uid(), name: `${p.name} (salinan)` };
    settings.profiles.push(np);
    editingId = np.id;
    save();
    profileTab(body);
  });
  body.querySelector("[data-delp]")?.addEventListener("click", () => {
    if (!confirm(`Hapus profil “${p.name}”?`)) return;
    settings.profiles = settings.profiles.filter((x) => x.id !== p.id);
    if (settings.activeId === p.id) settings.activeId = settings.profiles[0].id;
    editingId = settings.activeId;
    save();
    profileTab(body);
  });
}

function generalTab(body: HTMLElement) {
  body.innerHTML = `
    <label class="field"><span>Tema</span>
      <select data-g="theme">${[["auto", "Ikuti sistem"], ["light", "Terang"], ["dark", "Gelap"]]
        .map(([v, l]) => `<option value="${v}" ${settings.theme === v ? "selected" : ""}>${l}</option>`)
        .join("")}</select></label>
    <label class="field"><span>Instruksi tambahan untuk AI</span>
      <textarea data-g="systemExtra" rows="4" placeholder="Contoh: Saya tinggal di Bandung. Utamakan sumber berbahasa Indonesia. Jawab singkat.">${esc(settings.systemExtra)}</textarea>
      <small>Ditambahkan ke setiap pencarian, untuk semua profil.</small></label>
    <label class="check"><input type="checkbox" data-g="saveHistory" ${settings.saveHistory ? "checked" : ""} /> Simpan riwayat pencarian di perangkat ini</label>
    <div class="callout">
      <b>Jadikan mesin pencari default browser:</b> tambahkan mesin pencari kustom dengan URL<br>
      <code style="word-break:break-all">${esc(location.origin + location.pathname)}?q=%s</code>
      <div class="btns"><button class="btn" data-copyurl>Salin URL</button></div>
    </div>
    <div class="callout warn">
      <b>Privasi:</b> semua data (API key, riwayat) tersimpan hanya di browser perangkat ini. Pertanyaan dikirim langsung dari perangkat Anda ke penyedia AI yang Anda pilih. Jangan gunakan di perangkat bersama.
    </div>
    <div class="btns"><button class="btn danger" data-wipe>${I.trash} Hapus semua data aplikasi</button></div>`;
  body.querySelectorAll<HTMLInputElement>("[data-g]").forEach((inp) => {
    const k = inp.dataset.g!;
    inp.addEventListener(inp.type === "checkbox" || inp.tagName === "SELECT" ? "change" : "input", () => {
      if (k === "saveHistory") {
        settings.saveHistory = inp.checked;
        if (inp.checked) saveHistory(threads);
      } else (settings as any)[k] = inp.value;
      persist();
      if (k === "theme") applyTheme();
    });
  });
  body.querySelector("[data-copyurl]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}?q=%s`);
      toast("URL disalin");
    } catch {
      toast("Tidak bisa menyalin");
    }
  });
  body.querySelector("[data-wipe]")?.addEventListener("click", () => {
    if (!confirm("Hapus SEMUA profil, API key, dan riwayat dari perangkat ini?")) return;
    try {
      localStorage.clear();
    } catch {
      /* abaikan */
    }
    location.reload();
  });
}

function syncTab(body: HTMLElement) {
  body.innerHTML = `
    <p class="hint" style="margin-top:0">Pindahkan profil AI (beserta API key) dan riwayat ke perangkat lain. Data dienkripsi (AES-256) dengan kata sandi yang Anda tentukan — tanpa server, tanpa akun.</p>
    <div class="label">1. Di perangkat ini — Ekspor</div>
    <label class="field"><span>Kata sandi enkripsi</span><input type="password" data-xpass autocomplete="new-password" placeholder="Minimal 8 karakter" /></label>
    <label class="check"><input type="checkbox" data-xhist checked /> Sertakan riwayat pencarian</label>
    <div class="btns"><button class="btn primary" data-export>Buat kode sinkron</button></div>
    <div data-xout hidden>
      <label class="field" style="margin-top:12px"><span>Kode sinkron</span><textarea class="code" readonly data-xcode></textarea></label>
      <div class="btns"><button class="btn" data-xcopy>Salin kode</button><button class="btn" data-xfile>Unduh file .telusur</button></div>
      <p class="hint">Kirim kode/file ini ke perangkat lain (mis. lewat chat ke diri sendiri). Tanpa kata sandi, isinya tidak bisa dibaca.</p>
    </div>
    <div class="label" style="margin-top:22px">2. Di perangkat lain — Impor</div>
    <label class="field"><span>Tempel kode sinkron atau pilih file</span><textarea class="code" data-icode placeholder="TELUSUR1:…"></textarea></label>
    <input type="file" accept=".telusur,.txt" data-ifile style="margin-bottom:12px;max-width:100%" />
    <label class="field"><span>Kata sandi</span><input type="password" data-ipass autocomplete="off" /></label>
    <div class="btns"><button class="btn primary" data-import>Impor & gabungkan</button></div>`;
  let lastCode = "";
  body.querySelector("[data-export]")!.addEventListener("click", async () => {
    const pass = $<HTMLInputElement>("[data-xpass]", body).value;
    if (pass.length < 8) return toast("Kata sandi minimal 8 karakter");
    lastCode = await exportBundle({ settings, history: $<HTMLInputElement>("[data-xhist]", body).checked ? threads : undefined }, pass);
    $<HTMLTextAreaElement>("[data-xcode]", body).value = lastCode;
    $("[data-xout]", body).hidden = false;
  });
  body.querySelector("[data-xcopy]")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastCode);
      toast("Kode disalin");
    } catch {
      $<HTMLTextAreaElement>("[data-xcode]", body).select();
    }
  });
  body.querySelector("[data-xfile]")!.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lastCode], { type: "text/plain" }));
    a.download = `telusur-${new Date().toISOString().slice(0, 10)}.telusur`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  body.querySelector<HTMLInputElement>("[data-ifile]")!.addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) $<HTMLTextAreaElement>("[data-icode]", body).value = (await f.text()).trim();
  });
  body.querySelector("[data-import]")!.addEventListener("click", async () => {
    try {
      const b = await importBundle($<HTMLTextAreaElement>("[data-icode]", body).value, $<HTMLInputElement>("[data-ipass]", body).value);
      // Gabungkan: profil dengan id sama ditimpa, yang baru ditambahkan.
      for (const ip of b.settings.profiles) {
        const i = settings.profiles.findIndex((x) => x.id === ip.id);
        if (i >= 0) settings.profiles[i] = newProfile(ip);
        else settings.profiles.push(newProfile(ip));
      }
      settings.systemExtra = settings.systemExtra || b.settings.systemExtra || "";
      if (!settings.profiles.find((x) => x.id === settings.activeId)?.apiKey) settings.activeId = b.settings.activeId;
      if (b.history?.length) {
        const ids = new Set(threads.map((t) => t.id));
        threads.push(...b.history.filter((t) => !ids.has(t.id)));
        saveHistory(threads);
      }
      persist();
      renderProfilePick();
      toast(`Berhasil: ${b.settings.profiles.length} profil${b.history?.length ? ` & ${b.history.length} riwayat` : ""} diimpor`);
      settingsTab = "ai";
      openSettings();
    } catch (e) {
      toast((e as Error).message);
    }
  });
}

// ---------- Mulai ----------
applyTheme();
renderProfilePick();
document.addEventListener("keydown", (e) => {
  const tgt = e.target as HTMLElement;
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(tgt.tagName)) {
    e.preventDefault();
    document.querySelector<HTMLTextAreaElement>(".searchbox textarea")?.focus();
  }
  if (e.key === "Escape" && controller) controller.abort();
});

const params = new URLSearchParams(location.search);
const initialQ = (params.get("q") || params.get("text") || "").trim();
goHome();
if (initialQ) ask(initialQ, false);
else if (PROVIDERS[active().provider].keyRequired && !active().apiKey && !localStorage.getItem("telusur.welcomed")) {
  try {
    localStorage.setItem("telusur.welcomed", "1");
  } catch {
    /* abaikan */
  }
  openSettings("Selamat datang di Telusur! Pilih penyedia AI dan masukkan API key Anda untuk mulai. Ingin gratis/offline? Pilih “Google Gemini” (tier gratis) atau “OpenAI-compatible / Lokal” untuk Ollama.");
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
