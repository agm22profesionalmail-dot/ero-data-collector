// Generador de splattag integrado — render del canvas portado del proyecto
// open-source SeymourSchlong/splashtags (= splashtagmaker.com), GPL-3.0.
// Paridad completa: banners normales y recoloreables por capas, insignias,
// títulos en 13 idiomas con sus fuentes (incl. asiáticas), prefijos de tag y
// marca de agua de artistas. Assets servidos vía jsDelivr con CORS, para poder
// exportar el canvas (crossOrigin="anonymous") sin "tainted canvas".
// Créditos completos en el aviso legal (app.js → legalHtml).
import { SPLATTAG_CDN, LEANNY_BADGE_CDN, LEANNY_NPL_CDN } from "./config.js";
import { getLang, t } from "./i18n.js";
import { el, clear, debounce, toast } from "./ui.js";
import EXTRA_BADGES from "./extra-badges.js";
import EXTRA_BANNERS from "./extra-banners.js";
import { loadNames, badgeNames, bannerNames, curName, altName } from "./data.js";

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
    loadNames(), // nombres oficiales EN/ES de badges y banners
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
  // Banners oficiales que SeymourSchlong aún no incluye (temporadas 8-9,
  // Splatoon Raiders…): imagen desde Leanny/splat3 (solo .png), resuelta por
  // `url`. Se colocan al final de su sección, antes de los banners de fans.
  for (const e of EXTRA_BANNERS) {
    const item = { file: "banners/" + e.f, colour: e.c, section: e.s, url: `${LEANNY_NPL_CDN}/${e.f}`, noWebp: true };
    let at = -1;
    out.forEach((b, i) => { if (b.section === e.s) at = i; });
    out.splice(at < 0 ? out.length : at + 1, 0, item);
  }
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
      const file = (custom ? "custom/badges/" : "badges/") + s;
      out.push({ file, section, custom, url: A(file) });
    }
  };
  walk(data.badges);
  walk(data.customBadges);
  // Badges oficiales que SeymourSchlong no incluye (niveles altos de arma Lv02-Lv06,
  // VariousWeaponLevel, CoopKillTripleBoss). Sus imágenes vienen de Leanny/splat3 (solo
  // .png). El identificador `file` es único (nombres disjuntos del upstream) y la URL
  // se resuelve por `url`, no por A(file), así que nunca golpea el CDN principal.
  for (const e of EXTRA_BADGES) {
    out.push({ file: "badges/" + e.f, section: e.s, custom: false, url: `${LEANNY_BADGE_CDN}/${e.f}`, noWebp: true });
  }
  // Reagrupar por sección (orden de primera aparición) para que los extras se fundan
  // con su sección ya existente (armas → "weps", etc.) en vez de crear grupos sueltos.
  const order = [];
  const groups = new Map();
  for (const it of out) {
    if (!groups.has(it.section)) { groups.set(it.section, []); order.push(it.section); }
    groups.get(it.section).push(it);
  }
  return order.flatMap((s) => groups.get(s));
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

// Etiqueta de un badge/banner: texto oficial del juego en el idioma de la web
// (badges) o su origen/nombre oficial (banners); si no hay, el nombre de
// fichero legible. alt = el mismo en el otro idioma (búsqueda y tooltip).
function assetNames(file) {
  const pair = badgeNames(file) || bannerNames(file);
  return pair ? { label: curName(pair), alt: altName(pair) } : { label: prettify(file), alt: "" };
}

function prettify(file) {
  const base = file.split("/").pop();
  return base
    .replace(/^Npl_/, "").replace(/^Badge_/, "").replace(/^preview$/, file.split("/").slice(-2, -1)[0] || "preview")
    .replace(/_/g, " ").replace(/\b(Lv)(\d)/g, "$1 $2").trim();
}

// ── Estado del generador (persistido en state._splattag + localStorage) ─
const CFG_KEY = (state) => "edc_splattag_" + (state._userId || "anon");

function defaultGen(state) {
  // Español de España (EUes) para los títulos del splashtag, no el latinoamericano
  const langKey = getLang() === "es" ? "EUes" : "USen";
  return {
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

function genState(state) {
  if (!state._splattag) {
    const def = defaultGen(state);
    // DB tiene prioridad sobre localStorage (permite editar desde otro dispositivo)
    let saved = state.splattag_config || null;
    if (!saved) {
      try { const raw = localStorage.getItem(CFG_KEY(state)); if (raw) saved = JSON.parse(raw); } catch (e) { /* ignore */ }
    }
    if (saved && saved.banner) {
      state._splattag = { ...def, ...saved, badges: Array.isArray(saved.badges) ? saved.badges.slice(0, 3) : def.badges };
      state._splattagPersisted = true;
      // Sincronizar config de DB a localStorage para uso offline / consistencia
      if (state.splattag_config) {
        try { localStorage.setItem(CFG_KEY(state), JSON.stringify(state._splattag)); } catch (e) { /* ignore */ }
      }
    } else {
      state._splattag = def;
    }
  }
  return state._splattag;
}

function persistGen(state) {
  try { localStorage.setItem(CFG_KEY(state), JSON.stringify(state._splattag)); } catch (e) { /* ignore */ }
}

// ¿Tiene este usuario una splattag creada con el generador (config guardada)?
// Sirve para distinguir a quien subió un PNG a mano antes de esta versión.
// Comprueba primero la config de DB (cross-device), luego localStorage.
export function hasStoredSplattag(state) {
  if (state.splattag_config?.banner) return true;
  try { const raw = localStorage.getItem(CFG_KEY(state)); return !!(raw && JSON.parse(raw)?.banner); }
  catch (e) { return false; }
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

// ── Banner / insignias propios ─────────────────────────────────────────
// El jugador puede subir su propio banner (700×200) y hasta 3 insignias
// (cuadradas). Se normalizan en un canvas (re-codifica la imagen: solo
// quedan píxeles) y se guardan como data URL en la config del generador:
// g.customBanner y g.customBadges[i]. En g.banner / g.badges[i] queda un
// marcador (CUSTOM_BANNER / CUSTOM_BADGE + i).
const CUSTOM_BANNER = "custom:banner";
const CUSTOM_BADGE = "custom:badge";
const BADGE_PX = 128;
const UPLOAD_MAX = 2 * 1024 * 1024;
const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];
const isCustomBadge = (f) => typeof f === "string" && f.startsWith(CUSTOM_BADGE);

function pickImageFile() {
  return new Promise((res) => {
    const inp = el("input", { type: "file", accept: UPLOAD_TYPES.join(",") });
    inp.addEventListener("change", () => res(inp.files?.[0] || null));
    inp.click();
  });
}

// Encaja la imagen en w×h. Banner ("cover"): cubre el área y recorta lo que
// sobre. Insignia ("contain"): entera y centrada sobre transparente.
// Devuelve { url, adjusted } o lanza si no es una imagen válida.
async function normalizeUpload(file, w, h, mode) {
  if (!file || file.size > UPLOAD_MAX || !UPLOAD_TYPES.includes(file.type)) throw new Error("bad");
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i); i.onerror = () => ko(new Error("bad"));
      i.src = src;
    });
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) throw new Error("bad");
    const adjusted = Math.abs(iw / ih - w / h) > 0.01;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    const k = mode === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    const dw = iw * k, dh = ih * k;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    let url = c.toDataURL("image/webp", 0.92);
    if (!url.startsWith("data:image/webp")) url = c.toDataURL("image/png");
    return { url, adjusted };
  } finally {
    URL.revokeObjectURL(src);
  }
}

async function uploadCustom(w, h, mode) {
  const file = await pickImageFile();
  if (!file) return null;
  try {
    const r = await normalizeUpload(file, w, h, mode);
    if (r.adjusted) toast(t("gen_upload_adjusted").replace("{size}", mode === "cover" ? `${w}×${h}` : t("gen_square")), "err");
    return r.url;
  } catch {
    toast(t("gen_upload_bad"), "err");
    return null;
  }
}

function exportPng(canvas) {
  // Blindado contra el bug de "Save no funciona": canvas.toBlob puede no llamar
  // al callback (canvas tainted, memoria baja, race con redraw). Sin timeout,
  // la promise se colgaba y dejaba el botón Save disabled para siempre.
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("Canvas export timed out (10s)")), 10000);
    try {
      canvas.toBlob((b) => {
        clearTimeout(timer);
        if (!b) return rej(new Error("Canvas export returned an empty blob"));
        res(new File([b], "banner.png", { type: "image/png" }));
      }, "image/png");
    } catch (e) {
      clearTimeout(timer);
      rej(e);
    }
  });
}

// ── Selectores modales ────────────────────────────────────────────────
// Solo un selector abierto a la vez: un doble clic en un botón lento abría dos
// galerías de ~2.000 insignias seguidas y congelaba los equipos modestos.
let _pickerOpen = false;
const PICKER_FIRST = 120;   // celdas que se pintan al abrir
const PICKER_CHUNK = 200;   // resto, por tandas, sin bloquear la página

function openAssetPicker({ title, items, langKey, onSelect, onUpload, uploadHint }) {
  if (_pickerOpen) return;
  _pickerOpen = true;
  const overlay = el("div", { class: "edc-modal-overlay" });
  let job = 0;   // invalida las tandas pendientes al cerrar o al buscar
  const close = () => { job++; _pickerOpen = false; overlay.remove(); document.removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  const body = el("div", { class: "edc-gallery-grid edc-gallery-sectioned" });
  const search = el("input", { class: "edc-input edc-search", placeholder: t("search_ph"), style: "margin:12px 16px 0" });

  const render = (q) => {
    const my = ++job;
    clear(body);
    const ql = (q || "").toLowerCase();
    const matches = [];
    for (const it of items) {
      const { label, alt } = assetNames(it.file);
      if (ql && !label.toLowerCase().includes(ql) && !alt.toLowerCase().includes(ql)
        && !it.file.toLowerCase().includes(ql)) continue;
      matches.push({ it, label, alt });
    }
    if (!matches.length) { body.append(el("div", { class: "edc-empty" }, t("no_results"))); return; }
    let lastSection = null, pos = 0;
    const paint = (n) => {
      const frag = document.createDocumentFragment();
      for (const end = Math.min(pos + n, matches.length); pos < end; pos++) {
        const { it, label, alt } = matches[pos];
        if (it.section !== lastSection) {
          lastSection = it.section;
          frag.append(el("div", { class: "edc-gallery-head" }, sectionLabel(it.section, langKey)));
        }
        const base = it.url || A(it.file);
        const img = el("img", { src: base + (it.noWebp ? ".png" : ".webp"), alt: label, loading: "lazy", decoding: "async" });
        img.onerror = () => { if (!img.dataset.png) { img.dataset.png = "1"; img.src = base + ".png"; } };
        frag.append(el("div", { class: "edc-gallery-cell" + (it.layers ? " edc-cell-layers" : ""), title: alt ? `${label}
${alt}` : label, onClick: () => { onSelect(it); close(); } },
          img, el("div", {}, label)));
      }
      body.append(frag);
      if (pos < matches.length) setTimeout(() => { if (my === job) paint(PICKER_CHUNK); }, 16);
    };
    paint(PICKER_FIRST);
  };
  search.addEventListener("input", debounce(() => render(search.value), 150));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", esc);

  const upload = onUpload ? el("div", { class: "edc-gen-upload" },
    el("button", { class: "edc-btn edc-btn-sm", onClick: () => { close(); onUpload(); } }, "⬆ " + t("gen_upload")),
    el("span", {}, uploadHint || "")) : null;

  overlay.append(el("div", { class: "edc-modal" },
    el("div", { class: "edc-modal-head" }, el("h3", {}, title), el("button", { class: "edc-modal-close", onClick: close }, "×")),
    upload, search, body));
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
    const frag = document.createDocumentFragment();
    frag.append(el("div", { class: "edc-text-row", onClick: () => { onSelect(""); close(); } }, "— " + t("gen_none") + " —"));
    let n = 0;
    for (const s of list) {
      if (ql && !s.toLowerCase().includes(ql)) continue;
      if (++n > 300) break; // límite de render; afina con la búsqueda
      frag.append(el("div", { class: "edc-text-row", onClick: () => { onSelect(s); close(); } }, s));
    }
    if (!n && ql) frag.append(el("div", { class: "edc-empty" }, t("no_results")));
    body.append(frag);
  };
  search.addEventListener("input", debounce(() => render(search.value), 150));
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
  const loading = el("div", { class: "edc-loading" }, el("div", { class: "edc-inkloader" }), el("div", {}, t("gen_loading")));
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
    // Marca que el usuario tocó el generador y guarda su config (persistencia por usuario)
    const touch = () => { state._splattagDirty = true; persistGen(state); };
    const onEdit = () => { touch(); redraw(); };

    const reloadFonts = async () => { fonts = await fontsForLang(g.langKey); redraw(); };
    const reloadBanner = async () => {
      imgs.bannerMeta = bannerMeta(g.banner);
      imgs.banner = null; imgs.layerImages = [];
      if (imgs.bannerMeta?.layers) {
        imgs.layerImages = await Promise.all(imgs.bannerMeta.layerFiles.map((f) => loadImage(A(f) + ".png").catch(() => null)));
      } else if (g.banner === CUSTOM_BANNER) {
        try { imgs.banner = g.customBanner ? await loadImage(g.customBanner) : null; } catch { imgs.banner = null; }
      } else if (g.banner) {
        try { imgs.banner = await loadImage((imgs.bannerMeta?.url || A(g.banner)) + ".png"); } catch { imgs.banner = null; }
      }
      redraw();
    };
    const reloadBadge = async (i) => {
      if (!g.badges[i]) { imgs.badges[i] = null; redraw(); return; }
      if (isCustomBadge(g.badges[i])) {
        const url = g.customBadges?.[i];
        try { imgs.badges[i] = url ? await loadImage(url) : null; } catch { imgs.badges[i] = null; }
        redraw(); return;
      }
      const bm = bannerMetaBadge(g.badges[i]);
      const base = bm?.url || A(g.badges[i]);
      try { imgs.badges[i] = await loadImage(base + ".png"); } catch { imgs.badges[i] = null; }
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
      touch();
      reloadFonts();
    });
    controls.append(row(t("gen_language"), langSel));

    // Banner + color de texto
    const bannerBtn = el("button", { class: "edc-btn", onClick: () => openAssetPicker({
      title: t("gen_pick_banner"), items: _assets.banners, langKey: g.langKey,
      onSelect: (it) => { g.banner = it.file; g.customBanner = null; if (it.colour && !it.layers) { g.colour = "#" + it.colour; colorInput.value = g.colour; }
        touch(); renderLayerPickers(); reloadBanner(); },
      uploadHint: t("gen_upload_hint_banner"),
      onUpload: async () => {
        const url = await uploadCustom(TAG_W, TAG_H, "cover");
        if (!url) return;
        g.banner = CUSTOM_BANNER; g.customBanner = url;
        touch(); renderLayerPickers(); reloadBanner();
      },
    }) }, t("gen_banner"));
    const colorInput = el("input", { type: "color", class: "edc-gen-color", value: g.colour });
    colorInput.addEventListener("input", () => { g.colour = colorInput.value; onEdit(); });
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
        ci.addEventListener("input", () => { g.bgColours[i] = ci.value; onEdit(); });
        inline.append(ci);
      }
      layerRow.append(inline);
    };
    controls.append(layerRow);

    // Nombre
    const nameInput = el("input", { class: "edc-input", value: g.name, maxlength: 24, placeholder: t("gen_name") });
    nameInput.addEventListener("input", () => { g.name = nameInput.value; onEdit(); });
    controls.append(row(t("gen_name"), nameInput));

    // Título (first + last + custom)
    const titleLabel = el("span", { class: "edc-gen-pick-val" });
    const refreshTitle = () => { titleLabel.textContent = titleString(g) || "— " + t("gen_none") + " —"; };
    const firstBtn = el("button", { class: "edc-btn edc-btn-sm", onClick: () => openTextPicker({
      title: t("gen_title_first"), list: (_langRaw[g.langKey] || _langRaw.USen).titles.first,
      onSelect: (s) => { g.titleFirst = s; g.titleCustom = ""; customTitle.value = ""; refreshTitle(); onEdit(); },
    }) }, t("gen_title_first"));
    const lastBtn = el("button", { class: "edc-btn edc-btn-sm", onClick: () => openTextPicker({
      title: t("gen_title_last"), list: (_langRaw[g.langKey] || _langRaw.USen).titles.last,
      onSelect: (s) => { g.titleLast = s; g.titleCustom = ""; customTitle.value = ""; refreshTitle(); onEdit(); },
    }) }, t("gen_title_last"));
    const customTitle = el("input", { class: "edc-input", value: g.titleCustom, placeholder: t("gen_title_custom") });
    customTitle.addEventListener("input", () => { g.titleCustom = customTitle.value; refreshTitle(); onEdit(); });
    controls.append(el("div", { class: "edc-gen-row" },
      el("span", { class: "edc-label" }, t("gen_title")),
      el("div", { class: "edc-gen-inline" }, firstBtn, lastBtn, titleLabel),
      customTitle));
    refreshTitle();

    // Tag ID (prefijo + cuerpo)
    const signSel = el("select", { class: "edc-input edc-gen-sign" });
    for (const s of TAG_SIGNS) { const o = el("option", { value: s }, s.trim() || "#"); if (s === g.sign) o.selected = true; signSel.append(o); }
    signSel.addEventListener("change", () => { g.sign = signSel.value; onEdit(); });
    const idInput = el("input", { class: "edc-input", value: g.id, maxlength: 20, placeholder: t("gen_id") });
    idInput.addEventListener("input", () => { g.id = idInput.value; onEdit(); });
    controls.append(row(t("gen_id"), signSel, idInput));

    // Badges (3 slots)
    const slots = el("div", { class: "edc-gen-inline" });
    for (let i = 0; i < 3; i++) {
      const slot = el("button", { class: "edc-btn edc-btn-sm edc-badge-slot", title: t("gen_badge_slot") + " " + (i + 1) });
      // Quitar va en su propio botón: antes, pulsar un hueco lleno lo vaciaba sin
      // avisar y el segundo clic abría la galería (parecía que "no hacía nada").
      const remove = el("button", { class: "edc-btn edc-btn-sm edc-badge-remove", title: t("gen_badge_remove"), "aria-label": t("gen_badge_remove") + " " + (i + 1) }, "×");
      const setCustom = (url) => {
        const cb = Array.isArray(g.customBadges) ? g.customBadges.slice(0, 3) : [];
        while (cb.length < 3) cb.push(null);
        cb[i] = url; g.customBadges = cb;
      };
      const refreshSlot = () => { slot.textContent = g.badges[i] ? "★" : "+"; remove.hidden = !g.badges[i]; };
      remove.addEventListener("click", () => { g.badges[i] = null; setCustom(null); touch(); refreshSlot(); reloadBadge(i); });
      slot.addEventListener("click", () => {
        openAssetPicker({ title: t("gen_pick_badge"), items: _assets.badges, langKey: g.langKey,
          onSelect: (it) => { g.badges[i] = it.file; setCustom(null); touch(); refreshSlot(); reloadBadge(i); },
          uploadHint: t("gen_upload_hint_badge"),
          onUpload: async () => {
            const url = await uploadCustom(BADGE_PX, BADGE_PX, "contain");
            if (!url) return;
            g.badges[i] = CUSTOM_BADGE + i; setCustom(url);
            touch(); refreshSlot(); reloadBadge(i);
          } });
      });
      refreshSlot();
      slots.append(el("span", { class: "edc-badge-pair" }, slot, remove));
    }
    controls.append(row(t("gen_badges"), slots));

    // Captura: genera el PNG del canvas actual. La invoca app.js al pulsar "Guardar",
    // garantizando que todas las imágenes/fuentes están dibujadas antes de exportar.
    state._captureSplattag = async () => {
      await Promise.all([reloadFonts(), reloadBanner(), ...[0, 1, 2].map(reloadBadge)]);
      redraw();
      const file = await exportPng(canvas);
      if (state._bannerPreviewUrl) URL.revokeObjectURL(state._bannerPreviewUrl);
      state._bannerPreviewUrl = URL.createObjectURL(file);
      return file;
    };

    container.append(
      el("p", { class: "edc-label", style: "margin-top:0" }, t("gen_desc")),
      el("div", { class: "edc-gen-canvas-wrap" }, canvas),
      controls,
    );

    renderLayerPickers();
    reloadFonts();
    reloadBanner();
    onUse && onUse(); // señala que el generador está activo (preview superior)
  }

  function row(label, ...nodes) {
    return el("div", { class: "edc-gen-row" }, el("span", { class: "edc-label" }, label), el("div", { class: "edc-gen-inline" }, ...nodes));
  }
  function labeled(label, node) {
    return el("label", { class: "edc-gen-mini" }, el("span", {}, label), node);
  }
}
