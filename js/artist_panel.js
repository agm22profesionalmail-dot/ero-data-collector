import { supabase } from "./supabase.js";
import { getLang } from "./i18n.js";
import { el, clear, toast, imgWithFallback } from "./ui.js";
import {
  loadData,
  data,
  getById,
  colorToHex,
  hexToColor,
  headNames,
  clothNames,
  shoesNames,
  curName,
  altName,
  eyebrowsFor
} from "./data.js";
import { SPECIES, SKIN_TONES, EYE_COLORS, IMG } from "./config.js";
import { ARTIST_TERMS_VERSION, artistTermsHtml } from "./artist_terms.js";
import { getBannerUrl, getRenderUrl, getRenderUrlFirst, renderPaths, renderCandidates } from "./store.js";
import { createRenderSpin } from "./render_spin.js";
const S = {
  en: {
    title: "Artist panel",
    intro: "See the characters of the players who signed up through your artist link.",
    need_discord: "Sign in with Discord to access your artist panel.",
    need_link: "Your session has no Discord account. Link Discord to continue.",
    connect_discord: "Connect with Discord",
    link_discord: "Link Discord",
    key_intro: "Enter the artist key you were given to see your group.",
    key_ph: "Artist key",
    enter: "Enter",
    bad_key: "Wrong key or unauthorized access.",
    err: "Error: ",
    refresh: "Refresh",
    change_key: "Change key",
    back: "Back to site",
    back_gallery: "Back to group",
    render_beta: "*3D renders are in beta, expect errors.",
    empty: "No players in your group yet.",
    no_alias: "No alias",
    view: "View sheet",
    render_soon: "Render coming soon",
    render_variant: "Render of this version coming soon",
    download_card: "Download Splashtag",
    download_banner: "Download banner",
    no_banner: "No Splashtag",
    f_species: "Species & gender",
    f_skin: "Skin tone",
    f_eye: "Eye color",
    f_ink: "Ink color",
    ink_copy: "Copy",
    ink_copied: "Copied: ",
    show_formats: "Show HEX / RGB / HSL",
    f_hair: "Hairstyle",
    f_brows: "Eyebrows",
    f_legs: "Legs",
    f_head: "Head gear",
    f_cloth: "Clothing",
    f_shoes: "Shoes",
    g_character: "Character",
    g_gear: "Gear",
    base: "Base",
    alt: "ALT",
    girl: "Girl",
    boy: "Boy",
    inkling: "Inkling",
    octoling: "Octoling",
    show_all: "Show all options",
    show_selected: "Show only the selected one",
    terms_title: "Artist Beta Program Terms",
    terms_intro: "Before entering your panel, please read and accept the terms of the Artist Beta Program.",
    terms_accept: "I have read and accept the Artist Beta Program Terms.",
    terms_required: "You must accept the terms to continue.",
    terms_submit: "Accept and continue",
    cp_title: "Set your artist key",
    cp_intro: "This is your first time. The key you got by email is temporary. Choose a new one now.",
    cp_rule_len: "At least 10 characters",
    cp_rule_unique: "Different from the temporary one you got by email",
    cp_new: "New key",
    cp_new_ph: "Your new artist key",
    cp_new2: "Repeat new key",
    cp_new2_ph: "Type it again",
    cp_submit: "Save and continue",
    cp_short: "Your key must be at least 10 characters long.",
    cp_mismatch: "The two keys don't match.",
    cp_same: "Choose a key different from the temporary one.",
    cp_bad_current: "Session lost. Sign in again.",
    cp_done: "Key updated."
  },
  es: {
    title: "Panel del artista",
    intro: "Consulta los personajes de los jugadores que se registraron a través de tu enlace de artista.",
    need_discord: "Inicia sesión con Discord para acceder a tu panel de artista.",
    need_link: "Tu sesión no tiene cuenta de Discord. Vincula Discord para continuar.",
    connect_discord: "Conectar con Discord",
    link_discord: "Vincular Discord",
    key_intro: "Introduce la clave de artista que te dieron para ver tu grupo.",
    key_ph: "Clave de artista",
    enter: "Entrar",
    bad_key: "Clave o acceso incorrectos.",
    err: "Error: ",
    refresh: "Actualizar",
    change_key: "Cambiar clave",
    back: "Volver a la web",
    back_gallery: "Volver al grupo",
    render_beta: "*Renderizados 3D en fase beta, espera errores.",
    empty: "Aún no hay jugadores en tu grupo.",
    no_alias: "Sin alias",
    view: "Ver ficha",
    render_soon: "Render en preparación",
    render_variant: "Render de esta versión en preparación",
    download_card: "Descargar Splashtag",
    download_banner: "Descargar banner",
    no_banner: "Sin Splashtag",
    f_species: "Especie y género",
    f_skin: "Tono de piel",
    f_eye: "Color de ojos",
    f_ink: "Color de tinta",
    ink_copy: "Copiar",
    ink_copied: "Copiado: ",
    show_formats: "Ver HEX / RGB / HSL",
    f_hair: "Peinado",
    f_brows: "Cejas",
    f_legs: "Piernas",
    f_head: "Gear cabeza",
    f_cloth: "Gear ropa",
    f_shoes: "Gear zapatillas",
    g_character: "Personaje",
    g_gear: "Equipo",
    base: "Base",
    alt: "ALT",
    girl: "Chica",
    boy: "Chico",
    inkling: "Inkling",
    octoling: "Octoling",
    show_all: "Ver todas las opciones",
    show_selected: "Ver solo la elegida",
    terms_title: "Términos del programa beta de artistas",
    terms_intro: "Antes de entrar en tu panel, lee y acepta los términos del programa beta de artistas.",
    terms_accept: "He leído y acepto los términos del programa beta de artistas.",
    terms_required: "Tienes que aceptar los términos para continuar.",
    terms_submit: "Aceptar y continuar",
    cp_title: "Elige tu clave de artista",
    cp_intro: "Es tu primera vez. La clave que te llegó por email es temporal. Elige una nueva ahora.",
    cp_rule_len: "Al menos 10 caracteres",
    cp_rule_unique: "Distinta de la temporal que te llegó por email",
    cp_new: "Clave nueva",
    cp_new_ph: "Tu clave de artista",
    cp_new2: "Repite la clave",
    cp_new2_ph: "Escríbela otra vez",
    cp_submit: "Guardar y entrar",
    cp_short: "La clave debe tener al menos 10 caracteres.",
    cp_mismatch: "Las dos claves no coinciden.",
    cp_same: "Elige una clave distinta de la temporal.",
    cp_bad_current: "Sesión perdida. Vuelve a entrar.",
    cp_done: "Clave actualizada."
  }
};
const ta = (k) => (S[getLang()] || S.en)[k] || k;
export const isPanelRoute = () => new URLSearchParams(location.search).has("panel");
export function leavePanel() {
  if (!isPanelRoute())
    return false;
  history.pushState(null, "", location.pathname);
  const m = document.querySelector("main.edc-main");
  if (m)
    m.classList.remove("edc-main--wide");
  return true;
}
const KEY_STORE = "edc_panel_key";
try {
  localStorage.removeItem(KEY_STORE);
} catch {
}
const keyStore = {
  get() {
    try {
      return sessionStorage.getItem(KEY_STORE);
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      v ? sessionStorage.setItem(KEY_STORE, v) : sessionStorage.removeItem(KEY_STORE);
    } catch {
    }
  }
};
export function forgetPanelKey() {
  artistKey = null;
  rows = null;
  mustChange = false;
  termsOk = false;
  keyStore.set(null);
}
let artistKey = null;
let rows = null;
let mustChange = false;
let termsOk = false;
let dataReady = false;
async function ensureData() {
  if (!dataReady) {
    await loadData();
    dataReady = true;
  }
}
const rpcGroup = async (key) => {
  const { data: d, error } = await supabase.rpc("artist_group", { p_key: key });
  if (error)
    throw error;
  if (Array.isArray(d))
    return { must_change_password: false, players: d };
  return { must_change_password: !!d?.must_change_password, players: d?.players || [] };
};
const isUnauthorized = (e) => !!e && (e.code === "28000" || /unauthorized|no discord/i.test(e.message || ""));
export function renderArtistPanel(container, { session, profile, actions } = {}) {
  clear(container);
  const wrap = el("div", { class: "edc-apply" });
  container.append(wrap);
  const backBtn = () => el("button", { class: "edc-btn-link", onClick: actions.back }, ta("back"));
  const hasDiscord = !!(session?.user && profile?.hasDiscord);
  if (!hasDiscord)
    showConnect();
  else if (!rows && !mustChange && keyStore.get())
    resume(keyStore.get());
  else if (!rows && !mustChange)
    showKeyForm();
  else if (mustChange)
    showChangePassword();
  else
    gateTerms(showGallery);
  async function gateTerms(next) {
    if (termsOk)
      return next();
    try {
      const { data: data2, error } = await supabase.rpc("artist_terms_status", { p_key: artistKey });
      if (error)
        throw error;
      if (data2 === ARTIST_TERMS_VERSION) {
        termsOk = true;
        return next();
      }
      showTerms(next);
    } catch (e) {
      if (isUnauthorized(e))
        return showKeyForm(ta("bad_key"));
      termsOk = true;
      next();
    }
  }
  function showTerms(next, errMsg) {
    clear(wrap);
    const cb = el("input", { type: "checkbox", id: "edcPanelTerms" });
    const row = el("label", { class: "edc-terms-accept", for: "edcPanelTerms" }, cb, el("span", {}, ta("terms_accept")));
    const err = el("div", { class: "edc-banner-err" });
    err.hidden = !errMsg;
    err.textContent = errMsg || "";
    const btn = el("button", { class: "edc-btn edc-btn-primary" }, ta("terms_submit"));
    btn.addEventListener("click", async () => {
      if (!cb.checked) {
        row.classList.add("error");
        err.hidden = false;
        err.textContent = ta("terms_required");
        return;
      }
      btn.disabled = true;
      try {
        const { error } = await supabase.rpc("artist_accept_terms", { p_key: artistKey, p_version: ARTIST_TERMS_VERSION });
        if (error)
          throw error;
        termsOk = true;
        next();
      } catch (e) {
        btn.disabled = false;
        if (isUnauthorized(e))
          return showKeyForm(ta("bad_key"));
        showTerms(next, ta("err") + (e?.message || ""));
      }
    });
    wrap.append(el(
      "div",
      { class: "edc-card" },
      el("div", { class: "edc-section-title" }, ta("terms_title")),
      el("p", { class: "edc-apply-intro" }, ta("terms_intro")),
      el("div", { class: "edc-terms-box", tabindex: "0", html: artistTermsHtml(getLang()) }),
      row,
      err,
      el("div", { class: "edc-apply-actions" }, btn, backBtn())
    ));
  }
  function showConnect() {
    clear(wrap);
    const needsLink = !!session?.user;
    wrap.append(el(
      "div",
      { class: "edc-card" },
      el("div", { class: "edc-section-title" }, ta("title")),
      el("p", { class: "edc-apply-intro" }, ta("intro")),
      el("p", { class: "edc-apply-intro edc-apply-need" }, ta(needsLink ? "need_link" : "need_discord")),
      el(
        "div",
        { class: "edc-apply-actions" },
        el(
          "button",
          { class: "edc-btn edc-btn-discord", onClick: () => (needsLink ? actions.linkDiscord : actions.login)() },
          el("span", { html: actions.discordSvg ? actions.discordSvg() : "" }),
          ta(needsLink ? "link_discord" : "connect_discord")
        ),
        backBtn()
      )
    ));
  }
  async function resume(k) {
    clear(wrap);
    wrap.append(el("div", { class: "edc-card" }, el("p", { class: "edc-apply-intro" }, "…")));
    try {
      const group = await rpcGroup(k);
      artistKey = k;
      if (group.must_change_password) {
        mustChange = true;
        return showChangePassword();
      }
      await ensureData();
      rows = group.players;
      gateTerms(showGallery);
    } catch (e) {
      showKeyForm(isUnauthorized(e) ? ta("bad_key") : null);
    }
  }
  function showKeyForm(errMsg) {
    rows = null;
    artistKey = null;
    mustChange = false;
    termsOk = false;
    keyStore.set(null);
    clear(wrap);
    const input = el("input", { class: "edc-input", type: "password", placeholder: ta("key_ph"), autocomplete: "off" });
    const err = el("div", { class: "edc-banner-err" });
    err.hidden = !errMsg;
    err.textContent = errMsg || "";
    const btn = el("button", { class: "edc-btn edc-btn-primary" }, ta("enter"));
    const submit = async () => {
      const k = input.value.trim();
      if (!k)
        return;
      btn.disabled = true;
      try {
        const group = await rpcGroup(k);
        artistKey = k;
        keyStore.set(k);
        if (group.must_change_password) {
          mustChange = true;
          showChangePassword();
          return;
        }
        await ensureData();
        rows = group.players;
        mustChange = false;
        gateTerms(showGallery);
      } catch (e) {
        btn.disabled = false;
        showKeyForm(ta("bad_key"));
      }
    };
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        submit();
    });
    wrap.append(el(
      "div",
      { class: "edc-card" },
      el("div", { class: "edc-section-title" }, ta("title")),
      el("p", { class: "edc-apply-intro" }, ta("key_intro")),
      input,
      err,
      el("div", { class: "edc-apply-actions" }, btn, backBtn())
    ));
  }
  function showChangePassword(errMsg) {
    clear(wrap);
    const nw = el("input", { class: "edc-input", type: "password", placeholder: ta("cp_new_ph"), autocomplete: "new-password" });
    const nw2 = el("input", { class: "edc-input", type: "password", placeholder: ta("cp_new2_ph"), autocomplete: "new-password" });
    const err = el("div", { class: "edc-banner-err" });
    err.hidden = !errMsg;
    err.textContent = errMsg || "";
    const btn = el("button", { class: "edc-btn edc-btn-primary" }, ta("cp_submit"));
    const submit = async () => {
      const a = nw.value, b = nw2.value;
      if (!a || a.length < 10) {
        nw.classList.add("error");
        return showChangePassword(ta("cp_short"));
      }
      if (a !== b) {
        nw2.classList.add("error");
        return showChangePassword(ta("cp_mismatch"));
      }
      if (a === artistKey) {
        nw.classList.add("error");
        return showChangePassword(ta("cp_same"));
      }
      btn.disabled = true;
      try {
        const { error } = await supabase.rpc("artist_change_password", { p_current: artistKey, p_new: a });
        if (error)
          throw error;
        artistKey = a;
        keyStore.set(a);
        mustChange = false;
        await ensureData();
        const group = await rpcGroup(artistKey);
        rows = group.players;
        toast(ta("cp_done"), "ok");
        gateTerms(showGallery);
      } catch (e) {
        btn.disabled = false;
        showChangePassword(isUnauthorized(e) ? ta("cp_bad_current") : ta("err") + (e?.message || ""));
      }
    };
    btn.addEventListener("click", submit);
    nw2.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        submit();
    });
    wrap.append(el(
      "div",
      { class: "edc-card" },
      el("div", { class: "edc-section-title" }, ta("cp_title")),
      el("p", { class: "edc-apply-intro" }, ta("cp_intro")),
      el(
        "ul",
        { class: "edc-cp-rules" },
        el("li", {}, ta("cp_rule_len")),
        el("li", {}, ta("cp_rule_unique"))
      ),
      el("label", { class: "edc-label" }, ta("cp_new")),
      nw,
      el("label", { class: "edc-label" }, ta("cp_new2")),
      nw2,
      err,
      el("div", { class: "edc-apply-actions" }, btn, backBtn())
    ));
  }
  async function reload() {
    const g = await rpcGroup(artistKey);
    rows = g.players;
    mustChange = g.must_change_password;
  }
  function showGallery() {
    clear(wrap);
    setMainWide(false);
    wrap.append(el(
      "div",
      { class: "edc-admin-head" },
      el("div", { class: "edc-section-title" }, ta("title")),
      el(
        "div",
        { class: "edc-apply-actions" },
        el("button", { class: "edc-btn edc-btn-sm", onClick: async () => {
          try {
            await reload();
            showGallery();
          } catch (e) {
            if (isUnauthorized(e))
              showKeyForm(ta("bad_key"));
            else
              toast(ta("err") + (e?.message || ""), "err");
          }
        } }, ta("refresh")),
        el("button", { class: "edc-btn edc-btn-sm", onClick: () => showKeyForm() }, ta("change_key")),
        backBtn()
      )
    ));
    if (!rows.length) {
      wrap.append(el("p", { class: "edc-apply-intro" }, ta("empty")));
      return;
    }
    const grid = el("div", { class: "edc-panel-grid" });
    for (const p of rows)
      grid.append(renderPlayerCard(p));
    wrap.append(grid);
  }
  function renderPlayerCard(p) {
    const open = () => showDetail(p);
    const sheet = sheetView(p);
    const sp = speciesOf(sheet.species_key);
    const speciesLabel = `${ta(sp.species)} ${sp.male ? ta("boy") : ta("girl")}`;
    const handle = p.x_username ? "@" + p.x_username : p.discord_name || "";
    const body = el(
      "div",
      { class: "edc-panel-pcard-body" },
      el("div", { class: "edc-panel-pcard-alias" }, p.alias || ta("no_alias")),
      el("div", { class: "edc-panel-pcard-meta" }, speciesLabel),
      el(
        "div",
        { class: "edc-panel-pcard-contact" },
        el("span", { class: "edc-panel-pcard-dot", style: `background:${sheet.ink_hex}` }),
        el(
          "div",
          { class: "edc-panel-pcard-lines" },
          handle ? el("span", { class: "edc-panel-pcard-handle" }, handle) : null,
          p.discord_id ? el("span", { class: "edc-panel-pcard-did" }, p.discord_id) : null
        )
      )
    );
    return el(
      "div",
      { class: "edc-card edc-panel-pcard", onClick: open },
      renderBanner(p, { size: "card" }),
      body
    );
  }
  function showDetail(p) {
    clear(wrap);
    setMainWide(true);
    wrap.append(el(
      "div",
      { class: "edc-admin-head" },
      el("button", { class: "edc-btn edc-btn-sm", onClick: () => showGallery() }, ta("back_gallery")),
      el("div", { class: "edc-apply-actions" }, backBtn())
    ));
    wrap.append(el(
      "div",
      { class: "edc-pcard" },
      el(
        "div",
        { class: "edc-pcard-side" },
        renderSlot(p),
        el("p", { class: "edc-pcard-beta" }, ta("render_beta"))
      ),
      el(
        "div",
        { class: "edc-pcard-main" },
        el("div", { class: "edc-pcard-name" }, p.alias || ta("no_alias")),
        renderBanner(p, { size: "detail", interactive: true }),
        renderSheet(p)
      )
    ));
  }
}
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
    if (size === "card") {
      showPlaceholder();
      wrap.appendChild(ph);
      return wrap;
    }
    wrap.hidden = true;
    return wrap;
  }
  if (size === "card")
    wrap.appendChild(ph);
  if (interactive) {
    wrap.hidden = true;
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
        const bannerHref = getBannerUrl(player.banner_path, player.banner_sha256);
        if (bannerHref) {
          const a = document.createElement("a");
          a.href = bannerHref;
          a.download = `${player.alias || player.discord_name || "player"}_splattag.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      } catch {
      }
      dl.disabled = false;
    });
    overlay.appendChild(dl);
    wrap.appendChild(overlay);
  }
  loadBannerInto(wrap, ph, player, {
    onLoad: () => {
      wrap.hidden = false;
    },
    onFail: () => {
      if (size === "card")
        showPlaceholder();
    }
  });
  return wrap;
}
async function loadBannerInto(container, ph, player, cb = {}) {
  try {
    const bannerSrc = getBannerUrl(player.banner_path, player.banner_sha256);
    if (!bannerSrc) {
      cb.onFail?.();
      return;
    }
    const img = document.createElement("img");
    img.className = "edc-banner-img";
    img.alt = "";
    img.decoding = "async";
    img.onload = () => {
      if (!container.isConnected)
        return;
      if (ph.isConnected)
        ph.remove();
      container.prepend(img);
      cb.onLoad?.();
    };
    img.onerror = () => {
      cb.onFail?.();
    };
    img.src = bannerSrc;
  } catch {
    cb.onFail?.();
  }
}
function setMainWide(on) {
  const m = document.querySelector("main.edc-main");
  if (!m)
    return;
  m.classList.toggle("edc-main--wide", !!on);
  if (on)
    m.style.maxWidth = "1280px";
  else
    m.style.maxWidth = "";
  for (const a of m.querySelectorAll(".edc-apply")) {
    a.classList.toggle("edc-apply--wide", !!on);
    a.style.maxWidth = on ? "none" : "";
  }
}
function tag(k) {
  const S2 = { en: {
    download_banner: "Download banner",
    no_banner: "No Splashtag"
  }, es: {
    download_banner: "Descargar banner",
    no_banner: "Sin Splashtag"
  } };
  return (S2[getLang()] || S2.en)[k] || k;
}
function renderSlot(player, onLoaded) {
  const phIco = el("span", { class: "edc-pcard-render-ico", "aria-hidden": "true" });
  phIco.innerHTML = '<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><path d="M4 6h24v20H4V6zm2 2v14l6.5-5.5 5 4 6-6.5L28 18V8H6z" fill="currentColor"/></svg>';
  const ph = el(
    "div",
    { class: "edc-pcard-render-ph" },
    phIco,
    el("span", {}, ta(player?.has_variant ? "render_variant" : "render_soon"))
  );
  let png = null, spin = null;
  if (player?.has_variant && player.variant_render) {
    const base = player.variant_render.replace(/\.(png|webp)$/i, "");
    png = renderCandidates(base);
    spin = base + "_spin.webp";
  } else if (player?.user_id)
    ({ png, spin } = renderPaths(player.user_id, player.slot || 0));
  return createRenderSpin({
    placeholder: ph,
    pngUrl: png ? getRenderUrlFirst(png) : null,
    spinUrl: spin ? getRenderUrl(spin) : null,
    onLoaded
  });
}
const relRow = (e) => e ? e.__RowId : null;
export function sheetFromRaw(p) {
  const d = data();
  const sp = SPECIES[p.player_type] || SPECIES[0];
  const hair = getById(d.hair, p.hair);
  const brows = getById(d.eyebrows, p.eye_brows);
  const bot = getById(d.bottoms, p.bottom);
  const gear = (entry, namesFn, variation) => entry ? {
    img: `player/gear/${entry.__RowId}.png`,
    name: namesFn(entry),
    alt: !!(entry.VariationNum && Number(variation) === 1)
  } : null;
  const bv = Number(p.bottom_variation) || 0;
  return {
    species_key: sp.key,
    skin_img: `player/skin_color/${Math.max(0, Number(p.skin_tone) || 0)}.png`,
    eye_img: `player/eye_color/${Math.max(0, Number(p.eye_color) || 0)}.png`,
    ink_hex: colorToHex(p.color || { r: 1, g: 1, b: 1 }),
    hair_img: hair ? `player/hair/${relRow(hair)}.png` : null,
    brows_img: brows ? `player/eyebrow/${relRow(brows)}_${sp.male ? "M" : "F"}.png` : null,
    legs: bot ? {
      img: `player/pants/${bot.__RowId}.png`,
      img_var: bv > 0 ? `player/pants/${bot.__RowId}.${bv}.png` : null,
      img_local: bv > 0 ? `assets/pants/${bot.__RowId}.v${bv}.png` : null,
      variant: bv
    } : null,
    head: gear(getById(d.headgear, p.gear_head), headNames, p.gear_head_variation),
    cloth: gear(getById(d.clothes, p.gear_cloth), clothNames, p.gear_cloth_variation),
    shoes: gear(getById(d.shoes, p.gear_shoes), shoesNames, p.gear_shoes_variation)
  };
}
function sheetView(p) {
  if (p && p.sheet && typeof p.sheet === "object")
    return p.sheet;
  return sheetFromRaw(p || {});
}
const speciesOf = (key) => SPECIES.find((s) => s.key === key) || SPECIES[0];
const imgUrl = (rel) => !rel ? "" : rel.startsWith("assets/") ? `./${rel}` : `${IMG}/${rel}`;
function swatchWrap(imgNode) {
  return el("div", { class: "edc-pcard-swatch" }, imgNode);
}
function fieldRow(label, valueNode) {
  return el(
    "div",
    { class: "edc-pcard-field" },
    el("div", { class: "edc-pcard-field-label" }, label),
    valueNode
  );
}
function plainSwatchRow(src, alt) {
  return el("div", { class: "edc-pcard-field-value" }, swatchWrap(imgWithFallback(src, alt || "")));
}
function legsRow(legs) {
  const img = el("img", { alt: "", loading: "lazy" });
  const base = imgUrl(legs.img);
  if (legs.img_var) {
    img.src = imgUrl(legs.img_var);
    img.onerror = () => {
      img.onerror = () => {
        img.src = base;
      };
      img.src = legs.img_local ? imgUrl(legs.img_local) : base;
    };
  } else
    img.src = base;
  const v = Number(legs.variant) || 0;
  const label = v === 0 ? ta("base") : "V" + v;
  return el("div", { class: "edc-pcard-field-value" }, swatchWrap(img), el("span", {}, label));
}
function gearRow(g) {
  const pair = g?.name && Array.isArray(g.name) ? g.name : null;
  const alt = altName(pair);
  return el(
    "div",
    { class: "edc-pcard-field-value" },
    swatchWrap(imgWithFallback(g ? imgUrl(g.img) : "", pair ? curName(pair) : "")),
    el(
      "span",
      {},
      pair ? curName(pair) : "-",
      alt ? el("span", { class: "edc-pcard-name-alt" }, alt) : null
    ),
    g?.alt ? el("span", { class: "edc-pcard-alt" }, ta("alt")) : null
  );
}
function inkFormats(hex) {
  const c = /^#[0-9a-f]{6}$/i.test(hex || "") ? hexToColor(hex) : { r: 1, g: 1, b: 1 };
  const [r, g, b] = [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 255));
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    const [R, G, B] = [r / 255, g / 255, b / 255];
    h = max === R ? (G - B) / d % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h = Math.round(h * 60);
    if (h < 0)
      h += 360;
  }
  return [
    ["HEX", colorToHex(c).toUpperCase()],
    ["RGB", `rgb(${r}, ${g}, ${b})`],
    ["HSL", `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`]
  ];
}
function inkRow(inkHex) {
  const formats = inkFormats(inkHex);
  const hex = formats[0][1];
  const strip = el("div", { class: "edc-pcard-strip edc-pcard-ink-strip" });
  strip.dataset.expanded = "false";
  strip.append(el(
    "div",
    { class: "edc-pcard-ink-head" },
    el("div", { class: "edc-pcard-choice is-selected edc-pcard-ink-swatch", style: `background:${hex}`, title: hex }),
    el("span", { class: "edc-pcard-ink-hex" }, hex)
  ));
  for (const [fmt, val] of formats) {
    const btn = el("button", { class: "edc-pcard-ink-copy", type: "button", title: ta("ink_copy") + " " + fmt }, ta("ink_copy"));
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(val);
        toast(ta("ink_copied") + val, "ok");
      } catch {
      }
    });
    strip.append(el(
      "div",
      { class: "edc-pcard-ink-fmt" },
      el("span", { class: "edc-pcard-ink-k" }, fmt),
      el("code", { class: "edc-pcard-ink-v" }, val),
      btn
    ));
  }
  const toggle = el("button", { class: "edc-pcard-strip-toggle", type: "button", title: ta("show_formats") }, "+");
  toggle.setAttribute("aria-label", ta("show_formats"));
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = strip.dataset.expanded !== "true";
    closeAllChoiceStrips(willOpen ? strip : null);
    strip.dataset.expanded = willOpen ? "true" : "false";
    toggle.textContent = willOpen ? "−" : "+";
    toggle.title = ta(willOpen ? "show_selected" : "show_formats");
  });
  ensureStripOutsideCloser();
  return el("div", { class: "edc-pcard-field-value edc-pcard-choice-value" }, strip, toggle);
}
function choiceStrip(options, selectedIdx, opts = {}) {
  const strip = el("div", { class: "edc-pcard-strip" });
  strip.dataset.expanded = "false";
  const items = [];
  options.forEach((o, i) => {
    const w = el(
      "div",
      { class: "edc-pcard-choice" + (i === selectedIdx ? " is-selected" : "") },
      imgWithFallback(o.src, o.alt || "")
    );
    if (o.title)
      w.title = o.title;
    items.push(w);
  });
  if (selectedIdx >= 0 && selectedIdx < items.length) {
    strip.append(items[selectedIdx]);
    items.forEach((it, i) => {
      if (i !== selectedIdx)
        strip.append(it);
    });
  } else
    items.forEach((it) => strip.append(it));
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
function closeAllChoiceStrips(except) {
  document.querySelectorAll('.edc-pcard-strip[data-expanded="true"]').forEach((s) => {
    if (s === except)
      return;
    s.dataset.expanded = "false";
    const t = s.parentElement && s.parentElement.querySelector(".edc-pcard-strip-toggle");
    if (t) {
      t.textContent = "+";
    }
  });
}
let _stripCloserBound = false;
function ensureStripOutsideCloser() {
  if (_stripCloserBound)
    return;
  _stripCloserBound = true;
  document.addEventListener("click", (e) => {
    if (e.target.closest(".edc-pcard-strip") || e.target.closest(".edc-pcard-strip-toggle"))
      return;
    closeAllChoiceStrips(null);
  });
}
function renderSheet(p) {
  const s = sheetView(p);
  const sp = speciesOf(s.species_key);
  const brows = eyebrowsFor(sp.idx);
  const speciesValue = el(
    "div",
    { class: "edc-pcard-field-value" },
    swatchWrap(imgWithFallback(imgUrl(`player/playertype/${sp.key}.png`), "")),
    el("span", {}, `${ta(sp.species)} · ${sp.male ? ta("boy") : ta("girl")}`)
  );
  const pick = (opts, rel) => opts.findIndex((o) => o.rel === rel);
  const skinOpts = Array.from({ length: SKIN_TONES }, (_, i) => ({ rel: `player/skin_color/${i}.png`, src: imgUrl(`player/skin_color/${i}.png`), title: `${i + 1}/${SKIN_TONES}` }));
  const eyeOpts = Array.from({ length: EYE_COLORS }, (_, i) => ({ rel: `player/eye_color/${i}.png`, src: imgUrl(`player/eye_color/${i}.png`), title: `${i + 1}/${EYE_COLORS}` }));
  const browOpts = brows.map((e) => {
    const rel = `player/eyebrow/${e.__RowId}_${sp.male ? "M" : "F"}.png`;
    return { rel, src: imgUrl(rel) };
  });
  const sheet = el("div", { class: "edc-pcard-sheet" });
  sheet.append(
    fieldRow(ta("f_species"), speciesValue),
    fieldRow(ta("f_skin"), choiceStrip(skinOpts, pick(skinOpts, s.skin_img))),
    fieldRow(ta("f_eye"), choiceStrip(eyeOpts, pick(eyeOpts, s.eye_img))),
    fieldRow(ta("f_ink"), inkRow(s.ink_hex)),
    fieldRow(ta("f_hair"), plainSwatchRow(imgUrl(s.hair_img))),
    fieldRow(ta("f_brows"), browOpts.length ? choiceStrip(browOpts, pick(browOpts, s.brows_img)) : plainSwatchRow(imgUrl(s.brows_img))),
    fieldRow(ta("f_legs"), s.legs ? legsRow(s.legs) : plainSwatchRow("")),
    el("div", { class: "edc-pcard-section-sep" }, ta("g_gear")),
    fieldRow(ta("f_head"), gearRow(s.head)),
    fieldRow(ta("f_cloth"), gearRow(s.cloth)),
    fieldRow(ta("f_shoes"), gearRow(s.shoes))
  );
  return sheet;
}
export { ensureData, renderSlot, renderBanner, renderSheet, setMainWide };
