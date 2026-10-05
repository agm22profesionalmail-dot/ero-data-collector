import { supabase } from "./supabase.js";
import { t, getLang } from "./i18n.js";
import { el, clear, toast } from "./ui.js";
import { ARTIST_TERMS_VERSION, artistTermsHtml } from "./artist_terms.js";
import { checkEmailDomain, suggestEmail } from "./email_check.js";
const REF_KEY = "edc_ref";
const APPLY_KEY = "edc_apply_pending";
const ss = {
  get(k) {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      sessionStorage.setItem(k, v);
    } catch {
    }
  },
  del(k) {
    try {
      sessionStorage.removeItem(k);
    } catch {
    }
  }
};
const REF_TTL_MS = 24 * 60 * 60 * 1e3;
const ls = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {
    }
  }
};
const SLUG_RE = /^[a-z0-9_-]{1,64}$/i;
export function captureRefFromUrl() {
  const slug = new URLSearchParams(window.location.search).get("ref");
  if (slug && SLUG_RE.test(slug)) {
    const v = slug.toLowerCase();
    ss.set(REF_KEY, v);
    ls.set(REF_KEY, JSON.stringify({ slug: v, at: Date.now() }));
  }
}
export function getRefSlug() {
  let slug = ss.get(REF_KEY);
  if (!slug) {
    try {
      const saved = JSON.parse(ls.get(REF_KEY) || "null");
      if (saved && Date.now() - saved.at < REF_TTL_MS)
        slug = saved.slug;
      else if (saved)
        ls.del(REF_KEY);
    } catch {
      ls.del(REF_KEY);
    }
  }
  return slug && SLUG_RE.test(slug) ? slug : null;
}
export function clearRef() {
  ss.del(REF_KEY);
  ls.del(REF_KEY);
}
let refArtistPromise = null;
export function resolveRefArtist() {
  if (refArtistPromise)
    return refArtistPromise;
  const slug = getRefSlug();
  if (!slug)
    return refArtistPromise = Promise.resolve(null);
  refArtistPromise = supabase.from("artists").select("id,name,slug").eq("slug", slug).maybeSingle().then(({ data, error }) => {
    if (error) {
      console.warn("artists ref:", error);
      return null;
    }
    return data?.id ? { id: data.id, name: data.name || slug, slug: data.slug } : null;
  }).catch((e) => {
    console.warn("artists ref:", e);
    return null;
  });
  return refArtistPromise;
}
export function needsRefConsent(artist, state) {
  return !!artist && !!state && !(state._linkedArtists || []).includes(artist.id);
}
export async function loadLinkedArtists(playerId = null) {
  try {
    let q = supabase.from("player_artists").select(playerId ? "artist_id,player_id" : "artist_id");
    if (playerId)
      q = q.eq("player_id", playerId);
    const { data, error } = await q;
    if (error) {
      console.warn("player_artists:", error);
      return [];
    }
    return (data || []).map((r) => r.artist_id);
  } catch (e) {
    console.warn("player_artists:", e);
    return [];
  }
}
export async function linkArtist(artistId, state, playerId = null) {
  const args = { p_artist_id: artistId };
  if (playerId)
    args.p_player_id = playerId;
  const { error } = await supabase.rpc("artist_link", args);
  if (error)
    throw error;
  if (state)
    state._linkedArtists = [...new Set([...state._linkedArtists || [], artistId])];
}
function withName(key, name) {
  const parts = t(key).split("{name}");
  const out = [];
  parts.forEach((p, i) => {
    if (p)
      out.push(p);
    if (i < parts.length - 1)
      out.push(el("b", {}, name));
  });
  return out;
}
export function renderRefConsent(container, artist, state, onChange) {
  clear(container);
  const input = el("input", { type: "checkbox" });
  input.checked = state._refConsent === true;
  input.addEventListener("change", () => {
    state._refConsent = input.checked;
    onChange && onChange(state);
  });
  container.append(el(
    "div",
    { class: "edc-card edc-ref-card" },
    el("div", { class: "edc-ref-kicker" }, t("ref_kicker")),
    el("p", { class: "edc-ref-text" }, ...withName("ref_intro", artist.name)),
    el("label", { class: "edc-check" }, input, el("span", {}, ...withName("ref_consent", artist.name))),
    el("div", { class: "edc-ref-note" }, t("ref_optional"))
  ));
}
export const CHAR_FIELDS = [
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
  "color"
];
export async function loadArtistVariant(artistId, playerId = null) {
  try {
    let q = supabase.from("player_artist_chars").select(CHAR_FIELDS.join(",")).eq("artist_id", artistId);
    if (playerId)
      q = q.eq("player_id", playerId);
    const { data, error } = await q.maybeSingle();
    if (error) {
      console.warn("player_artist_chars:", error);
      return null;
    }
    return data || null;
  } catch (e) {
    console.warn("player_artist_chars:", e);
    return null;
  }
}
export async function saveArtistVariant(artistId, state, playerId = null) {
  const args = {
    p_artist_id: artistId,
    p_player_type: state.player_type,
    p_hair: state.hair,
    p_bottom: state.bottom,
    p_bottom_var: state.bottom_variation,
    p_skin_tone: state.skin_tone,
    p_eye_brows: state.eye_brows,
    p_eye_color: state.eye_color,
    p_gear_head: state.gear_head,
    p_gear_head_v: state.gear_head_variation,
    p_gear_cloth: state.gear_cloth,
    p_gear_cloth_v: state.gear_cloth_variation,
    p_gear_shoes: state.gear_shoes,
    p_gear_shoes_v: state.gear_shoes_variation,
    p_weapon_main: state.weapon_main,
    p_anim_name: state.anim_name,
    p_color: state.color
  };
  if (playerId)
    args.p_player_id = playerId;
  const { error } = await supabase.rpc("artist_save_char", args);
  if (error)
    throw error;
  state._linkedArtists = [...new Set([...state._linkedArtists || [], artistId])];
}
const BETA_FULL = true;
export const isApplyRoute = () => new URLSearchParams(window.location.search).has("apply");
export function goApply() {
  if (isApplyRoute())
    return false;
  history.pushState(null, "", window.location.pathname + "?apply");
  return true;
}
export function goHome() {
  if (!isApplyRoute())
    return false;
  history.pushState(null, "", window.location.pathname);
  return true;
}
export function restoreApplyRoute() {
  if (ss.get(APPLY_KEY) !== "1")
    return;
  ss.del(APPLY_KEY);
  if (!isApplyRoute())
    history.replaceState(null, "", window.location.pathname + "?apply");
}
const markApplyPending = () => ss.set(APPLY_KEY, "1");
const DISCORD_INVITE = "https://discord.gg/Hckay4PGNR";
function discordHint(svg) {
  return el(
    "div",
    { class: "edc-apply-discord-hint" },
    el("span", {}, t("apply_discord_hint")),
    el(
      "a",
      { class: "edc-apply-discord-join", href: DISCORD_INVITE, target: "_blank", rel: "noopener noreferrer" },
      el("span", { html: svg || "" }),
      t("apply_discord_join")
    )
  );
}
let draft = { name: "", email: "", portfolio: "", reason: "", terms: false };
let sent = false;
async function submitRequest({ discord_id, name, email, portfolio, reason }) {
  const preferred_lang = getLang() === "es" ? "es" : "en";
  const { error } = await supabase.from("artists").insert({
    discord_id,
    name,
    email,
    portfolio: portfolio || null,
    reason: reason || null,
    preferred_lang,
    status: "pending",
    terms_version: ARTIST_TERMS_VERSION
  });
  if (error?.code === "23505")
    return reapply({ discord_id, name, email, portfolio, reason, preferred_lang });
  if (error)
    throw error;
}
async function reapply({ discord_id, name, email, portfolio, reason, preferred_lang }) {
  const { data, error } = await supabase.rpc("artist_reapply", {
    p_discord_id: discord_id,
    p_name: name,
    p_email: email,
    p_portfolio: portfolio || null,
    p_reason: reason || null,
    p_lang: preferred_lang,
    p_terms_version: ARTIST_TERMS_VERSION
  });
  if (!error && data === "reapplied")
    return;
  if (!error && data === "approved")
    throw { code: "approved" };
  if (error && error.code !== "PGRST202")
    throw error;
  throw { code: "23505" };
}
function validPortfolio(v) {
  if (!v)
    return true;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function validEmail(v) {
  return typeof v === "string" && v.length >= 5 && v.length <= 320 && EMAIL_RE.test(v);
}
export function renderArtistApply(container, { session, profile, actions }) {
  clear(container);
  const wrap = el("div", { class: "edc-apply" });
  container.append(wrap);
  const backLink = () => el(
    "button",
    { class: "edc-btn-link", onClick: actions.back },
    t(session?.user ? "apply_back" : "apply_back_home")
  );
  const card = el("div", { class: "edc-card" });
  wrap.append(card);
  if (BETA_FULL && !sent) {
    card.append(el(
      "div",
      { class: "edc-beta-full", role: "note" },
      el("img", { class: "edc-beta-full-img", src: "assets/email-hero-rejected.jpg", alt: "", width: "1200", height: "500" }),
      el(
        "div",
        { class: "edc-beta-full-text" },
        el("strong", {}, t("apply_full_title")),
        el("span", {}, t("apply_full_desc"))
      )
    ));
  }
  card.append(el("div", { class: "edc-section-title" }, t("apply_title")));
  card.append(el("p", { class: "edc-apply-intro" }, t("apply_intro")));
  if (sent) {
    card.append(el(
      "div",
      { class: "edc-apply-done" },
      el("div", { class: "edc-apply-done-title" }, t("apply_done_title")),
      el("p", { class: "edc-apply-intro" }, t("apply_done")),
      discordHint(actions.discordSvg ? actions.discordSvg() : ""),
      backLink()
    ));
    return;
  }
  const hasDiscord = !!(session?.user && profile?.hasDiscord && profile?.discord_id);
  if (!hasDiscord) {
    const needsLink = !!session?.user;
    card.append(el("p", { class: "edc-apply-intro edc-apply-need" }, t(needsLink ? "apply_link_discord" : "apply_need_discord")));
    card.append(el(
      "div",
      { class: "edc-apply-actions" },
      el("button", {
        class: "edc-btn edc-btn-discord",
        onClick: () => {
          markApplyPending();
          (needsLink ? actions.linkDiscord : actions.login)();
        }
      }, el("span", { html: actions.discordSvg ? actions.discordSvg() : "" }), t(needsLink ? "link_discord" : "login_btn")),
      backLink()
    ));
    return;
  }
  if (!draft.name)
    draft.name = profile.discord_name || "";
  const as = el("div", { class: "edc-apply-as" }, t("apply_as") + ":");
  if (profile.discord_avatar)
    as.append(el("img", { src: profile.discord_avatar, alt: "" }));
  as.append(el("strong", {}, profile.discord_name || profile.display_name || "Discord"));
  card.append(as);
  const errBox = el("div", { class: "edc-banner-err", hidden: "" });
  const showErr = (msg, ...extra) => {
    errBox.replaceChildren(msg, ...extra);
    errBox.hidden = !msg;
  };
  let suggestedFor = "";
  card.append(el("label", { class: "edc-label" }, t("apply_name")));
  const name = el("input", { class: "edc-input", type: "text", maxlength: "60", placeholder: t("apply_name_ph"), value: draft.name, autocomplete: "nickname" });
  name.addEventListener("input", () => {
    draft.name = name.value;
    name.classList.remove("error");
    showErr("");
  });
  card.append(name);
  card.append(el("label", { class: "edc-label" }, t("apply_email")));
  if (!draft.email)
    draft.email = session?.user?.email || "";
  const email = el("input", { class: "edc-input", type: "email", maxlength: "254", placeholder: t("apply_email_ph"), value: draft.email, autocomplete: "email", inputmode: "email" });
  email.addEventListener("input", () => {
    draft.email = email.value;
    email.classList.remove("error");
    showErr("");
  });
  card.append(email);
  card.append(discordHint(actions.discordSvg ? actions.discordSvg() : ""));
  card.append(el("label", { class: "edc-label" }, t("apply_portfolio")));
  const portfolio = el("input", { class: "edc-input", type: "url", maxlength: "200", placeholder: "https://…", value: draft.portfolio, autocomplete: "url", inputmode: "url" });
  portfolio.addEventListener("input", () => {
    draft.portfolio = portfolio.value;
    portfolio.classList.remove("error");
    showErr("");
  });
  card.append(portfolio);
  card.append(el("label", { class: "edc-label" }, t("apply_reason")));
  const reason = el("textarea", { class: "edc-input edc-textarea", maxlength: "500", placeholder: t("apply_reason_ph"), rows: "4" });
  reason.value = draft.reason;
  reason.addEventListener("input", () => {
    draft.reason = reason.value;
  });
  card.append(reason);
  card.append(el("label", { class: "edc-label" }, t("artist_terms_title")));
  card.append(el("div", { class: "edc-terms-box", tabindex: "0", html: artistTermsHtml(getLang()) }));
  const terms = el("input", { type: "checkbox", id: "edcTermsAccept" });
  terms.checked = !!draft.terms;
  const termsRow = el("label", { class: "edc-terms-accept", for: "edcTermsAccept" }, terms, el("span", {}, t("apply_terms_accept")));
  terms.addEventListener("change", () => {
    draft.terms = terms.checked;
    termsRow.classList.remove("error");
    showErr("");
  });
  card.append(termsRow);
  card.append(errBox);
  card.append(el("p", { class: "edc-apply-privacy" }, t("apply_privacy")));
  const submit = el("button", { class: "edc-btn edc-btn-primary" }, t("apply_submit"));
  const status = el("span", { class: "edc-save-status" });
  submit.addEventListener("click", async () => {
    const n = draft.name.trim();
    const em = draft.email.trim();
    const p = draft.portfolio.trim();
    const r = draft.reason.trim();
    if (!n) {
      name.classList.add("error");
      showErr(t("apply_name_required"));
      name.focus();
      return;
    }
    if (!validEmail(em)) {
      email.classList.add("error");
      showErr(t("apply_email_invalid"));
      email.focus();
      return;
    }
    const fix = suggestEmail(em);
    if (fix && suggestedFor !== em) {
      suggestedFor = em;
      email.classList.add("error");
      const use = el("button", { class: "edc-btn-link", type: "button", onClick: () => {
        draft.email = fix;
        email.value = fix;
        email.classList.remove("error");
        showErr("");
        email.focus();
      } }, t("apply_email_suggest_use"));
      showErr(t("apply_email_suggest").replace("{email}", fix) + " ", use, el("br"), t("apply_email_suggest_keep"));
      return;
    }
    if (!validPortfolio(p)) {
      portfolio.classList.add("error");
      showErr(t("apply_portfolio_invalid"));
      portfolio.focus();
      return;
    }
    if (!terms.checked) {
      termsRow.classList.add("error");
      showErr(t("apply_terms_required"));
      terms.focus();
      return;
    }
    submit.disabled = true;
    status.className = "edc-save-status";
    status.textContent = t("apply_email_checking");
    if (await checkEmailDomain(em) === "dead") {
      submit.disabled = false;
      status.textContent = "";
      email.classList.add("error");
      showErr(t("apply_email_dead"));
      email.focus();
      return;
    }
    status.textContent = t("apply_sending");
    try {
      await submitRequest({ discord_id: profile.discord_id, name: n, email: em, portfolio: p, reason: r });
      sent = true;
      draft = { name: "", email: "", portfolio: "", reason: "", terms: false };
      toast(t("apply_done_title"), "ok");
      renderArtistApply(container, { session, profile, actions });
    } catch (e) {
      const dup = e?.code === "23505" || e?.code === "approved";
      const msg = e?.code === "approved" ? t("apply_already_approved") : dup ? t("apply_dup") : t("apply_err") + (e?.message || t("link_err_generic"));
      status.className = "edc-save-status err";
      status.textContent = msg;
      toast(msg, "err");
      if (!dup)
        console.warn("artists.insert:", e);
      submit.disabled = false;
    }
  });
  card.append(el("div", { class: "edc-apply-actions" }, submit, status, backLink()));
}
