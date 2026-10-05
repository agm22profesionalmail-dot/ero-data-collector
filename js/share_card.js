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
const ACCENT = "#8b5cff";      // acento de marca (splat de respaldo)

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
  en: { l1: "I JUST REGISTERED", l2: "MY OC!", sub: "in the OC Data Collector", cta: "MAKE YOURS" },
  es: { l1: "YA HE REGISTRADO", l2: "¡MI OC!", sub: "en el OC Data Collector", cta: "HAZ EL TUYO" },
};
const copy = () => COPY[getLang()] || COPY.en;

// Mensajes para publicar (sin URL: se añade aparte). Neutros en especie y género.
export const MESSAGES = {
  en: [
    "I just registered my OC in the OC Data Collector. This is my 3D render, make yours:",
    "My OC finally has a 3D render. Go get yours:",
    "Registered my OC in the OC Data Collector. Not bad for a couple of clicks. Your turn:",
    "Tell me this isn't a good-looking OC. Now go register yours:",
    "Plot twist: my OC has a 3D model now. Make yours here:",
    "My OC just got its own card. Come get yours:",
    "Found a site that renders your Splatoon OC in 3D. Of course I tried it:",
    "OC registered, render ready. What does yours look like?",
    "Two minutes and my OC has a 3D render. Show me yours:",
    "This is my OC, rendered in 3D by the OC Data Collector. Make yours and show me:",
    "My OC, but now with a 3D render and a splattag. Register yours:",
    "Inkopolis, meet my OC. Make yours and let's compare:",
    "My OC is official now. Yours deserves a render too:",
    "Who else has an OC? Register it and get a free 3D render:",
    "Gave my OC a 3D render. Looks ready for a Splatfest:",
    "OC check: registered, rendered, ready. Yours?",
    "New profile pic material: my OC in 3D. Make yours:",
    "I registered my OC and got this render. Drop yours below:",
  ],
  es: [
    "Acabo de registrar mi OC en el OC Data Collector. Este es mi render 3D, haz el tuyo:",
    "Mi OC por fin tiene render 3D. Ve a por el tuyo:",
    "He registrado mi OC en el OC Data Collector. No está mal para un par de clics. Te toca:",
    "Decidme que mi OC no queda genial. Y ahora registrad el vuestro:",
    "Giro de guion: mi OC ya tiene modelo 3D. Haz el tuyo aquí:",
    "Mi OC acaba de conseguir su propia tarjeta. Ven a por la tuya:",
    "He encontrado una web que renderiza tu OC de Splatoon en 3D. Claro que la he probado:",
    "OC registrado, render listo. ¿Cómo es el tuyo?",
    "Dos minutos y mi OC ya tiene render 3D. Enséñame el tuyo:",
    "Este es mi OC renderizado en 3D por el OC Data Collector. Haz el tuyo y enséñamelo:",
    "Mi OC, pero ahora con render 3D y splattag. Registra el tuyo:",
    "Inkopolis, os presento a mi OC. Haced el vuestro y comparamos:",
    "Mi OC ya es oficial. El tuyo también merece un render:",
    "¿Quién más tiene un OC? Regístralo y te sale un render 3D gratis:",
    "Le he hecho un render 3D a mi OC. Parece listo para un Splatfest:",
    "Revisión de OC: registrado, renderizado y listo. ¿Y el tuyo?",
    "Material de foto de perfil: mi OC en 3D. Haz el tuyo:",
    "He registrado mi OC y me ha salido este render. Poned el vuestro en los comentarios:",
  ],
};
const pool = () => MESSAGES[getLang()] || MESSAGES.en;
// Siguiente mensaje al azar sin repetir el actual
export function nextMessage(current) {
  const p = pool();
  if (p.length < 2) return p[0];
  let m; do { m = p[Math.floor(Math.random() * p.length)]; } while (m === current);
  return m;
}
export const shareText = (msg) => `${msg} ${SITE_URL}`;

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

  // Render en marco doble (carcasa + núcleo, radios concéntricos). El render se dibuja ENTERO,
  // marca de agua incluida, así que la marca se conserva sin invadir el resto del diseño.
  const PW = 432, PH = Math.round(PW * ren.height / ren.width), PAD = 12, R_IN = 28, R_OUT = R_IN + PAD;
  const CX = 924, CY = H / 2;
  const shade = mix(ink.splat, "#05070f", 0.8);   // sombra teñida con la tinta, no negro puro
  g.globalAlpha = 0.9;
  g.drawImage(star, 640, 34, 84, 84);
  g.drawImage(star, 1116, 560, 60, 60);
  g.globalAlpha = 1;
  g.save();
  g.translate(CX, CY); g.rotate(0.03);
  const OW = PW + PAD * 2, OH = PH + PAD * 2;
  g.shadowColor = shade + "d9"; g.shadowBlur = 40; g.shadowOffsetY = 16;
  g.fillStyle = "rgba(255,255,255,.07)"; roundRect(g, -OW / 2, -OH / 2, OW, OH, R_OUT); g.fill();
  g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
  g.lineWidth = 2; g.strokeStyle = "rgba(255,255,255,.18)"; roundRect(g, -OW / 2 + 1, -OH / 2 + 1, OW - 2, OH - 2, R_OUT); g.stroke();
  g.fillStyle = "#0f1426"; roundRect(g, -PW / 2, -PH / 2, PW, PH, R_IN); g.fill();
  g.save();
  roundRect(g, -PW / 2, -PH / 2, PW, PH, R_IN); g.clip();
  const pg = g.createRadialGradient(0, 0, 20, 0, 0, PH * 0.7);
  pg.addColorStop(0, ink.splat + "66"); pg.addColorStop(1, "#0f142600");
  g.fillStyle = pg; g.fillRect(-PW / 2, -PH / 2, PW, PH);
  const sw = Math.round(PW * 1.25), sh = Math.round(sw * splat.height / splat.width);
  g.drawImage(tinted(splat, ink.splat, sw, sh), -sw / 2, -sh / 2 + 6);
  g.drawImage(ren, -PW / 2, -PH / 2, PW, PH);
  g.restore();
  g.lineWidth = 4; g.strokeStyle = ink.text; roundRect(g, -PW / 2, -PH / 2, PW, PH, R_IN); g.stroke();
  g.restore();

  // Columna izquierda (ritmo de 8 px)
  const X = 64;
  g.save(); g.beginPath(); g.arc(X + 28, 74, 28, 0, Math.PI * 2); g.clip();
  g.drawImage(logo, X, 46, 56, 56); g.restore();
  g.fillStyle = "#eaf0ff"; g.textBaseline = "alphabetic";
  g.font = `26px ${TEXT}`; g.fillText("OC DATA COLLECTOR", X + 72, 83);

  g.fillStyle = "#ffffff"; fitText(g, c.l1, 600, 60, TITLE, 34); g.fillText(c.l1, X, 176);
  g.fillStyle = ink.text; fitText(g, c.l2, 600, 100, TITLE, 40); g.fillText(c.l2, X, 266);
  g.fillStyle = "#a9b4d6"; g.font = `30px ${TEXT}`; g.fillText(c.sub, X, 312);

  // Placa: alias + especie y color de tinta, con barra del color de tinta
  const alias = (opts.alias || "").trim() || "OC";
  const sp = SPECIES[opts.playerType] || SPECIES[0];
  const meta = `${t(sp.species)} / ${sp.male ? t("boy") : t("girl")}`.toUpperCase();
  fitText(g, alias, 480, 40, TEXT, 24);
  const aliasW = g.measureText(alias).width;
  g.font = `22px ${TEXT}`; const metaW = g.measureText(meta).width + 34;
  const PLW = Math.min(560, Math.max(300, Math.max(aliasW, metaW) + 64)), PLY = 336, PLH = 96;
  g.save();
  g.shadowColor = shade + "99"; g.shadowBlur = 24; g.shadowOffsetY = 8;
  g.fillStyle = "rgba(26,33,56,.94)"; roundRect(g, X, PLY, PLW, PLH, 20); g.fill();
  g.restore();
  g.lineWidth = 1.5; g.strokeStyle = "rgba(255,255,255,.12)"; roundRect(g, X + .75, PLY + .75, PLW - 1.5, PLH - 1.5, 20); g.stroke();
  g.fillStyle = ink.text; roundRect(g, X + 14, PLY + 18, 8, PLH - 36, 4); g.fill();
  fitText(g, alias, 480, 40, TEXT, 24);
  g.fillStyle = "#ffffff"; g.fillText(alias, X + 40, PLY + 46);
  g.fillStyle = opts.colorHex; g.beginPath(); g.arc(X + 50, PLY + 74, 9, 0, Math.PI * 2); g.fill();
  g.lineWidth = 2; g.strokeStyle = "rgba(255,255,255,.7)"; g.stroke();
  g.fillStyle = "#a9b4d6"; g.font = `22px ${TEXT}`; g.fillText(meta, X + 70, PLY + 81);

  // Splattag del jugador (si tiene)
  if (ban) {
    const by = PLY + PLH + 20, bw = Math.min(440, 112 * ban.width / ban.height), bh = bw * ban.height / ban.width;
    g.save();
    g.shadowColor = shade + "b3"; g.shadowBlur = 20; g.shadowOffsetY = 8;
    g.drawImage(ban, X, by, bw, bh);
    g.restore();
  }

  // Pie sin cápsula: estrella + llamada a la acción + filete + dirección, centrados en una misma línea
  const FY = H - 58;                       // eje vertical común
  g.textBaseline = "middle";
  g.drawImage(star, X - 6, FY - 28, 56, 56);
  g.fillStyle = ink.text; g.font = `32px ${TITLE}`;
  const ctaW = g.measureText(c.cta).width;
  g.fillText(c.cta, X + 56, FY + 1);
  const sepX = X + 56 + ctaW + 24;
  g.fillStyle = "rgba(255,255,255,.22)"; g.fillRect(sepX, FY - 18, 2, 36);
  g.fillStyle = "#eaf0ff"; g.font = `28px ${TEXT}`;
  g.fillText(SITE_URL.replace("https://", ""), sepX + 26, FY + 1);
  g.textBaseline = "alphabetic";

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
  // Mensaje editable + otro al azar (la URL se añade sola al publicar)
  const msgBox = el("textarea", { class: "edc-input edc-share-msg", id: "share-msg", rows: "3", maxlength: "240" });
  msgBox.value = nextMessage("");
  const btnNext = el("button", { class: "edc-btn edc-btn-sm", type: "button", onClick: () => { msgBox.value = nextMessage(msgBox.value); } }, t("share_another"));
  const msgField = el("div", { class: "edc-share-field" },
    el("div", { class: "edc-share-fieldhead" },
      el("label", { class: "edc-label", for: "share-msg" }, t("share_msg_label")), btnNext),
    msgBox);
  const currentMsg = () => msgBox.value.trim() || nextMessage("");

  const fileName = "oc-data-collector-" + (opts.alias || "oc").replace(/[^\w-]+/g, "_").slice(0, 30) + ".png";
  const download = () => {
    const a = el("a", { href: url, download: fileName }); document.body.append(a); a.click(); a.remove();
  };
  btnSave.addEventListener("click", download);
  btnCopy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(shareText(currentMsg())); toast(t("share_copied"), "ok"); }
    catch { toast(t("share_copy_err"), "err"); }
  });
  btnShare.addEventListener("click", async () => {
    const file = blob && new File([blob], fileName, { type: "image/png" });
    // Móvil y navegadores con Web Share de ficheros: la imagen va ya adjunta
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], text: shareText(currentMsg()) }); return; }
      catch (e) { if (e?.name === "AbortError") return; }
    }
    // Escritorio: X no admite imagen por enlace → se descarga y se abre el tweet escrito
    download();
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(currentMsg())}&url=${encodeURIComponent(SITE_URL)}`,
      "_blank", "noopener");
    status.textContent = t("share_attach");
  });

  overlay.append(el("div", { class: "edc-modal edc-share-modal", role: "dialog", "aria-modal": "true", "aria-label": t("share_title") },
    el("div", { class: "edc-modal-head" }, el("h3", {}, t("share_title")),
      el("button", { class: "edc-modal-close", type: "button", "aria-label": t("share_close"), onClick: close }, "×")),
    el("div", { class: "edc-share-body" }, el("div", { class: "edc-share-shell" }, stage), msgField, status,
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
