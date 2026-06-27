// Generador de splattag integrado — render del canvas portado del proyecto
// open-source SeymourSchlong/splashtags (= splashtagmaker.com), GPL-3.0.
// Paridad completa: banners normales y recoloreables por capas, insignias,
// títulos en 13 idiomas con sus fuentes (incl. asiáticas), prefijos de tag y
// marca de agua de artistas. Assets servidos vía jsDelivr con CORS, para poder
// exportar el canvas (crossOrigin="anonymous") sin "tainted canvas".
// Créditos completos en el aviso legal (app.js → legalHtml).
import { SPLATTAG_CDN } from "./config.js";
import { getLang, t } from "./i18n.js";
import { el, clear } from "./ui.js";

const TAG_W = 700, TAG_H = 200, TEXT_SCALE = 2;
const A = (p) => `${SPLATTAG_CDN}/assets/${p}`;

// Familia de fuente → archivo en el repo
const FONT_FILES = {
  "Splat-text": "fonts/SplatoonText.otf", "Splat-title": "fonts/SplatoonTitle.otf",
  "Kurokane": "fonts/JPja/Kurokane.otf", "Rowdy": "fonts/JPja/Rowdy.otf",
  "HanyiZongyi": "fonts/CNzh/hanyi_zongyi.ttf", "HuakangZongyi": "fonts/CNzh/huakang_xinzongyi.ttc",
  "KCUBEr": "fonts/KRko/AsiaKCUBE-R.otf", "KERINm": "fonts/KRko/AsiaKERIN-M.otf",
  "DFPT_AZ5": "fonts/TWzh/DFPT_AZ5.otf", "DFPT_ZY9": "fonts/TWzh/DFPT_ZY9.otf",
};
// Prefijos de tag (sign) seleccionables, como en el original
const TAG_SIGNS = ["#", "Nr. ", "Nº ", "N° ", "n.º "];
// Marcas de agua de artistas: índice 0 = genérica; el resto por artista
const WATERMARK_SRCS = ["custom", "deadline", "electrodev", "zeeto", "sharkinodraws"];
const ARTISTS = [
  { dir: "/deadline/",   name: "DeadLine" },
  { dir: "/electrodev/", name: "Electro" },
  { dir: "/bands/",      name: "Zeeto" },
  { dir: "/sharkino/",   name: "Sharkino" },
];

let _assets = null;          // { banners:[], badges:[] }
let _langRaw = null, _assetsRaw = null;
const _imgCache = new Map(); // url -> Promise<HTMLImageElement>
const _fontsLoaded = new Set();
let _watermarks = null;      // HTMLImageElement[5] | null

// Canvas auxiliares reutilizados (composición de capas + texto a 2x)
let _aux = null;
function aux() {
  if (_aux) return _aux;
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const layer = mk(TAG_W, TAG_H), comp = mk(TAG_W, TAG_H), text = mk(TAG_W * TEXT_SCALE, TAG_H * TEXT_SCALE);
  _aux = { layer, layerCtx: layer.getContext("2d"), comp, compCtx: comp.getContext("2d"),
           text, textCtx: text.getContext("2d") };
  return _aux;
}

// ── Carga de datos / fuentes / imágenes ───────────────────────────────
async function loadFont(name) {
  if (_fontsLoaded.has(name) || !FONT_FILES[name]) return;
  try {
    const ff = new FontFace(name, `url(${A(FONT_FILES[name])})`);
    await ff.load(); document.fonts.add(ff); _fontsLoaded.add(name);
  } catch (e) { /* respaldo del navegador si falla */ }
}

// Devuelve las familias de fuente (con comillas) para un idioma, cargándolas.
async function fontsForLang(langKey) {
  const block = _langRaw[langKey] || _langRaw.USen;
  const textFams = ["Splat-text"], titleFams = ["Splat-title"];
  if (block.font) { textFams.push(block.font[0]); titleFams.push(block.font[1]); }
  await Promise.all([...new Set([...textFams, ...titleFams])].map(loadFont));
  const q = (arr) => arr.map((f) => `'${f}'`).join(",");
  return { text: q(textFams), title: q(titleFams) };
}

async function loadAssets() {
  if (_assetsRaw && _langRaw) return;
  const [aj, lj] = await Promise.all([
    fetch(`${SPLATTAG_CDN}/assets.min.json`).then((r) => r.json()),
    fetch(`${SPLATTAG_CDN}/lang.min.json`).then((r) => r.json()),
  ]);
  _assetsRaw = aj; _langRaw = lj;
  _assets = { banners: parseBanners(aj), badges: parseBadges(aj) };
}

// Banners normales + recoloreables por capas (estos llevan layers + layerFiles)
function parseBanners(data) {
  const out = [];
  let section = "";
  const walk = (arr, prefix) => {
    for (const b of arr) {
      if (b.name) { section = b.name; continue; }
      const item = { file: prefix + b.file, colour: b.colour, section };
      if (b.layers) {
        item.layers = b.layers;
        item.layerFiles = [];
        for (let i = 0; i < b.layers; i++) item.layerFiles.push(prefix + b.file.replace("preview", i + 1));
      }
      out.push(item);
    }
  };
  walk(data.banners, "banners/");
  walk(data.customBanners, "custom/banners/");
  return out;
}

function parseBadges(data) {
  const out = [];
  let section = "";
  const walk = (arr) => {
    for (const s of arr) {
      if (typeof s === "string" && s.startsWith("NAME")) {
        const m = /^NAME:(.*?)#(.*?)$/.exec(s);
        if (m) section = m[1];
        continue;
      }
      const custom = s.includes("/");
      out.push({ file: (custom ? "custom/badges/" : "badges/") + s, section, custom });
    }
  };
  walk(data.badges);
  walk(data.customBadges);
  return out;
}

function loadImage(url) {
  if (_imgCache.has(url)) return _imgCache.get(url);
  const p = new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("img " + url));
    img.src = url;
  });
  _imgCache.set(url, p);
  return p;
}

async function loadWatermarks() {
  if (_watermarks) return _watermarks;
  _watermarks = await Promise.all(WATERMARK_SRCS.map((w) =>
    loadImage(A(`images/watermarks/${w}.png`)).catch(() => null)));
  return _watermarks;
}

function sectionLabel(name, langKey) { return (_langRaw[langKey]?.sections?.[name]) || name; }

function prettify(file) {
  const base = file.split("/").pop();
  return base
    .replace(/^Npl_/, "").replace(/^Badge_/, "").replace(/^preview$/, file.split("/").slice(-2, -1)[0] || "preview")
    .replace(/_/g, " ").replace(/\b(Lv)(\d)/g, "$1 $2").trim();
}

// ── Estado del generador (persistido en state._splattag) ───────────────
function genState(state) {
  if (!state._splattag) {
    const langKey = getLang() === "es" ? "USes" : "USen";
    state._splattag = {
      langKey,
      banner: _assets.banners[0]?.file || null,
      bgColours: ["#ffffff", "#ff0000", "#00ff00", "#0000ff"],
      name: (state.alias || "Player").slice(0, 24),
      titleFirst: "", titleLast: "", titleCustom: "",
      sign: _langRaw[langKey]?.sign || "#",
      id: "0001",
      colour: "#" + (_assets.banners[0]?.colour || "ffffff"),
      badges: [null, null, null],
    };
  }
  return state._splattag;
}

function bannerMeta(file) { return _assets.banners.find((b) => b.file === file) || null; }
function titleString(g) {
  if (g.titleCustom && g.titleCustom.trim()) return g.titleCustom.trim();
  return [g.titleFirst, g.titleLast].filter(Boolean).join(" ");
}

// ── Render del canvas (portado de renderSplashtag) ─────────────────────
function drawTag(canvas, g, imgs, fonts) {
  const ctx = canvas.getContext("2d");
  const { layer, layerCtx, comp, compCtx, text: tcv, textCtx: tx } = aux();
  ctx.clearRect(0, 0, TAG_W, TAG_H);
  tx.setTransform(1, 0, 0, 1, 0, 0);
  tx.clearRect(0, 0, tcv.width, tcv.height);
  tx.scale(TEXT_SCALE, TEXT_SCALE);

  // Banner: directo o composición por capas recoloreadas
  const meta = imgs.bannerMeta;
  if (meta && meta.layers && imgs.layerImages?.length) {
    const layers = imgs.layerImages;
    for (let i = 0; i < layers.length; i++) {
      if (!layers[i]) continue;
      compCtx.clearRect(0, 0, TAG_W, TAG_H);
      compCtx.save();
      compCtx.fillStyle = g.bgColours[!i ? i : layers.length - i] || "#ffffff";
      compCtx.drawImage(layers[i], 0, 0, TAG_W, TAG_H);
      compCtx.globalCompositeOperation = "difference";
      compCtx.fillRect(0, 0, TAG_W, TAG_H);
      compCtx.restore();

      layerCtx.save();
      layerCtx.drawImage(layers[i], 0, 0, TAG_W, TAG_H);
      layerCtx.globalCompositeOperation = "source-in";
      layerCtx.drawImage(comp, 0, 0, TAG_W, TAG_H);
      layerCtx.restore();
      ctx.drawImage(layer, 0, 0);
      layerCtx.clearRect(0, 0, TAG_W, TAG_H);
    }
  } else if (imgs.banner) {
    ctx.drawImage(imgs.banner, 0, 0, TAG_W, TAG_H);
  }

  tx.fillStyle = g.colour;
  const setLS = (v) => { if ("letterSpacing" in tx) tx.letterSpacing = v; };
  const xScale = (w, max) => (w > max && w > 0 ? max / w : 1);

  // Título(s) — 36px, itálica por skew, arriba-izquierda
  const title = titleString(g);
  if (title) {
    tx.save();
    tx.textAlign = "left"; tx.font = `36px ${fonts.text}`; setLS("-0.3px");
    const w = tx.measureText(title).width;
    const xs = xScale(w, TAG_W - 32);
    tx.transform(1, 0, -7.5 / 100, 1, 0, 0);
    tx.scale(xs, 1);
    tx.fillText(title, 18 / xs, 42);
    tx.restore(); setLS("0px");
  }

  // Tag ID (sign + cuerpo) — 24px, abajo-izquierda, ancho limitado por el primer badge
  const idText = (g.sign || "") + (g.id || "");
  if (idText) {
    tx.save();
    tx.textAlign = "left"; tx.font = `24px ${fonts.text}`; setLS("0.2px");
    const leftBadge = g.badges.findIndex((b) => b);
    const maxX = (leftBadge === -1 ? TAG_W : 480 + 74 * leftBadge) - 48;
    const w = tx.measureText(idText).width;
    const xs = xScale(w, maxX);
    tx.scale(xs, 1);
    tx.fillText(idText, 24 / xs, 185);
    tx.restore(); setLS("0px");
  }

  // Nombre — 66px, centrado
  if (g.name) {
    tx.save();
    tx.textAlign = "center"; tx.font = `66px ${fonts.title}`; setLS("-0.4px");
    const w = tx.measureText(g.name).width;
    const xs = xScale(w, TAG_W - 32);
    tx.scale(xs, 1);
    tx.fillText(g.name, (TAG_W / 2 - 1.5) / xs, 119);
    tx.restore(); setLS("0px");
  }

  // Copiar textos al canvas principal (alpha 1) y limpiar el de texto
  ctx.drawImage(tcv, 0, 0, TAG_W, TAG_H);
  tx.setTransform(1, 0, 0, 1, 0, 0);
  tx.clearRect(0, 0, tcv.width, tcv.height);
  tx.scale(TEXT_SCALE, TEXT_SCALE);

  // Determinar si se usan assets de artistas (para la marca de agua)
  let customed = !!(meta && meta.file.includes("custom/"));

  // Badges — 70×70, 3 slots desde x=480, paso 74
  for (let i = 0; i < 3; i++) {
    const bimg = imgs.badges[i];
    if (!bimg) continue;
    const size = 70, x = 480 + (size + 4) * i, y = 128;
    const bMeta = bannerMetaBadge(g.badges[i]);
    if (bMeta?.custom) customed = true;
    const cw = bimg.naturalWidth, ch = bimg.naturalHeight;
    if (cw && ch && cw !== ch) {
      const landscape = cw > ch;
      const ratio = !landscape ? cw / ch : ch / cw;
      const width = landscape ? size : size * ratio;
      const height = !landscape ? size : size * ratio;
      ctx.drawImage(bimg, x + (size / 2 - width / 2), y + (size / 2 - height / 2), width, height);
    } else {
      ctx.drawImage(bimg, x, y, size, size);
    }
  }

  // Marca de agua de artistas (cuando se usan sus banners/badges)
  if (customed && _watermarks) {
    const wm = { offset: { x: 10, y: 5 }, textoffset: 10, width: 40, height: 40 };
    tx.font = `14px ${fonts.text}`; tx.textAlign = "center"; tx.fillStyle = "#ffffff";
    const wmX = TAG_W - wm.width - wm.offset.x;
    const textPos = { x: TAG_W - wm.offset.x - wm.width / 2, y: wm.offset.y + wm.height + wm.textoffset };

    const featured = [];
    ARTISTS.forEach((a, i) => {
      const hit = (meta && meta.file.includes(a.dir)) ||
        g.badges.some((bf) => bf && bf.includes(a.dir));
      if (hit && !featured.includes(i)) featured.push(i);
    });
    featured.sort();

    if (featured.length === 1) {
      const a = ARTISTS[featured[0]];
      if (_watermarks[featured[0] + 1]) tx.drawImage(_watermarks[featured[0] + 1], wmX, wm.offset.y, wm.width, wm.height);
      tx.fillText(a.name, textPos.x, textPos.y);
    } else if (featured.length > 1) {
      if (_watermarks[0]) tx.drawImage(_watermarks[0], wmX, wm.offset.y, wm.width, wm.height);
      featured.forEach((f, i) => tx.fillText(ARTISTS[f].name, textPos.x, textPos.y + 14 * i));
    }
    if (featured.length) {
      tx.fillStyle = g.colour;
      tx.globalCompositeOperation = "source-in";
      tx.fillRect(0, 0, TAG_W, TAG_H);
      tx.globalCompositeOperation = "source-over";
    }
  }

  // Sobreimpresión tenue (alpha 0.2) — solo la marca de agua queda en el canvas de texto
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.drawImage(tcv, 0, 0, TAG_W, TAG_H);
  ctx.restore();
}

function bannerMetaBadge(file) { return _assets.badges.find((b) => b.file === file) || null; }

function exportPng(canvas) {
  return new Promise((res) =>
    canvas.toBlob((b) => res(new File([b], "banner.png", { type: "image/png" })), "image/png"));
}

// ── Selectores modales ────────────────────────────────────────────────
function openAssetPicker({ title, items, langKey, onSelect }) {
  const overlay = el("div", { class: "edc-modal-overlay" });
  const close = () => { overlay.remove(); document.removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  const body = el("div", { class: "edc-gallery-grid edc-gallery-sectioned" });
  const search = el("input", { class: "edc-input edc-search", placeholder: t("search_ph"), style: "margin:12px 16px 0" });

  const render = (q) => {
    clear(body);
    const ql = (q || "").toLowerCase();
    let lastSection = null, any = false;
    for (const it of items) {
      const label = prettify(it.file);
      if (ql && !label.toLowerCase().includes(ql) && !it.file.toLowerCase().includes(ql)) continue;
      any = true;
      if (it.section !== lastSection) {
        lastSection = it.section;
        body.append(el("div", { class: "edc-gallery-head" }, sectionLabel(it.section, langKey)));
      }
      const img = el("img", { src: A(it.file) + ".webp", alt: label, loading: "lazy" });
      img.onerror = () => { if (!img.dataset.png) { img.dataset.png = "1"; img.src = A(it.file) + ".png"; } };
      body.append(el("div", { class: "edc-gallery-cell" + (it.layers ? " edc-cell-layers" : ""), title: label, onClick: () => { onSelect(it); close(); } },
        img, el("div", {}, label)));
    }
    if (!any) body.append(el("div", { class: "edc-empty" }, t("no_results")));
  };
  search.addEventListener("input", () => render(search.value));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", esc);

  overlay.append(el("div", { class: "edc-modal" },
    el("div", { class: "edc-modal-head" }, el("h3", {}, title), el("button", { class: "edc-modal-close", onClick: close }, "×")),
    search, body));
  document.body.append(overlay);
  render(""); search.focus();
}

function openTextPicker({ title, list, onSelect }) {
  const overlay = el("div", { class: "edc-modal-overlay" });
  const close = () => { overlay.remove(); document.removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  const body = el("div", { class: "edc-text-list" });
  const search = el("input", { class: "edc-input edc-search", placeholder: t("search_ph"), style: "margin:12px 16px 0" });

  const render = (q) => {
    clear(body);
    const ql = (q || "").toLowerCase();
    body.append(el("div", { class: "edc-text-row", onClick: () => { onSelect(""); close(); } }, "— " + t("gen_none") + " —"));
    let n = 0;
    for (const s of list) {
      if (ql && !s.toLowerCase().includes(ql)) continue;
      if (++n > 300) break; // límite de render; afina con la búsqueda
      body.append(el("div", { class: "edc-text-row", onClick: () => { onSelect(s); close(); } }, s));
    }
    if (!n && ql) body.append(el("div", { class: "edc-empty" }, t("no_results")));
  };
  search.addEventListener("input", () => render(search.value));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", esc);

  overlay.append(el("div", { class: "edc-modal" },
    el("div", { class: "edc-modal-head" }, el("h3", {}, title), el("button", { class: "edc-modal-close", onClick: close }, "×")),
    search, body));
  document.body.append(overlay);
  render(""); search.focus();
}

// ── Panel del generador ───────────────────────────────────────────────
// onUse(file) recibe el PNG generado (File) ya asignado a state.bannerFile.
export function renderSplattagGenerator(container, state, onUse) {
  clear(container);
  const loading = el("div", { class: "edc-loading" }, el("div", { class: "edc-spinner" }), el("div", {}, t("gen_loading")));
  container.append(loading);

  loadAssets()
    .then(() => loadWatermarks().catch(() => null))
    .then(() => { clear(container); build(); })
    .catch((e) => {
      clear(container);
      container.append(el("div", { class: "edc-banner-err" }, t("gen_load_err") + (e?.message || "")));
    });

  function build() {
    const g = genState(state);
    const imgs = { banner: null, bannerMeta: bannerMeta(g.banner), layerImages: [], badges: [null, null, null] };
    let fonts = { text: "'Splat-text'", title: "'Splat-title'" };

    const canvas = el("canvas", { class: "edc-gen-canvas", width: TAG_W, height: TAG_H });
    const redraw = () => drawTag(canvas, g, imgs, fonts);

    const reloadFonts = async () => { fonts = await fontsForLang(g.langKey); redraw(); };
    const reloadBanner = async () => {
      imgs.bannerMeta = bannerMeta(g.banner);
      imgs.banner = null; imgs.layerImages = [];
      if (imgs.bannerMeta?.layers) {
        imgs.layerImages = await Promise.all(imgs.bannerMeta.layerFiles.map((f) => loadImage(A(f) + ".png").catch(() => null)));
      } else if (g.banner) {
        try { imgs.banner = await loadImage(A(g.banner) + ".png"); } catch { imgs.banner = null; }
      }
      redraw();
    };
    const reloadBadge = async (i) => {
      if (!g.badges[i]) { imgs.badges[i] = null; redraw(); return; }
      try { imgs.badges[i] = await loadImage(A(g.badges[i]) + ".png"); } catch { imgs.badges[i] = null; }
      redraw();
    };

    const controls = el("div", { class: "edc-gen-controls" });

    // Idioma (títulos + fuente) — desbloquea fuentes asiáticas
    const langSel = el("select", { class: "edc-input edc-gen-select" });
    for (const k of Object.keys(_langRaw)) {
      const o = el("option", { value: k }, _langRaw[k].name || k);
      if (k === g.langKey) o.selected = true;
      langSel.append(o);
    }
    langSel.addEventListener("change", () => {
      const prev = g.sign;
      g.langKey = langSel.value;
      // Si el prefijo seguía siendo el del idioma anterior, actualízalo al nuevo
      const newSign = _langRaw[g.langKey]?.sign || "#";
      if (TAG_SIGNS.includes(prev)) { g.sign = TAG_SIGNS.includes(newSign) ? newSign : prev; signSel.value = g.sign; }
      reloadFonts();
    });
    controls.append(row(t("gen_language"), langSel));

    // Banner + color de texto
    const bannerBtn = el("button", { class: "edc-btn", onClick: () => openAssetPicker({
      title: t("gen_pick_banner"), items: _assets.banners, langKey: g.langKey,
      onSelect: (it) => { g.banner = it.file; if (it.colour && !it.layers) { g.colour = "#" + it.colour; colorInput.value = g.colour; }
        renderLayerPickers(); reloadBanner(); },
    }) }, t("gen_banner"));
    const colorInput = el("input", { type: "color", class: "edc-gen-color", value: g.colour });
    colorInput.addEventListener("input", () => { g.colour = colorInput.value; redraw(); });
    controls.append(row(t("gen_banner"), bannerBtn, labeled(t("gen_text_color"), colorInput)));

    // Colores de capas (solo banners recoloreables)
    const layerRow = el("div", { class: "edc-gen-row" });
    const renderLayerPickers = () => {
      clear(layerRow);
      const m = bannerMeta(g.banner);
      if (!m?.layers) return;
      layerRow.append(el("span", { class: "edc-label" }, t("gen_layer_colors")));
      const inline = el("div", { class: "edc-gen-inline" });
      for (let i = 0; i < m.layers; i++) {
        const ci = el("input", { type: "color", class: "edc-gen-color", value: g.bgColours[i] || "#ffffff" });
        ci.addEventListener("input", () => { g.bgColours[i] = ci.value; redraw(); });
        inline.append(ci);
      }
      layerRow.append(inline);
    };
    controls.append(layerRow);

    // Nombre
    const nameInput = el("input", { class: "edc-input", value: g.name, maxlength: 24, placeholder: t("gen_name") });
    nameInput.addEventListener("input", () => { g.name = nameInput.value; redraw(); });
    controls.append(row(t("gen_name"), nameInput));

    // Título (first + last + custom)
    const titleLabel = el("span", { class: "edc-gen-pick-val" });
    const refreshTitle = () => { titleLabel.textContent = titleString(g) || "— " + t("gen_none") + " —"; };
    const firstBtn = el("button", { class: "edc-btn edc-btn-sm", onClick: () => openTextPicker({
      title: t("gen_title_first"), list: (_langRaw[g.langKey] || _langRaw.USen).titles.first,
      onSelect: (s) => { g.titleFirst = s; g.titleCustom = ""; customTitle.value = ""; refreshTitle(); redraw(); },
    }) }, t("gen_title_first"));
    const lastBtn = el("button", { class: "edc-btn edc-btn-sm", onClick: () => openTextPicker({
      title: t("gen_title_last"), list: (_langRaw[g.langKey] || _langRaw.USen).titles.last,
      onSelect: (s) => { g.titleLast = s; g.titleCustom = ""; customTitle.value = ""; refreshTitle(); redraw(); },
    }) }, t("gen_title_last"));
    const customTitle = el("input", { class: "edc-input", value: g.titleCustom, placeholder: t("gen_title_custom") });
    customTitle.addEventListener("input", () => { g.titleCustom = customTitle.value; refreshTitle(); redraw(); });
    controls.append(el("div", { class: "edc-gen-row" },
      el("span", { class: "edc-label" }, t("gen_title")),
      el("div", { class: "edc-gen-inline" }, firstBtn, lastBtn, titleLabel),
      customTitle));
    refreshTitle();

    // Tag ID (prefijo + cuerpo)
    const signSel = el("select", { class: "edc-input edc-gen-sign" });
    for (const s of TAG_SIGNS) { const o = el("option", { value: s }, s.trim() || "#"); if (s === g.sign) o.selected = true; signSel.append(o); }
    signSel.addEventListener("change", () => { g.sign = signSel.value; redraw(); });
    const idInput = el("input", { class: "edc-input", value: g.id, maxlength: 20, placeholder: t("gen_id") });
    idInput.addEventListener("input", () => { g.id = idInput.value; redraw(); });
    controls.append(row(t("gen_id"), signSel, idInput));

    // Badges (3 slots)
    const slots = el("div", { class: "edc-gen-inline" });
    for (let i = 0; i < 3; i++) {
      const slot = el("button", { class: "edc-btn edc-btn-sm edc-badge-slot", title: t("gen_badge_slot") + " " + (i + 1) });
      const refreshSlot = () => { slot.textContent = g.badges[i] ? "★" : "+"; };
      slot.addEventListener("click", () => {
        if (g.badges[i]) { g.badges[i] = null; refreshSlot(); reloadBadge(i); return; }
        openAssetPicker({ title: t("gen_pick_badge"), items: _assets.badges, langKey: g.langKey,
          onSelect: (it) => { g.badges[i] = it.file; refreshSlot(); reloadBadge(i); } });
      });
      refreshSlot();
      slots.append(slot);
    }
    controls.append(row(t("gen_badges"), slots));

    // Acción
    const status = el("span", { class: "edc-save-status" });
    const useBtn = el("button", { class: "edc-btn edc-btn-primary", onClick: async () => {
      useBtn.disabled = true; status.className = "edc-save-status"; status.textContent = t("gen_building");
      try {
        await Promise.all([reloadFonts(), reloadBanner(), ...[0, 1, 2].map(reloadBadge)]);
        redraw();
        const file = await exportPng(canvas);
        if (state._bannerPreviewUrl) URL.revokeObjectURL(state._bannerPreviewUrl);
        state.bannerFile = file;
        state._bannerPreviewUrl = URL.createObjectURL(file);
        state._bannerError = null;
        status.className = "edc-save-status ok"; status.textContent = t("gen_done");
        onUse && onUse(file);
      } catch (e) {
        status.className = "edc-save-status err"; status.textContent = t("gen_build_err") + (e?.message || "");
      } finally { useBtn.disabled = false; }
    } }, t("gen_use"));

    container.append(
      el("p", { class: "edc-label", style: "margin-top:0" }, t("gen_desc")),
      el("div", { class: "edc-gen-canvas-wrap" }, canvas),
      controls,
      el("div", { class: "edc-save-bar" }, useBtn, status),
    );

    renderLayerPickers();
    reloadFonts();
    reloadBanner();
  }

  function row(label, ...nodes) {
    return el("div", { class: "edc-gen-row" }, el("span", { class: "edc-label" }, label), el("div", { class: "edc-gen-inline" }, ...nodes));
  }
  function labeled(label, node) {
    return el("label", { class: "edc-gen-mini" }, el("span", {}, label), node);
  }
}
