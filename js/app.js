import { artistTermsHtml } from "./artist_terms.js";
import { DEFAULT_PLAYER, SPECIES, X_LOGIN_ENABLED, SHARE_OC_PUBLIC, SHARE_OC_USERS } from "./config.js";
import { openShareDialog, shareOptsFor } from "./share_card.js";
import { t, getLang, setLang, onLangChange } from "./i18n.js";
import { isConfigured, supabase } from "./supabase.js";
import {
  signInWithDiscord,
  signInWithX,
  linkX,
  linkDiscord,
  unlinkX,
  refreshSessionUser,
  signOut,
  getSession,
  onAuthChange,
  identityProfile,
  consumeAuthError
} from "./auth.js";
import { loadData, colorToHex, data } from "./data.js";
import { renderConfigurator, ensureValid } from "./configurator.js";
import { renderBanner } from "./banner.js";
import { forgetSplattagCfg } from "./splattag.js";
import {
  loadPlayers,
  savePlayer,
  deletePlayer,
  getCharacterLimit,
  resetCharacterLimit,
  getBannerUrl,
  getRenderUrl,
  renderPaths,
  syncIdentityFields
} from "./store.js";
import { createRenderSpin } from "./render_spin.js";
import { el, clear, toast } from "./ui.js";
import {
  captureRefFromUrl,
  resolveRefArtist,
  needsRefConsent,
  renderRefConsent,
  clearRef,
  isApplyRoute,
  goApply,
  goHome,
  restoreApplyRoute,
  renderArtistApply,
  saveArtistVariant,
  loadLinkedArtists,
  linkArtist,
  loadArtistVariant,
  CHAR_FIELDS
} from "./artists.js";
import { isAdminRoute, renderAdminPanel, leaveAdmin, forgetAdmin } from "./admin.js";
import {
  isPanelRoute,
  renderArtistPanel,
  leavePanel,
  forgetPanelKey,
  renderBanner as renderPlayerBanner,
  renderSheet as renderPlayerSheet,
  setMainWide
} from "./artist_panel.js";
import { isFeedbackRoute, goFeedback, leaveFeedback, restoreFeedbackRoute, renderFeedback } from "./feedback.js";
const KOFI_SUPPORT_URL = "https://ko-fi.com/zerosplatoon/donate";
const KOFI_TIERS_URL = "https://ko-fi.com/zerosplatoon/tiers";
const $ = (id) => document.getElementById(id);
const appEl = () => $("app");
let session = null;
let dataReady = false;
let state = null;
let chars = [];
let charLimit = 1;
let profile = null;
let mode = "edit";
let activeCharId = null;
let editSnapshot = null;
let refArtist = null;
let banned = null;
const banCache = new Map();
async function checkBanned(user) {
  if (!user)
    return false;
  if (banCache.has(user.id))
    return banCache.get(user.id);
  let res = false;
  try {
    const { data: data2, error } = await supabase.rpc("am_i_banned");
    if (!error && data2 && data2.banned === true)
      res = { reason: data2.reason || "" };
  } catch {
  }
  banCache.set(user.id, res);
  return res;
}
async function enforceBan() {
  const b = await checkBanned(session?.user);
  if (!b)
    return false;
  banned = b;
  session = null;
  state = null;
  chars = [];
  mode = "edit";
  forgetPanelKey();
  try {
    await signOut();
  } catch {
  }
  return true;
}
function renderBannedScreen() {
  clear(appEl());
  appEl().append(el(
    "div",
    { class: "edc-apply" },
    el(
      "div",
      { class: "edc-card" },
      el("div", { class: "edc-section-title" }, t("banned_title")),
      el("p", { class: "edc-apply-intro" }, t("banned_desc")),
      banned?.reason ? el("p", { class: "edc-apply-intro" }, el("strong", {}, t("banned_reason")), " ", banned.reason) : null,
      el(
        "p",
        { class: "edc-apply-intro" },
        t("banned_appeal"),
        " ",
        el("a", { href: "https://discord.gg/Hckay4PGNR", target: "_blank", rel: "noopener noreferrer" }, "discord.gg/Hckay4PGNR")
      )
    )
  ));
}
function applyStaticI18n() {
  document.documentElement.lang = getLang();
  $("appSub").textContent = t("app_sub");
  renderFooter();
  renderFloatbar();
  for (const b of $("langSwitch").querySelectorAll("button"))
    b.classList.toggle("active", b.dataset.lang === getLang());
  const btnPanel = $("btnPanel");
  if (btnPanel)
    btnPanel.textContent = t("nav_panel");
  const btnApply = $("btnApply");
  if (btnApply)
    btnApply.textContent = t("nav_apply");
  const skip = $("skipLink");
  if (skip)
    skip.textContent = t("skip_link");
  renderAuthArea();
}
function renderAuthArea() {
  const area = $("authArea");
  clear(area);
  if (session?.user) {
    const p = identityProfile(session.user);
    const chip = el("div", { class: "edc-user-chip" });
    if (p.display_avatar)
      chip.append(el("img", { src: p.display_avatar, alt: "" }));
    chip.append(el("span", {}, p.display_name));
    if (X_LOGIN_ENABLED) {
      if (p.hasX) {
        chip.append(el(
          "span",
          { class: "edc-x-handle", title: t("linked_as") + " @" + (p.x_username || "?") },
          el("span", { class: "edc-x-mini", html: xSvg(12) }),
          "@" + (p.x_username || "?")
        ));
        if (p.providers.length >= 2)
          chip.append(el("button", { class: "edc-btn edc-btn-sm", onClick: doUnlinkX }, t("unlink_x")));
      } else {
        chip.append(el(
          "button",
          { class: "edc-btn edc-btn-sm edc-btn-x-sm", onClick: () => doLink("x") },
          el("span", { class: "edc-x-mini", html: xSvg(12) }),
          t("link_x")
        ));
      }
      if (!p.hasDiscord)
        chip.append(el("button", { class: "edc-btn edc-btn-sm", onClick: () => doLink("discord") }, t("link_discord")));
    }
    chip.append(el("button", { class: "edc-btn edc-btn-sm", onClick: async () => {
      forgetPanelKey();
      forgetAdmin();
      await signOut();
    } }, t("logout")));
    area.append(chip);
  }
}
const LINK_KEY = "edc_link_pending";
const LINK_TTL_MS = 10 * 60 * 1e3;
async function doLink(provider) {
  try {
    const n = (session?.user?.identities || []).length;
    sessionStorage.setItem(LINK_KEY, JSON.stringify({ provider, ts: Date.now(), n }));
    if (provider === "x")
      await linkX();
    else
      await linkDiscord();
  } catch (e) {
    sessionStorage.removeItem(LINK_KEY);
    toast(t("link_err") + t("link_err_generic"), "err");
    console.warn("linkIdentity:", e);
  }
}
async function reloadSessionProfile() {
  const s = await refreshSessionUser();
  if (s?.user)
    session = s;
  profile = identityProfile(session.user);
}
async function doUnlinkX() {
  try {
    const done = await unlinkX();
    if (!done) {
      toast(t("unlink_x_err_last"), "err");
      return;
    }
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
  if (!raw)
    return null;
  sessionStorage.removeItem(LINK_KEY);
  try {
    const p = JSON.parse(raw);
    if (!p?.provider || !p.ts || Date.now() - p.ts > LINK_TTL_MS)
      return null;
    return p;
  } catch {
    return null;
  }
}
async function finishPendingLink() {
  const pending = readPendingLink();
  const err = consumeAuthError();
  if (err) {
    toast(describeAuthError(err), "err");
    return;
  }
  if (!pending || !session?.user)
    return;
  try {
    await reloadSessionProfile();
    const linked = pending.provider === "x" ? profile.hasX : profile.hasDiscord;
    const nNow = (session.user.identities || []).length;
    if (!linked || nNow === pending.n) {
      renderAuthArea();
      return;
    }
    await syncIdentityFields(session.user, profile);
    const who = pending.provider === "x" ? "@" + (profile.x_username || "?") : profile.discord_name || "Discord";
    toast(t("linked_as") + " " + who, "ok");
    renderAuthArea();
  } catch (e) {
    toast(t("link_err") + t("link_err_generic"), "err");
    console.warn("finishPendingLink:", e);
  }
}
function describeAuthError(err) {
  const code = (err.code || "").toLowerCase();
  const kind = (err.error || "").toLowerCase();
  if (code === "identity_already_exists")
    return t("link_err_in_use");
  if (code === "manual_linking_disabled")
    return t("link_err") + t("link_err_disabled");
  if (code === "access_denied" || kind === "access_denied")
    return t("link_err") + t("link_err_cancelled");
  console.warn("auth error:", err);
  return t("link_err") + t("link_err_generic");
}
function renderFooter() {
  const f = $("footer");
  clear(f);
  f.append(el(
    "div",
    { class: "edc-footer-row" },
    el("span", {}, t("footer")),
    !isApplyRoute() && el("button", { class: "edc-footer-link", onClick: openApply }, t("footer_artist")),
    !isFeedbackRoute() && el("button", { class: "edc-footer-link", onClick: openFeedback }, t("footer_feedback"))
  ));
  f.append(el("div", { class: "edc-legal-line" }, t("legal_disclaimer")));
  f.append(el("div", { class: "edc-legal-line" }, t("ai_notice")));
  const d = el("details", { class: "edc-legal" });
  d.append(el("summary", {}, t("legal_title")));
  d.append(el("div", { class: "edc-help-body", html: legalHtml(getLang()) }));
  f.append(d);
  const at = el("details", { class: "edc-legal", id: "artist-terms" });
  at.append(el("summary", {}, t("artist_terms_title")));
  at.append(el("div", { class: "edc-help-body", html: artistTermsHtml(getLang()) }));
  f.append(at);
  const faqItems = [
    ["lp_faq_1_q", "lp_faq_1_a"],
    ["lp_faq_2_q", "lp_faq_2_a"],
    ["lp_faq_3_q", "lp_faq_3_a"],
    ["lp_faq_4_q", "lp_faq_4_a"],
    ["lp_faq_5_q", "lp_faq_5_a"],
    ["lp_faq_6_q", "lp_faq_6_a"],
    ["lp_faq_7_q", "lp_faq_7_a"],
    ["lp_faq_8_q", "lp_faq_8_a"],
    ["lp_faq_9_q", "lp_faq_9_a"],
    ["lp_faq_10_q", "lp_faq_10_a"],
    ["lp_faq_11_q", "lp_faq_11_a"]
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
function renderFloatbar() {
  const bar = $("floatbar");
  if (!bar)
    return;
  clear(bar);
  bar.append(
    el(
      "a",
      {
        class: "edc-float-btn edc-float-discord",
        href: "https://discord.gg/Hckay4PGNR",
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label": t("join_discord")
      },
      el("span", { class: "edc-float-ico", html: discordSvg(18) }),
      el("span", { class: "edc-float-label" }, t("join_discord"))
    ),
    el(
      "a",
      {
        class: "edc-float-btn edc-float-kofi",
        href: KOFI_SUPPORT_URL,
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label": t("kofi_btn")
      },
      el("span", { class: "edc-float-ico", html: kofiSvg(18) }),
      el("span", { class: "edc-float-label" }, t("kofi_btn"))
    )
  );
}
function kofiSvg(size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298"/></svg>`;
}
function renderLogin() {
  clear(appEl());
  const hero = el(
    "section",
    { class: "edc-hero" },
    el(
      "div",
      { class: "edc-hero-inner" },
      el(
        "div",
        { class: "edc-hero-copy" },
        el("h2", { class: "edc-hero-title" }, t("login_title")),
        el("p", { class: "edc-hero-desc" }, t(X_LOGIN_ENABLED ? "login_desc_x" : "login_desc")),
        el(
          "div",
          { class: "edc-hero-ctas" },
          el(
            "button",
            { class: "edc-btn edc-btn-discord edc-hero-cta", onClick: doLogin },
            el("span", { html: discordSvg() }),
            t("login_btn")
          ),
          X_LOGIN_ENABLED && el(
            "button",
            { class: "edc-btn edc-btn-x edc-hero-cta", onClick: doLoginX },
            el("span", { html: xSvg(18) }),
            t("login_btn_x")
          )
        ),
        X_LOGIN_ENABLED && el("p", { class: "edc-login-note" }, t("login_dup_note")),
        el("p", { class: "edc-privacy" }, t(X_LOGIN_ENABLED ? "login_privacy_x" : "login_privacy"))
      ),
      el(
        "div",
        { class: "edc-hero-art", "aria-hidden": "true" },
        el("span", { class: "edc-hero-splat" }),
        el("img", { class: "edc-hero-char", src: "assets/hero/hero-trio.webp", alt: "", loading: "eager" })
      )
    )
  );
  appEl().append(hero);
}
async function doLogin() {
  try {
    await signInWithDiscord();
  } catch (e) {
    toast(t("save_err") + e.message, "err");
  }
}
async function doLoginX() {
  try {
    await signInWithX();
  } catch (e) {
    toast(t("save_err") + e.message, "err");
  }
}
async function renderApp() {
  clear(appEl());
  const loading = el("div", { class: "edc-loading" }, el("div", { class: "edc-inkloader" }), el("div", {}, t("loading_data")));
  appEl().append(loading);
  try {
    if (!dataReady) {
      await loadData();
      dataReady = true;
    }
    profile = identityProfile(session.user);
    if (state === null) {
      const [rows, limit] = await Promise.all([loadPlayers(session.user.id), getCharacterLimit()]);
      charLimit = limit;
      chars = rows.map(charFromRow);
      if (!chars.length)
        chars = [newChar(0)];
      const main = chars[0];
      activeCharId = main.id;
      state = main.data;
      refArtist = await resolveRefArtist();
      await loadCharLinks(main);
      if (hasRecord() && refArtist)
        mode = "artist_choice";
      else
        mode = hasRecord() && !needsRefConsent(refArtist, state) ? "preview" : "edit";
    }
  } catch (e) {
    clear(appEl());
    appEl().append(el("div", { class: "edc-loading" }, el("div", {}, t("loading_err")), el("div", { class: "edc-label" }, e.message)));
    return;
  }
  renderModeView();
}
function renderModeView() {
  setMainWide(mode === "sheet");
  if (mode === "preview")
    renderPreviewScreen();
  else if (mode === "sheet")
    renderCharacterSheet();
  else if (mode === "artist_choice")
    renderArtistChoiceScreen();
  else if (mode === "artist_custom")
    renderEditor();
  else
    renderEditor();
}
function withName(key, name) {
  return t(key).replace(/\{name\}/g, name);
}
function renderArtistChoiceScreen() {
  clear(appEl());
  const name = refArtist.name;
  const card = el("div", { class: "edc-card" });
  card.append(el("div", { class: "edc-section-title" }, withName(t("artist_choice_title"), name)));
  card.append(el("p", { class: "edc-apply-intro" }, withName(t("artist_choice_intro"), name)));
  const pickable = usableChars().filter(isSaved);
  if (pickable.length > 1) {
    const pick = el("div", { class: "edc-char-pick", role: "group", "aria-label": t("artist_char_pick") });
    pick.append(el("span", { class: "edc-char-pick-label" }, t("artist_char_pick")));
    for (const c of pickable) {
      pick.append(el("button", {
        class: "edc-char-pick-btn",
        type: "button",
        "aria-pressed": String(c.id === activeCharId),
        onClick: async () => {
          if (c.id === activeCharId)
            return;
          activeCharId = c.id;
          state = c.data;
          await loadCharLinks(c);
          renderArtistChoiceScreen();
        }
      }, c.data.alias || t("your_char")));
    }
    card.append(pick);
  }
  const errBox = el("div", { class: "edc-banner-err", hidden: "" });
  const consentInput = el("input", { type: "checkbox" });
  const consentLabel = el(
    "label",
    { class: "edc-check" },
    consentInput,
    el("span", {}, withName(t("ref_consent"), name))
  );
  const shareBtn = el(
    "button",
    { class: "edc-btn edc-btn-primary" },
    t("artist_choice_share")
  );
  shareBtn.addEventListener("click", async () => {
    if (!consentInput.checked) {
      errBox.textContent = withName(t("ref_intro").replace("You're signing up through {name}.", "").trim(), name) || "Mark the consent checkbox first.";
      errBox.hidden = false;
      return;
    }
    shareBtn.disabled = true;
    errBox.hidden = true;
    try {
      const ov = renderSubmitOverlay();
      await ov.phase(t("artist_choice_confirming"), 50, 300);
      await linkArtist(refArtist.id, state, rpcPlayerId(activeChar()));
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
  const optA = needsRefConsent(refArtist, state) ? el(
    "div",
    { class: "edc-ref-card edc-card" },
    el("div", { class: "edc-ref-kicker" }, t("artist_choice_share")),
    el("p", { class: "edc-ref-note" }, withName(t("artist_choice_share_note"), name)),
    consentLabel,
    el("div", { class: "edc-apply-actions" }, shareBtn)
  ) : el(
    "div",
    { class: "edc-ref-card edc-card" },
    el("p", { class: "edc-ref-note" }, withName(t("artist_choice_already"), name))
  );
  const customBtn = el(
    "button",
    { class: "edc-btn edc-btn-sm" },
    withName(t("artist_choice_custom"), name)
  );
  customBtn.addEventListener("click", async () => {
    customBtn.disabled = true;
    state._mainChar = pickChar(state);
    const saved = await loadArtistVariant(refArtist.id, readPlayerId(activeChar()));
    if (saved)
      applyChar(state, saved);
    state._artistVariantFor = refArtist.id;
    mode = "artist_custom";
    renderModeView();
  });
  const optB = el(
    "div",
    { class: "edc-ref-card edc-card" },
    el("div", { class: "edc-ref-kicker" }, withName(t("artist_choice_custom"), name)),
    el("p", { class: "edc-ref-note" }, withName(t("artist_choice_custom_note"), name)),
    el("div", { class: "edc-apply-actions" }, customBtn)
  );
  const skipBtn = el("button", { class: "edc-btn-link" }, t("artist_choice_skip"));
  skipBtn.addEventListener("click", () => {
    clearRef();
    mode = "preview";
    renderModeView();
  });
  card.append(optA, optB, errBox, skipBtn);
  appEl().append(card);
}
const characterLimit = () => charLimit;
const activeChar = () => chars.find((c) => c.id === activeCharId) || null;
const hasRecord = () => chars.some((c) => !c.isNew);
const isSaved = (c) => !!c && !c.isNew;
const usableChars = () => chars.filter((c) => !c.locked);
const baseAlias = () => profile?.discord_name || profile?.x_name || profile?.x_username || "";
function charFromRow(row) {
  const s = stateFromRow(row);
  const slot = Number.isInteger(row.slot) ? row.slot : 0;
  s._userId = session.user.id;
  s._charId = row.id;
  s._slot = slot;
  if (!s.alias && baseAlias())
    s.alias = baseAlias();
  ensureValid(s);
  if (s.banner_path)
    s.banner_url = getBannerUrl(s.banner_path, s.banner_sha256);
  s._linkedArtists = [];
  return { id: row.id, slot, userId: session.user.id, data: s, isNew: false, locked: slot >= charLimit };
}
function newChar(slot) {
  const s = stateFromRow(null);
  s._userId = session.user.id;
  s._slot = slot;
  const base = baseAlias() || t("your_char");
  let alias = slot === 0 ? baseAlias() : `${base} ${slot + 1}`;
  for (let n = slot + 2; alias && chars.some((c) => c.data.alias === alias); n++)
    alias = `${base} ${n}`;
  s.alias = alias;
  ensureValid(s);
  s._linkedArtists = [];
  return { id: "new-" + slot, slot, userId: session.user.id, data: s, isNew: true, locked: false };
}
function freeSlot() {
  if (chars.length >= characterLimit())
    return null;
  for (let n = 0; n < 3; n++)
    if (!chars.some((c) => c.slot === n))
      return n;
  return null;
}
const rpcPlayerId = (ch) => ch && !ch.isNew && ch.slot > 0 ? ch.id : null;
const readPlayerId = (ch) => ch && !ch.isNew && chars.length > 1 ? ch.id : null;
async function loadCharLinks(ch) {
  if (!ch || ch.data._linksLoaded)
    return;
  ch.data._linksLoaded = true;
  ch.data._linkedArtists = isSaved(ch) && refArtist ? await loadLinkedArtists(readPlayerId(ch)) : [];
}
function getCharacters() {
  if (!state || !session?.user)
    return [];
  return chars;
}
const charPlayer = (ch) => ({ ...ch.data, user_id: ch.userId });
const charName = (ch) => ch.data.alias || t("your_char");
const charSpecies = (ch) => {
  const sp = SPECIES[ch.data.player_type] || SPECIES[0];
  return `${t(sp.species)} · ${sp.male ? t("boy") : t("girl")}`;
};
const renderStale = new Set();
const renderProbeCache = new Map();
const canLoad = (url) => new Promise((resolve) => {
  const im = new Image();
  im.onload = () => resolve(true);
  im.onerror = () => resolve(false);
  im.src = url;
});
const probeKey = (ch) => `${ch.userId}:${ch.slot}`;
function probeRender(ch) {
  if (!ch?.userId)
    return Promise.resolve(null);
  const key = probeKey(ch);
  if (!renderProbeCache.has(key)) {
    renderProbeCache.set(key, (async () => {
      for (const path of renderPaths(ch.userId, ch.slot).png || []) {
        const url = getRenderUrl(path);
        if (url && await canLoad(url))
          return url;
      }
      return null;
    })());
  }
  return renderProbeCache.get(key);
}
const PLACEHOLDER_ICON = '<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><path d="M4 6h24v20H4V6zm2 2v14l6.5-5.5 5 4 6-6.5L28 18V8H6z" fill="currentColor"/></svg>';
function focusAfterPaint(selector) {
  requestAnimationFrame(() => document.querySelector(selector)?.focus({ preventScroll: true }));
}
function openCharacter(id) {
  const ch = chars.find((c) => c.id === id);
  if (!ch || ch.locked)
    return;
  activeCharId = id;
  state = ch.data;
  mode = "sheet";
  renderModeView();
  window.scrollTo({ top: 0 });
  focusAfterPaint("#char-name");
}
function closeCharacter() {
  const id = activeCharId;
  mode = "preview";
  renderModeView();
  window.scrollTo({ top: 0 });
  focusAfterPaint(`[data-char-id="${id}"]`);
}
function startEdit() {
  editSnapshot = JSON.stringify(pickChar(state));
  mode = "edit";
  renderModeView();
  window.scrollTo({ top: 0 });
}
function startNewCharacter() {
  const slot = freeSlot();
  if (slot === null)
    return;
  const ch = newChar(slot);
  chars.push(ch);
  chars.sort((x, y) => x.slot - y.slot);
  activeCharId = ch.id;
  state = ch.data;
  editSnapshot = null;
  mode = "edit";
  renderModeView();
  window.scrollTo({ top: 0 });
}
async function cancelEdit(btn) {
  btn.disabled = true;
  const wasId = activeCharId;
  try {
    const ch = activeChar();
    if (ch?.isNew) {
      chars = chars.filter((c) => c !== ch);
    } else if (ch) {
      const rows = await loadPlayers(session.user.id);
      const row = rows.find((r) => r.id === ch.id);
      if (row) {
        const fresh = charFromRow(row);
        Object.assign(ch, fresh, { locked: ch.locked });
      }
    }
  } catch (e) {
    console.warn("cancelEdit:", e);
  }
  editSnapshot = null;
  const back = chars.find((c) => c.id === wasId);
  if (back && !back.isNew) {
    activeCharId = back.id;
    state = back.data;
    mode = "sheet";
  } else {
    activeCharId = chars[0]?.id || null;
    state = chars[0]?.data || null;
    mode = "preview";
  }
  renderModeView();
  window.scrollTo({ top: 0 });
}
function renderPreviewScreen() {
  clear(appEl());
  const chars_ = getCharacters().filter((c) => isSaved(c));
  const list = el("ul", { class: "edc-chars-list" });
  chars_.forEach((ch, i) => list.append(el("li", { style: `--i:${i}` }, renderCharacterCard(ch))));
  const hasLocked = chars_.some((c) => c.locked);
  if (chars_.length && freeSlot() !== null)
    list.append(el("li", { style: `--i:${chars_.length}` }, renderAddCharacterSlot()));
  const notice = chars_.length && (hasLocked || characterLimit() === 1) ? renderCharNotice(hasLocked) : null;
  const head = el(
    "header",
    { class: "edc-chars-head" },
    el("h2", { class: "edc-section-title", id: "chars-title", tabindex: "-1" }, t("chars_title")),
    chars_.length ? el("p", { class: "edc-chars-intro" }, t("chars_intro")) : null
  );
  const body = chars_.length ? list : el(
    "div",
    { class: "edc-chars-empty" },
    el("p", {}, t("chars_empty")),
    el("button", { class: "edc-btn edc-btn-primary", type: "button", onClick: startNewMain }, t("chars_create"))
  );
  appEl().append(el("section", { class: "edc-chars", "aria-labelledby": "chars-title" }, head, body, notice));
  const help = el("div");
  appEl().append(help);
  renderHelp(help);
}
function startNewMain() {
  if (!chars.length)
    chars = [newChar(0)];
  const ch = chars[0];
  activeCharId = ch.id;
  state = ch.data;
  editSnapshot = null;
  mode = "edit";
  renderModeView();
  window.scrollTo({ top: 0 });
}
function renderCharacterCard(ch) {
  const d = ch.data;
  const hex = colorToHex(d.color).toUpperCase();
  const thumb = el("span", { class: "edc-char-thumb is-loading", "aria-hidden": "true" });
  const status = el("span", { class: "edc-char-status", "data-state": "loading" }, t("render_loading"));
  const setStatus = (kind) => {
    status.dataset.state = kind;
    status.textContent = t("render_" + kind);
  };
  probeRender(ch).then((url) => {
    if (!thumb.isConnected)
      return;
    thumb.classList.remove("is-loading");
    if (url) {
      thumb.append(el("img", { src: url, alt: "", decoding: "async" }));
      if (ch.locked)
        setStatus("locked");
      else
        setStatus(renderStale.has(ch.id) ? "stale" : "ready");
    } else {
      thumb.append(el("span", { class: "edc-char-thumb-ph", html: PLACEHOLDER_ICON }));
      setStatus(ch.locked ? "locked" : "pending");
    }
  });
  if (ch.locked) {
    return el(
      "div",
      { class: "edc-char-card edc-char-card--locked", "data-char-id": ch.id },
      thumb,
      el(
        "span",
        { class: "edc-char-body" },
        el("span", { class: "edc-char-alias" }, charName(ch)),
        el("span", { class: "edc-char-meta" }, charSpecies(ch)),
        status
      )
    );
  }
  let banner = null;
  if (d.banner_path) {
    banner = el("span", { class: "edc-char-banner", hidden: "", "aria-hidden": "true" });
    const img = el("img", { alt: "", decoding: "async" });
    img.addEventListener("load", () => {
      banner.hidden = false;
    });
    img.src = getBannerUrl(d.banner_path, d.banner_sha256);
    banner.append(img);
  }
  return el(
    "button",
    { class: "edc-char-card", type: "button", "data-char-id": ch.id, onClick: () => openCharacter(ch.id) },
    thumb,
    el(
      "span",
      { class: "edc-char-body" },
      el("span", { class: "edc-char-alias" }, charName(ch)),
      el("span", { class: "edc-char-meta" }, charSpecies(ch)),
      el(
        "span",
        { class: "edc-char-ink" },
        el("span", { class: "edc-char-ink-sw", style: `background:${hex}` }),
        hex
      ),
      status
    ),
    banner,
    el("span", { class: "edc-char-go", "aria-hidden": "true" })
  );
}
function renderAddCharacterSlot() {
  return el(
    "button",
    { class: "edc-char-card edc-char-card--add", type: "button", onClick: startNewCharacter },
    el("span", { class: "edc-char-plus", "aria-hidden": "true" }),
    el(
      "span",
      { class: "edc-char-body" },
      el("span", { class: "edc-char-alias" }, t("chars_add")),
      el("span", { class: "edc-char-meta" }, t("chars_add_hint"))
    )
  );
}
function renderCharNotice(hasLocked) {
  return el(
    "aside",
    { class: "edc-char-notice" },
    el("p", { class: "edc-char-notice-text" }, t(hasLocked ? "chars_locked_note" : "chars_upsell")),
    el(
      "div",
      { class: "edc-char-notice-links" },
      el(
        "a",
        { class: "edc-btn edc-btn-sm edc-char-notice-link", href: KOFI_SUPPORT_URL, target: "_blank", rel: "noopener noreferrer" },
        el("span", { class: "edc-char-notice-ico", html: kofiSvg(15) }),
        t("kofi_donate")
      ),
      el(
        "a",
        { class: "edc-btn edc-btn-sm edc-char-notice-link", href: KOFI_TIERS_URL, target: "_blank", rel: "noopener noreferrer" },
        el("span", { class: "edc-char-notice-ico", html: kofiSvg(15) }),
        t("kofi_member")
      )
    )
  );
}
function renderCharacterDelete(ch) {
  const box = el("div", { class: "edc-char-del" });
  const showAsk = () => {
    clear(box);
    box.append(el("button", { class: "edc-btn edc-btn-sm edc-char-del-btn", type: "button", onClick: showConfirm }, t("chars_delete")));
  };
  const showConfirm = () => {
    clear(box);
    const msg = el("p", { class: "edc-char-del-msg", id: "char-del-msg" }, t("chars_delete_confirm").replace("{name}", charName(ch)));
    const err = el("p", { class: "edc-char-del-err", role: "alert", hidden: "" });
    const no = el("button", { class: "edc-btn edc-btn-sm", type: "button", onClick: showAsk }, t("chars_cancel"));
    const yes = el("button", { class: "edc-btn edc-btn-sm edc-char-del-yes", type: "button" }, t("chars_delete_yes"));
    yes.addEventListener("click", async () => {
      yes.disabled = no.disabled = true;
      err.hidden = true;
      try {
        await deletePlayer(ch.id, ch.slot);
        forgetSplattagCfg(session.user.id, ch.slot, ch.id);
        renderProbeCache.delete(probeKey(ch));
        renderStale.delete(ch.id);
        chars = chars.filter((c) => c !== ch);
        activeCharId = chars[0]?.id || null;
        state = chars[0]?.data || null;
        mode = "preview";
        renderModeView();
        window.scrollTo({ top: 0 });
        toast(t("chars_deleted"), "ok");
      } catch (e) {
        console.warn("deletePlayer:", e);
        yes.disabled = no.disabled = false;
        err.textContent = t("chars_delete_err");
        err.hidden = false;
      }
    });
    box.append(el(
      "div",
      { class: "edc-char-del-ask", role: "group", "aria-labelledby": "char-del-msg" },
      msg,
      err,
      el("div", { class: "edc-char-del-actions" }, no, yes)
    ));
    no.focus({ preventScroll: true });
  };
  showAsk();
  return box;
}
function renderCharacterSheet() {
  const ch = getCharacters().find((c) => c.id === activeCharId);
  if (!ch || ch.locked || ch.isNew) {
    mode = "preview";
    renderModeView();
    return;
  }
  clear(appEl());
  const p = charPlayer(ch);
  const note = el("p", { class: "edc-pcard-note", hidden: "" });
  const shareSlot = el("div", { class: "edc-char-share" });
  if (shareEnabled())
    probeRender(ch).then((url) => {
      if (!url || renderStale.has(ch.id) || activeCharId !== ch.id || mode !== "sheet")
        return;
      shareSlot.append(el("button", {
        class: "edc-btn edc-char-sharebtn",
        type: "button",
        onClick: () => openShareDialog(shareOptsFor(ch, url, profile?.hasDiscord))
      }, t("share_btn")));
    });
  const side = el(
    "div",
    { class: "edc-pcard-side edc-char-side" },
    renderCharacterRender(ch, note),
    el("button", { class: "edc-btn edc-btn-primary edc-char-edit", type: "button", onClick: startEdit }, t("chars_edit")),
    shareSlot,
    note,
    ch.slot > 0 ? renderCharacterDelete(ch) : null
  );
  const main = el(
    "div",
    { class: "edc-pcard-main" },
    el("h2", { class: "edc-pcard-name", id: "char-name", tabindex: "-1" }, charName(ch)),
    renderPlayerBanner(p, { size: "detail", interactive: true }),
    renderPlayerSheet(p)
  );
  appEl().append(el(
    "section",
    { class: "edc-chars edc-chars--sheet", "aria-labelledby": "char-name" },
    el(
      "div",
      { class: "edc-chars-nav" },
      el(
        "button",
        { class: "edc-btn edc-btn-sm", type: "button", onClick: closeCharacter },
        t("chars_back")
      )
    ),
    el("div", { class: "edc-pcard" }, side, main)
  ));
}
const shareEnabled = () => SHARE_OC_PUBLIC || SHARE_OC_USERS.includes(session?.user?.id);
function renderCharacterRender(ch, note) {
  const ph = el("div", { class: "edc-pcard-render-ph", role: "status" });
  const paint = (kind) => {
    clear(ph);
    ph.classList.toggle("is-loading", kind === "loading");
    if (kind === "loading") {
      ph.append(el("span", { class: "edc-sr-only" }, t("render_loading")));
      return;
    }
    ph.append(
      el("span", { class: "edc-pcard-render-ico", "aria-hidden": "true", html: PLACEHOLDER_ICON }),
      el("span", {}, t("my_render_pending"))
    );
  };
  paint("loading");
  const { spin } = renderPaths(ch.userId, ch.slot);
  return createRenderSpin({
    placeholder: ph,
    pngUrl: probeRender(ch),
    spinUrl: spin ? getRenderUrl(spin) : null,
    onLoaded: () => {
      const stale = renderStale.has(ch.id);
      note.dataset.state = stale ? "stale" : "info";
      note.textContent = t(stale ? "render_note_stale" : "render_note");
      note.hidden = false;
    },
    onFail: () => paint("pending")
  });
}
function willHaveBanner() {
  return !!(state.bannerFile || state.banner_url || state._captureSplattag);
}
function renderEditor() {
  clear(appEl());
  if (X_LOGIN_ENABLED && !hasRecord() && profile?.hasX && !profile?.hasDiscord)
    appEl().append(el("div", { class: "edc-card edc-notice" }, t("editor_dup_note")));
  if (mode === "artist_custom" && refArtist) {
    const banner = el(
      "div",
      { class: "edc-card edc-ref-card" },
      el("div", { class: "edc-ref-kicker" }, withName(t("artist_choice_custom"), refArtist.name)),
      el("p", { class: "edc-ref-note" }, withName(t("artist_choice_custom_note"), refArtist.name)),
      el(
        "button",
        { class: "edc-btn-link", onClick: () => {
          leaveVariantMode();
          mode = "artist_choice";
          renderModeView();
        } },
        t("artist_choice_back")
      )
    );
    appEl().append(banner);
  }
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
  if (mode !== "artist_custom") {
    const bnr = el("div");
    appEl().append(bnr);
    renderBanner(bnr, state, () => updatePreview(preview));
  }
  const help = el("div");
  appEl().append(help);
  renderHelp(help);
  const status = el("span", { class: "edc-save-status" });
  const saveBtnLabel = mode === "artist_custom" && refArtist ? withName(t("artist_choice_custom_save"), refArtist.name) : isSaved(activeChar()) ? t("update_player") : t("save");
  const saveBtn = el(
    "button",
    { class: "edc-btn edc-btn-primary", onClick: () => doSave(saveBtn, status) },
    saveBtnLabel
  );
  const cancelBtn = hasRecord() && mode !== "artist_custom" ? el("button", { class: "edc-btn edc-char-cancel", type: "button", onClick: () => cancelEdit(cancelBtn) }, t("chars_cancel")) : null;
  const bar = el("div", { class: "edc-card", style: "padding:0" }, el("div", { class: "edc-save-bar" }, cancelBtn, saveBtn, status));
  appEl().append(bar);
}
function pickChar(s) {
  const o = {};
  for (const k of CHAR_FIELDS)
    o[k] = structuredClone(s[k]);
  return o;
}
function applyChar(s, src) {
  for (const k of CHAR_FIELDS)
    if (src[k] !== void 0 && src[k] !== null)
      s[k] = structuredClone(src[k]);
}
function leaveVariantMode() {
  if (state?._mainChar)
    applyChar(state, state._mainChar);
  if (state) {
    delete state._mainChar;
    delete state._artistVariantFor;
  }
}
function updatePreview(node) {
  clear(node);
  const sp = SPECIES[state.player_type] || SPECIES[0];
  node.append(
    el("div", { class: "edc-color-preview", style: `background:${colorToHex(state.color)}` }),
    el("strong", {}, state.alias || t("your_char")),
    el("span", { class: "edc-preview-badge" }, `${t(sp.species)} · ${sp.male ? t("boy") : t("girl")}`),
    el(
      "span",
      { class: "edc-preview-badge" },
      el("span", { class: "edc-badge-ico", html: preIcon("banner") }),
      " ",
      el("span", { class: "edc-badge-ico", html: preIcon(willHaveBanner() ? "ok" : "none") })
    )
  );
}
const SUBMIT_PHRASES = {
  es: {
    pack: {
      new: ["Empaquetando personaje…", "Empaquetando características…", "Preparando tu ficha…"],
      upd: ["Empaquetando nuevo personaje…", "Recogiendo tus cambios…", "Empaquetando características…"]
    },
    send: {
      new: ["Registrando personaje…", "Dando de alta tu ficha…", "Reservando tu plaza…"],
      upd: ["Actualizando información…", "Sincronizando tus cambios…", "Actualizando tu ficha…"]
    },
    reg: {
      new: ["Sellando el registro…", "Guardando en el servidor…"],
      upd: ["Aplicando la actualización…", "Guardando los cambios…"]
    },
    done: { new: ["¡Personaje registrado!"], upd: ["¡Información actualizada!"] }
  },
  en: {
    pack: {
      new: ["Packing your character…", "Bundling traits…", "Preparing your sheet…"],
      upd: ["Packing your new character…", "Gathering your changes…", "Bundling traits…"]
    },
    send: {
      new: ["Registering character…", "Signing up your sheet…", "Saving your spot…"],
      upd: ["Updating your info…", "Syncing your changes…", "Updating your sheet…"]
    },
    reg: {
      new: ["Sealing the record…", "Saving to the server…"],
      upd: ["Applying the update…", "Saving your changes…"]
    },
    done: { new: ["Character registered!"], upd: ["Info updated!"] }
  }
};
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
function submitPhrases(isUpdate) {
  const L = SUBMIT_PHRASES[getLang()] || SUBMIT_PHRASES.en;
  const k = isUpdate ? "upd" : "new";
  return { pack: pickOne(L.pack[k]), send: pickOne(L.send[k]), reg: pickOne(L.reg[k]), done: pickOne(L.done[k]) };
}
function renderSubmitOverlay() {
  const bar = el("div", { class: "edc-progress-bar" });
  const label = el("div", { class: "edc-submit-label" }, "…");
  const overlay = el(
    "div",
    { class: "edc-submit-overlay", role: "status", "aria-live": "polite" },
    el(
      "div",
      { class: "edc-submit-card" },
      el("div", { class: "edc-inkloader" }),
      label,
      el("div", { class: "edc-progress" }, bar)
    )
  );
  document.body.append(overlay);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    async phase(text, pct, dwell = 440) {
      label.textContent = text;
      bar.style.width = pct + "%";
      await wait(dwell);
    },
    close() {
      overlay.remove();
    }
  };
}
async function doSave(btn, status) {
  if (!state.alias || !state.alias.trim()) {
    state._aliasError = true;
    renderEditor();
    toast(t("alias_required"), "err");
    return;
  }
  if (btn.disabled)
    return;
  btn.disabled = true;
  status.className = "edc-save-status";
  status.textContent = t("saving");
  const ch = activeChar();
  const isUpdate = isSaved(ch);
  if (mode === "artist_custom" && state._artistVariantFor) {
    const artistId = state._artistVariantFor;
    if (needsRefConsent(refArtist, state) && state._refConsent !== true) {
      const msg = t("ref_consent_required").replace("{name}", refArtist.name);
      status.className = "edc-save-status err";
      status.textContent = msg;
      toast(msg, "err");
      btn.disabled = false;
      return;
    }
    const artName = refArtist?.name || "";
    const P2 = submitPhrases(false);
    const ov2 = renderSubmitOverlay();
    try {
      await ov2.phase(P2.send, 60);
      await saveArtistVariant(artistId, state, rpcPlayerId(ch));
      await ov2.phase(withName(t("artist_choice_custom_saved"), artName), 100, 700);
      ov2.close();
      leaveVariantMode();
      clearRef();
      toast(withName(t("artist_choice_custom_saved"), artName), "ok");
      mode = "preview";
      renderModeView();
    } catch (e) {
      ov2.close();
      status.className = "edc-save-status err";
      status.textContent = t("save_err") + e.message;
      toast(t("save_err") + e.message, "err");
      btn.disabled = false;
    }
    return;
  }
  const consenting = needsRefConsent(refArtist, state) && state._refConsent === true;
  const P = submitPhrases(isUpdate);
  const ov = renderSubmitOverlay();
  try {
    if (state._captureSplattag && (!state.banner_path || state._splattagDirty || state._splattagPersisted)) {
      await ov.phase(P.pack, 28);
      try {
        state.bannerFile = await Promise.race([
          state._captureSplattag(),
          new Promise((_, rej) => setTimeout(() => rej(new Error("splattag capture timeout")), 12e3))
        ]);
      } catch (e) {
        console.warn("No se pudo generar la splattag:", e);
      }
    }
    await ov.phase(P.send, 62);
    await savePlayer(state, session.user, profile, chars.map((c) => c.slot));
    renderProbeCache.delete(probeKey(ch));
    if (ch.isNew)
      forgetSplattagCfg(session.user.id, state._slot);
    ch.id = state._charId;
    ch.slot = state._slot;
    ch.isNew = false;
    activeCharId = ch.id;
    state._linksLoaded = true;
    if (consenting)
      await linkArtist(refArtist.id, state, rpcPlayerId(ch));
    await ov.phase(P.reg, 88);
    if (state.banner_path)
      state.banner_url = getBannerUrl(state.banner_path, state.banner_sha256);
    await ov.phase(P.done, 100, 620);
    ov.close();
    if (consenting) {
      clearRef();
      state._refConsent = false;
      toast(t("saved") + " " + t("ref_saved").replace("{name}", refArtist.name), "ok");
    } else {
      toast(t("saved"), "ok");
    }
    if (!editSnapshot || editSnapshot !== JSON.stringify(pickChar(state)))
      renderStale.add(ch.id);
    editSnapshot = null;
    openCharacter(ch.id);
  } catch (e) {
    ov.close();
    const msg = e?.code === "character_limit" ? t("chars_limit_err") : t("save_err") + e.message;
    if (e?.code === "character_limit")
      resetCharacterLimit();
    status.className = "edc-save-status err";
    status.textContent = msg;
    toast(msg, "err");
    btn.disabled = false;
  }
}
function stateFromRow(row) {
  const s = structuredClone(DEFAULT_PLAYER);
  s.bannerFile = null;
  s.banner_path = null;
  s.banner_url = null;
  if (!row)
    return s;
  const keys = [
    "alias",
    "player_type",
    "hair",
    "bottom",
    "bottom_variation",
    "skin_tone",
    "eye_brows",
    "eye_color",
    "gear_head",
    "gear_head_variation",
    "gear_cloth",
    "gear_cloth_variation",
    "gear_shoes",
    "gear_shoes_variation",
    "weapon_main",
    "anim_name",
    "banner_path",
    "banner_sha256",
    "splattag_config"
  ];
  for (const k of keys)
    if (row[k] !== null && row[k] !== void 0)
      s[k] = row[k];
  if (row.color)
    s.color = row.color;
  return s;
}
function updateNavLinks() {
  const navLinks = $("navLinks");
  if (!navLinks)
    return;
  navLinks.hidden = !!banned || isAdminRoute() || isPanelRoute() || isApplyRoute() || isFeedbackRoute();
}
function route() {
  setMainWide(false);
  updateNavLinks();
  if (!isConfigured()) {
    clear(appEl());
    appEl().append(el("div", { class: "edc-loading" }, el("div", {}, t("not_configured"))));
    return;
  }
  if (isAdminRoute()) {
    renderAdminView();
    return;
  }
  if (banned) {
    renderBannedScreen();
    return;
  }
  if (isPanelRoute()) {
    renderPanelView();
    return;
  }
  if (isApplyRoute()) {
    renderApplyView();
    return;
  }
  if (isFeedbackRoute()) {
    renderFeedbackView();
    return;
  }
  if (session?.user)
    renderApp();
  else
    renderLogin();
}
function renderApplyView() {
  profile = session?.user ? identityProfile(session.user) : null;
  renderArtistApply(appEl(), {
    session,
    profile,
    actions: { login: doLogin, linkDiscord: () => doLink("discord"), back: closeApply, discordSvg }
  });
}
function openApply() {
  if (goApply()) {
    route();
    renderFooter();
  }
}
function closeApply() {
  if (goHome()) {
    route();
    renderFooter();
  }
}
function renderFeedbackView() {
  profile = session?.user ? identityProfile(session.user) : null;
  renderFeedback(appEl(), {
    session,
    profile,
    actions: { login: doLogin, linkDiscord: () => doLink("discord"), back: closeFeedback, discordSvg }
  });
}
function openFeedback() {
  if (goFeedback()) {
    route();
    renderFooter();
    window.scrollTo({ top: 0 });
  }
}
function closeFeedback() {
  if (leaveFeedback()) {
    route();
    renderFooter();
  }
}
function renderAdminView() {
  renderAdminPanel(appEl(), { onBack: closeAdmin });
}
function closeAdmin() {
  if (leaveAdmin()) {
    route();
    renderFooter();
  }
}
function renderPanelView() {
  profile = session?.user ? identityProfile(session.user) : null;
  renderArtistPanel(appEl(), {
    session,
    profile,
    actions: { login: doLogin, linkDiscord: () => doLink("discord"), back: closePanel, discordSvg }
  });
}
function closePanel() {
  if (leavePanel()) {
    route();
    renderFooter();
  }
}
async function init() {
  captureRefFromUrl();
  restoreApplyRoute();
  restoreFeedbackRoute();
  applyStaticI18n();
  for (const b of $("langSwitch").querySelectorAll("button"))
    b.addEventListener("click", () => setLang(b.dataset.lang));
  onLangChange(() => {
    applyStaticI18n();
    if (!isConfigured() || isApplyRoute() || isAdminRoute() || isPanelRoute() || isFeedbackRoute()) {
      route();
      return;
    }
    if (session?.user && state)
      renderModeView();
    else
      route();
  });
  window.addEventListener("popstate", () => {
    route();
    renderFooter();
  });
  $("btnPanel")?.addEventListener("click", () => {
    history.pushState(null, "", location.pathname + "?panel");
    route();
  });
  $("btnApply")?.addEventListener("click", () => {
    goApply();
    route();
    renderFooter();
  });
  if (isConfigured()) {
    session = await getSession();
    onAuthChange((s) => {
      const prevId = session?.user?.id || null;
      session = s;
      const nextId = s?.user?.id || null;
      if (nextId === prevId)
        return;
      state = null;
      chars = [];
      mode = "edit";
      resetCharacterLimit();
      activeCharId = null;
      editSnapshot = null;
      renderStale.clear();
      renderProbeCache.clear();
      const go = () => {
        applyStaticI18n();
        route();
      };
      if (s?.user)
        enforceBan().then(go);
      else
        go();
    });
    if (session?.user) {
      await enforceBan();
      applyStaticI18n();
    }
  }
  route();
  if (isConfigured() && X_LOGIN_ENABLED)
    finishPendingLink();
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
  if (lang === "es")
    return `
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
  if (lang === "es")
    return `
<p><b>Aviso:</b> Este sitio es un proyecto de fans para organizar contenido de la comunidad. Las donaciones recibidas se destinan exclusivamente a cubrir gastos de alojamiento e infraestructura. <b>No está afiliado, asociado, autorizado ni patrocinado por Nintendo</b> ni ninguna de sus filiales.</p>
<p><b>Marcas y propiedad:</b> «Splatoon», «Nintendo Switch», «Inkling», «Octoling» y los logotipos asociados son marcas registradas de Nintendo. Las imágenes, personajes y demás recursos del juego son propiedad intelectual de Nintendo Co., Ltd. y/o sus filiales. Los recursos gráficos se muestran únicamente con fines ilustrativos dentro de un contexto de fans. Todos los derechos pertenecen a sus respectivos propietarios.</p>
<h4>Datos que recogemos</h4>
<p>Al conectar tu Discord guardamos lo siguiente:</p>
<ul>
  <li><b>Nombre de usuario y avatar de Discord</b> - para identificarte en la comunidad.</li>
  <li><b>Configuración de personaje</b> - especie, género, skin, equipamiento, color de tinta y alias que eliges en el formulario.</li>
  <li><b>Banner (PNG)</b> - generado con el creador integrado.</li>
  <li><b>Configuración del generador de Splattag</b> - si usaste el creador integrado, guardamos también los ajustes del diseño (banner elegido, nombre, título, insignias…) para que puedas editarlos más adelante sin perder tu configuración.</li>
</ul>
${X ? `<p><b>Cuenta de X (opcional):</b> si entras con X o vinculas tu cuenta de X, guardamos en tu ficha únicamente tu nombre de usuario (@), tu nombre público, tu avatar y el identificador numérico de la cuenta, con el mismo fin de identificarte en la comunidad. X también nos facilita tu dirección de email confirmada, que gestiona exclusivamente el sistema de autenticación (Supabase Auth) para identificar tu cuenta; no se guarda en la ficha ni se usa para enviarte comunicaciones. La pantalla de autorización de X solicita lectura de publicaciones y acceso sin conexión porque X lo exige técnicamente para el inicio de sesión: no leemos tus publicaciones, seguidores ni mensajes, y no publicamos nada en tu nombre. Puedes desvincular X en cualquier momento desde la cabecera del sitio (siempre que tengas otra cuenta vinculada).</p>` : ""}
<p><b>Finalidad:</b> preparar contenido y fotos para eventos de la comunidad. No se venden ni ceden datos a terceros con fines publicitarios.</p>
<p><b>Enlaces de artistas (opcional):</b> algunos artistas de la comunidad tienen un enlace personal (URL con <code>?ref=</code>). Si te registras a través de uno de esos enlaces y marcas la casilla de consentimiento, autorizas expresamente a ese artista concreto, el que aparece con nombre en la casilla, a ver dentro de un panel privado tu configuración de personaje (especie, género, piel, ojos, peinado, cejas, gear, color de tinta y alias), tu banner y tu contacto (nombre de usuario y avatar de Discord${X ? ", y, si la vinculaste, tu @ de X" : ""}). Se trata de material de referencia visual para poder dibujarte o hacerte comisiones: el panel no permite descargar tu fichero de configuración ni los datos en bruto (muestra las opciones elegidas como referencia visual, nunca el arma ni la animación). El consentimiento es voluntario; si no marcas la casilla, tu personaje se guarda igual y no se comparte con nadie. Puedes retirar el consentimiento en cualquier momento contactando con el organizador por Discord y desasociaremos tu ficha de ese artista.</p>
<p><b>Normas de contenido:</b> todo lo que añadas a la web, alias, Splashtag (nombre, título, textos o imágenes), insignias o cualquier otro campo, tiene que ser respetuoso. No se permite contenido inapropiado, ofensivo, de odio, sexista, machista, racista, homófobo o sexual, ni símbolos de odio (por ejemplo, símbolos nazis). Si una cuenta incumple estas normas, podemos borrar ese contenido y <b>banear la cuenta de la web</b> sin previo aviso.</p>
<p><b>Edad mínima:</b> debes tener al menos 14 años para usar este servicio. Si eres menor de 14 años, necesitas el consentimiento de tu padre, madre o tutor legal.</p>
<p><b>Tus derechos:</b> puedes consultar, modificar o vaciar tu ficha en cualquier momento volviendo a entrar con ${X ? "tu cuenta de Discord o X" : "tu Discord"}. Para eliminar todos tus datos por completo, contacta con el organizador por Discord. Responderemos a solicitudes de acceso, rectificación o supresión en un plazo máximo de 30 días.</p>
<p><b>Conservación:</b> tus datos se mantienen mientras haya eventos de comunidad activos o hasta que solicites su eliminación.</p>
<p><b>Almacenamiento:</b> los datos se guardan en Supabase (base de datos y almacenamiento de archivos). Este sitio guarda en el almacenamiento local de tu navegador (localStorage) tu idioma preferido, el estado del generador de Splashtag, tu sesión de inicio (gestionada por Supabase Auth), una caché de las direcciones temporales de tus imágenes (banner y render, válidas 7 horas) y, si llegaste por el enlace de un artista, su código durante 24 horas. En el almacenamiento de sesión (sessionStorage, que se borra al cerrar la pestaña) guarda el borrador del formulario de reportes y, solo para artistas y administradores, la clave o el token de acceso a su panel. Sin cookies de terceros ni rastreo publicitario. Al diseñar tu banner con el generador integrado, confirmas que los datos que introduces (nombre, alias, ID) no infringen derechos de terceros.</p>
<h4>Créditos</h4>
<p>El creador de splattags está basado en el proyecto de código abierto <a href="https://github.com/SeymourSchlong/splashtags" target="_blank" rel="noopener">Splashtag Creator</a> (<a href="https://splashtagmaker.com/" target="_blank" rel="noopener">splashtagmaker.com</a>), licencia GPL-3.0. Todo el mérito es de sus autores:</p>
<ul>
  <li><b>seymour</b> (@spaghettitron) - creador de la web original</li>
  <li><b>LeanYoshi</b> - base de datos de Splatoon</li>
  <li><b>Raven_The_Cute</b> - traducciones</li>
  <li><b>DeadLineSMB</b> - banners Splatband</li>
  <li><b>ElectroDev</b> - banners de armas especiales</li>
  <li><b>Lucyfer</b> - banners Pride</li>
  <li><b>mya</b> - banners Grandfest</li>
  <li><b>Zeeto</b> - badges de bandas</li>
  <li><b>Sharkinodraws</b> - badges de huevos de Salmon Run</li>
</ul>
<p>Los datos e imágenes del juego (configurador de personaje) se cargan desde <a href="https://github.com/Flexlion/flexlion.github.io" target="_blank" rel="noopener">Flexlion</a>.</p>
<p>Los renders 3D de los personajes se generan con <a href="https://github.com/nvnprogram/HoianViewer" target="_blank" rel="noopener">HoianViewer</a>, de <b>nvnprogram</b>.</p>
<p>Lista completa en la <a href="https://splashtagmaker.com/credits/" target="_blank" rel="noopener">página de créditos original</a>. Fuentes, imágenes y datos de Splatoon son propiedad intelectual de Nintendo Co., Ltd.</p>`;
  return `
<p><b>Disclaimer:</b> This is a fan project made to organize community content. Any donations received go exclusively toward hosting and infrastructure costs. <b>It is not affiliated with, associated with, authorized, endorsed by, or in any way sponsored by Nintendo</b> or any of its subsidiaries.</p>
<p><b>Trademarks &amp; ownership:</b> "Splatoon", "Nintendo Switch", "Inkling", "Octoling" and associated logos are registered trademarks of Nintendo. Images, characters and other game assets are the intellectual property of Nintendo Co., Ltd. and/or its affiliates. Game artwork is shown for illustrative fan purposes only. All rights belong to their respective owners.</p>
<h4>Data we collect</h4>
<p>When you connect your Discord, we store the following:</p>
<ul>
  <li><b>Discord username and avatar</b> - to identify you within the community.</li>
  <li><b>Character configuration</b> - species, gender, skin tone, gear, ink color and alias you set in the form.</li>
  <li><b>Banner (PNG)</b> - generated with the built-in creator.</li>
  <li><b>Splattag generator settings</b> - if you used the built-in creator, we also save your design settings (chosen banner, name, title, badges…) so you can edit them later without losing your configuration.</li>
</ul>
${X ? `<p><b>X account (optional):</b> if you sign in with X or link your X account, your sheet only stores your username (@), display name, avatar and the account's numeric ID, for the same purpose of identifying you within the community. X also provides us with your confirmed email address, which is handled exclusively by the authentication system (Supabase Auth) to identify your account; it is not stored in your sheet or used to contact you. X's authorization screen asks for post reading and offline access because X technically requires them for sign-in: we do not read your posts, followers or messages, and nothing is ever posted on your behalf. You can unlink X at any time from the site header (as long as another account remains linked).</p>` : ""}
<p><b>Purpose:</b> exclusively to prepare content and photos for community events. We do not sell or share your data with third parties for advertising.</p>
<p><b>Artist links (optional):</b> some community artists have a personal link (URL with <code>?ref=</code>). If you sign up through one of those links and tick the consent box, you explicitly authorize that specific artist, the one named next to the box, to view inside a private panel your character configuration (species, gender, skin tone, eye color, hair, eyebrows, gear, ink color and alias), your banner and your contact (Discord username and avatar${X ? ", and, if you linked it, your X @" : ""}). This is visual reference material so they can draw or take commissions from you: the panel does not allow downloading your configuration file or the raw data (it shows the chosen options as visual reference, never your weapon or animation). Consent is voluntary; if you leave the box unticked, your character is saved as usual and shared with no one. You can withdraw consent at any time by contacting the organizer on Discord and your sheet will be disassociated from that artist.</p>
<p><b>Content rules:</b> everything you add to the site, alias, Splashtag (name, title, text or images), badges or any other field, must be respectful. Inappropriate, offensive, hateful, sexist, misogynistic, racist, homophobic or sexual content is not allowed, and neither are hate symbols (for example, Nazi symbols). If an account breaks these rules, we may remove that content and <b>ban the account from the site</b> without prior notice.</p>
<p><b>Minimum age:</b> you must be at least 14 years old to use this service. If you are under 14, you need parental or legal guardian consent.</p>
<p><b>Your rights:</b> you can view, edit or clear your sheet at any time by logging in again with ${X ? "your Discord or X account" : "your Discord"}. To fully delete your data, contact the organizer on Discord. We will respond to access, rectification or deletion requests within 30 days.</p>
<p><b>Retention:</b> your data is kept while community events are active, or until you request its deletion.</p>
<p><b>Storage:</b> data is stored in Supabase (database and file storage). This site keeps in your browser's local storage (localStorage) your preferred language, the Splashtag generator state, your sign-in session (managed by Supabase Auth), a cache of the temporary addresses of your images (banner and render, valid for 7 hours) and, if you arrived through an artist link, that artist's code for 24 hours. Session storage (sessionStorage, cleared when the tab closes) holds the draft of the feedback form and, for artists and administrators only, the key or token that opens their panel. No third-party cookies or advertising trackers. By designing your banner with the built-in generator, you confirm that the data you enter (name, alias, ID) does not infringe third-party rights.</p>
<h4>Credits</h4>
<p>The splattag creator is based on the open-source project <a href="https://github.com/SeymourSchlong/splashtags" target="_blank" rel="noopener">Splashtag Creator</a> (<a href="https://splashtagmaker.com/" target="_blank" rel="noopener">splashtagmaker.com</a>), GPL-3.0 license. All credit goes to its authors:</p>
<ul>
  <li><b>seymour</b> (@spaghettitron) - original website creator</li>
  <li><b>LeanYoshi</b> - Splatoon database</li>
  <li><b>Raven_The_Cute</b> - translation help</li>
  <li><b>DeadLineSMB</b> - Splatband banners</li>
  <li><b>ElectroDev</b> - special weapon banners</li>
  <li><b>Lucyfer</b> - Pride banners</li>
  <li><b>mya</b> - Grandfest banners</li>
  <li><b>Zeeto</b> - Splatband badges</li>
  <li><b>Sharkinodraws</b> - Salmon Run egg badges</li>
</ul>
<p>Game data and images (character configurator) are loaded from <a href="https://github.com/Flexlion/flexlion.github.io" target="_blank" rel="noopener">Flexlion</a>.</p>
<p>The 3D character renders are generated with <a href="https://github.com/nvnprogram/HoianViewer" target="_blank" rel="noopener">HoianViewer</a>, by <b>nvnprogram</b>.</p>
<p>Full list on the <a href="https://splashtagmaker.com/credits/" target="_blank" rel="noopener">original credits page</a>. Splatoon fonts, images and data are the intellectual property of Nintendo Co., Ltd.</p>`;
}
const _preIconPaths = {
  head: { vb: "0 0 256 256", d: "M128,24h0A104.12,104.12,0,0,0,24,128v56a24,24,0,0,0,24,24,24.11,24.11,0,0,0,14.18-4.64C74.33,194.53,95.6,184,128,184s53.67,10.52,65.81,19.35A24,24,0,0,0,232,184V128A104.12,104.12,0,0,0,128,24Zm88,104v8.87a166,166,0,0,0-40.94-18.22A167,167,0,0,0,146.19,41.9,88.14,88.14,0,0,1,216,128ZM128,44.27a152.47,152.47,0,0,1,30.4,70.46,170.85,170.85,0,0,0-60.84,0A153.31,153.31,0,0,1,128,44.27ZM109.81,41.9a167,167,0,0,0-28.87,76.76A166,166,0,0,0,40,136.88V128A88.14,88.14,0,0,1,109.81,41.9ZM211.66,191.11a8,8,0,0,1-8.44-.69C189.16,180.2,164.7,168,128,168S66.84,180.2,52.78,190.42a8,8,0,0,1-8.44.69A7.77,7.77,0,0,1,40,184V156.07a152,152,0,0,1,176,0V184A7.77,7.77,0,0,1,211.66,191.11Z" },
  cloth: { vb: "0 0 256 256", d: "M247.59,61.22,195.83,33A8,8,0,0,0,192,32H160a8,8,0,0,0-8,8,24,24,0,0,1-48,0,8,8,0,0,0-8-8H64a8,8,0,0,0-3.84,1L8.41,61.22A15.76,15.76,0,0,0,1.82,82.48l19.27,36.81A16.37,16.37,0,0,0,35.67,128H56v80a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16V128h20.34a16.37,16.37,0,0,0,14.58-8.71l19.27-36.81A15.76,15.76,0,0,0,247.59,61.22ZM35.67,112a.62.62,0,0,1-.41-.13L16.09,75.26,56,53.48V112ZM184,208H72V48h16.8a40,40,0,0,0,78.38,0H184Zm36.75-96.14a.55.55,0,0,1-.41.14H200V53.48l39.92,21.78Z" },
  shoes: { vb: "0 0 256 256", d: "M228.65,129.11l-60.73-20.24a24,24,0,0,1-14.32-13L130.39,41.6s0-.07,0-.1A16,16,0,0,0,110.25,33L34.53,60.49A16.05,16.05,0,0,0,24,75.53V192a16,16,0,0,0,16,16H240a16,16,0,0,0,16-16V167.06A40,40,0,0,0,228.65,129.11ZM115.72,48l7.11,16.63-21.56,7.85A8,8,0,0,0,104,88a7.91,7.91,0,0,0,2.73-.49l22.4-8.14,4.74,11.07-16.6,6A8,8,0,0,0,120,112a7.91,7.91,0,0,0,2.73-.49l17.6-6.4a40.24,40.24,0,0,0,7.68,10l-14.74,5.36A8,8,0,0,0,136,136a8.14,8.14,0,0,0,2.73-.48l28-10.18,56.87,18.95A24,24,0,0,1,238.93,160H40V75.53ZM40,192h0V176H240v16Z" },
  banner: { vb: "0 0 16 16", d: "M2 3.5h12v9H2v-9zm1.5 1.5v5.2l2.7-2.3 2.2 2 3.1-3.3V5H3.5z" }
};
function preIcon(kind, size = 14) {
  const p = _preIconPaths[kind];
  if (p)
    return `<svg viewBox="${p.vb}" width="${size}" height="${size}" fill="currentColor" aria-hidden="true" style="vertical-align:-2px"><path d="${p.d}"/></svg>`;
  if (kind === "ok")
    return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" style="vertical-align:-2px"><path d="M3 8.2l2.8 2.8 6.2-6.2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (kind === "none")
    return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" style="vertical-align:-2px"><path d="M4 8h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  return "";
}
function xSvg(size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.742 21.75l-7.563-11.179 7.056-8.321h-2.456l-5.691 6.714-4.54-6.714H2.359l7.29 10.776L2.25 21.75h2.456l6.035-7.118 4.818 7.118h6.191-.008zM7.739 3.818L18.81 20.182h-2.447L5.29 3.818h2.447z"/></svg>`;
}
function discordSvg(height = 20) {
  const width = Math.round(height * 126.644 / 96 * 10) / 10;
  return `<svg width="${width}" height="${height}" viewBox="0 0 126.644 96" aria-hidden="true"><path fill="#fff" d="M81.15,0c-1.2376,2.1973-2.3489,4.4704-3.3591,6.794-9.5975-1.4396-19.3718-1.4396-28.9945,0-.985-2.3236-2.1216-4.5967-3.3591-6.794-9.0166,1.5407-17.8059,4.2431-26.1405,8.0568C2.779,32.5304-1.6914,56.3725.5312,79.8863c9.6732,7.1476,20.5083,12.603,32.0505,16.0884,2.6014-3.4854,4.8998-7.1981,6.8698-11.0623-3.738-1.3891-7.3497-3.1318-10.8098-5.1523.9092-.6567,1.7932-1.3386,2.6519-1.9953,20.281,9.547,43.7696,9.547,64.0758,0,.8587.7072,1.7427,1.3891,2.6519,1.9953-3.4601,2.0457-7.0718,3.7632-10.835,5.1776,1.97,3.8642,4.2683,7.5769,6.8698,11.0623,11.5419-3.4854,22.3769-8.9156,32.0509-16.0631,2.626-27.2771-4.496-50.9172-18.817-71.8548C98.9811,4.2684,90.1918,1.5659,81.1752.0505l-.0252-.0505ZM42.2802,65.4144c-6.2383,0-11.4159-5.6575-11.4159-12.6535s4.9755-12.6788,11.3907-12.6788,11.5169,5.708,11.4159,12.6788c-.101,6.9708-5.026,12.6535-11.3907,12.6535ZM84.3576,65.4144c-6.2637,0-11.3907-5.6575-11.3907-12.6535s4.9755-12.6788,11.3907-12.6788,11.4917,5.708,11.3906,12.6788c-.101,6.9708-5.026,12.6535-11.3906,12.6535Z"/></svg>`;
}
init();
