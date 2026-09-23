// Reportes y sugerencias (?feedback)
//
// Formulario público para avisar de un fallo o proponer una mejora. Se pide
// un contacto obligatorio para poder responder, a elegir:
//  - Email: formato + errata en dominios comunes + DNS (MX/A) como en ?apply.
//  - Discord: sesión con Discord Y ser miembro de ZeroServer (el bot solo
//    puede escribir por mensaje directo a quien comparte servidor con él).
//
// Todo lo valida también la Edge Function submit-feedback (anti-spam, DNS,
// pertenencia al servidor, identidad de Discord sacada del JWT). Esta vista
// solo evita viajes inútiles y traduce los códigos de error.
//
// Sin ?feedback, nada de este módulo cambia el flujo de la web.
import { supabase } from "./supabase.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { t, getLang } from "./i18n.js";
import { el, clear, toast } from "./ui.js";
import { checkEmailDomain, suggestEmail } from "./email_check.js";

const PENDING_KEY = "edc_feedback_pending"; // "1" si se fue al OAuth desde ?feedback
const DRAFT_KEY = "edc_feedback_draft";     // borrador (sobrevive al OAuth)
const DISCORD_INVITE = "https://discord.gg/Hckay4PGNR";
const FN_URL = `${SUPABASE_URL}/functions/v1/submit-feedback`;

export const KINDS = ["bug", "suggestion", "other"];
export const MSG_MIN = 10;
export const MSG_MAX = 2000;

// sessionStorage puede lanzar (modo privado, storage bloqueado): nunca rompe la web
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* sin storage */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* nada */ } },
};

// ── Ruta ──────────────────────────────────────────────────────────────
export const isFeedbackRoute = () => new URLSearchParams(window.location.search).has("feedback");

// Navegación: ?feedback ↔ inicio. Devuelven true si cambió la URL.
export function goFeedback() {
  if (isFeedbackRoute()) return false;
  history.pushState(null, "", window.location.pathname + "?feedback");
  return true;
}
export function leaveFeedback() {
  if (!isFeedbackRoute()) return false;
  history.pushState(null, "", window.location.pathname);
  return true;
}

// Al volver del OAuth iniciado desde ?feedback la query se ha perdido: se
// restaura antes de enrutar. Llamar al arrancar.
export function restoreFeedbackRoute() {
  if (ss.get(PENDING_KEY) !== "1") return;
  ss.del(PENDING_KEY);
  if (!isFeedbackRoute()) history.replaceState(null, "", window.location.pathname + "?feedback");
}
const markPending = () => ss.set(PENDING_KEY, "1");

// ── Borrador ──────────────────────────────────────────────────────────
// Sobrevive a los repintados (idioma, refresco de token) y al viaje OAuth.
const emptyDraft = () => ({ kind: "bug", message: "", method: "email", email: "" });
let draft = loadDraft();
let sent = false;           // enviado en esta carga → pantalla de "gracias"
let memberCache = null;     // { userId, member } de la última comprobación

function loadDraft() {
  try {
    const d = JSON.parse(ss.get(DRAFT_KEY) || "null");
    if (!d || typeof d !== "object") return emptyDraft();
    return {
      kind: KINDS.includes(d.kind) ? d.kind : "bug",
      message: typeof d.message === "string" ? d.message.slice(0, MSG_MAX) : "",
      method: d.method === "discord" ? "discord" : "email",
      email: typeof d.email === "string" ? d.email.slice(0, 254) : "",
    };
  } catch { return emptyDraft(); }
}
function saveDraft() { ss.set(DRAFT_KEY, JSON.stringify(draft)); }
function resetDraft() { draft = emptyDraft(); ss.del(DRAFT_KEY); }

// ── Llamadas a la Edge Function ───────────────────────────────────────
async function callFn(body, accessToken) {
  const headers = { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY };
  headers.Authorization = `Bearer ${accessToken || SUPABASE_ANON_KEY}`;
  const r = await fetch(FN_URL, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  let j = null;
  try { j = await r.json(); } catch { /* sin cuerpo */ }
  if (j && typeof j.ok === "boolean") return j;
  return { ok: false, error: "server" };
}

async function accessToken() {
  try { return (await supabase.auth.getSession()).data?.session?.access_token || null; }
  catch { return null; }
}

// Códigos de la función → texto. Cualquier código desconocido, genérico.
const ERR_KEYS = {
  bad_request: "fb_err_bad_request", email_dead: "fb_err_email_dead", not_member: "fb_err_not_member",
  not_logged: "fb_err_not_logged", rate_limited: "fb_err_rate_limited", server: "fb_err_server",
};
const errText = (code) => t(ERR_KEYS[code] || "fb_err_server");

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const validEmail = (v) => typeof v === "string" && v.length >= 5 && v.length <= 254 && EMAIL_RE.test(v);

// ── Vista ─────────────────────────────────────────────────────────────
// `session`/`profile` los da app.js; `actions`:
//  - login(): abre el OAuth de Discord (login existente)
//  - linkDiscord(): vincula Discord a la sesión actual (X sin Discord)
//  - back(): vuelve al inicio
//  - discordSvg(): logo de Discord
export function renderFeedback(container, { session, profile, actions }) {
  clear(container);
  const wrap = el("div", { class: "edc-apply" });
  container.append(wrap);
  const svg = actions.discordSvg ? actions.discordSvg() : "";

  const backLink = () => el("button", { class: "edc-btn-link", type: "button", onClick: actions.back },
    t(session?.user ? "apply_back" : "apply_back_home"));

  const card = el("div", { class: "edc-card" });
  wrap.append(card);
  card.append(el("h2", { class: "edc-section-title" }, t("fb_title")));

  if (sent) {
    card.append(el("div", { class: "edc-apply-done", role: "status" },
      el("div", { class: "edc-apply-done-title" }, t("fb_done_title")),
      el("p", { class: "edc-apply-intro" }, t("fb_done")),
      backLink()));
    return;
  }

  card.append(el("p", { class: "edc-apply-intro" }, t("fb_intro")));

  const errBox = el("div", { class: "edc-banner-err", id: "fbErr", role: "alert", "aria-live": "assertive", hidden: "" });
  const showErr = (msg, ...extra) => { errBox.replaceChildren(msg, ...extra); errBox.hidden = !msg; };

  // Tipo (botones segmentados)
  card.append(el("span", { class: "edc-label", id: "fbKindLabel" }, t("fb_kind")));
  const kindBtns = {};
  const seg = el("div", { class: "edc-seg", role: "group", "aria-labelledby": "fbKindLabel" });
  for (const k of KINDS) {
    const b = el("button", { class: "edc-btn edc-btn-sm edc-seg-btn", type: "button", "aria-pressed": String(draft.kind === k) }, t("fb_kind_" + k));
    b.addEventListener("click", () => {
      draft.kind = k; saveDraft();
      for (const [kk, bb] of Object.entries(kindBtns)) bb.setAttribute("aria-pressed", String(kk === k));
    });
    kindBtns[k] = b;
    seg.append(b);
  }
  card.append(seg);

  // Mensaje + contador
  card.append(el("label", { class: "edc-label", for: "fbMessage" }, t("fb_message")));
  const counter = el("span", { class: "edc-fb-counter", id: "fbCounter", "aria-live": "polite" });
  const message = el("textarea", {
    class: "edc-input edc-textarea edc-fb-message", id: "fbMessage", rows: "6",
    maxlength: String(MSG_MAX), placeholder: t("fb_message_ph"), "aria-describedby": "fbCounter fbErr",
  });
  message.value = draft.message;
  const updateCounter = () => {
    const n = message.value.length;
    counter.textContent = `${n} / ${MSG_MAX}`;
    counter.classList.toggle("is-short", n > 0 && n < MSG_MIN);
  };
  message.addEventListener("input", () => {
    draft.message = message.value; saveDraft();
    message.classList.remove("error"); showErr(""); updateCounter();
  });
  updateCounter();
  card.append(message, el("div", { class: "edc-fb-counter-row" }, el("span", { class: "edc-fb-hint" }, t("fb_message_hint")), counter));

  // Honeypot: los humanos no lo ven; si viene relleno el servidor descarta
  // el envío sin decir nada.
  const honey = el("input", { type: "text", name: "website", class: "edc-fb-hp", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" });
  card.append(honey);

  // Contacto: método
  card.append(el("span", { class: "edc-label", id: "fbMethodLabel" }, t("fb_contact")));
  card.append(el("p", { class: "edc-fb-hint" }, t("fb_contact_hint")));
  const methodBtns = {};
  const mseg = el("div", { class: "edc-seg", role: "group", "aria-labelledby": "fbMethodLabel" });
  const methodBody = el("div", { class: "edc-fb-method" });
  const setMethod = (m) => {
    draft.method = m; saveDraft();
    for (const [mm, bb] of Object.entries(methodBtns)) bb.setAttribute("aria-pressed", String(mm === m));
    showErr("");
    renderMethod();
  };
  for (const m of ["email", "discord"]) {
    const b = el("button", { class: "edc-btn edc-btn-sm edc-seg-btn", type: "button", "aria-pressed": String(draft.method === m) },
      m === "discord" ? el("span", { class: "edc-seg-ico", html: svg }) : null, t("fb_method_" + m));
    b.addEventListener("click", () => setMethod(m));
    methodBtns[m] = b;
    mseg.append(b);
  }
  card.append(mseg, methodBody);

  // Estado del método Discord en esta vista
  const hasDiscord = !!(session?.user && profile?.hasDiscord && profile?.discord_id);
  let emailInput = null;
  let suggestedFor = "";       // email al que ya se ofreció corrección
  let memberState = "idle";    // idle | checking | member | not_member | error

  async function checkMember(force = false) {
    if (!hasDiscord) return;
    if (!force && memberCache && memberCache.userId === session.user.id) {
      memberState = memberCache.member ? "member" : "not_member";
      return;
    }
    memberState = "checking";
    renderMethod();
    const res = await callFn({ action: "check_member" }, await accessToken());
    if (res.ok) {
      memberCache = { userId: session.user.id, member: !!res.member };
      memberState = res.member ? "member" : "not_member";
    } else {
      memberState = res.error === "not_logged" ? "not_member" : "error";
    }
    renderMethod();
  }

  function renderMethod() {
    clear(methodBody);
    if (draft.method === "email") {
      methodBody.append(el("label", { class: "edc-label", for: "fbEmail" }, t("fb_email")));
      emailInput = el("input", {
        class: "edc-input", id: "fbEmail", type: "email", maxlength: "254", placeholder: t("fb_email_ph"),
        value: draft.email, autocomplete: "email", inputmode: "email", "aria-describedby": "fbErr",
      });
      emailInput.addEventListener("input", () => { draft.email = emailInput.value; saveDraft(); emailInput.classList.remove("error"); showErr(""); });
      methodBody.append(emailInput);
      return;
    }
    emailInput = null;
    if (!hasDiscord) {
      const needsLink = !!session?.user;
      methodBody.append(el("p", { class: "edc-apply-intro edc-apply-need" }, t(needsLink ? "fb_link_discord" : "fb_need_discord")));
      methodBody.append(el("div", { class: "edc-apply-actions" },
        el("button", {
          class: "edc-btn edc-btn-discord", type: "button",
          onClick: () => { saveDraft(); markPending(); (needsLink ? actions.linkDiscord : actions.login)(); },
        }, el("span", { html: svg }), t(needsLink ? "link_discord" : "login_btn"))));
      return;
    }
    const as = el("div", { class: "edc-apply-as" }, t("fb_as") + ":");
    if (profile.discord_avatar) as.append(el("img", { src: profile.discord_avatar, alt: "" }));
    as.append(el("strong", {}, "@" + (profile.discord_name || profile.display_name || "Discord")));
    methodBody.append(as);

    if (memberState === "idle") { checkMember(); return; }
    if (memberState === "checking") {
      methodBody.append(el("p", { class: "edc-fb-hint", role: "status" }, t("fb_member_checking")));
      return;
    }
    if (memberState === "member") {
      methodBody.append(el("p", { class: "edc-fb-hint edc-fb-ok", role: "status" }, t("fb_member_ok")));
      return;
    }
    // not_member | error
    methodBody.append(el("div", { class: "edc-apply-discord-hint", role: "status" },
      el("span", {}, t(memberState === "error" ? "fb_member_err" : "fb_member_no")),
      el("a", { class: "edc-apply-discord-join", href: DISCORD_INVITE, target: "_blank", rel: "noopener noreferrer" },
        el("span", { html: svg }), t("apply_discord_join"))));
    methodBody.append(el("div", { class: "edc-apply-actions" },
      el("button", { class: "edc-btn edc-btn-sm", type: "button", onClick: () => checkMember(true) }, t("fb_member_recheck"))));
  }
  renderMethod();

  card.append(errBox);
  card.append(el("p", { class: "edc-apply-privacy" }, t("fb_privacy")));

  const submit = el("button", { class: "edc-btn edc-btn-primary", type: "button" }, t("fb_submit"));
  const status = el("span", { class: "edc-save-status", role: "status", "aria-live": "polite" });
  submit.addEventListener("click", async () => {
    if (submit.disabled) return;
    const msg = draft.message.trim();
    if (msg.length < MSG_MIN || msg.length > MSG_MAX) {
      message.classList.add("error"); showErr(t("fb_message_short")); message.focus(); return;
    }
    let em = "";
    if (draft.method === "email") {
      em = draft.email.trim();
      if (!validEmail(em)) { emailInput?.classList.add("error"); showErr(t("apply_email_invalid")); emailInput?.focus(); return; }
      // Errata en un dominio común ("gmial.com"): se ofrece la corrección una vez
      const fix = suggestEmail(em);
      if (fix && suggestedFor !== em) {
        suggestedFor = em;
        emailInput?.classList.add("error");
        const use = el("button", { class: "edc-btn-link", type: "button", onClick: () => {
          draft.email = fix; saveDraft();
          if (emailInput) { emailInput.value = fix; emailInput.classList.remove("error"); emailInput.focus(); }
          showErr("");
        } }, t("apply_email_suggest_use"));
        showErr(t("apply_email_suggest").replace("{email}", fix) + " ", use, el("br"), t("fb_email_suggest_keep"));
        return;
      }
    } else {
      if (!hasDiscord) { showErr(t("fb_err_not_logged")); return; }
      if (memberState !== "member") { showErr(t("fb_err_not_member")); return; }
    }

    submit.disabled = true; status.className = "edc-save-status";
    if (draft.method === "email") {
      status.textContent = t("apply_email_checking");
      // "unknown" (DNS sin respuesta) no bloquea: la función lo vuelve a mirar
      if (await checkEmailDomain(em) === "dead") {
        submit.disabled = false; status.textContent = "";
        emailInput?.classList.add("error"); showErr(t("apply_email_dead")); emailInput?.focus();
        return;
      }
    }
    status.textContent = t("apply_sending");
    try {
      const body = {
        action: "submit", kind: draft.kind, message: msg, contact_method: draft.method,
        page: location.pathname + location.search, lang: getLang() === "es" ? "es" : "en",
        website: honey.value,
      };
      if (draft.method === "email") body.email = em;
      const res = await callFn(body, draft.method === "discord" ? await accessToken() : null);
      if (!res.ok) throw Object.assign(new Error(res.error || "server"), { code: res.error || "server" });
      sent = true;
      resetDraft();
      toast(t("fb_done_title"), "ok");
      renderFeedback(container, { session, profile, actions });
    } catch (e) {
      const code = e?.code || "server";
      if (code === "not_member") memberCache = null;
      const m = t("fb_err") + errText(code);
      status.className = "edc-save-status err"; status.textContent = "";
      showErr(m);
      toast(m, "err");
      if (code === "server") console.warn("submit-feedback:", e);
      submit.disabled = false;
    }
  });
  card.append(el("div", { class: "edc-apply-actions" }, submit, status, backLink()));
}
