// "Compartir OC": tarjeta 1200×675 (formato de X) con el render del personaje.
//
// Se dibuja en el navegador con <canvas>: sin servidor y sin coste. Las imágenes
// de R2 se piden por /api/img (mismo origen) para que el canvas siga exportable.
// Para publicar: Web Share con la imagen adjunta si el dispositivo lo permite
// (móvil: abre la app de X con la tarjeta puesta); si no, descarga + intent de X.
import { t, getLang } from "./i18n.js";
import { el, toast } from "./ui.js";
import { R2_PUBLIC_URL, SPECIES } from "./config.js";
import { colorToHex } from "./data.js";

export const SITE_URL = "https://eroplayerdata.pages.dev";
const W = 1200, H = 675;
const ASSET = (p) => new URL(`../assets/${p}`, import.meta.url).href;
const ACCENT = "#8b5cff";

// ── Utilidades de color ───────────────────────────────────────────────
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const [r, g, b] = hexRgb(h).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const mix = (h, o, k) => "#" + hexRgb(h).map((v, i) => Math.round(v + (hexRgb(o)[i] - v) * k).toString(16).padStart(2, "0")).join("");

// Color de tinta usable sobre fondo oscuro: ni casi negro ni blanco puro (el
// blanco se funde con el personaje; ahí el splat usa el morado de la marca).
function inkColors(hex) {
  const l = lum(hex);
  let text = hex, splat = hex;
  if (l < 0.2) { text = mix(hex, "#ffffff", 0.5); splat = mix(hex, "#ffffff", 0.35); }
  if (l > 0.82 || l < 0.12) splat = ACCENT;
  return { text, splat };
}

// ── Carga de imágenes ─────────────────────────────────────────────────
function loadImg(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("img " + src));
    im.src = src;
  });
}
// URL de R2 → ruta del proxy del mismo origen (sin ?v=…)
const viaProxy = (r2Url) => `/api/img?p=${encodeURIComponent(r2Url.replace(R2_PUBLIC_URL + "/", "").split("?")[0])}`;

function tinted(img, color, w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, w, h);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Texto que se encoge hasta caber en maxW
function fitText(g, text, maxW, size, family, min = 22) {
  let s = size;
  for (; s > min; s -= 2) { g.font = `${s}px ${family}`; if (g.measureText(text).width <= maxW) break; }
  g.font = `${s}px ${family}`;
  return s;
}

// ── Textos (EN / ES) ──────────────────────────────────────────────────
const COPY = {
  en: { l1: "I JUST REGISTERED", l2: "MY OC!", sub: "in the OC Data Collector", cta: "MAKE YOURS",
        tweet: "I just registered my OC in the OC Data Collector. This is my 3D render, make yours:" },
  es: { l1: "YA HE REGISTRADO", l2: "¡MI OC!", sub: "en el OC Data Collector", cta: "HAZ EL TUYO",
        tweet: "Acabo de registrar mi OC en el OC Data Collector. Este es mi render 3D, haz el tuyo:" },
};
const copy = () => COPY[getLang()] || COPY.en;
export const shareText = () => `${copy().tweet} ${SITE_URL}`;

// ── La tarjeta ────────────────────────────────────────────────────────
// opts: { alias, playerType, colorHex, renderUrl (R2), bannerUrl (R2 | null) }
export async function buildShareCard(opts) {
  const c = copy();
  const [bg, splat, star, logo, ren, ban] = await Promise.all([
    loadImg(ASSET("bg/bg-ink-camo.webp")),
    loadImg(ASSET("decor/splat-purple.png")),
    loadImg(ASSET("decor/star-shine.png")),
    loadImg(ASSET("brand-logo.webp")),
    loadImg(viaProxy(opts.renderUrl)),
    opts.bannerUrl ? loadImg(viaProxy(opts.bannerUrl)).catch(() => null) : Promise.resolve(null),
    document.fonts.load('64px "Splat-Title"'), document.fonts.load('32px "Splat-Text"'),
  ]);
  const TITLE = '"Splat-Title","Space Grotesk",sans-serif';
  const TEXT = '"Splat-Text","Space Grotesk",sans-serif';
  const ink = inkColors(opts.colorHex);

  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d");

  // Fondo: azul noche + patrón de calamares a poca opacidad + resplandor de tinta
  g.fillStyle = "#0b0e1a"; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.55;
  const k = Math.max(W / bg.width, H / bg.height);
  g.drawImage(bg, 0, (H - bg.height * k) / 2, bg.width * k, bg.height * k);
  g.globalAlpha = 1;
  const glow = g.createRadialGradient(850, 330, 40, 850, 330, 560);
  glow.addColorStop(0, ink.splat + "55"); glow.addColorStop(1, "#0b0e1a00");
  g.fillStyle = glow; g.fillRect(0, 0, W, H);

  // Splat grande del color de tinta, detrás del personaje
  const sw = 640, sh = Math.round(640 * splat.height / splat.width);
  g.drawImage(tinted(splat, ink.splat, sw, sh), 790 - sw / 2 + 20, H / 2 - sh / 2 + 6);
  g.globalAlpha = 0.9;
  g.drawImage(star, 610, 40, 96, 96);
  g.drawImage(star, 1090, 520, 70, 70);
  g.globalAlpha = 1;

  // Personaje (el render ya lleva la marca de agua)
  const rh = 612, rw = Math.round(rh * ren.width / ren.height);
  g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 28; g.shadowOffsetY = 12;
  g.drawImage(ren, 800 - rw / 2 + 60, H - rh - 22, rw, rh);
  g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;

  // Columna izquierda
  const X = 64;
  g.save(); g.beginPath(); g.arc(X + 28, 74, 28, 0, Math.PI * 2); g.clip();
  g.drawImage(logo, X, 46, 56, 56); g.restore();
  g.fillStyle = "#eaf0ff"; g.textBaseline = "alphabetic";
  g.font = `24px ${TEXT}`; g.fillText("OC DATA COLLECTOR", X + 72, 83);

  g.fillStyle = "#ffffff"; fitText(g, c.l1, 600, 60, TITLE, 34); g.fillText(c.l1, X, 168);
  g.fillStyle = ink.text; fitText(g, c.l2, 600, 100, TITLE, 40); g.fillText(c.l2, X, 262);
  g.fillStyle = "#93a0c4"; g.font = `27px ${TEXT}`; g.fillText(c.sub, X, 306);

  // Placa con el alias, con barra del color de tinta
  const alias = (opts.alias || "").trim() || "OC";
  fitText(g, alias, 470, 40, TEXT, 24);
  const aw = Math.min(520, Math.max(220, g.measureText(alias).width + 64));
  g.fillStyle = "rgba(26,33,56,.92)"; roundRect(g, X, 328, aw, 64, 16); g.fill();
  g.fillStyle = ink.text; roundRect(g, X, 328, 12, 64, 6); g.fill();
  g.fillStyle = "#ffffff"; g.fillText(alias, X + 32, 328 + 44);

  // Splattag del jugador (si tiene)
  let y = 412;
  if (ban) {
    const bw = Math.min(420, 112 * ban.width / ban.height), bh = bw * ban.height / ban.width;
    g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 16; g.shadowOffsetY = 6;
    g.drawImage(ban, X, y, bw, bh);
    g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
    y += bh + 18;
  }

  // Especie + color de tinta
  const sp = SPECIES[opts.playerType] || SPECIES[0];
  const spText = `${t(sp.species)} · ${sp.male ? t("boy") : t("girl")}`.toUpperCase();
  g.font = `24px ${TEXT}`;
  const tw = g.measureText(spText).width + 70;
  g.fillStyle = "rgba(255,255,255,.08)"; roundRect(g, X, y, tw, 44, 22); g.fill();
  g.fillStyle = opts.colorHex; g.beginPath(); g.arc(X + 26, y + 22, 11, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 2; g.stroke();
  g.fillStyle = "#eaf0ff"; g.fillText(spText, X + 48, y + 31);

  // Pie: llamada a la acción + dirección
  g.fillStyle = ACCENT; roundRect(g, X, H - 78, 214, 46, 23); g.fill();
  g.fillStyle = "#ffffff"; g.font = `24px ${TEXT}`; g.fillText(c.cta, X + 24, H - 47);
  g.fillStyle = "#eaf0ff"; g.font = `26px ${TEXT}`; g.fillText(SITE_URL.replace("https://", ""), X + 236, H - 46);

  return cv;
}

const toBlob = (cv) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));

// ── Diálogo ───────────────────────────────────────────────────────────
export function openShareDialog(opts) {
  const overlay = el("div", { class: "edc-modal-overlay" });
  let url = null, blob = null;
  const esc = (e) => { if (e.key === "Escape") close(); };
  const close = () => { overlay.remove(); document.removeEventListener("keydown", esc); if (url) URL.revokeObjectURL(url); };

  const stage = el("div", { class: "edc-share-stage is-loading", role: "status" }, el("span", { class: "edc-sr-only" }, t("share_making")));
  const status = el("p", { class: "edc-share-note" }, t("share_note"));
  const btnShare = el("button", { class: "edc-btn edc-btn-primary", type: "button", disabled: "" }, t("share_x"));
  const btnSave = el("button", { class: "edc-btn", type: "button", disabled: "" }, t("share_download"));
  const btnCopy = el("button", { class: "edc-btn edc-btn-link", type: "button" }, t("share_copy_text"));

  const fileName = "oc-data-collector-" + (opts.alias || "oc").replace(/[^\w-]+/g, "_").slice(0, 30) + ".png";
  const download = () => {
    const a = el("a", { href: url, download: fileName }); document.body.append(a); a.click(); a.remove();
  };
  btnSave.addEventListener("click", download);
  btnCopy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(shareText()); toast(t("share_copied"), "ok"); }
    catch { toast(t("share_copy_err"), "err"); }
  });
  btnShare.addEventListener("click", async () => {
    const file = blob && new File([blob], fileName, { type: "image/png" });
    // Móvil y navegadores con Web Share de ficheros: la imagen va ya adjunta
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], text: shareText() }); return; }
      catch (e) { if (e?.name === "AbortError") return; }
    }
    // Escritorio: X no admite imagen por enlace → se descarga y se abre el tweet escrito
    download();
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(copy().tweet)}&url=${encodeURIComponent(SITE_URL)}`,
      "_blank", "noopener");
    status.textContent = t("share_attach");
  });

  overlay.append(el("div", { class: "edc-modal edc-share-modal", role: "dialog", "aria-modal": "true", "aria-label": t("share_title") },
    el("div", { class: "edc-modal-head" }, el("h3", {}, t("share_title")),
      el("button", { class: "edc-modal-close", type: "button", "aria-label": t("share_close"), onClick: close }, "×")),
    el("div", { class: "edc-share-body" }, stage, status,
      el("div", { class: "edc-share-actions" }, btnShare, btnSave, btnCopy))));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", esc);
  document.body.append(overlay);

  buildShareCard(opts).then(async (cv) => {
    blob = await toBlob(cv);
    url = URL.createObjectURL(blob);
    stage.classList.remove("is-loading"); stage.textContent = "";
    stage.append(el("img", { src: url, alt: t("share_alt"), width: W, height: H }));
    btnShare.disabled = false; btnSave.disabled = false;
    btnShare.focus();
  }).catch((e) => {
    console.warn("share card:", e);
    stage.classList.remove("is-loading"); stage.textContent = t("share_err");
  });
}

// Datos de un personaje de app.js → opciones de la tarjeta
export const shareOptsFor = (ch, renderUrl) => ({
  alias: ch.data.alias,
  playerType: ch.data.player_type,
  colorHex: colorToHex(ch.data.color),
  renderUrl,
  bannerUrl: ch.data.banner_url || null,
});
