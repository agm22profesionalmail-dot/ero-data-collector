// Orquestador de la SPA
import { artistTermsHtml } from "./artist_terms.js";
import { DEFAULT_PLAYER, SPECIES, X_LOGIN_ENABLED } from "./config.js";
import { t, getLang, setLang, onLangChange } from "./i18n.js";
import { isConfigured } from "./supabase.js";
import {
  signInWithDiscord, signInWithX, linkX, linkDiscord, unlinkX, refreshSessionUser,
  signOut, getSession, onAuthChange, identityProfile, consumeAuthError,
} from "./auth.js";
import { loadData, colorToHex, data, getById, headNames, clothNames, shoesNames, curName } from "./data.js";
import { renderConfigurator, ensureValid } from "./configurator.js";
import { renderBanner } from "./banner.js";
import { loadPlayer, savePlayer, getBannerSignedUrl, syncIdentityFields } from "./store.js";
import { el, clear, toast } from "./ui.js";
import {
  captureRefFromUrl, resolveRefArtist, needsRefConsent, renderRefConsent, clearRef,
  isApplyRoute, goApply, goHome, restoreApplyRoute, renderArtistApply, saveArtistVariant,
  loadLinkedArtists, linkArtist,
} from "./artists.js";
import { isAdminRoute, renderAdminPanel, leaveAdmin } from "./admin.js";
import { isPanelRoute, renderArtistPanel, leavePanel } from "./artist_panel.js";

const $ = (id) => document.getElementById(id);
const appEl = () => $("app");

let session = null;
let dataReady = false;
let state = null;        // ficha en edición
let profile = null;
let hasRecord = false;   // ¿el usuario ya tenía ficha guardada?
let mode = "edit";        // "preview" | "edit"
let refArtist = null;     // artista del enlace ?ref resuelto ({id, name}) o null

// ── i18n estático ─────────────────────────────────────────────────────
function applyStaticI18n() {
  document.documentElement.lang = getLang();
  $("appSub").textContent = t("app_sub");
  renderFooter();
  renderFloatbar();
  for (const b of $("langSwitch").querySelectorAll("button"))
    b.classList.toggle("active", b.dataset.lang === getLang());
  const btnPanel = $("btnPanel"); if (btnPanel) btnPanel.textContent = t("nav_panel");
  const btnApply = $("btnApply"); if (btnApply) btnApply.textContent = t("nav_apply");
  const skip = $("skipLink"); if (skip) skip.textContent = t("skip_link");
  renderAuthArea();
}

function renderAuthArea() {
  const area = $("authArea");
  clear(area);
  if (session?.user) {
    const p = identityProfile(session.user);
    const chip = el("div", { class: "edc-user-chip" });
    if (p.display_avatar) chip.append(el("img", { src: p.display_avatar, alt: "" }));
    chip.append(el("span", {}, p.display_name));
    if (X_LOGIN_ENABLED) {
      if (p.hasX) {
        chip.append(el("span", { class: "edc-x-handle", title: t("linked_as") + " @" + (p.x_username || "?") },
          el("span", { class: "edc-x-mini", html: xSvg(12) }), "@" + (p.x_username || "?")));
        // Supabase no permite dejar al usuario sin identidades: solo con ≥2
        if (p.providers.length >= 2)
          chip.append(el("button", { class: "edc-btn edc-btn-sm", onClick: doUnlinkX }, t("unlink_x")));
      } else {
        chip.append(el("button", { class: "edc-btn edc-btn-sm edc-btn-x-sm", onClick: () => doLink("x") },
          el("span", { class: "edc-x-mini", html: xSvg(12) }), t("link_x")));
      }
      if (!p.hasDiscord)
        chip.append(el("button", { class: "edc-btn edc-btn-sm", onClick: () => doLink("discord") }, t("link_discord")));
    }
    chip.append(el("button", { class: "edc-btn edc-btn-sm", onClick: async () => { await signOut(); } }, t("logout")));
    area.append(chip);
  }
}

// ── Vinculación de identidades (solo con X_LOGIN_ENABLED) ────────────
// Antes de linkIdentity se guarda en sessionStorage {provider, ts, n} (n = nº de
// identidades actual). Al volver del OAuth se comprueba, con caducidad de 10 min,
// si la identidad ya cuelga del usuario y se refresca la ficha.
const LINK_KEY = "edc_link_pending";
const LINK_TTL_MS = 10 * 60 * 1000;

async function doLink(provider) {
  try {
    const n = (session?.user?.identities || []).length;
    sessionStorage.setItem(LINK_KEY, JSON.stringify({ provider, ts: Date.now(), n }));
    if (provider === "x") await linkX(); else await linkDiscord();
  } catch (e) {
    sessionStorage.removeItem(LINK_KEY);
    toast(t("link_err") + t("link_err_generic"), "err");
    console.warn("linkIdentity:", e);
  }
}

// Sesión refrescada del servidor (identities al día, persistida) y perfil recalculado
async function reloadSessionProfile() {
  const s = await refreshSessionUser();
  if (s?.user) session = s;
  profile = identityProfile(session.user);
}

async function doUnlinkX() {
  try {
    const done = await unlinkX();
    if (!done) { toast(t("unlink_x_err_last"), "err"); return; }
    await reloadSessionProfile();
    await syncIdentityFields(session.user, profile);
    toast(t("unlinked_x"), "ok");
    renderAuthArea();
  } catch (e) {
    toast(t("link_err") + t("link_err_generic"), "err");
    console.warn("unlinkIdentity:", e);
  }
}

function readPendingLink() {
  const raw = sessionStorage.getItem(LINK_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(LINK_KEY);
  try {
    const p = JSON.parse(raw);
    if (!p?.provider || !p.ts || Date.now() - p.ts > LINK_TTL_MS) return null; // caducado
    return p;
  } catch { return null; }
}

// Al cargar la web: gestiona la vuelta de un OAuth de vinculación (éxito o error en la URL)
async function finishPendingLink() {
  const pending = readPendingLink();
  const err = consumeAuthError();
  if (err) { toast(describeAuthError(err), "err"); return; }
  if (!pending || !session?.user) return;
  try {
    await reloadSessionProfile();
    const linked = pending.provider === "x" ? profile.hasX : profile.hasDiscord;
    const nNow = (session.user.identities || []).length;
    // Sin error en la URL y sin identidad nueva: el usuario canceló o volvió
    // sin completar el OAuth → no se avisa de nada.
    if (!linked || nNow === pending.n) { renderAuthArea(); return; }
    await syncIdentityFields(session.user, profile);
    const who = pending.provider === "x" ? "@" + (profile.x_username || "?") : (profile.discord_name || "Discord");
    toast(t("linked_as") + " " + who, "ok");
    renderAuthArea();
  } catch (e) {
    toast(t("link_err") + t("link_err_generic"), "err");
    console.warn("finishPendingLink:", e);
  }
}

// Solo códigos conocidos tienen mensaje propio; el resto, genérico (nunca se
// muestra error_description en crudo).
function describeAuthError(err) {
  const code = (err.code || "").toLowerCase();
  const kind = (err.error || "").toLowerCase();
  if (code === "identity_already_exists") return t("link_err_in_use");
  if (code === "manual_linking_disabled") return t("link_err") + t("link_err_disabled");
  if (code === "access_denied" || kind === "access_denied") return t("link_err") + t("link_err_cancelled");
  console.warn("auth error:", err);
  return t("link_err") + t("link_err_generic");
}

function renderFooter() {
  const f = $("footer");
  clear(f);
  f.append(el("div", { class: "edc-footer-row" },
    el("span", {}, t("footer")),
    // Enlace discreto a la solicitud de acceso de artista (?apply)
    !isApplyRoute() && el("button", { class: "edc-footer-link", onClick: openApply }, t("footer_artist")),
  ));
  f.append(el("div", { class: "edc-legal-line" }, t("legal_disclaimer")));

  // Aviso legal y privacidad (colapsable)
  const d = el("details", { class: "edc-legal" });
  d.append(el("summary", {}, t("legal_title")));
  d.append(el("div", { class: "edc-help-body", html: legalHtml(getLang()) }));
  f.append(d);

  // Términos del programa beta de artistas: públicos para cualquiera, no solo
  // en el formulario de solicitud.
  const at = el("details", { class: "edc-legal", id: "artist-terms" });
  at.append(el("summary", {}, t("artist_terms_title")));
  at.append(el("div", { class: "edc-help-body", html: artistTermsHtml(getLang()) }));
  f.append(at);

  // Preguntas frecuentes (colapsable, mismo estilo que el aviso legal)
  const faqItems = [
    ["lp_faq_1_q",  "lp_faq_1_a"],
    ["lp_faq_2_q",  "lp_faq_2_a"],
    ["lp_faq_3_q",  "lp_faq_3_a"],
    ["lp_faq_4_q",  "lp_faq_4_a"],
    ["lp_faq_5_q",  "lp_faq_5_a"],
    ["lp_faq_6_q",  "lp_faq_6_a"],
    ["lp_faq_7_q",  "lp_faq_7_a"],
    ["lp_faq_8_q",  "lp_faq_8_a"],
    ["lp_faq_9_q",  "lp_faq_9_a"],
    ["lp_faq_10_q", "lp_faq_10_a"],
  ];
  const faqDetails = el("details", { class: "edc-legal" });
  faqDetails.append(el("summary", {}, t("lp_faq_title")));
  const faqBody = el("div", { class: "edc-help-body" });
  for (const [qk, ak] of faqItems) {
    faqBody.append(el("h4", {}, t(qk)));
    faqBody.append(el("p", {}, t(ak)));
  }
  faqDetails.append(faqBody);
  f.append(faqDetails);
}

// Par de botones flotantes de comunidad (Discord + Ko-fi). Colapsados muestran
// solo el icono y se expanden con el texto al pasar el ratón, como el widget de
// Ko-fi. Viven en un contenedor position:fixed propio, fuera de .edc-bg-decor.
function renderFloatbar() {
  const bar = $("floatbar");
  if (!bar) return;
  clear(bar);
  bar.append(
    el("a", {
      class: "edc-float-btn edc-float-discord",
      href: "https://discord.gg/Hckay4PGNR",
      target: "_blank", rel: "noopener noreferrer",
      "aria-label": t("join_discord"),
    }, el("span", { class: "edc-float-ico", html: discordSvg(18) }),
       el("span", { class: "edc-float-label" }, t("join_discord"))),
    el("a", {
      class: "edc-float-btn edc-float-kofi",
      href: "https://ko-fi.com/Q2Z422804H",
      target: "_blank", rel: "noopener noreferrer",
      "aria-label": t("kofi_btn"),
    }, el("span", { class: "edc-float-ico", html: kofiSvg(18) }),
       el("span", { class: "edc-float-label" }, t("kofi_btn"))),
  );
}

// Logo oficial de Ko-fi (marca Ko-fi). Relleno blanco para contrastar sobre el
// fondo del botón.
function kofiSvg(size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298"/></svg>`;
}

// ── Vistas ────────────────────────────────────────────────────────────
function renderLogin() {
  clear(appEl());
  const hero = el("section", { class: "edc-hero" },
    el("div", { class: "edc-hero-inner" },
      el("div", { class: "edc-hero-copy" },
        el("h2", { class: "edc-hero-title" }, t("login_title")),
        el("p", { class: "edc-hero-desc" }, t(X_LOGIN_ENABLED ? "login_desc_x" : "login_desc")),
        el("div", { class: "edc-hero-ctas" },
          el("button", { class: "edc-btn edc-btn-discord edc-hero-cta", onClick: doLogin },
            el("span", { html: discordSvg() }), t("login_btn")),
          X_LOGIN_ENABLED && el("button", { class: "edc-btn edc-btn-x edc-hero-cta", onClick: doLoginX },
            el("span", { html: xSvg(18) }), t("login_btn_x")),
        ),
        X_LOGIN_ENABLED && el("p", { class: "edc-login-note" }, t("login_dup_note")),
        el("p", { class: "edc-privacy" }, t(X_LOGIN_ENABLED ? "login_privacy_x" : "login_privacy")),
      ),
      el("div", { class: "edc-hero-art", "aria-hidden": "true" },
        el("span", { class: "edc-hero-splat" }),
        el("img", { class: "edc-hero-char", src: "assets/hero/hero-trio.webp", alt: "", loading: "eager" }),
      ),
    ),
  );
  appEl().append(hero);
}

async function doLogin() {
  try { await signInWithDiscord(); }
  catch (e) { toast(t("save_err") + e.message, "err"); }
}

async function doLoginX() {
  try { await signInWithX(); }
  catch (e) { toast(t("save_err") + e.message, "err"); }
}

async function renderApp() {
  clear(appEl());
  const loading = el("div", { class: "edc-loading" }, el("div", { class: "edc-inkloader" }), el("div", {}, t("loading_data")));
  appEl().append(loading);

  try {
    if (!dataReady) { await loadData(); dataReady = true; }
    profile = identityProfile(session.user);
    if (state === null) {
      const row = await loadPlayer(session.user.id);
      hasRecord = !!row;
      state = stateFromRow(row);
      state._userId = session.user.id; // clave de persistencia del generador de splattag
      // Alias por defecto: nombre de Discord; si no hay, nombre o @handle de X
      const defaultAlias = profile?.discord_name || profile?.x_name || profile?.x_username || "";
      if (!state.alias && defaultAlias) state.alias = defaultAlias;
      ensureValid(state);
      if (state.banner_path) state.banner_signed_url = await getBannerSignedUrl(state.banner_path);
      // Enlace de artista (?ref): se resuelve una vez (cacheado). Si hay
      // consentimiento pendiente se entra directo al editor para que lo vea.
      refArtist = await resolveRefArtist();
      // Artistas con los que ya está (puede ser más de uno)
      state._linkedArtists = hasRecord && refArtist ? await loadLinkedArtists() : [];
      // Usuario ya registrado con enlace de artista: muestra pantalla de elección
      if (hasRecord && refArtist) mode = "artist_choice";
      else mode = hasRecord && !needsRefConsent(refArtist, state) ? "preview" : "edit";
    }
  } catch (e) {
    clear(appEl());
    appEl().append(el("div", { class: "edc-loading" }, el("div", {}, t("loading_err")), el("div", { class: "edc-label" }, e.message)));
    return;
  }
  renderModeView();
}

function renderModeView() {
  if (mode === "preview") renderPreviewScreen();
  else if (mode === "artist_choice") renderArtistChoiceScreen();
  else if (mode === "artist_custom") renderEditor();   // editor pre-cargado para variante
  else renderEditor();
}

// ── Pantalla de elección: usuario registrado + enlace de artista ─────
function withName(key, name) {
  return t(key).replace(/\{name\}/g, name);
}

function renderArtistChoiceScreen() {
  clear(appEl());
  const name = refArtist.name;

  const card = el("div", { class: "edc-card" });
  card.append(el("div", { class: "edc-section-title" }, withName(t("artist_choice_title"), name)));
  card.append(el("p", { class: "edc-apply-intro" }, withName(t("artist_choice_intro"), name)));

  const errBox = el("div", { class: "edc-banner-err", hidden: "" });

  // Opción A — compartir personaje guardado
  const consentInput = el("input", { type: "checkbox" });
  const consentLabel = el("label", { class: "edc-check" }, consentInput,
    el("span", {}, withName(t("ref_consent"), name)));
  const shareBtn = el("button", { class: "edc-btn edc-btn-primary" },
    t("artist_choice_share"));
  shareBtn.addEventListener("click", async () => {
    if (!consentInput.checked) {
      errBox.textContent = withName(t("ref_intro").replace("You're signing up through {name}.", "").trim(), name) ||
        "Mark the consent checkbox first.";
      errBox.hidden = false;
      return;
    }
    shareBtn.disabled = true;
    errBox.hidden = true;
    try {
      const ov = renderSubmitOverlay();
      await ov.phase(t("artist_choice_confirming"), 50, 300);
      await linkArtist(refArtist.id, state);
      await ov.phase(withName(t("artist_choice_shared"), name), 100, 700);
      ov.close();
      clearRef();
      state._refConsent = false;
      toast(withName(t("artist_choice_shared"), name), "ok");
      mode = "preview";
      renderModeView();
    } catch (e) {
      shareBtn.disabled = false;
      errBox.textContent = t("save_err") + e.message;
      errBox.hidden = false;
    }
  });

  // Ya asociado a ESTE artista: no se vuelve a pedir (sí puede crear variante)
  const optA = needsRefConsent(refArtist, state)
    ? el("div", { class: "edc-ref-card edc-card" },
        el("div", { class: "edc-ref-kicker" }, t("artist_choice_share")),
        el("p", { class: "edc-ref-note" }, withName(t("artist_choice_share_note"), name)),
        consentLabel,
        el("div", { class: "edc-apply-actions" }, shareBtn))
    : el("div", { class: "edc-ref-card edc-card" },
        el("p", { class: "edc-ref-note" }, withName(t("artist_choice_already"), name)));

  // Opción B — crear variante para este artista
  const customBtn = el("button", { class: "edc-btn edc-btn-sm" },
    withName(t("artist_choice_custom"), name));
  customBtn.addEventListener("click", () => {
    state._artistVariantFor = refArtist.id;
    mode = "artist_custom";
    renderModeView();
  });
  const optB = el("div", { class: "edc-ref-card edc-card" },
    el("div", { class: "edc-ref-kicker" }, withName(t("artist_choice_custom"), name)),
    el("p", { class: "edc-ref-note" }, withName(t("artist_choice_custom_note"), name)),
    el("div", { class: "edc-apply-actions" }, customBtn));

  const skipBtn = el("button", { class: "edc-btn-link" }, t("artist_choice_skip"));
  skipBtn.addEventListener("click", () => { clearRef(); mode = "preview"; renderModeView(); });

  card.append(optA, optB, errBox, skipBtn);
  appEl().append(card);
}

// Pantalla de bienvenida para quien ya tiene ficha: preview de 1 línea + Editar
function renderPreviewScreen() {
  clear(appEl());
  const card = el("div", { class: "edc-card" });
  card.append(el("div", { class: "edc-section-title" }, t("saved_title")));
  if (state.banner_signed_url) card.append(el("img", { class: "edc-preview-banner", src: state.banner_signed_url, alt: "banner" }));
  card.append(summaryRow());
  card.append(el("div", { class: "edc-save-bar" },
    el("button", { class: "edc-btn edc-btn-primary", onClick: () => { mode = "edit"; renderModeView(); } }, t("edit_player"))));
  appEl().append(card);

  const help = el("div");
  appEl().append(help);
  renderHelp(help);
}

// Resumen de 1 línea con las opciones seleccionadas
// Chip de gear de la vista previa: nombre oficial en el idioma de la web; el
// del otro idioma va en el tooltip.
function gearBadge(icon, pair) {
  return el("span", { class: "edc-preview-badge", title: pair ? pair.join(" / ") : "" },
    el("span", { class: "edc-badge-ico", html: preIcon(icon) }), " " + (pair ? curName(pair) : "—"));
}

function summaryRow() {
  const sp = SPECIES[state.player_type] || SPECIES[0];
  const d = data();
  const head = getById(d.headgear, state.gear_head);
  const cloth = getById(d.clothes, state.gear_cloth);
  const shoes = getById(d.shoes, state.gear_shoes);
  return el("div", { class: "edc-preview" },
    el("div", { class: "edc-color-preview", style: `background:${colorToHex(state.color)}` }),
    el("strong", {}, state.alias || t("your_char")),
    el("span", { class: "edc-preview-badge" }, `${t(sp.species)} · ${sp.male ? t("boy") : t("girl")}`),
    gearBadge("head", head ? headNames(head) : null),
    gearBadge("cloth", cloth ? clothNames(cloth) : null),
    gearBadge("shoes", shoes ? shoesNames(shoes) : null),
    el("span", { class: "edc-preview-badge" },
      el("span", { class: "edc-badge-ico", html: preIcon("banner") }), " ",
      el("span", { class: "edc-badge-ico", html: preIcon((state.banner_signed_url || state.bannerFile) ? "ok" : "none") })),
  );
}

// ¿Habrá banner adjunto? (banner guardado, ya capturado, o generador activo que se capturará al guardar)
function willHaveBanner() {
  return !!(state.bannerFile || state.banner_signed_url || state._captureSplattag);
}

// Editor completo (configurador + banner + guardar/actualizar)
function renderEditor() {
  clear(appEl());

  // Entró con X, sin ficha previa y sin Discord vinculado: puede que ya tenga
  // ficha con Discord (otro usuario de Supabase). Aviso para evitar duplicados.
  if (X_LOGIN_ENABLED && !hasRecord && profile?.hasX && !profile?.hasDiscord)
    appEl().append(el("div", { class: "edc-card edc-notice" }, t("editor_dup_note")));

  // Modo variante de artista: banner de contexto + botón volver
  if (mode === "artist_custom" && refArtist) {
    const banner = el("div", { class: "edc-card edc-ref-card" },
      el("div", { class: "edc-ref-kicker" }, withName(t("artist_choice_custom"), refArtist.name)),
      el("p", { class: "edc-ref-note" }, withName(t("artist_choice_custom_note"), refArtist.name)),
      el("button", { class: "edc-btn-link", onClick: () => { mode = "artist_choice"; renderModeView(); } },
        t("artist_choice_back")));
    appEl().append(banner);
  }

  // Llegó por el enlace de un artista (?ref) y aún no está asociado:
  // consentimiento explícito (RGPD). El check se aplica al guardar.
  if (needsRefConsent(refArtist, state)) {
    const ref = el("div");
    appEl().append(ref);
    renderRefConsent(ref, refArtist, state);
  }

  const preview = el("div", { class: "edc-card edc-preview" });
  appEl().append(preview);
  updatePreview(preview);

  const cfg = el("div");
  appEl().append(cfg);
  renderConfigurator(cfg, state, () => updatePreview(preview));

  const bnr = el("div");
  appEl().append(bnr);
  renderBanner(bnr, state, () => updatePreview(preview));

  const help = el("div");
  appEl().append(help);
  renderHelp(help);

  const status = el("span", { class: "edc-save-status" });
  const saveBtnLabel = mode === "artist_custom" && refArtist
    ? withName(t("artist_choice_custom_save"), refArtist.name)
    : hasRecord ? t("update_player") : t("save");
  const saveBtn = el("button", { class: "edc-btn edc-btn-primary", onClick: () => doSave(saveBtn, status) },
    saveBtnLabel);
  const bar = el("div", { class: "edc-card", style: "padding:0" }, el("div", { class: "edc-save-bar" }, saveBtn, status));
  appEl().append(bar);
}

function updatePreview(node) {
  clear(node);
  const sp = SPECIES[state.player_type] || SPECIES[0];
  node.append(
    el("div", { class: "edc-color-preview", style: `background:${colorToHex(state.color)}` }),
    el("strong", {}, state.alias || t("your_char")),
    el("span", { class: "edc-preview-badge" }, `${t(sp.species)} · ${sp.male ? t("boy") : t("girl")}`),
    el("span", { class: "edc-preview-badge" },
      el("span", { class: "edc-badge-ico", html: preIcon("banner") }), " ",
      el("span", { class: "edc-badge-ico", html: preIcon(willHaveBanner() ? "ok" : "none") })),
  );
}

// Frases del envío por fase, distintas para alta nueva (new) y actualización
// (upd); se elige una al azar de cada grupo en cada guardado, para variar.
const SUBMIT_PHRASES = {
  es: {
    pack: { new: ["Empaquetando personaje…", "Empaquetando características…", "Preparando tu ficha…"],
            upd: ["Empaquetando nuevo personaje…", "Recogiendo tus cambios…", "Empaquetando características…"] },
    send: { new: ["Registrando personaje…", "Dando de alta tu ficha…", "Reservando tu plaza…"],
            upd: ["Actualizando información…", "Sincronizando tus cambios…", "Actualizando tu ficha…"] },
    reg:  { new: ["Sellando el registro…", "Guardando en el servidor…"],
            upd: ["Aplicando la actualización…", "Guardando los cambios…"] },
    done: { new: ["¡Personaje registrado!"], upd: ["¡Información actualizada!"] },
  },
  en: {
    pack: { new: ["Packing your character…", "Bundling traits…", "Preparing your sheet…"],
            upd: ["Packing your new character…", "Gathering your changes…", "Bundling traits…"] },
    send: { new: ["Registering character…", "Signing up your sheet…", "Saving your spot…"],
            upd: ["Updating your info…", "Syncing your changes…", "Updating your sheet…"] },
    reg:  { new: ["Sealing the record…", "Saving to the server…"],
            upd: ["Applying the update…", "Saving your changes…"] },
    done: { new: ["Character registered!"], upd: ["Info updated!"] },
  },
};
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
function submitPhrases(isUpdate) {
  const L = SUBMIT_PHRASES[getLang()] || SUBMIT_PHRASES.en;
  const k = isUpdate ? "upd" : "new";
  return { pack: pickOne(L.pack[k]), send: pickOne(L.send[k]), reg: pickOne(L.reg[k]), done: pickOne(L.done[k]) };
}

// Overlay de envío: loader de tinta + barra de progreso + texto por fases.
// Cada fase se corresponde con un paso REAL del guardado; el pequeño margen
// entre fases es solo para que el texto sea legible (no falsea el resultado).
function renderSubmitOverlay() {
  const bar = el("div", { class: "edc-progress-bar" });
  const label = el("div", { class: "edc-submit-label" }, "…");
  const overlay = el("div", { class: "edc-submit-overlay", role: "status", "aria-live": "polite" },
    el("div", { class: "edc-submit-card" },
      el("div", { class: "edc-inkloader" }),
      label,
      el("div", { class: "edc-progress" }, bar)));
  document.body.append(overlay);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    async phase(text, pct, dwell = 440) { label.textContent = text; bar.style.width = pct + "%"; await wait(dwell); },
    close() { overlay.remove(); },
  };
}

async function doSave(btn, status) {
  if (!state.alias || !state.alias.trim()) {
    state._aliasError = true; renderEditor();
    toast(t("alias_required"), "err");
    return;
  }
  // Guard anti-doble-click: si ya está guardando, ignora.
  if (btn.disabled) return;
  btn.disabled = true; status.className = "edc-save-status"; status.textContent = t("saving");
  const isUpdate = hasRecord;            // ¿ya tenía ficha? decide el juego de frases
  // Modo variante de artista: guardar en player_artist_chars, no en players
  if (mode === "artist_custom" && state._artistVariantFor) {
    const artistId = state._artistVariantFor;
    // artist_save_char asocia al jugador con este artista: sin la casilla
    // marcada no se envía nada (consentimiento explícito, RGPD).
    if (needsRefConsent(refArtist, state) && state._refConsent !== true) {
      const msg = t("ref_consent_required").replace("{name}", refArtist.name);
      status.className = "edc-save-status err"; status.textContent = msg;
      toast(msg, "err");
      btn.disabled = false;
      return;
    }
    const artName = refArtist?.name || "";
    const P = submitPhrases(false);
    const ov = renderSubmitOverlay();
    try {
      await ov.phase(P.send, 60);
      await saveArtistVariant(artistId, state);
      await ov.phase(withName(t("artist_choice_custom_saved"), artName), 100, 700);
      ov.close();
      delete state._artistVariantFor;
      clearRef();
      toast(withName(t("artist_choice_custom_saved"), artName), "ok");
      mode = "preview";
      renderModeView();
    } catch (e) {
      ov.close();
      status.className = "edc-save-status err"; status.textContent = t("save_err") + e.message;
      toast(t("save_err") + e.message, "err");
      btn.disabled = false;
    }
    return;
  }

  // Enlace de artista: solo se asocia si el usuario marcó el consentimiento
  // (tras guardar la ficha, por RPC; no quita a otros artistas).
  const consenting = needsRefConsent(refArtist, state) && state._refConsent === true;
  const P = submitPhrases(isUpdate);
  const ov = renderSubmitOverlay();
  try {
    // Genera y adjunta la splattag del canvas automáticamente (sin descargas ni subidas).
    // Solo cuando hace falta: primera ficha, el usuario tocó el generador, o su config está cargada.
    if (state._captureSplattag && (!state.banner_path || state._splattagDirty || state._splattagPersisted)) {
      await ov.phase(P.pack, 28);
      try {
        // Timeout defensivo (12s) por si _captureSplattag cuelga en algún browser.
        // Sin esto, un canvas.toBlob que no dispara callback bloqueaba todo el save.
        state.bannerFile = await Promise.race([
          state._captureSplattag(),
          new Promise((_, rej) => setTimeout(() => rej(new Error("splattag capture timeout")), 12000)),
        ]);
      } catch (e) { console.warn("No se pudo generar la splattag:", e); }
    }
    await ov.phase(P.send, 62);
    await savePlayer(state, session.user, profile);
    if (consenting) await linkArtist(refArtist.id, state);
    await ov.phase(P.reg, 88);
    if (state.banner_path) state.banner_signed_url = await getBannerSignedUrl(state.banner_path);
    hasRecord = true;
    await ov.phase(P.done, 100, 620);
    ov.close();
    if (consenting) {
      // Asociación guardada: el ref ya no hace falta en esta pestaña
      clearRef();
      state._refConsent = false;
      toast(t("saved") + " " + t("ref_saved").replace("{name}", refArtist.name), "ok");
    } else {
      toast(t("saved"), "ok");
    }
    mode = "preview";
    renderModeView();
  } catch (e) {
    ov.close();
    status.className = "edc-save-status err"; status.textContent = t("save_err") + e.message;
    toast(t("save_err") + e.message, "err");
    btn.disabled = false;
  }
}

function stateFromRow(row) {
  const s = structuredClone(DEFAULT_PLAYER);
  s.bannerFile = null; s.banner_path = null; s.banner_signed_url = null;
  if (!row) return s;
  const keys = ["alias", "player_type", "hair", "bottom", "bottom_variation", "skin_tone",
    "eye_brows", "eye_color", "gear_head", "gear_head_variation", "gear_cloth", "gear_cloth_variation",
    "gear_shoes", "gear_shoes_variation", "weapon_main", "anim_name", "banner_path", "banner_sha256",
    "splattag_config"];
  for (const k of keys) if (row[k] !== null && row[k] !== undefined) s[k] = row[k];
  if (row.color) s.color = row.color;
  return s;
}

// ── Router ────────────────────────────────────────────────────────────
function updateNavLinks() {
  const navLinks = $("navLinks");
  if (!navLinks) return;
  navLinks.hidden = isAdminRoute() || isPanelRoute() || isApplyRoute();
}

function route() {
  updateNavLinks();
  if (!isConfigured()) {
    clear(appEl());
    appEl().append(el("div", { class: "edc-loading" }, el("div", {}, t("not_configured"))));
    return;
  }
  if (isAdminRoute()) { renderAdminView(); return; }
  if (isPanelRoute()) { renderPanelView(); return; }
  if (isApplyRoute()) { renderApplyView(); return; }
  if (session?.user) renderApp();
  else renderLogin();
}

// ── Solicitud de acceso de artista (?apply) ──────────────────────────
function renderApplyView() {
  profile = session?.user ? identityProfile(session.user) : null;
  renderArtistApply(appEl(), {
    session, profile,
    actions: { login: doLogin, linkDiscord: () => doLink("discord"), back: closeApply, discordSvg },
  });
}

function openApply() { if (goApply()) { route(); renderFooter(); } }
function closeApply() { if (goHome()) { route(); renderFooter(); } }

// ── Panel de admin (?admin) ──────────────────────────────────────────
function renderAdminView() { renderAdminPanel(appEl(), { onBack: closeAdmin }); }
function closeAdmin() { if (leaveAdmin()) { route(); renderFooter(); } }

// ── Panel del artista (?panel) ────────────────────────────────────────
function renderPanelView() {
  profile = session?.user ? identityProfile(session.user) : null;
  renderArtistPanel(appEl(), {
    session, profile,
    actions: { login: doLogin, linkDiscord: () => doLink("discord"), back: closePanel, discordSvg },
  });
}
function closePanel() { if (leavePanel()) { route(); renderFooter(); } }

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  // Antes de cualquier replaceState: guarda el ?ref del artista (sobrevive al
  // OAuth en sessionStorage) y restaura ?apply si se fue al OAuth desde ahí.
  captureRefFromUrl();
  restoreApplyRoute();

  applyStaticI18n();

  for (const b of $("langSwitch").querySelectorAll("button"))
    b.addEventListener("click", () => setLang(b.dataset.lang));

  onLangChange(() => {
    applyStaticI18n();
    if (!isConfigured() || isApplyRoute() || isAdminRoute() || isPanelRoute()) { route(); return; }
    if (session?.user && state) renderModeView();
    else route();
  });

  // Atrás/adelante del navegador entre ?apply y el inicio
  window.addEventListener("popstate", () => { route(); renderFooter(); });

  // Botones de nav header
  $("btnPanel")?.addEventListener("click", () => {
    history.pushState(null, "", location.pathname + "?panel");
    route();
  });
  $("btnApply")?.addEventListener("click", () => { goApply(); route(); renderFooter(); });

  if (isConfigured()) {
    session = await getSession();
    onAuthChange((s) => {
      const wasUser = !!session?.user;
      session = s;
      if (!!s?.user !== wasUser) { state = null; hasRecord = false; mode = "edit"; }
      applyStaticI18n();
      route();
    });
  }
  route();
  if (isConfigured() && X_LOGIN_ENABLED) finishPendingLink();
}

function renderHelp(container) {
  clear(container);
  const d = el("details", { class: "edc-help" });
  d.append(el("summary", {}, t("help_title")));
  d.append(el("div", { class: "edc-help-body", html: helpHtml(getLang()) }));
  container.append(d);
}

function helpHtml(lang) {
  const X = X_LOGIN_ENABLED;
  if (lang === "es") return `
<p>Conecta ${X ? "tu cuenta de Discord o X" : "tu Discord"}, configura tu personaje, sube tu banner y guarda. Puedes volver con ${X ? "la misma cuenta (Discord o X)" : "el mismo Discord"} y editarlo cuando quieras.</p>
<h4>Qué hace cada cosa</h4>
<ul>
  <li><b>Alias</b>: el nombre de tu ficha (no tiene por qué ser tu nombre de Discord).</li>
  <li><b>Color de tinta</b>: el color de tu personaje. Usa el selector o escribe el código <code>#RRGGBB</code>.</li>
  <li><b>Especie y género</b>: Inkling/Octoling × chica/chico.</li>
  <li><b>Tono de piel</b> y <b>color de ojos</b>: aspecto facial.</li>
  <li><b>Peinado</b> y <b>cejas</b>: dependen de la especie (mira las limitaciones).</li>
  <li><b>Piernas</b>: si la prenda tiene variantes aparece <b>Variación de piernas</b> (Base, V1, V2…).</li>
  <li><b>Equipamiento</b> (cabeza, ropa, zapatillas): pulsa <b>Cambiar</b> para elegir. El interruptor <b>Variante</b> activa la versión alternativa de esa prenda (si existe).</li>
  <li><b>Banner Splattag</b>: diséñalo aquí mismo (banner, nombre, título, ID e insignias). Se adjunta solo a tu perfil al pulsar <b>Guardar</b>; si ya tienes uno guardado, se conserva a menos que decidas crear uno nuevo. Tu configuración del generador también se guarda, así que puedes editar solo un detalle sin rehacer todo.</li>
</ul>
<h4>Limitaciones</h4>
<ul>
  <li><b>Peinados y cejas son por especie</b>: como Inkling solo ves peinados/cejas de Inkling; como Octoling solo los de Octoling. No se pueden mezclar. Si cambias de especie, el peinado y las cejas se reinician a los de la nueva especie.</li>
  <li><b>Variante</b>: el interruptor solo funciona en prendas que tienen versión alternativa; en las demás aparece desactivado.</li>
  <li><b>Arma y pose</b>: no se eligen aquí; las define el equipo al montar la foto.</li>
  <li><b>Editar</b>: para cambiar tu ficha, vuelve a entrar con ${X ? "la misma cuenta (Discord o X)" : "el mismo Discord"}.</li>
</ul>`;
  return `
<p>Connect ${X ? "your Discord or X account" : "your Discord"}, set up your character, upload your banner and save. You can come back with ${X ? "the same account (Discord or X)" : "the same Discord"} and edit it anytime.</p>
<h4>What each option does</h4>
<ul>
  <li><b>Alias</b>: the name on your sheet (doesn't have to be your Discord name).</li>
  <li><b>Ink color</b>: your character's color. Use the picker or type a <code>#RRGGBB</code> code.</li>
  <li><b>Species &amp; gender</b>: Inkling/Octoling × girl/boy.</li>
  <li><b>Skin tone</b> and <b>eye color</b>: facial look.</li>
  <li><b>Hairstyle</b> and <b>eyebrows</b>: depend on species (see limitations).</li>
  <li><b>Legs</b>: if the item has variants, a <b>Legs variation</b> row appears (Base, V1, V2…).</li>
  <li><b>Gear</b> (head, clothes, shoes): click <b>Change</b> to pick. The <b>Variant</b> switch enables the alternate version of that gear (if it has one).</li>
  <li><b>Splattag banner</b>: design it right here (banner, name, title, ID and badges). It's attached to your profile when you press <b>Save</b>. If you already have one, it's kept unless you explicitly create a new one. Your generator settings are saved too, so you can tweak one thing without redoing everything.</li>
</ul>
<h4>Limitations</h4>
<ul>
  <li><b>Hair and eyebrows are per species</b>: as an Inkling you only see Inkling hair/eyebrows; as an Octoling only Octoling ones. They can't be mixed. If you switch species, hair and eyebrows reset to the new species'.</li>
  <li><b>Variant</b>: the switch only works on gear that has an alternate version; otherwise it's disabled.</li>
  <li><b>Weapon and pose</b>: not chosen here; the team sets them when building the photo.</li>
  <li><b>Editing</b>: to change your sheet, log in again with ${X ? "the same account (Discord or X)" : "the same Discord"}.</li>
</ul>`;
}

function legalHtml(lang) {
  const X = X_LOGIN_ENABLED;
  if (lang === "es") return `
<p><b>Aviso:</b> Este sitio es un proyecto de fans para organizar contenido de la comunidad. Las donaciones recibidas se destinan exclusivamente a cubrir gastos de alojamiento e infraestructura. <b>No está afiliado, asociado, autorizado ni patrocinado por Nintendo</b> ni ninguna de sus filiales.</p>
<p><b>Marcas y propiedad:</b> «Splatoon», «Nintendo Switch», «Inkling», «Octoling» y los logotipos asociados son marcas registradas de Nintendo. Las imágenes, personajes y demás recursos del juego son propiedad intelectual de Nintendo Co., Ltd. y/o sus filiales. Los recursos gráficos se muestran únicamente con fines ilustrativos dentro de un contexto de fans. Todos los derechos pertenecen a sus respectivos propietarios.</p>
<h4>Datos que recogemos</h4>
<p>Al conectar tu Discord guardamos lo siguiente:</p>
<ul>
  <li><b>Nombre de usuario y avatar de Discord</b> — para identificarte en la comunidad.</li>
  <li><b>Configuración de personaje</b> — especie, género, skin, equipamiento, color de tinta y alias que eliges en el formulario.</li>
  <li><b>Banner (PNG)</b> — generado con el creador integrado.</li>
  <li><b>Configuración del generador de Splattag</b> — si usaste el creador integrado, guardamos también los ajustes del diseño (banner elegido, nombre, título, insignias…) para que puedas editarlos más adelante sin perder tu configuración.</li>
</ul>
${X ? `<p><b>Cuenta de X (opcional):</b> si entras con X o vinculas tu cuenta de X, guardamos en tu ficha únicamente tu nombre de usuario (@), tu nombre público, tu avatar y el identificador numérico de la cuenta, con el mismo fin de identificarte en la comunidad. X también nos facilita tu dirección de email confirmada, que gestiona exclusivamente el sistema de autenticación (Supabase Auth) para identificar tu cuenta; no se guarda en la ficha ni se usa para enviarte comunicaciones. La pantalla de autorización de X solicita lectura de publicaciones y acceso sin conexión porque X lo exige técnicamente para el inicio de sesión: no leemos tus publicaciones, seguidores ni mensajes, y no publicamos nada en tu nombre. Puedes desvincular X en cualquier momento desde la cabecera del sitio (siempre que tengas otra cuenta vinculada).</p>` : ""}
<p><b>Finalidad:</b> preparar contenido y fotos para eventos de la comunidad. No se venden ni ceden datos a terceros con fines publicitarios.</p>
<p><b>Enlaces de artistas (opcional):</b> algunos artistas de la comunidad tienen un enlace personal (URL con <code>?ref=</code>). Si te registras a través de uno de esos enlaces y marcas la casilla de consentimiento, autorizas expresamente a ese artista concreto —el que aparece con nombre en la casilla— a ver dentro de un panel privado tu configuración de personaje (especie, género, piel, ojos, peinado, cejas, gear, color de tinta y alias), tu banner y tu contacto (nombre de usuario y avatar de Discord${X ? ", y —si la vinculaste— tu @ de X" : ""}). Se trata de material de referencia visual para poder dibujarte o hacerte comisiones: el panel no permite descargar ni copiar tu configuración. El consentimiento es voluntario; si no marcas la casilla, tu personaje se guarda igual y no se comparte con nadie. Puedes retirar el consentimiento en cualquier momento contactando con el organizador por Discord y desasociaremos tu ficha de ese artista.</p>
<p><b>Edad mínima:</b> debes tener al menos 14 años para usar este servicio. Si eres menor de 14 años, necesitas el consentimiento de tu padre, madre o tutor legal.</p>
<p><b>Tus derechos:</b> puedes consultar, modificar o vaciar tu ficha en cualquier momento volviendo a entrar con ${X ? "tu cuenta de Discord o X" : "tu Discord"}. Para eliminar todos tus datos por completo, contacta con el organizador por Discord. Responderemos a solicitudes de acceso, rectificación o supresión en un plazo máximo de 30 días.</p>
<p><b>Conservación:</b> tus datos se mantienen mientras haya eventos de comunidad activos o hasta que solicites su eliminación.</p>
<p><b>Almacenamiento:</b> los datos se guardan en Supabase (base de datos y almacenamiento de archivos). Este sitio guarda tu idioma preferido y el estado del generador en el almacenamiento local de tu navegador (localStorage), sin cookies de terceros ni rastreo publicitario. Al diseñar tu banner con el generador integrado, confirmas que los datos que introduces (nombre, alias, ID) no infringen derechos de terceros.</p>
<h4>Créditos</h4>
<p>El creador de splattags está basado en el proyecto de código abierto <a href="https://github.com/SeymourSchlong/splashtags" target="_blank" rel="noopener">Splashtag Creator</a> (<a href="https://splashtagmaker.com/" target="_blank" rel="noopener">splashtagmaker.com</a>), licencia GPL-3.0. Todo el mérito es de sus autores:</p>
<ul>
  <li><b>seymour</b> (@spaghettitron) — creador de la web original</li>
  <li><b>LeanYoshi</b> — base de datos de Splatoon</li>
  <li><b>Raven_The_Cute</b> — traducciones</li>
  <li><b>DeadLineSMB</b> — banners Splatband</li>
  <li><b>ElectroDev</b> — banners de armas especiales</li>
  <li><b>Lucyfer</b> — banners Pride</li>
  <li><b>mya</b> — banners Grandfest</li>
  <li><b>Zeeto</b> — badges de bandas</li>
  <li><b>Sharkinodraws</b> — badges de huevos de Salmon Run</li>
</ul>
<p>Los datos e imágenes del juego (configurador de personaje) se cargan desde <a href="https://github.com/Flexlion/flexlion.github.io" target="_blank" rel="noopener">Flexlion</a>.</p>
<p>Lista completa en la <a href="https://splashtagmaker.com/credits/" target="_blank" rel="noopener">página de créditos original</a>. Fuentes, imágenes y datos de Splatoon son propiedad intelectual de Nintendo Co., Ltd.</p>`;
  return `
<p><b>Disclaimer:</b> This is a fan project made to organize community content. Any donations received go exclusively toward hosting and infrastructure costs. <b>It is not affiliated with, associated with, authorized, endorsed by, or in any way sponsored by Nintendo</b> or any of its subsidiaries.</p>
<p><b>Trademarks &amp; ownership:</b> "Splatoon", "Nintendo Switch", "Inkling", "Octoling" and associated logos are registered trademarks of Nintendo. Images, characters and other game assets are the intellectual property of Nintendo Co., Ltd. and/or its affiliates. Game artwork is shown for illustrative fan purposes only. All rights belong to their respective owners.</p>
<h4>Data we collect</h4>
<p>When you connect your Discord, we store the following:</p>
<ul>
  <li><b>Discord username and avatar</b> — to identify you within the community.</li>
  <li><b>Character configuration</b> — species, gender, skin tone, gear, ink color and alias you set in the form.</li>
  <li><b>Banner (PNG)</b> — generated with the built-in creator.</li>
  <li><b>Splattag generator settings</b> — if you used the built-in creator, we also save your design settings (chosen banner, name, title, badges…) so you can edit them later without losing your configuration.</li>
</ul>
${X ? `<p><b>X account (optional):</b> if you sign in with X or link your X account, your sheet only stores your username (@), display name, avatar and the account's numeric ID, for the same purpose of identifying you within the community. X also provides us with your confirmed email address, which is handled exclusively by the authentication system (Supabase Auth) to identify your account; it is not stored in your sheet or used to contact you. X's authorization screen asks for post reading and offline access because X technically requires them for sign-in: we do not read your posts, followers or messages, and nothing is ever posted on your behalf. You can unlink X at any time from the site header (as long as another account remains linked).</p>` : ""}
<p><b>Purpose:</b> exclusively to prepare content and photos for community events. We do not sell or share your data with third parties for advertising.</p>
<p><b>Artist links (optional):</b> some community artists have a personal link (URL with <code>?ref=</code>). If you sign up through one of those links and tick the consent box, you explicitly authorize that specific artist —the one named next to the box— to view inside a private panel your character configuration (species, gender, skin tone, eye color, hair, eyebrows, gear, ink color and alias), your banner and your contact (Discord username and avatar${X ? ", and —if you linked it— your X @" : ""}). This is visual reference material so they can draw or take commissions from you: the panel does not allow downloading or copying your configuration. Consent is voluntary; if you leave the box unticked, your character is saved as usual and shared with no one. You can withdraw consent at any time by contacting the organizer on Discord and your sheet will be disassociated from that artist.</p>
<p><b>Minimum age:</b> you must be at least 14 years old to use this service. If you are under 14, you need parental or legal guardian consent.</p>
<p><b>Your rights:</b> you can view, edit or clear your sheet at any time by logging in again with ${X ? "your Discord or X account" : "your Discord"}. To fully delete your data, contact the organizer on Discord. We will respond to access, rectification or deletion requests within 30 days.</p>
<p><b>Retention:</b> your data is kept while community events are active, or until you request its deletion.</p>
<p><b>Storage:</b> data is stored in Supabase (database and file storage). This site saves your preferred language and generator state in your browser's local storage (localStorage), with no third-party cookies or advertising trackers. By designing your banner with the built-in generator, you confirm that the data you enter (name, alias, ID) does not infringe third-party rights.</p>
<h4>Credits</h4>
<p>The splattag creator is based on the open-source project <a href="https://github.com/SeymourSchlong/splashtags" target="_blank" rel="noopener">Splashtag Creator</a> (<a href="https://splashtagmaker.com/" target="_blank" rel="noopener">splashtagmaker.com</a>), GPL-3.0 license. All credit goes to its authors:</p>
<ul>
  <li><b>seymour</b> (@spaghettitron) — original website creator</li>
  <li><b>LeanYoshi</b> — Splatoon database</li>
  <li><b>Raven_The_Cute</b> — translation help</li>
  <li><b>DeadLineSMB</b> — Splatband banners</li>
  <li><b>ElectroDev</b> — special weapon banners</li>
  <li><b>Lucyfer</b> — Pride banners</li>
  <li><b>mya</b> — Grandfest banners</li>
  <li><b>Zeeto</b> — Splatband badges</li>
  <li><b>Sharkinodraws</b> — Salmon Run egg badges</li>
</ul>
<p>Game data and images (character configurator) are loaded from <a href="https://github.com/Flexlion/flexlion.github.io" target="_blank" rel="noopener">Flexlion</a>.</p>
<p>Full list on the <a href="https://splashtagmaker.com/credits/" target="_blank" rel="noopener">original credits page</a>. Splatoon fonts, images and data are the intellectual property of Nintendo Co., Ltd.</p>`;
}

// Iconos de resumen del preview (head/cloth/shoes/banner/ok).
// SVG inline (no <img>) para que fill="currentColor" respete el color CSS del
// contenedor (.edc-badge-ico tiene color: var(--accent)). Los 3 de gear son
// Phosphor Icons (regular, MIT). Banner/ok/none son SVG mínimos propios.
const _preIconPaths = {
  head:   { vb: "0 0 256 256", d: "M128,24h0A104.12,104.12,0,0,0,24,128v56a24,24,0,0,0,24,24,24.11,24.11,0,0,0,14.18-4.64C74.33,194.53,95.6,184,128,184s53.67,10.52,65.81,19.35A24,24,0,0,0,232,184V128A104.12,104.12,0,0,0,128,24Zm88,104v8.87a166,166,0,0,0-40.94-18.22A167,167,0,0,0,146.19,41.9,88.14,88.14,0,0,1,216,128ZM128,44.27a152.47,152.47,0,0,1,30.4,70.46,170.85,170.85,0,0,0-60.84,0A153.31,153.31,0,0,1,128,44.27ZM109.81,41.9a167,167,0,0,0-28.87,76.76A166,166,0,0,0,40,136.88V128A88.14,88.14,0,0,1,109.81,41.9ZM211.66,191.11a8,8,0,0,1-8.44-.69C189.16,180.2,164.7,168,128,168S66.84,180.2,52.78,190.42a8,8,0,0,1-8.44.69A7.77,7.77,0,0,1,40,184V156.07a152,152,0,0,1,176,0V184A7.77,7.77,0,0,1,211.66,191.11Z" },
  cloth:  { vb: "0 0 256 256", d: "M247.59,61.22,195.83,33A8,8,0,0,0,192,32H160a8,8,0,0,0-8,8,24,24,0,0,1-48,0,8,8,0,0,0-8-8H64a8,8,0,0,0-3.84,1L8.41,61.22A15.76,15.76,0,0,0,1.82,82.48l19.27,36.81A16.37,16.37,0,0,0,35.67,128H56v80a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16V128h20.34a16.37,16.37,0,0,0,14.58-8.71l19.27-36.81A15.76,15.76,0,0,0,247.59,61.22ZM35.67,112a.62.62,0,0,1-.41-.13L16.09,75.26,56,53.48V112ZM184,208H72V48h16.8a40,40,0,0,0,78.38,0H184Zm36.75-96.14a.55.55,0,0,1-.41.14H200V53.48l39.92,21.78Z" },
  shoes:  { vb: "0 0 256 256", d: "M228.65,129.11l-60.73-20.24a24,24,0,0,1-14.32-13L130.39,41.6s0-.07,0-.1A16,16,0,0,0,110.25,33L34.53,60.49A16.05,16.05,0,0,0,24,75.53V192a16,16,0,0,0,16,16H240a16,16,0,0,0,16-16V167.06A40,40,0,0,0,228.65,129.11ZM115.72,48l7.11,16.63-21.56,7.85A8,8,0,0,0,104,88a7.91,7.91,0,0,0,2.73-.49l22.4-8.14,4.74,11.07-16.6,6A8,8,0,0,0,120,112a7.91,7.91,0,0,0,2.73-.49l17.6-6.4a40.24,40.24,0,0,0,7.68,10l-14.74,5.36A8,8,0,0,0,136,136a8.14,8.14,0,0,0,2.73-.48l28-10.18,56.87,18.95A24,24,0,0,1,238.93,160H40V75.53ZM40,192h0V176H240v16Z" },
  banner: { vb: "0 0 16 16",   d: "M2 3.5h12v9H2v-9zm1.5 1.5v5.2l2.7-2.3 2.2 2 3.1-3.3V5H3.5z" },
};
function preIcon(kind, size = 14) {
  const p = _preIconPaths[kind];
  if (p) return `<svg viewBox="${p.vb}" width="${size}" height="${size}" fill="currentColor" aria-hidden="true" style="vertical-align:-2px"><path d="${p.d}"/></svg>`;
  if (kind === "ok")   return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" style="vertical-align:-2px"><path d="M3 8.2l2.8 2.8 6.2-6.2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (kind === "none") return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" style="vertical-align:-2px"><path d="M4 8h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  return "";
}

// Logo oficial de X (X Corp.): trazado original tal cual lo sirve x.com.
// Solo se escala; el color hereda del botón (blanco sobre negro, versión permitida).
function xSvg(size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.742 21.75l-7.563-11.179 7.056-8.321h-2.456l-5.691 6.714-4.54-6.714H2.359l7.29 10.776L2.25 21.75h2.456l6.035-7.118 4.818 7.118h6.191-.008zM7.739 3.818L18.81 20.182h-2.447L5.29 3.818h2.447z"/></svg>`;
}

// Símbolo oficial de Discord (Discord-Symbol-White.svg del kit de marca de
// discord.com/branding). Trazado sin modificar; solo se escala manteniendo la
// proporción 126.644:96. El blanco va como atributo fill (el SVG original lo
// define con una clase CSS que chocaría con otras clases de la página).
function discordSvg(height = 20) {
  const width = Math.round(height * 126.644 / 96 * 10) / 10;
  return `<svg width="${width}" height="${height}" viewBox="0 0 126.644 96" aria-hidden="true"><path fill="#fff" d="M81.15,0c-1.2376,2.1973-2.3489,4.4704-3.3591,6.794-9.5975-1.4396-19.3718-1.4396-28.9945,0-.985-2.3236-2.1216-4.5967-3.3591-6.794-9.0166,1.5407-17.8059,4.2431-26.1405,8.0568C2.779,32.5304-1.6914,56.3725.5312,79.8863c9.6732,7.1476,20.5083,12.603,32.0505,16.0884,2.6014-3.4854,4.8998-7.1981,6.8698-11.0623-3.738-1.3891-7.3497-3.1318-10.8098-5.1523.9092-.6567,1.7932-1.3386,2.6519-1.9953,20.281,9.547,43.7696,9.547,64.0758,0,.8587.7072,1.7427,1.3891,2.6519,1.9953-3.4601,2.0457-7.0718,3.7632-10.835,5.1776,1.97,3.8642,4.2683,7.5769,6.8698,11.0623,11.5419-3.4854,22.3769-8.9156,32.0509-16.0631,2.626-27.2771-4.496-50.9172-18.817-71.8548C98.9811,4.2684,90.1918,1.5659,81.1752.0505l-.0252-.0505ZM42.2802,65.4144c-6.2383,0-11.4159-5.6575-11.4159-12.6535s4.9755-12.6788,11.3907-12.6788,11.5169,5.708,11.4159,12.6788c-.101,6.9708-5.026,12.6535-11.3907,12.6535ZM84.3576,65.4144c-6.2637,0-11.3907-5.6575-11.3907-12.6535s4.9755-12.6788,11.3907-12.6788,11.4917,5.708,11.3906,12.6788c-.101,6.9708-5.026,12.6535-11.3906,12.6535Z"/></svg>`;
}

init();
