// Helpers de UI (DOM, toast, modal de galería)
import { fallbackImg } from "./data.js";
import { t } from "./i18n.js";

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style") n.style.cssText = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function imgWithFallback(src, alt = "") {
  const img = el("img", { src, alt, loading: "lazy" });
  img.onerror = () => { if (img.src !== fallbackImg) img.src = fallbackImg; };
  return img;
}

let toastTimer;
export function toast(msg, type = "") {
  const el2 = document.getElementById("toast");
  el2.textContent = msg;
  el2.className = "edc-toast " + type;
  el2.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el2.hidden = true; }, 3500);
}

// Galería modal searchable. items: [{id, label, img}]
export function openGallery({ title, items, onSelect }) {
  const overlay = el("div", { class: "edc-modal-overlay" });
  const close = () => overlay.remove();
  const grid = el("div", { class: "edc-gallery-grid" });
  const search = el("input", { class: "edc-input edc-search", placeholder: t("search_ph"), style: "margin:12px 16px 0" });

  const render = (q) => {
    clear(grid);
    const ql = (q || "").toLowerCase();
    const filtered = items.filter((it) => !ql || it.label.toLowerCase().includes(ql));
    if (!filtered.length) { grid.append(el("div", { class: "edc-empty" }, t("no_results"))); return; }
    for (const it of filtered) {
      grid.append(el("div", { class: "edc-gallery-cell", onClick: () => { onSelect(it.id); close(); } },
        imgWithFallback(it.img, it.label), el("div", {}, it.label)));
    }
  };
  search.addEventListener("input", () => render(search.value));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); } });

  overlay.append(el("div", { class: "edc-modal" },
    el("div", { class: "edc-modal-head" }, el("h3", {}, title), el("button", { class: "edc-modal-close", onClick: close }, "×")),
    search, grid));
  document.body.append(overlay);
  render("");
  search.focus();
}
