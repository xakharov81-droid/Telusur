import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Source } from "./providers/types";

marked.setOptions({ gfm: true, breaks: false });

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Markdown → HTML aman, dengan penanda [n] diubah menjadi tautan sitasi. */
export function renderAnswer(md: string, sources: Source[]): string {
  const withCites = md.replace(/\[(\d{1,3})\](?!\(|:)/g, (m, k) => {
    const s = sources[+k - 1];
    if (!s) return m;
    return `<a class="cite" href="${esc(s.url)}" title="${esc(s.title)}">${k}</a>`;
  });
  const html = marked.parse(withCites, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export { esc };
