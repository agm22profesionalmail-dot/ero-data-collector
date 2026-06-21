// Orquestador de la SPA
import { DEFAULT_PLAYER, SPECIES } from "./config.js";
import { t, getLang, setLang, onLangChange } from "./i18n.js";
import { isConfigured } from "./supabase.js";
import { signInWithDiscord, signOut, getSession, onAuthChange, discordProfile } from "./auth.js";
import { loadData, colorToHex } from "./data.js";
import { renderConfigurator, ensureValid } from "./configurator.js";
import { renderBanner, validatePng } from "./banner.js";
import { loadPlayer, savePlayer, getBannerSignedUrl } from "./store.js";
import { el, clear, toast } from "./ui.js";

const $ = (id) => document.getElementById(id);
const appEl = () => $("app");

let session = null;
let dataReady = false;
let state = null;   // ficha en edición
let profile = null;

// ── i18n estático ─────────────────────────────────────────────────────
function applyStaticI18n() {
  document.documentElement.lang = getLang();
  $("appSub").textContent = t("app_sub");
  $("footer").textContent = t("footer");
  for (const b of $("langSwitch").querySelectorAll("button"))
    b.classList.toggle("active", b.dataset.lang === getLang());
  renderAuthArea();
}

function renderAuthArea() {
  const area = $("authArea");
  clear(area);
  if (session?.user) {
    const p = discordProfile(session.user);
    const chip = el("div", { class: "edc-user-chip" });
    if (p.discord_avatar) chip.append(el("img", { src: p.discord_avatar, alt: "" }));
    chip.append(el("span", {}, p.discord_name || "Player"));
    chip.append(el("button", { class: "edc-btn edc-btn-sm", onClick: async () => { await signOut(); } }, t("logout")));
    area.append(chip);
  }
}

// ── Vistas ────────────────────────────────────────────────────────────
function renderLogin() {
  clear(appEl());
  const card = el("div", { class: "edc-login" },
    el("h2", {}, t("login_title")),
    el("p", {}, t("login_desc")),
    el("button", { class: "edc-btn edc-btn-discord", onClick: doLogin },
      el("span", { html: discordSvg() }), t("login_btn")),
    el("p", { class: "edc-privacy edc-label" }, t("login_privacy")),
  );
  appEl().append(card);
}

async function doLogin() {
  try { await signInWithDiscord(); }
  catch (e) { toast(t("save_err") + e.message, "err"); }
}

async function renderApp() {
  clear(appEl());
  const loading = el("div", { class: "edc-loading" }, el("div", { class: "edc-spinner" }), el("div", {}, t("loading_data")));
  appEl().append(loading);

  try {
    if (!dataReady) { await loadData(); dataReady = true; }
    profile = discordProfile(session.user);
    if (state === null) {
      const row = await loadPlayer(session.user.id);
      state = stateFromRow(row);
      if (!state.alias && profile?.discord_name) state.alias = profile.discord_name;
      ensureValid(state);
      if (state.banner_path) state.banner_signed_url = await getBannerSignedUrl(state.banner_path);
    }
  } catch (e) {
    clear(appEl());
    appEl().append(el("div", { class: "edc-loading" }, el("div", {}, t("loading_err")), el("div", { class: "edc-label" }, e.message)));
    return;
  }
  paintApp();
}

function paintApp() {
  clear(appEl());

  // Preview en vivo
  const preview = el("div", { class: "edc-card edc-preview" });
  appEl().append(preview);
  updatePreview(preview);

  // Configurador
  const cfg = el("div");
  appEl().append(cfg);
  renderConfigurator(cfg, state, () => updatePreview(preview));

  // Banner
  const bnr = el("div");
  appEl().append(bnr);
  renderBanner(bnr, state, () => updatePreview(preview));

  // Save bar
  const status = el("span", { class: "edc-save-status" });
  const saveBtn = el("button", { class: "edc-btn edc-btn-primary", onClick: () => doSave(saveBtn, status) }, t("save"));
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
    el("span", { class: "edc-preview-badge" }, (state.bannerFile || state.banner_signed_url) ? "🖼 banner ✓" : "🖼 —"),
  );
}

async function doSave(btn, status) {
  if (!state.alias || !state.alias.trim()) {
    state._aliasError = true; paintApp();
    toast(t("alias_required"), "err");
    return;
  }
  btn.disabled = true; status.className = "edc-save-status"; status.textContent = t("saving");
  try {
    await savePlayer(state, session.user, profile);
    if (state.banner_path) state.banner_signed_url = await getBannerSignedUrl(state.banner_path);
    status.className = "edc-save-status ok"; status.textContent = t("saved");
    toast(t("saved"), "ok");
  } catch (e) {
    status.className = "edc-save-status err"; status.textContent = t("save_err") + e.message;
    toast(t("save_err") + e.message, "err");
  } finally { btn.disabled = false; }
}

function stateFromRow(row) {
  const s = structuredClone(DEFAULT_PLAYER);
  s.bannerFile = null; s.banner_path = null; s.banner_signed_url = null;
  if (!row) return s;
  const keys = ["alias", "player_type", "hair", "bottom", "bottom_variation", "skin_tone",
    "eye_brows", "eye_color", "gear_head", "gear_head_variation", "gear_cloth", "gear_cloth_variation",
    "gear_shoes", "gear_shoes_variation", "weapon_main", "anim_name", "banner_path", "banner_sha256"];
  for (const k of keys) if (row[k] !== null && row[k] !== undefined) s[k] = row[k];
  if (row.color) s.color = row.color;
  return s;
}

// ── Router ────────────────────────────────────────────────────────────
function route() {
  if (!isConfigured()) {
    clear(appEl());
    appEl().append(el("div", { class: "edc-loading" }, el("div", {}, t("not_configured"))));
    return;
  }
  if (session?.user) renderApp();
  else renderLogin();
}

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  applyStaticI18n();

  for (const b of $("langSwitch").querySelectorAll("button"))
    b.addEventListener("click", () => setLang(b.dataset.lang));

  onLangChange(() => {
    applyStaticI18n();
    if (!isConfigured()) { route(); return; }
    if (session?.user && state) paintApp();
    else route();
  });

  if (isConfigured()) {
    session = await getSession();
    onAuthChange((s) => {
      const wasUser = !!session?.user;
      session = s;
      if (!!s?.user !== wasUser) { state = null; }  // login/logout → reset ficha
      applyStaticI18n();
      route();
    });
  }
  route();
}

function discordSvg() {
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5c2 .6 3 .9 4.4 1.8a13.6 13.6 0 0 0-12-.5C8.7 4 9.7 3.6 11.2 3.5L11 3a19.8 19.8 0 0 0-4.9 1.4C2.6 9.7 2 14.9 2.3 20c1.8 1.3 3.6 2 5.3 2.6l1-1.7c-.9-.3-1.7-.7-2.4-1.2l.6-.4c4.6 2.1 9.5 2.1 14 0l.6.4c-.7.5-1.5.9-2.4 1.2l1 1.7c1.8-.6 3.5-1.3 5.3-2.6.4-6-.8-11.1-3.6-15.6zM9 16c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>';
}

init();
