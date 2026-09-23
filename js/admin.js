// Panel de admin — SOLO se activa por ?admin (enlace privado). La seguridad la
// dan las credenciales, validadas en el servidor por las funciones RPC admin_*
// (SECURITY DEFINER). Las credenciales viven en memoria mientras la pestaña
// esté abierta; nunca se guardan en disco. Textos propios (herramienta interna).
import { supabase } from "./supabase.js";
import { getLang } from "./i18n.js";
import { el, clear, toast } from "./ui.js";
import { colorToHex } from "./data.js";
import { SPECIES } from "./config.js";
import { ensureData, renderSlot, renderBanner, renderSheet, setMainWide } from "./artist_panel.js";

const S = {
  en: {
    title: "Admin — artists", intro: "Sign in with your admin credentials.",
    user: "User", pass: "Password", login: "Sign in",
    bad_creds: "Wrong user or password.", refresh: "Refresh", logout: "Sign out",
    back: "← Back to site", empty: "No requests yet.",
    render_beta: "*3D renders are in beta, expect errors.",
    st_pending: "Pending", st_approved: "Approved", st_rejected: "Rejected", st_revoked: "Revoked",
    players: "players", discord: "Discord ID", portfolio: "Portfolio", reason: "Reason", link: "Artist link",
    approve: "Approve", reject: "Reject", revoke: "Revoke", reapprove: "Re-approve", reset_key: "New key",
    key_title: "Artist credentials", key_note: "Copy these now and send them to the artist. The key is shown only once.",
    key: "Key", copy: "Copy", copied: "Copied.", close: "Done", err: "Error: ",
    tab_requests: "Artist requests", tab_players: "OC registrations",
    search_ph: "Search by alias, Discord, X or ID", only_variants: "Only with artist versions",
    no_players: "No registrations match.", no_alias: "No alias",
    inkling: "Inkling", octoling: "Octoling", girl: "Girl", boy: "Boy",
    n_versions: "artist version(s)", main_profile: "Main profile", version_for: "For",
    back_list: "← Back to registrations", no_media: "Sign in on the site (Discord or X) and refresh to see renders and Splashtags.",
    d_discord: "Discord", d_x: "X", d_user: "User ID", d_created: "Registered", d_updated: "Last edit",
    d_artists: "Artists", d_consent: "consent", d_variant_edit: "Version edited", none: "—",
  },
  es: {
    title: "Admin — artistas", intro: "Entra con tus credenciales de administrador.",
    user: "Usuario", pass: "Clave", login: "Entrar",
    bad_creds: "Usuario o clave incorrectos.", refresh: "Actualizar", logout: "Salir",
    back: "← Volver a la web", empty: "Aún no hay solicitudes.",
    render_beta: "*Renderizados 3D en fase beta, espera errores.",
    st_pending: "Pendiente", st_approved: "Aprobado", st_rejected: "Rechazado", st_revoked: "Revocado",
    players: "jugadores", discord: "ID de Discord", portfolio: "Portfolio", reason: "Motivo", link: "Enlace del artista",
    approve: "Aprobar", reject: "Rechazar", revoke: "Revocar", reapprove: "Reaprobar", reset_key: "Nueva clave",
    key_title: "Credenciales del artista", key_note: "Cópialas ahora y pásaselas al artista. La clave se muestra una sola vez.",
    key: "Clave", copy: "Copiar", copied: "Copiado.", close: "Hecho", err: "Error: ",
    tab_requests: "Solicitudes de artistas", tab_players: "Registros de OC",
    search_ph: "Buscar por alias, Discord, X o ID", only_variants: "Solo con versiones para artistas",
    no_players: "Ningún registro coincide.", no_alias: "Sin alias",
    inkling: "Inkling", octoling: "Octoling", girl: "Chica", boy: "Chico",
    n_versions: "versión(es) para artistas", main_profile: "Ficha principal", version_for: "Para",
    back_list: "← Volver a los registros", no_media: "Inicia sesión en la web (Discord o X) y pulsa Actualizar para ver renders y Splashtags.",
    d_discord: "Discord", d_x: "X", d_user: "ID de usuario", d_created: "Registrado", d_updated: "Última edición",
    d_artists: "Artistas", d_consent: "consentimiento", d_variant_edit: "Versión editada", none: "—",
  },
};
const ta = (k) => (S[getLang()] || S.en)[k] || k;

export const isAdminRoute = () => new URLSearchParams(location.search).has("admin");
export function leaveAdmin() {
  if (!isAdminRoute()) return false;
  history.pushState(null, "", location.pathname);
  return true;
}

// { user, pass }: en memoria + localStorage, para que la sesión no se cierre
// sola (cambiar de pestaña, recargar, cerrar el navegador). Solo se borra al
// pulsar "Salir" (aquí o arriba a la derecha) o si dejan de ser válidas.
const CREDS_KEY = "edc_admin_creds";
const store = {
  get() { try { return JSON.parse(localStorage.getItem(CREDS_KEY) || "null"); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(CREDS_KEY, JSON.stringify(v)) : localStorage.removeItem(CREDS_KEY); } catch { /* sin storage */ } },
};
export function forgetAdmin() { creds = null; rows = null; store.set(null); }
let creds = store.get();
let rows = null;    // último listado de artistas
let tab = "requests"; // "requests" | "players"
let oc = null;      // { media, players } de admin_players
let ocQuery = "", ocOnlyVariants = false;

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

  if (!creds) showLogin();
  else if (rows) showList();
  else reload().then(showList).catch((e) => showLogin(isUnauthorized(e) ? ta("bad_creds") : ta("err") + (e?.message || "")));

  function showLogin(errMsg) {
    creds = null; rows = null; store.set(null);
    clear(wrap);
    const user = el("input", { class: "edc-input", type: "text", placeholder: ta("user"), autocomplete: "username" });
    const pass = el("input", { class: "edc-input", type: "password", placeholder: ta("pass"), autocomplete: "current-password" });
    const err = el("div", { class: "edc-banner-err" }); err.hidden = !errMsg; err.textContent = errMsg || "";
    const btn = el("button", { class: "edc-btn edc-btn-primary" }, ta("login"));
    const submit = async () => {
      const u = user.value.trim(), p = pass.value;
      if (!u || !p) return;
      btn.disabled = true;
      try { creds = { user: u, pass: p }; rows = await rpc("admin_list", { p_user: u, p_pass: p }); store.set(creds); showList(); }
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

  async function reload() {
    if (tab === "players") { await ensureData(); oc = await rpc("admin_players", { p_user: creds.user, p_pass: creds.pass }); }
    else rows = await rpc("admin_list", { p_user: creds.user, p_pass: creds.pass });
  }
  const refresh = async () => {
    try { await reload(); showList(); }
    catch (e) { if (isUnauthorized(e)) showLogin(ta("bad_creds")); else toast(ta("err") + (e?.message || ""), "err"); }
  };

  function head() {
    const tabBtn = (id, label) => el("button", {
      class: "edc-btn edc-btn-sm" + (tab === id ? " edc-btn-primary" : ""),
      onClick: () => { if (tab === id) return; tab = id; if (id === "players" && !oc) refresh(); else showList(); },
    }, label);
    const count = oc ? ` (${oc.players.length})` : "";
    return [
      el("div", { class: "edc-admin-head" },
        el("div", { class: "edc-section-title" }, ta("title")),
        el("div", { class: "edc-apply-actions" },
          el("button", { class: "edc-btn edc-btn-sm", onClick: refresh }, ta("refresh")),
          el("button", { class: "edc-btn edc-btn-sm", onClick: () => { oc = null; tab = "requests"; showLogin(); } }, ta("logout")),
          backBtn())),
      el("div", { class: "edc-apply-actions edc-admin-tabs" },
        tabBtn("requests", ta("tab_requests")), tabBtn("players", ta("tab_players") + count)),
    ];
  }

  function showList() {
    clear(wrap);
    setMainWide(false);
    wrap.append(...head());
    if (tab === "players") return showPlayers();
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
        el("button", { class: "edc-btn edc-btn-sm", onClick: () => run("admin_reject", { p_id: a.id }) }, ta("reject")));
    else if (a.status === "approved")
      bar.append(
        el("button", { class: "edc-btn edc-btn-sm", onClick: () => run("admin_reset_key", { p_id: a.id }, (r) => showSecret({ ...r, slug: a.slug })) }, ta("reset_key")),
        el("button", { class: "edc-btn edc-btn-sm", onClick: () => run("admin_set_status", { p_id: a.id, p_status: "revoked" }) }, ta("revoke")));
    else
      bar.append(el("button", { class: "edc-btn edc-btn-sm", onClick: () => run("admin_set_status", { p_id: a.id, p_status: "approved" }) }, ta("reapprove")));
    return bar;
  }

  // ── Registros de OC ─────────────────────────────────────────────
  const speciesLabel = (t) => { const sp = SPECIES[t] || SPECIES[0]; return `${ta(sp.species)} ${sp.male ? ta("boy") : ta("girl")}`; };
  const variantsOf = (p) => (p.artists || []).filter((a) => a.variant);
  const fmtDate = (d) => d ? new Date(d).toLocaleString(getLang() === "es" ? "es-ES" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : ta("none");

  function showPlayers() {
    if (!oc) return;
    if (!oc.media) wrap.append(el("div", { class: "edc-banner-err edc-admin-note" }, ta("no_media")));
    const search = el("input", { class: "edc-input", type: "search", placeholder: ta("search_ph") });
    search.value = ocQuery;
    const only = el("input", { type: "checkbox" });
    only.checked = ocOnlyVariants;
    const grid = el("div", { class: "edc-panel-grid" });
    const paint = () => {
      const q = ocQuery.trim().toLowerCase();
      const list = oc.players.filter((p) =>
        (!ocOnlyVariants || variantsOf(p).length) &&
        (!q || [p.alias, p.discord_name, p.discord_id, p.x_username, p.user_id].some((v) => (v || "").toLowerCase().includes(q))));
      clear(grid);
      if (!list.length) { grid.append(el("p", { class: "edc-apply-intro" }, ta("no_players"))); return; }
      for (const p of list) grid.append(playerCard(p));
    };
    search.addEventListener("input", () => { ocQuery = search.value; paint(); });
    only.addEventListener("change", () => { ocOnlyVariants = only.checked; paint(); });
    wrap.append(el("div", { class: "edc-admin-filters" }, search,
      el("label", { class: "edc-admin-check" }, only, el("span", {}, ta("only_variants")))), grid);
    paint();
  }

  function playerCard(p) {
    const handle = p.x_username ? ("@" + p.x_username) : (p.discord_name || "");
    const nv = variantsOf(p).length;
    return el("div", { class: "edc-card edc-panel-pcard", onClick: () => showPlayer(p, null) },
      renderBanner(p, { size: "card" }),
      el("div", { class: "edc-panel-pcard-body" },
        el("div", { class: "edc-panel-pcard-alias" }, p.alias || ta("no_alias")),
        el("div", { class: "edc-panel-pcard-meta" }, speciesLabel(p.player_type)),
        el("div", { class: "edc-panel-pcard-contact" },
          el("span", { class: "edc-panel-pcard-dot", style: `background:${colorToHex(p.color)}` }),
          el("div", { class: "edc-panel-pcard-lines" },
            handle ? el("span", { class: "edc-panel-pcard-handle" }, handle) : null,
            p.discord_id ? el("span", { class: "edc-panel-pcard-did" }, p.discord_id) : null)),
        nv ? el("span", { class: "edc-admin-badge edc-admin-badge-pending edc-admin-vbadge" }, `${nv} ${ta("n_versions")}`) : null));
  }

  // `artistId` null = ficha principal; si no, la versión exclusiva para ese artista
  function showPlayer(p, artistId) {
    clear(wrap);
    setMainWide(true);
    wrap.append(el("div", { class: "edc-admin-head" },
      el("button", { class: "edc-btn edc-btn-sm", onClick: () => showList() }, ta("back_list")),
      el("div", { class: "edc-apply-actions" }, backBtn())));
    const vars = variantsOf(p);
    if (vars.length) {
      const chip = (id, label) => el("button", {
        class: "edc-btn edc-btn-sm" + (artistId === id ? " edc-btn-primary" : ""),
        onClick: () => showPlayer(p, id),
      }, label);
      wrap.append(el("div", { class: "edc-apply-actions edc-admin-tabs" },
        chip(null, ta("main_profile")),
        ...vars.map((a) => chip(a.artist_id, `${ta("version_for")} ${a.name || a.slug || "?"}`))));
    }
    const v = artistId ? vars.find((a) => a.artist_id === artistId)?.variant : null;
    const shown = v
      ? { ...p, ...v, has_variant: true, variant_render: `${p.user_id}/artist/${artistId}.png` }
      : { ...p, has_variant: false };
    wrap.append(el("div", { class: "edc-pcard" },
      el("div", { class: "edc-pcard-side" },
        renderSlot(shown),
        el("p", { class: "edc-pcard-beta" }, ta("render_beta"))),
      el("div", { class: "edc-pcard-main" },
        el("div", { class: "edc-pcard-name" }, p.alias || ta("no_alias")),
        renderBanner(p, { size: "detail", interactive: true }),
        renderSheet(shown))));
    const info = [
      [ta("d_discord"), [p.discord_name, p.discord_id].filter(Boolean).join(" · ") || ta("none")],
      [ta("d_x"), p.x_username ? "@" + p.x_username : ta("none")],
      [ta("d_user"), p.user_id || ta("none")],
      [ta("d_created"), fmtDate(p.created_at)],
      [ta("d_updated"), fmtDate(p.updated_at)],
    ];
    if (v) info.push([ta("d_variant_edit"), fmtDate(v.updated_at)]);
    const arts = (p.artists || []).map((a) => `${a.name || a.slug || "?"} (${ta("d_consent")}: ${fmtDate(a.consent_at)})`);
    info.push([ta("d_artists"), arts.length ? arts.join(" · ") : ta("none")]);
    const card = el("div", { class: "edc-card edc-admin-card" });
    for (const [k, val] of info)
      card.append(el("div", { class: "edc-admin-row" }, el("span", { class: "edc-admin-k" }, k), el("span", { class: "edc-admin-v" }, val)));
    wrap.append(card);
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
