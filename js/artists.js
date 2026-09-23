// Sistema de artistas — dos piezas, ambas SOLO se activan por la URL:
//
//  1) Enlace de artista (?ref=<slug>): un artista aprobado reparte
//     https://<web>/?ref=<slug>. Quien se registra por ahí puede aceptar
//     (consentimiento explícito, RGPD) que el artista vea su personaje y su
//     contacto. El slug se guarda en sessionStorage + localStorage (24 h)
//     porque el OAuth vuelve a origin+pathname SIN la query y el ?ref se perdería.
//
//  2) Solicitud de acceso (?apply): un artista pide acceso con su cuenta de
//     Discord; queda en `artists` con status=pending hasta que se aprueba a
//     mano (fuera de esta web).
//
// Sin ?ref ni ?apply, nada de este módulo cambia el flujo de la web.
import { supabase } from "./supabase.js";
import { t, getLang } from "./i18n.js";
import { el, clear, toast } from "./ui.js";
import { ARTIST_TERMS_VERSION, artistTermsHtml } from "./artist_terms.js";

const REF_KEY = "edc_ref";              // slug del artista (sessionStorage)
const APPLY_KEY = "edc_apply_pending";  // "1" si se fue al OAuth desde ?apply

// sessionStorage puede lanzar (modo privado, storage bloqueado): nunca rompe la web
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* sin storage: se sigue sin ref */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* nada */ } },
};

// El ref va a localStorage con caducidad (no a sessionStorage): en móvil el
// OAuth de Discord puede volver en OTRA pestaña (app de Discord → navegador) y
// sessionStorage se pierde con ella. Caduca a las 24 h para no asociar a nadie
// días después de haber pulsado un enlace.
const REF_TTL_MS = 24 * 60 * 60 * 1000;
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin storage */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
};

// Solo slugs "de URL": letras, números, guion y guion bajo (hasta 64)
const SLUG_RE = /^[a-z0-9_-]{1,64}$/i;

// ── 1) Enlace de artista (?ref) ───────────────────────────────────────

// Llamar al arrancar, ANTES de cualquier replaceState: si la URL trae
// ?ref=<slug> válido, se guarda para que sobreviva al redirect del OAuth.
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
      if (saved && Date.now() - saved.at < REF_TTL_MS) slug = saved.slug;
      else if (saved) ls.del(REF_KEY);
    } catch { ls.del(REF_KEY); }
  }
  return slug && SLUG_RE.test(slug) ? slug : null;
}

export function clearRef() { ss.del(REF_KEY); ls.del(REF_KEY); }

// Resuelve el slug contra `artists` (solo artistas aprobados: lo garantiza la
// política RLS artists_public_select; anon solo tiene grant de id/name/slug).
// NO se usa la vista artists_public: es security_invoker y filtra por
// `status`, columna sin grant para anon/authenticated → "permission denied" y
// el ?ref se descartaba en silencio.
// Una sola consulta por carga: se cachea la promesa. Devuelve {id, name, slug}
// o null (sin ref, slug desconocido o error de red → como si no hubiera ref).
let refArtistPromise = null;
export function resolveRefArtist() {
  if (refArtistPromise) return refArtistPromise;
  const slug = getRefSlug();
  if (!slug) return (refArtistPromise = Promise.resolve(null));
  refArtistPromise = supabase.from("artists").select("id,name,slug").eq("slug", slug).maybeSingle()
    .then(({ data, error }) => {
      if (error) { console.warn("artists ref:", error); return null; }
      return data?.id ? { id: data.id, name: data.name || slug, slug: data.slug } : null;
    })
    .catch((e) => { console.warn("artists ref:", e); return null; });
  return refArtistPromise;
}

// ¿Toca mostrar el consentimiento? Hay artista resuelto y el jugador aún NO
// está asociado a ESE artista. Un jugador puede estar con varios artistas a la
// vez (tabla player_artists, migración 20260922_07): asociarse a uno nuevo no
// quita la ficha a los anteriores.
export function needsRefConsent(artist, state) {
  return !!artist && !!state && !(state._linkedArtists || []).includes(artist.id);
}

// Artistas a los que el jugador ya está asociado (RLS: solo sus filas).
// Si falla (red, tabla aún no migrada) → [] y se pide consentimiento de nuevo,
// que es lo seguro: artist_link es idempotente.
export async function loadLinkedArtists() {
  try {
    const { data, error } = await supabase.from("player_artists").select("artist_id");
    if (error) { console.warn("player_artists:", error); return []; }
    return (data || []).map((r) => r.artist_id);
  } catch (e) { console.warn("player_artists:", e); return []; }
}

// Asocia al jugador con el artista (con consentimiento). No toca a los demás.
export async function linkArtist(artistId, state) {
  const { error } = await supabase.rpc("artist_link", { p_artist_id: artistId });
  if (error) throw error;
  if (state) state._linkedArtists = [...new Set([...(state._linkedArtists || []), artistId])];
}

// "Texto con {name}" → nodos, con el nombre en negrita y sin innerHTML
// (el nombre lo escribe el artista: no se inyecta como HTML).
function withName(key, name) {
  const parts = t(key).split("{name}");
  const out = [];
  parts.forEach((p, i) => { if (p) out.push(p); if (i < parts.length - 1) out.push(el("b", {}, name)); });
  return out;
}

// Bloque de consentimiento (card destacada) dentro del editor. El check vive
// en state._refConsent para sobrevivir a los repintados del editor.
export function renderRefConsent(container, artist, state, onChange) {
  clear(container);
  const input = el("input", { type: "checkbox" });
  input.checked = state._refConsent === true;
  input.addEventListener("change", () => { state._refConsent = input.checked; onChange && onChange(state); });
  container.append(el("div", { class: "edc-card edc-ref-card" },
    el("div", { class: "edc-ref-kicker" }, t("ref_kicker")),
    el("p", { class: "edc-ref-text" }, ...withName("ref_intro", artist.name)),
    el("label", { class: "edc-check" }, input, el("span", {}, ...withName("ref_consent", artist.name))),
    el("div", { class: "edc-ref-note" }, t("ref_optional")),
  ));
}

// Campos del personaje que forman una "versión para un artista"
// (mismos nombres en players y en player_artist_chars).
export const CHAR_FIELDS = [
  "player_type", "hair", "bottom", "bottom_variation", "skin_tone", "eye_brows", "eye_color",
  "gear_head", "gear_head_variation", "gear_cloth", "gear_cloth_variation",
  "gear_shoes", "gear_shoes_variation", "weapon_main", "anim_name", "color",
];

// Versión ya guardada del jugador para ese artista (RLS: solo las suyas) o null.
export async function loadArtistVariant(artistId) {
  try {
    const { data, error } = await supabase.from("player_artist_chars")
      .select(CHAR_FIELDS.join(",")).eq("artist_id", artistId).maybeSingle();
    if (error) { console.warn("player_artist_chars:", error); return null; }
    return data || null;
  } catch (e) { console.warn("player_artist_chars:", e); return null; }
}

// Guarda (o actualiza) la variante de personaje que el jugador crea
// específicamente para un artista. No toca la ficha principal del jugador.
// Llama al RPC artist_save_char (migración 20260922_01/07), que además asocia
// al jugador con ese artista.
export async function saveArtistVariant(artistId, state) {
  const { error } = await supabase.rpc("artist_save_char", {
    p_artist_id:   artistId,
    p_player_type: state.player_type,
    p_hair:        state.hair,
    p_bottom:      state.bottom,
    p_bottom_var:  state.bottom_variation,
    p_skin_tone:   state.skin_tone,
    p_eye_brows:   state.eye_brows,
    p_eye_color:   state.eye_color,
    p_gear_head:   state.gear_head,
    p_gear_head_v: state.gear_head_variation,
    p_gear_cloth:  state.gear_cloth,
    p_gear_cloth_v: state.gear_cloth_variation,
    p_gear_shoes:  state.gear_shoes,
    p_gear_shoes_v: state.gear_shoes_variation,
    p_weapon_main: state.weapon_main,
    p_anim_name:   state.anim_name,
    p_color:       state.color,
  });
  if (error) throw error;
  state._linkedArtists = [...new Set([...(state._linkedArtists || []), artistId])];
}

// ── 2) Solicitud de acceso (?apply) ───────────────────────────────────

export const isApplyRoute = () => new URLSearchParams(window.location.search).has("apply");

// Navegación: ?apply ↔ inicio. Devuelven true si cambió la URL.
export function goApply() {
  if (isApplyRoute()) return false;
  history.pushState(null, "", window.location.pathname + "?apply");
  return true;
}
export function goHome() {
  if (!isApplyRoute()) return false;
  history.pushState(null, "", window.location.pathname);
  return true;
}

// Al volver del OAuth iniciado desde ?apply la query se ha perdido: se
// restaura antes de enrutar. Llamar al arrancar.
export function restoreApplyRoute() {
  if (ss.get(APPLY_KEY) !== "1") return;
  ss.del(APPLY_KEY);
  if (!isApplyRoute()) history.replaceState(null, "", window.location.pathname + "?apply");
}
const markApplyPending = () => ss.set(APPLY_KEY, "1");

// Borrador del formulario: sobrevive a los repintados de la vista (cambio de
// idioma, refresco de token → route()) para no perder lo tecleado.
let draft = { name: "", email: "", portfolio: "", reason: "", terms: false };
let sent = false; // ya enviada en esta carga → pantalla de "enviada"

// Inserta la solicitud. RLS (migración 20260916_03 + 20260920_06) solo deja
// insertar status=pending sin slug/clave, exige email válido y preferred_lang
// en ('en','es'). Sin .select(): no hay política de lectura. El idioma se
// captura del getLang() en el instante del envío para que el email de
// aprobación salga en el idioma que el artista tenía en la web.
async function submitRequest({ discord_id, name, email, portfolio, reason }) {
  const preferred_lang = getLang() === "es" ? "es" : "en";
  // terms_version: la política exige que venga; terms_accepted_at lo pone un
  // trigger con la hora del servidor (migración 20260922_05), no el cliente.
  const { error } = await supabase.from("artists").insert({
    discord_id, name, email,
    portfolio: portfolio || null, reason: reason || null,
    preferred_lang, status: "pending",
    terms_version: ARTIST_TERMS_VERSION,
  });
  if (error) throw error;
}

// Portfolio: vacío o URL http(s) válida
function validPortfolio(v) {
  if (!v) return true;
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}

// Email: mismo regex que la política SQL para dar el error en la web y no
// tener que redondear el trip a Supabase.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function validEmail(v) { return typeof v === "string" && v.length >= 5 && v.length <= 320 && EMAIL_RE.test(v); }

// Vista completa de solicitud. `session`/`profile` los da app.js; `actions`:
//  - login(): abre el OAuth de Discord (login existente)
//  - linkDiscord(): vincula Discord a la sesión actual (X sin Discord)
//  - back(): vuelve al inicio
export function renderArtistApply(container, { session, profile, actions }) {
  clear(container);
  const wrap = el("div", { class: "edc-apply" });
  container.append(wrap);

  const backLink = () => el("button", { class: "edc-btn-link", onClick: actions.back },
    t(session?.user ? "apply_back" : "apply_back_home"));

  const card = el("div", { class: "edc-card" });
  wrap.append(card);
  card.append(el("div", { class: "edc-section-title" }, t("apply_title")));
  card.append(el("p", { class: "edc-apply-intro" }, t("apply_intro")));

  if (sent) {
    card.append(el("div", { class: "edc-apply-done" },
      el("div", { class: "edc-apply-done-title" }, t("apply_done_title")),
      el("p", { class: "edc-apply-intro" }, t("apply_done")),
      backLink()));
    return;
  }

  const hasDiscord = !!(session?.user && profile?.hasDiscord && profile?.discord_id);

  // Sin sesión: entrar con Discord. Con sesión de X sin Discord: vincular.
  if (!hasDiscord) {
    const needsLink = !!session?.user;
    card.append(el("p", { class: "edc-apply-intro edc-apply-need" }, t(needsLink ? "apply_link_discord" : "apply_need_discord")));
    card.append(el("div", { class: "edc-apply-actions" },
      el("button", {
        class: "edc-btn edc-btn-discord",
        onClick: () => { markApplyPending(); (needsLink ? actions.linkDiscord : actions.login)(); },
      }, el("span", { html: actions.discordSvg ? actions.discordSvg() : "" }), t(needsLink ? "link_discord" : "login_btn")),
      backLink()));
    return;
  }

  // Formulario
  if (!draft.name) draft.name = profile.discord_name || "";
  const as = el("div", { class: "edc-apply-as" }, t("apply_as") + ":");
  if (profile.discord_avatar) as.append(el("img", { src: profile.discord_avatar, alt: "" }));
  as.append(el("strong", {}, profile.discord_name || profile.display_name || "Discord"));
  card.append(as);

  const errBox = el("div", { class: "edc-banner-err", hidden: "" });
  const showErr = (msg) => { errBox.textContent = msg; errBox.hidden = !msg; };

  card.append(el("label", { class: "edc-label" }, t("apply_name")));
  const name = el("input", { class: "edc-input", type: "text", maxlength: "60", placeholder: t("apply_name_ph"), value: draft.name, autocomplete: "nickname" });
  name.addEventListener("input", () => { draft.name = name.value; name.classList.remove("error"); showErr(""); });
  card.append(name);

  // Email: donde le llegará la clave del panel si se aprueba. Autocompletado
  // con el email de la sesión (Google/Discord) si existe; el artista puede
  // reescribirlo si prefiere otro.
  card.append(el("label", { class: "edc-label" }, t("apply_email")));
  if (!draft.email) draft.email = session?.user?.email || "";
  const email = el("input", { class: "edc-input", type: "email", maxlength: "254", placeholder: t("apply_email_ph"), value: draft.email, autocomplete: "email", inputmode: "email" });
  email.addEventListener("input", () => { draft.email = email.value; email.classList.remove("error"); showErr(""); });
  card.append(email);

  card.append(el("label", { class: "edc-label" }, t("apply_portfolio")));
  const portfolio = el("input", { class: "edc-input", type: "url", maxlength: "200", placeholder: "https://…", value: draft.portfolio, autocomplete: "url", inputmode: "url" });
  portfolio.addEventListener("input", () => { draft.portfolio = portfolio.value; portfolio.classList.remove("error"); showErr(""); });
  card.append(portfolio);

  card.append(el("label", { class: "edc-label" }, t("apply_reason")));
  const reason = el("textarea", { class: "edc-input edc-textarea", maxlength: "500", placeholder: t("apply_reason_ph"), rows: "4" });
  reason.value = draft.reason;
  reason.addEventListener("input", () => { draft.reason = reason.value; });
  card.append(reason);

  // Términos del programa: se leen aquí mismo, antes de enviar, y hay que
  // aceptarlos de forma explícita (casilla sin marcar por defecto).
  card.append(el("label", { class: "edc-label" }, t("artist_terms_title")));
  card.append(el("div", { class: "edc-terms-box", tabindex: "0", html: artistTermsHtml(getLang()) }));
  const terms = el("input", { type: "checkbox", id: "edcTermsAccept" });
  terms.checked = !!draft.terms;
  const termsRow = el("label", { class: "edc-terms-accept", for: "edcTermsAccept" }, terms, el("span", {}, t("apply_terms_accept")));
  terms.addEventListener("change", () => { draft.terms = terms.checked; termsRow.classList.remove("error"); showErr(""); });
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
    if (!n) { name.classList.add("error"); showErr(t("apply_name_required")); name.focus(); return; }
    if (!validEmail(em)) { email.classList.add("error"); showErr(t("apply_email_invalid")); email.focus(); return; }
    if (!validPortfolio(p)) { portfolio.classList.add("error"); showErr(t("apply_portfolio_invalid")); portfolio.focus(); return; }
    if (!terms.checked) { termsRow.classList.add("error"); showErr(t("apply_terms_required")); terms.focus(); return; }
    submit.disabled = true; status.className = "edc-save-status"; status.textContent = t("apply_sending");
    try {
      await submitRequest({ discord_id: profile.discord_id, name: n, email: em, portfolio: p, reason: r });
      sent = true;
      draft = { name: "", email: "", portfolio: "", reason: "", terms: false };
      toast(t("apply_done_title"), "ok");
      renderArtistApply(container, { session, profile, actions });
    } catch (e) {
      // 23505 = unique_violation (artists.discord_id): ya hay una solicitud
      const dup = e?.code === "23505";
      const msg = dup ? t("apply_dup") : t("apply_err") + (e?.message || t("link_err_generic"));
      status.className = "edc-save-status err"; status.textContent = msg;
      toast(msg, "err");
      if (!dup) console.warn("artists.insert:", e);
      submit.disabled = false;
    }
  });
  card.append(el("div", { class: "edc-apply-actions" }, submit, status, backLink()));
}
