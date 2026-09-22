// Panel del artista — SOLO se activa por ?panel (enlace privado, análogo a
// ?admin). El artista ya aprobado entra con SU sesión de Discord + la clave
// que le dio el admin (doble factor). La RPC artist_group (SECURITY DEFINER,
// supabase/migrations/20260916_05_artist_group.sql) devuelve SOLO su propio
// grupo de jugadores, sin JSON de Calico ni nada exportable.
//
// RESTRICCIÓN DURA: esto es SOLO material de referencia visual. No hay botón
// de exportar/descargar ni de copiar la config — únicamente ver la ficha.
//
// La clave vive en memoria mientras la pestaña esté abierta; nunca se guarda
// en disco. Textos propios (herramienta interna), como admin.js.
import { supabase } from "./supabase.js";
import { getLang } from "./i18n.js";
import { el, clear, toast, imgWithFallback } from "./ui.js";
import {
  loadData, data, getById, colorToHex,
  headName, clothName, shoesName,
  skinUrl, eyeUrl, typeUrl, hairUrl, eyebrowUrl, pantsVarUrl, pantsVarLocalUrl, gearUrl,
  eyebrowsFor,
} from "./data.js";
import { SPECIES, SKIN_TONES, EYE_COLORS } from "./config.js";

const S = {
  en: {
    title: "Artist panel",
    intro: "See the characters of the players who signed up through your artist link.",
    need_discord: "Sign in with Discord to access your artist panel.",
    need_link: "Your session has no Discord account. Link Discord to continue.",
    connect_discord: "Connect with Discord", link_discord: "Link Discord",
    key_intro: "Enter the artist key you were given to see your group.",
    key_ph: "Artist key", enter: "Enter",
    bad_key: "Wrong key or unauthorized access.", err: "Error: ",
    refresh: "Refresh", change_key: "Change key",
    back: "← Back to site", back_gallery: "← Back to group",
    empty: "No players in your group yet.",
    no_alias: "No alias", view: "View sheet",
    render_soon: "Render coming soon",
    download_card: "Download Splashtag",
    download_banner: "Download banner",
    no_banner: "No Splashtag",
    f_species: "Species & gender", f_skin: "Skin tone", f_eye: "Eye color",
    f_hair: "Hairstyle", f_brows: "Eyebrows", f_legs: "Legs",
    f_head: "Head gear", f_cloth: "Clothing", f_shoes: "Shoes",
    g_character: "Character", g_gear: "Gear",
    base: "Base", alt: "ALT", girl: "Girl", boy: "Boy", inkling: "Inkling", octoling: "Octoling",
    show_all: "Show all options", show_selected: "Show only the selected one",
    cp_title: "Set your artist key",
    cp_intro: "This is your first time. The key you got by email is temporary. Choose a new one now.",
    cp_rule_len: "At least 10 characters",
    cp_rule_unique: "Different from the temporary one you got by email",
    cp_new: "New key", cp_new_ph: "Your new artist key",
    cp_new2: "Repeat new key", cp_new2_ph: "Type it again",
    cp_submit: "Save and continue",
    cp_short: "Your key must be at least 10 characters long.",
    cp_mismatch: "The two keys don't match.",
    cp_same: "Choose a key different from the temporary one.",
    cp_bad_current: "Session lost. Sign in again.",
    cp_done: "Key updated.",
  },
  es: {
    title: "Panel del artista",
    intro: "Consulta los personajes de los jugadores que se registraron a través de tu enlace de artista.",
    need_discord: "Inicia sesión con Discord para acceder a tu panel de artista.",
    need_link: "Tu sesión no tiene cuenta de Discord. Vincula Discord para continuar.",
    connect_discord: "Conectar con Discord", link_discord: "Vincular Discord",
    key_intro: "Introduce la clave de artista que te dieron para ver tu grupo.",
    key_ph: "Clave de artista", enter: "Entrar",
    bad_key: "Clave o acceso incorrectos.", err: "Error: ",
    refresh: "Actualizar", change_key: "Cambiar clave",
    back: "← Volver a la web", back_gallery: "← Volver al grupo",
    empty: "Aún no hay jugadores en tu grupo.",
    no_alias: "Sin alias", view: "Ver ficha",
    render_soon: "Render en preparación",
    download_card: "Descargar Splashtag",
    download_banner: "Descargar banner",
    no_banner: "Sin Splashtag",
    f_species: "Especie y género", f_skin: "Tono de piel", f_eye: "Color de ojos",
    f_hair: "Peinado", f_brows: "Cejas", f_legs: "Piernas",
    f_head: "Gear cabeza", f_cloth: "Gear ropa", f_shoes: "Gear zapatillas",
    g_character: "Personaje", g_gear: "Equipo",
    base: "Base", alt: "ALT", girl: "Chica", boy: "Chico", inkling: "Inkling", octoling: "Octoling",
    show_all: "Ver todas las opciones", show_selected: "Ver solo la elegida",
    cp_title: "Elige tu clave de artista",
    cp_intro: "Es tu primera vez. La clave que te llegó por email es temporal. Elige una nueva ahora.",
    cp_rule_len: "Al menos 10 caracteres",
    cp_rule_unique: "Distinta de la temporal que te llegó por email",
    cp_new: "Clave nueva", cp_new_ph: "Tu clave de artista",
    cp_new2: "Repite la clave", cp_new2_ph: "Escríbela otra vez",
    cp_submit: "Guardar y entrar",
    cp_short: "La clave debe tener al menos 10 caracteres.",
    cp_mismatch: "Las dos claves no coinciden.",
    cp_same: "Elige una clave distinta de la temporal.",
    cp_bad_current: "Sesión perdida. Vuelve a entrar.",
    cp_done: "Clave actualizada.",
  },
};
const ta = (k) => (S[getLang()] || S.en)[k] || k;

export const isPanelRoute = () => new URLSearchParams(location.search).has("panel");
export function leavePanel() {
  if (!isPanelRoute()) return false;
  history.pushState(null, "", location.pathname);
  return true;
}

let artistKey = null;  // clave en memoria (nunca a disco)
let rows = null;       // último grupo devuelto por artist_group
let mustChange = false; // must_change_password del último rpcGroup
let dataReady = false; // RSDB (data.js) cargada — hace falta para pintar la ficha

async function ensureData() { if (!dataReady) { await loadData(); dataReady = true; } }

// artist_group v2 (migración 09) devuelve {must_change_password, players}.
// Se acepta también el formato viejo (array de players) por si un cliente
// llega antes de aplicar la migración: se toma como must_change_password=false.
const rpcGroup = async (key) => {
  const { data: d, error } = await supabase.rpc("artist_group", { p_key: key });
  if (error) throw error;
  if (Array.isArray(d)) return { must_change_password: false, players: d };
  return { must_change_password: !!d?.must_change_password, players: d?.players || [] };
};
const isUnauthorized = (e) => !!e && (e.code === "28000" || /unauthorized|no discord/i.test(e.message || ""));

// `session`/`profile` los da app.js; `actions`: login(), linkDiscord(), back(), discordSvg()
export function renderArtistPanel(container, { session, profile, actions } = {}) {
  clear(container);
  const wrap = el("div", { class: "edc-apply" });
  container.append(wrap);
  const backBtn = () => el("button", { class: "edc-btn-link", onClick: actions.back }, ta("back"));

  const hasDiscord = !!(session?.user && profile?.hasDiscord);

  if (!hasDiscord) showConnect();
  else if (!rows && !mustChange) showKeyForm();
  else if (mustChange) showChangePassword();
  else showGallery();

  function showConnect() {
    clear(wrap);
    const needsLink = !!session?.user; // sesión de X sin Discord: vincular en vez de login
    wrap.append(el("div", { class: "edc-card" },
      el("div", { class: "edc-section-title" }, ta("title")),
      el("p", { class: "edc-apply-intro" }, ta("intro")),
      el("p", { class: "edc-apply-intro edc-apply-need" }, ta(needsLink ? "need_link" : "need_discord")),
      el("div", { class: "edc-apply-actions" },
        el("button", { class: "edc-btn edc-btn-discord", onClick: () => (needsLink ? actions.linkDiscord : actions.login)() },
          el("span", { html: actions.discordSvg ? actions.discordSvg() : "" }), ta(needsLink ? "link_discord" : "connect_discord")),
        backBtn())));
  }

  function showKeyForm(errMsg) {
    rows = null; artistKey = null; mustChange = false;
    clear(wrap);
    const input = el("input", { class: "edc-input", type: "password", placeholder: ta("key_ph"), autocomplete: "off" });
    const err = el("div", { class: "edc-banner-err" }); err.hidden = !errMsg; err.textContent = errMsg || "";
    const btn = el("button", { class: "edc-btn edc-btn-primary" }, ta("enter"));
    const submit = async () => {
      const k = input.value.trim();
      if (!k) return;
      btn.disabled = true;
      try {
        const group = await rpcGroup(k);
        artistKey = k;
        if (group.must_change_password) {
          mustChange = true;
          showChangePassword();
          return;
        }
        await ensureData();
        rows = group.players; mustChange = false;
        showGallery();
      } catch (e) {
        btn.disabled = false;
        showKeyForm(ta("bad_key"));
      }
    };
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    wrap.append(el("div", { class: "edc-card" },
      el("div", { class: "edc-section-title" }, ta("title")),
      el("p", { class: "edc-apply-intro" }, ta("key_intro")),
      input, err,
      el("div", { class: "edc-apply-actions" }, btn, backBtn())));
  }

  // Primer login: la clave del email es genérica y compartida. Antes de dejar
  // ver la galería, el artista tiene que ponerse la suya. RPC
  // artist_change_password (mig. 08) valida la clave actual + fuerza mínima
  // ≥10 chars y actualiza must_change_password=false en la BD.
  function showChangePassword(errMsg) {
    clear(wrap);
    const nw  = el("input", { class: "edc-input", type: "password", placeholder: ta("cp_new_ph"),   autocomplete: "new-password" });
    const nw2 = el("input", { class: "edc-input", type: "password", placeholder: ta("cp_new2_ph"),  autocomplete: "new-password" });
    const err = el("div", { class: "edc-banner-err" }); err.hidden = !errMsg; err.textContent = errMsg || "";
    const btn = el("button", { class: "edc-btn edc-btn-primary" }, ta("cp_submit"));
    const submit = async () => {
      const a = nw.value, b = nw2.value;
      if (!a || a.length < 10) { nw.classList.add("error"); return showChangePassword(ta("cp_short")); }
      if (a !== b) { nw2.classList.add("error"); return showChangePassword(ta("cp_mismatch")); }
      if (a === artistKey) { nw.classList.add("error"); return showChangePassword(ta("cp_same")); }
      btn.disabled = true;
      try {
        const { error } = await supabase.rpc("artist_change_password", { p_current: artistKey, p_new: a });
        if (error) throw error;
        artistKey = a; mustChange = false;
        await ensureData();
        const group = await rpcGroup(artistKey);
        rows = group.players;
        toast(ta("cp_done"), "ok");
        showGallery();
      } catch (e) {
        btn.disabled = false;
        showChangePassword(isUnauthorized(e) ? ta("cp_bad_current") : (ta("err") + (e?.message || "")));
      }
    };
    btn.addEventListener("click", submit);
    nw2.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    wrap.append(el("div", { class: "edc-card" },
      el("div", { class: "edc-section-title" }, ta("cp_title")),
      el("p", { class: "edc-apply-intro" }, ta("cp_intro")),
      el("ul", { class: "edc-cp-rules" },
        el("li", {}, ta("cp_rule_len")),
        el("li", {}, ta("cp_rule_unique"))),
      el("label", { class: "edc-label" }, ta("cp_new")),  nw,
      el("label", { class: "edc-label" }, ta("cp_new2")), nw2,
      err,
      el("div", { class: "edc-apply-actions" }, btn, backBtn())));
  }

  async function reload() { const g = await rpcGroup(artistKey); rows = g.players; mustChange = g.must_change_password; }

  function showGallery() {
    clear(wrap);
    wrap.append(el("div", { class: "edc-admin-head" },
      el("div", { class: "edc-section-title" }, ta("title")),
      el("div", { class: "edc-apply-actions" },
        el("button", { class: "edc-btn edc-btn-sm", onClick: async () => { try { await reload(); showGallery(); } catch (e) { if (isUnauthorized(e)) showKeyForm(ta("bad_key")); else toast(ta("err") + (e?.message || ""), "err"); } } }, ta("refresh")),
        el("button", { class: "edc-btn edc-btn-sm", onClick: () => showKeyForm() }, ta("change_key")),
        backBtn())));
    if (!rows.length) { wrap.append(el("p", { class: "edc-apply-intro" }, ta("empty"))); return; }
    const grid = el("div", { class: "edc-panel-grid" });
    for (const p of rows) grid.append(renderPlayerCard(p));
    wrap.append(grid);
  }

  function renderPlayerCard(p) {
    const open = () => showDetail(p);
    const sp = SPECIES[p.player_type] || SPECIES[0];
    const speciesLabel = `${ta(sp.species)} ${sp.male ? ta("boy") : ta("girl")}`;
    const handle = p.x_username ? ("@" + p.x_username) : (p.discord_name || "");
    const body = el("div", { class: "edc-panel-pcard-body" },
      el("div", { class: "edc-panel-pcard-alias" }, p.alias || ta("no_alias")),
      el("div", { class: "edc-panel-pcard-meta" }, speciesLabel),
      el("div", { class: "edc-panel-pcard-contact" },
        el("span", { class: "edc-panel-pcard-dot", style: `background:${colorToHex(p.color)}` }),
        el("div", { class: "edc-panel-pcard-lines" },
          handle ? el("span", { class: "edc-panel-pcard-handle" }, handle) : null,
          p.discord_id ? el("span", { class: "edc-panel-pcard-did" }, p.discord_id) : null)));
    return el("div", { class: "edc-card edc-panel-pcard", onClick: open },
      renderBanner(p, { size: "card" }),
      body);
  }

  function showDetail(p) {
    clear(wrap);
    wrap.append(el("div", { class: "edc-admin-head" },
      el("button", { class: "edc-btn edc-btn-sm", onClick: () => showGallery() }, ta("back_gallery")),
      el("div", { class: "edc-apply-actions" }, backBtn())));
    // Ficha: render izquierda; a la derecha nombre + Splashtag (con hover-descargar)
    // + plantilla de personaje. El banner se monta oculto y se muestra sólo si
    // la imagen carga OK (así el rectángulo vacío nunca aparece: sin path o con
    // 404, el widget se queda hidden y no ocupa espacio).
    wrap.append(el("div", { class: "edc-pcard" },
      renderSlot(p),
      el("div", { class: "edc-pcard-main" },
        el("div", { class: "edc-pcard-name" }, p.alias || ta("no_alias")),
        renderBanner(p, { size: "detail", interactive: true }),
        renderSheet(p))));
  }
}

// ── Banner Splashtag ─────────────────────────────────────────────────
// Reutilizado por la tarjeta del listado y por la ficha del jugador.
// - Bucket `banners` es privado: cargamos vía createSignedUrl.
// - Modo "card" (listado): siempre visible. Con banner_path carga la imagen;
//   sin banner_path o si falla, se queda el placeholder (fondo neutral +
//   alias en display font). Sin overlay ni botón de descarga.
// - Modo "detail" (ficha): interactive; con overlay hover + botón "Descargar
//   banner". El widget arranca OCULTO y sólo se muestra si la imagen carga OK.
//   Así, sin banner o con fallo, no queda un rectángulo vacío en la ficha.
function renderBanner(player, opts = {}) {
  const size = opts.size === "card" ? "card" : "detail";
  const interactive = !!opts.interactive;
  const wrap = document.createElement("div");
  wrap.className = "edc-banner-wrap edc-banner-wrap-" + size;
  const ph = document.createElement("div");
  ph.className = "edc-banner-ph";
  const showPlaceholder = () => {
    ph.classList.add("edc-banner-ph-empty");
    const aliasBig = document.createElement("span");
    aliasBig.className = "edc-banner-ph-alias";
    aliasBig.textContent = (player?.alias || "").toUpperCase() || tag("no_banner");
    const aliasTag = document.createElement("span");
    aliasTag.className = "edc-banner-ph-tag";
    aliasTag.textContent = tag("no_banner");
    ph.append(aliasBig, aliasTag);
  };
  if (!player?.banner_path) {
    if (size === "card") { showPlaceholder(); wrap.appendChild(ph); return wrap; }
    wrap.hidden = true;  // ficha sin banner: no ocupa espacio
    return wrap;
  }
  if (size === "card") wrap.appendChild(ph);
  if (interactive) {
    wrap.hidden = true;  // ficha: se desoculta al cargar la imagen OK
    const overlay = document.createElement("div");
    overlay.className = "edc-banner-overlay";
    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "edc-banner-dl-btn";
    dl.textContent = tag("download_banner");
    dl.addEventListener("click", async (e) => {
      e.stopPropagation();
      dl.disabled = true;
      try {
        const { data: d } = await supabase.storage.from("banners").createSignedUrl(player.banner_path, 60);
        if (d?.signedUrl) {
          const a = document.createElement("a");
          a.href = d.signedUrl;
          a.download = `${player.alias || player.discord_name || "player"}_splattag.png`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }
      } catch { /* silencio: si falla no rompemos la ficha */ }
      dl.disabled = false;
    });
    overlay.appendChild(dl);
    wrap.appendChild(overlay);
  }
  loadBannerInto(wrap, ph, player, {
    onLoad: () => { wrap.hidden = false; },
    onFail: () => { if (size === "card") showPlaceholder(); /* ficha: queda hidden */ },
  });
  return wrap;
}

async function loadBannerInto(container, ph, player, cb = {}) {
  try {
    const { data: d } = await supabase.storage.from("banners")
      .createSignedUrl(player.banner_path, 3600);
    if (!d?.signedUrl) { cb.onFail?.(); return; }
    const img = document.createElement("img");
    img.className = "edc-banner-img";
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.onload = () => {
      if (!container.isConnected) return;
      if (ph.isConnected) ph.remove();
      container.prepend(img);
      cb.onLoad?.();
    };
    img.onerror = () => { cb.onFail?.(); };
    img.src = d.signedUrl;
  } catch { cb.onFail?.(); }
}

// helper i18n reutilizable fuera del closure de renderArtistPanel
function tag(k) {
  const S2 = { en: {
    download_banner: "Download banner", no_banner: "No Splashtag",
  }, es: {
    download_banner: "Descargar banner", no_banner: "Sin Splashtag",
  }};
  return (S2[getLang()] || S2.en)[k] || k;
}

// ── Hueco de RENDER del jugador ──────────────────────────────────────
// Muestra el render del bucket privado `renders` (mismo patrón que
// getBannerSignedUrl en store.js). Mientras no exista el archivo se queda el
// placeholder "Render en preparación"; la carga es asíncrona y defensiva
// (bucket o archivo ausentes → placeholder, sin romper la ficha).
function renderSlot(player, onLoaded) {
  const slot = el("div", { class: "edc-pcard-render" });
  const ph = el("div", { class: "edc-pcard-render-ph" },
    el("span", { class: "edc-pcard-render-ico", "aria-hidden": "true" }, "🖼"),
    el("span", {}, ta("render_soon")));
  slot.append(ph);
  loadRenderInto(slot, ph, player, onLoaded);
  return slot;
}
async function loadRenderInto(slot, ph, player, onLoaded) {
  if (!player?.user_id) return;
  let url = null;
  try {
    const { data: d } = await supabase.storage.from("renders")
      .createSignedUrl(`${player.user_id}/render.png`, 3600);
    url = d?.signedUrl || null;
  } catch { url = null; }
  if (!url) return;
  const img = el("img", { class: "edc-pcard-render-img", alt: "", decoding: "async" });
  img.onload = () => { if (slot.isConnected) { ph.remove(); slot.append(img); onLoaded?.(); } };
  img.onerror = () => {};  // aún sin render → se queda el placeholder
  img.src = url;
}

// ── Plantilla de personaje, READ-ONLY (panel amarillo de la ficha) ───
function swatchWrap(imgNode) { return el("div", { class: "edc-pcard-swatch" }, imgNode); }
function fieldRow(label, valueNode) {
  return el("div", { class: "edc-pcard-field" },
    el("div", { class: "edc-pcard-field-label" }, label),
    valueNode);
}
function plainSwatchRow(src, alt) {
  return el("div", { class: "edc-pcard-field-value" }, swatchWrap(imgWithFallback(src, alt || "")));
}
function legsRow(bot, v) {
  const img = el("img", { alt: "", loading: "lazy" });
  img.src = pantsVarUrl(bot, v);
  img.onerror = () => { img.onerror = () => { img.src = pantsVarUrl(bot, 0); }; img.src = pantsVarLocalUrl(bot, v); };
  const label = Number(v) === 0 ? ta("base") : "V" + v;
  return el("div", { class: "edc-pcard-field-value" }, swatchWrap(img), el("span", {}, label));
}
function gearRow(entry, urlFn, nameFn, variation) {
  return el("div", { class: "edc-pcard-field-value" },
    swatchWrap(imgWithFallback(entry ? urlFn(entry) : "", entry ? nameFn(entry) : "")),
    el("span", {}, entry ? nameFn(entry) : "—"),
    (entry?.VariationNum && Number(variation) === 1) ? el("span", { class: "edc-pcard-alt" }, ta("alt")) : null);
}

// Tira con TODAS las opciones de un pool cerrado (piel, ojos, cejas) y la
// seleccionada por el jugador MARCADA. Evita que el artista malinterprete un
// swatch aislado y se equivoque de tono. Toggle "solo la elegida ↔ todas":
// por defecto se muestra la elegida ampliada; al pulsar se despliegan las
// demás en la misma línea (o en varias, si son muchas — el CSS envuelve).
function choiceStrip(options, selectedIdx, opts = {}) {
  const strip = el("div", { class: "edc-pcard-strip" });
  strip.dataset.expanded = "false";
  const items = [];
  options.forEach((o, i) => {
    const w = el("div", { class: "edc-pcard-choice" + (i === selectedIdx ? " is-selected" : "") },
      imgWithFallback(o.src, o.alt || ""));
    if (o.title) w.title = o.title;
    items.push(w);
  });
  // orden: la elegida primero (queda siempre visible en modo colapsado)
  if (selectedIdx >= 0 && selectedIdx < items.length) {
    strip.append(items[selectedIdx]);
    items.forEach((it, i) => { if (i !== selectedIdx) strip.append(it); });
  } else items.forEach((it) => strip.append(it));
  const toggle = el("button", { class: "edc-pcard-strip-toggle", type: "button", title: ta(opts.showTitle || "show_all") }, "+");
  toggle.setAttribute("aria-label", ta(opts.showTitle || "show_all"));
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = strip.dataset.expanded !== "true";
    closeAllChoiceStrips(willOpen ? strip : null);
    strip.dataset.expanded = willOpen ? "true" : "false";
    toggle.textContent = willOpen ? "−" : "+";
    toggle.title = ta(willOpen ? "show_selected" : "show_all");
    toggle.setAttribute("aria-label", ta(willOpen ? "show_selected" : "show_all"));
  });
  ensureStripOutsideCloser();
  return el("div", { class: "edc-pcard-field-value edc-pcard-choice-value" }, strip, toggle);
}

// Cierra todos los strips abiertos (excepto `except`), reset del toggle.
function closeAllChoiceStrips(except) {
  document.querySelectorAll('.edc-pcard-strip[data-expanded="true"]').forEach((s) => {
    if (s === except) return;
    s.dataset.expanded = "false";
    const t = s.parentElement && s.parentElement.querySelector(".edc-pcard-strip-toggle");
    if (t) { t.textContent = "+"; }
  });
}
// Listener global (registrado una sola vez): clic fuera cierra los strips.
let _stripCloserBound = false;
function ensureStripOutsideCloser() {
  if (_stripCloserBound) return;
  _stripCloserBound = true;
  document.addEventListener("click", (e) => {
    if (e.target.closest(".edc-pcard-strip") || e.target.closest(".edc-pcard-strip-toggle")) return;
    closeAllChoiceStrips(null);
  });
}

function renderSheet(p) {
  const d = data();
  const sp = SPECIES[p.player_type] || SPECIES[0];
  const hair = getById(d.hair, p.hair);
  const brows = eyebrowsFor(p.player_type);
  const browIdx = brows.findIndex((e) => e.Id === p.eye_brows);
  const bot = getById(d.bottoms, p.bottom);
  const head = getById(d.headgear, p.gear_head);
  const cloth = getById(d.clothes, p.gear_cloth);
  const shoes = getById(d.shoes, p.gear_shoes);

  const speciesValue = el("div", { class: "edc-pcard-field-value" },
    swatchWrap(imgWithFallback(typeUrl(sp.key), "")),
    el("span", {}, `${ta(sp.species)} · ${sp.male ? ta("boy") : ta("girl")}`));

  const skinOpts = Array.from({ length: SKIN_TONES }, (_, i) => ({ src: skinUrl(i), title: `${i + 1}/${SKIN_TONES}` }));
  const eyeOpts  = Array.from({ length: EYE_COLORS }, (_, i) => ({ src: eyeUrl(i),  title: `${i + 1}/${EYE_COLORS}` }));
  const browOpts = brows.map((e) => ({ src: eyebrowUrl(e, p.player_type) }));

  const sheet = el("div", { class: "edc-pcard-sheet" });
  sheet.append(
    fieldRow(ta("f_species"), speciesValue),
    fieldRow(ta("f_skin"), choiceStrip(skinOpts, p.skin_tone)),
    fieldRow(ta("f_eye"), choiceStrip(eyeOpts, p.eye_color)),
    fieldRow(ta("f_hair"), hair ? plainSwatchRow(hairUrl(hair)) : plainSwatchRow("")),
    fieldRow(ta("f_brows"), browOpts.length ? choiceStrip(browOpts, browIdx) : plainSwatchRow("")),
    fieldRow(ta("f_legs"), bot ? legsRow(bot, p.bottom_variation) : plainSwatchRow("")),
    el("div", { class: "edc-pcard-section-sep" }, ta("g_gear")),
    fieldRow(ta("f_head"), gearRow(head, gearUrl, headName, p.gear_head_variation)),
    fieldRow(ta("f_cloth"), gearRow(cloth, gearUrl, clothName, p.gear_cloth_variation)),
    fieldRow(ta("f_shoes"), gearRow(shoes, gearUrl, shoesName, p.gear_shoes_variation)),
  );
  return sheet;
}
