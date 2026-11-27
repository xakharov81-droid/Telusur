# Telusur AI: mesin pencari pribadi yang memakai AI pilihan Anda

Telusur AI adalah aplikasi web progresif (PWA). Satu kode ini bisa dipasang di **Android, iPhone/iPad, Windows, macOS, Linux, dan ChromeOS** layaknya aplikasi biasa: punya ikon di layar utama, terbuka di jendela sendiri, dan tetap bisa dibuka saat offline.

Cara kerjanya: Anda mengetik pertanyaan, lalu AI pilihan Anda mencari di web dan menjawab dengan **sitasi bernomor ke sumbernya**. Anda juga bisa mengajukan pertanyaan lanjutan dalam satu percakapan.

## Penyedia AI yang didukung

| Penyedia | Cara mencari | Catatan |
|---|---|---|
| **Anthropic Claude** | Pencarian web bawaan Claude (`web_search`) | Default `claude-opus-5-5`. Bila model utama menolak, permintaan dialihkan otomatis ke model cadangan (*server-side fallback*). |
| **OpenAI** | Responses API dengan tool `web_search` | Bila browser memblokir permintaan (CORS), pakai proxy. |
| **Google Gemini** | Grounding with Google Search | Ada tier gratis di AI Studio. Widget saran Google ditampilkan sesuai ketentuan. |
| **OpenRouter** | Tool `openrouter:web_search` | Satu key untuk ratusan model. |
| **OpenAI-compatible / lokal** | Wikipedia, Tavily, Brave, SearXNG, atau tanpa pencarian | Ollama, LM Studio, Groq, DeepSeek, Mistral, Perplexity, dan lainnya. |

### Selalu versi terbaru
Setiap profil punya opsi **"Selalu pakai versi terbaru otomatis"** (aktif secara default). Telusur membaca *lini* model yang Anda pilih, misalnya `claude-opus-5-5` → lini `claude-opus`. Setiap 6 jam (atau saat tombol "Cek versi terbaru sekarang" ditekan), Telusur mengambil daftar model resmi dari penyedia dan memakai versi tertinggi di lini itu, termasuk model berbayar. Contohnya, `claude-opus-6` langsung dipakai begitu dirilis.
- Varian berbeda (mini, lite, fast, Sonnet vs Opus) tidak tertukar.
- Bila versi terbaru belum bisa dipakai oleh key Anda (404/403/400), Telusur otomatis mundur ke versi sebelumnya.
- Bila model baru menolak parameter lama, permintaan otomatis disederhanakan lalu diulang.
- Versi preview/eksperimen bisa diikutkan lewat kotak centang di pengaturan.

Anda bisa membuat **banyak profil** (misalnya "Claude teliti", "Gemini gratis", "Ollama offline"), lalu berganti profil dari menu di bagian atas.

## Fitur

- Jawaban tampil langsung saat ditulis (*streaming*), dirender sebagai Markdown (tabel, daftar, kode).
- Kartu sumber dan penanda sitasi `[n]` yang bisa diklik.
- Pertanyaan lanjutan dengan konteks percakapan. Tombol Salin, Bagikan, dan Ulangi.
- Riwayat pencarian yang bisa dicari dan dihapus.
- **Sinkron antar-perangkat tanpa server.** Pengaturan, API key, dan riwayat diekspor sebagai kode yang dienkripsi AES-256 dengan kata sandi Anda.
- Bisa dijadikan **mesin pencari default browser** lewat URL `https://situs-anda/?q=%s`.
- **Share target** di Android: dari aplikasi lain, pilih "Bagikan ke Telusur" untuk langsung mencari teks yang dibagikan.
- Tema terang/gelap, nyaman di ponsel, pintasan `/` untuk fokus ke kotak pencarian dan `Esc` untuk menghentikan jawaban.
- Instruksi tambahan untuk AI, misalnya "Saya tinggal di Bandung, utamakan sumber berbahasa Indonesia".

## Privasi

Tidak ada server Telusur. API key dan riwayat hanya tersimpan di browser perangkat Anda. Pertanyaan dikirim **langsung** dari perangkat Anda ke penyedia AI yang Anda pilih. Karena itu, jangan memakai Telusur di perangkat bersama, dan gunakan API key dengan batas pengeluaran (*spending limit*).

## Menjalankan dan memasang

### 1. Coba di komputer sendiri
```bash
npm install
npm run dev        # buka http://localhost:5173
```

### 2. Publikasikan gratis supaya bisa dipasang di semua perangkat
```bash
npm run build      # menghasilkan folder dist/
```
Unggah isi folder `dist/` ke salah satu layanan berikut (semuanya HTTPS, yang wajib untuk PWA):
- **Netlify Drop**: seret folder `dist` ke <https://app.netlify.com/drop>. Paling mudah, tanpa akun Git.
- **GitHub Pages (otomatis)**: repositori ini sudah berisi `.github/workflows/deploy.yml`. Push ke branch `main`, lalu buka Settings → Pages → *Source: GitHub Actions*. Situs akan terbit di `https://<user>.github.io/<repo>/` dan diperbarui otomatis setiap ada push.
- **Cloudflare Pages** / **Vercel**: hubungkan repositori, isi *build command* `npm run build` dan *output* `dist`.

### 3. Pasang di perangkat
- **Android (Chrome/Edge)**: buka situsnya, lalu menu ⋮ → *Instal aplikasi* / *Tambahkan ke layar utama*.
- **iPhone/iPad (Safari)**: tombol Bagikan → *Tambah ke Layar Utama*.
- **Windows/macOS/Linux (Chrome/Edge)**: klik ikon instal di bilah alamat.

### 4. Sinkronkan perangkat
Di perangkat pertama, buka Pengaturan → *Sinkron perangkat* → buat kode sinkron dengan kata sandi. Kirim kodenya ke perangkat lain (misalnya lewat chat ke diri sendiri), lalu impor di sana dengan kata sandi yang sama.

## Proxy CORS (opsional)

Beberapa API (OpenAI, Brave Search, kadang Tavily) tidak menerima permintaan langsung dari browser. File `proxy/worker.js` adalah Cloudflare Worker gratis yang hanya meneruskan permintaan, tanpa menyimpan apa pun. Petunjuk pemasangan dan URL yang perlu diisi di kolom **Base URL** ada di bagian atas file tersebut.

## Memakai AI lokal/offline (Ollama)
```bash
OLLAMA_ORIGINS="*" ollama serve      # izinkan akses dari browser
ollama pull llama3.2
```
Di Telusur, buat profil **OpenAI-compatible / Lokal** dengan Base URL `http://localhost:11434/v1`, model `llama3.2`, dan sumber pencarian **Wikipedia** (gratis, tanpa key).

## Struktur kode
```
src/
  main.ts               antarmuka (beranda, hasil, riwayat, pengaturan, sinkron)
  store.ts              penyimpanan lokal + ekspor/impor terenkripsi
  render.ts             Markdown → HTML aman (DOMPurify) + tautan sitasi
  providers/
    anthropic.ts        Claude via SDK resmi @anthropic-ai/sdk (web search, fallback, pause_turn)
    openai.ts           OpenAI Responses API
    gemini.ts           Gemini + Google Search grounding
    chat.ts             OpenRouter & semua API OpenAI-compatible
    index.ts            pemilihan penyedia + daftar model
  search/backends.ts    Wikipedia, Tavily, Brave, SearXNG
public/                 manifest PWA, service worker, ikon
proxy/worker.js         proxy CORS opsional (Cloudflare Worker)
tests/e2e.cjs           uji end-to-end dengan respons penyedia tiruan
```

## Pengujian
```bash
npm run build && npx vite preview --port 4173 &
node tests/e2e.cjs
node tests/latest.test.mjs   # logika "versi terbaru"
```
Uji ini memakai respons tiruan untuk setiap penyedia, sehingga tidak butuh API key.
