// Panel de admin — SOLO se activa por ?admin (enlace privado). La seguridad la
// dan las credenciales, validadas en el servidor por las funciones RPC admin_*
// (SECURITY DEFINER). Las credenciales viven en memoria mientras la pestaña
// esté abierta; nunca se guardan en disco. Textos propios (herramienta interna).
import { supabase } from "./supabase.js";
import { getLang } from "./i18n.js";
import { el, clear, toast } from "./ui.js";

const S = {
  en: {
    title: "Admin — artists", intro: "Sign in with your admin credentials.",
    user: "User", pass: "Password", login: "Sign in",
    bad_creds: "Wrong user or password.", refresh: "Refresh", logout: "Sign out",
    back: "← Back to site", empty: "No requests yet.",
    st_pending: "Pending", st_approved: "Approved", st_rejected: "Rejected", st_revoked: "Revoked",
    players: "players", discord: "Discord ID", portfolio: "Portfolio", reason: "Reason", link: "Artist link",
    approve: "Approve", reject: "Reject", revoke: "Revoke", reapprove: "Re-approve", reset_key: "New key",
    key_title: "Artist credentials", key_note: "Copy these now and send them to the artist. The key is shown only once.",
    key: "Key", copy: "Copy", copied: "Copied.", close: "Done", err: "Error: ",
  },
  es: {
    title: "Admin — artistas", intro: "Entra con tus credenciales de administrador.",
    user: "Usuario", pass: "Clave", login: "Entrar",
    bad_creds: "Usuario o clave incorrectos.", refresh: "Actualizar", logout: "Salir",
    back: "← Volver a la web", empty: "Aún no hay solicitudes.",
    st_pending: "Pendiente", st_approved: "Aprobado", st_rejected: "Rechazado", st_revoked: "Revocado",
    players: "jugadores", discord: "ID de Discord", portfolio: "Portfolio", reason: "Motivo", link: "Enlace del artista",
    approve: "Aprobar", reject: "Rechazar", revoke: "Revocar", reapprove: "Reaprobar", reset_key: "Nueva clave",
    key_title: "Credenciales del artista", key_note: "Cópialas ahora y pásaselas al artista. La clave se muestra una sola vez.",
    key: "Clave", copy: "Copiar", copied: "Copiado.", close: "Hecho", err: "Error: ",
  },
};
const ta = (k) => (S[getLang()] || S.en)[k] || k;

export const isAdminRoute = () => new URLSearchParams(location.search).has("admin");
export function leaveAdmin() {
  if (!isAdminRoute()) return false;
  history.pushState(null, "", location.pathname);
  return true;
}

let creds = null;   // { user, pass } en memoria (nunca a disco)
let rows = null;    // último listado de artistas

const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
};
const refLink = (slug) => `${location.origin}${location.pathname}?ref=${encodeURIComponent(slug)}`;
const isUnauthorized = (e) => !!e && (e.code === "28000" || /unauthorized/i.test(e.message || ""));

export function renderAdminPanel(container, { onBack } = {}) {
  clear(container);
  const wrap = el("div", { class: "edc-apply" });
  container.append(wrap);
  const backBtn = () => el("button", { class: "edc-btn-link", onClick: onBack }, ta("back"));

  if (!creds) showLogin(); else showList();

  function showLogin(errMsg) {
    creds = null;
    clear(wrap);
    const user = el("input", { class: "edc-input", type: "text", placeholder: ta("user"), autocomplete: "username" });
    const pass = el("input", { class: "edc-input", type: "password", placeholder: ta("pass"), autocomplete: "current-password" });
    const err = el("div", { class: "edc-banner-err" }); err.hidden = !errMsg; err.textContent = errMsg || "";
    const btn = el("button", { class: "edc-btn edc-btn-primary" }, ta("login"));
    const submit = async () => {
      const u = user.value.trim(), p = pass.value;
      if (!u || !p) return;
      btn.disabled = true;
      try { creds = { user: u, pass: p }; rows = await rpc("admin_list", { p_user: u, p_pass: p }); showList(); }
      catch (e) { showLogin(isUnauthorized(e) ? ta("bad_creds") : ta("err") + (e?.message || "")); }
    };
    btn.addEventListener("click", submit);
    pass.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    wrap.append(el("div", { class: "edc-card" },
      el("div", { class: "edc-section-title" }, ta("title")),
      el("p", { class: "edc-apply-intro" }, ta("intro")),
      user, pass, err,
      el("div", { class: "edc-apply-actions" }, btn, backBtn())));
  }

  async function reload() { rows = await rpc("admin_list", { p_user: creds.user, p_pass: creds.pass }); }

  function showList() {
    clear(wrap);
    wrap.append(el("div", { class: "edc-admin-head" },
      el("div", { class: "edc-section-title" }, ta("title")),
      el("div", { class: "edc-apply-actions" },
        el("button", { class: "edc-btn edc-btn-sm", onClick: async () => { try { await reload(); showList(); } catch (e) { toast(ta("err") + (e?.message || ""), "err"); } } }, ta("refresh")),
        el("button", { class: "edc-btn edc-btn-sm", onClick: () => showLogin() }, ta("logout")),
        backBtn())));
    if (!rows || !rows.length) { wrap.append(el("p", { class: "edc-apply-intro" }, ta("empty"))); return; }
    for (const a of rows) wrap.append(renderCard(a));
  }

  function renderCard(a) {
    const c = el("div", { class: "edc-card edc-admin-card" });
    c.append(el("div", { class: "edc-admin-meta" },
      el("strong", {}, a.name || "—"),
      el("span", { class: "edc-admin-badge edc-admin-badge-" + a.status }, ta("st_" + a.status)),
      (a.status === "approved" && a.players != null) ? el("span", { class: "edc-admin-players" }, a.players + " " + ta("players")) : null));
    const info = [];
    if (a.discord_id) info.push([ta("discord"), a.discord_id]);
    if (a.portfolio) info.push([ta("portfolio"), a.portfolio]);
    if (a.reason) info.push([ta("reason"), a.reason]);
    if (a.slug) info.push([ta("link"), refLink(a.slug)]);
    for (const [k, v] of info)
      c.append(el("div", { class: "edc-admin-row" }, el("span", { class: "edc-admin-k" }, k), el("span", { class: "edc-admin-v" }, v)));
    c.append(renderActions(a));
    return c;
  }

  function renderActions(a) {
    const bar = el("div", { class: "edc-apply-actions" });
    const run = async (fn, args, after) => {
      try { const r = await rpc(fn, { p_user: creds.user, p_pass: creds.pass, ...args }); await reload(); showList(); if (after) after(r); }
      catch (e) { if (isUnauthorized(e)) showLogin(ta("bad_creds")); else toast(ta("err") + (e?.message || ""), "err"); }
    };
    if (a.status === "pending")
      bar.append(
        el("button", { class: "edc-btn edc-btn-primary edc-btn-sm", onClick: () => run("admin_approve", { p_id: a.id }, showSecret) }, ta("approve")),
        el("button", { class: "edc-btn edc-btn-sm", onClick: () => run("admin_set_status", { p_id: a.id, p_status: "rejected" }) }, ta("reject")));
    else if (a.status === "approved")
      bar.append(
        el("button", { class: "edc-btn edc-btn-sm", onClick: () => run("admin_reset_key", { p_id: a.id }, (r) => showSecret({ ...r, slug: a.slug })) }, ta("reset_key")),
        el("button", { class: "edc-btn edc-btn-sm", onClick: () => run("admin_set_status", { p_id: a.id, p_status: "revoked" }) }, ta("revoke")));
    else
      bar.append(el("button", { class: "edc-btn edc-btn-sm", onClick: () => run("admin_set_status", { p_id: a.id, p_status: "approved" }) }, ta("reapprove")));
    return bar;
  }

  function showSecret(r) {
    if (!r) return;
    const lines = [];
    if (r.slug) lines.push(refLink(r.slug));
    if (r.key) lines.push(ta("key") + ": " + r.key);
    const ov = el("div", { class: "edc-submit-overlay" });
    const close = () => ov.remove();
    ov.append(el("div", { class: "edc-submit-card edc-admin-keycard" },
      el("div", { class: "edc-section-title" }, ta("key_title")),
      el("p", { class: "edc-apply-intro" }, ta("key_note")),
      r.slug ? el("div", { class: "edc-admin-secret" }, el("code", {}, refLink(r.slug))) : null,
      r.key ? el("div", { class: "edc-admin-secret" }, el("code", {}, r.key)) : null,
      el("div", { class: "edc-apply-actions" },
        el("button", { class: "edc-btn edc-btn-sm", onClick: async () => { try { await navigator.clipboard.writeText(lines.join("\n")); toast(ta("copied"), "ok"); } catch { /* sin portapapeles */ } } }, ta("copy")),
        el("button", { class: "edc-btn edc-btn-primary edc-btn-sm", onClick: close }, ta("close")))));
    document.body.append(ov);
  }
}
