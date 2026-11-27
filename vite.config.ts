import { defineConfig } from "vite";

// base "./" agar hasil build bisa di-host di subfolder mana pun
// (GitHub Pages, Netlify, Cloudflare Pages, Vercel, server sendiri).
export default defineConfig({
  base: "./",
  build: { target: "es2022", sourcemap: false },
});
