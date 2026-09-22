// Edge Function: send-artist-credentials
//
// Envía el email de acceso al artista aprobado (o restablecido). La disparan
// las RPCs admin_approve / admin_reset_generic vía pg_net con {"id": <uuid>}
// de una fila de public.artist_email_outbox (migración 20260922_08).
//
// Seguridad: quien llama NO manda datos ni credenciales, solo el id. La
// función lee la fila con la service_role que Supabase inyecta sola
// (SUPABASE_SERVICE_ROLE_KEY), solo si está sin enviar y tiene < 15 min, y al
// terminar borra la clave de la fila. Un id inventado no hace nada. Así la
// service_role nunca tiene que guardarse en la base de datos.
//
// Secrets de la función (Supabase → Edge Functions → Secrets):
//   GMAIL_USER          = zerosplatoon22@gmail.com
//   GMAIL_APP_PASSWORD  = app password de Google (16 caracteres)
//   SITE_URL            = https://eroplayerdata.pages.dev
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
//
// Desplegar con verify_jwt = false (pg_net no manda JWT de usuario).
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://eroplayerdata.pages.dev").replace(/\/+$/, "");
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_AGE_MS = 15 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Outbox = {
  id: string; email: string; name: string | null; slug: string; key: string | null;
  lang: string; reset: boolean; created_at: string; sent_at: string | null;
};

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

async function mark(id: string, patch: Record<string, unknown>) {
  await rest(`artist_email_outbox?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

const html = String.raw;

function e(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

function renderHtml({ name, refLink, panelLink, key, lang, reset }: {
  name: string; refLink: string; panelLink: string; key: string;
  lang: "en" | "es"; reset: boolean;
}) {
  if (lang === "es") {
    return html`<!doctype html>
<html lang="es"><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:24px auto;color:#111;line-height:1.55;">
  <h2 style="margin:0 0 12px 0;">Hola ${e(name)},</h2>
  <p>${reset
    ? "Hemos restablecido tu acceso al panel de artistas de OC Data Collector. La clave temporal es la de siempre:"
    : "Tu solicitud para el panel de artistas de OC Data Collector ha sido aprobada. Aquí tienes tus datos:"}</p>

  <h3 style="margin:22px 0 6px 0;">Tu enlace de artista</h3>
  <p>Compártelo con quienes vayan a hacerte comisiones para que se registren a través de él:</p>
  <p><a href="${e(refLink)}" style="color:#f650fe;">${e(refLink)}</a></p>

  <h3 style="margin:22px 0 6px 0;">Tu clave temporal</h3>
  <p>Entra en <a href="${e(panelLink)}" style="color:#19d3c5;">${e(panelLink)}</a>, inicia sesión con Discord y usa esta clave:</p>
  <pre style="background:#f4f4f4;padding:12px 16px;border-radius:8px;font-size:15px;user-select:all;overflow-wrap:anywhere;">${e(key)}</pre>

  <p style="background:#fff8e1;border-left:4px solid #f0b400;padding:10px 14px;border-radius:6px;">
    <strong>Importante:</strong> esta clave es temporal. Al entrar por primera vez el panel te obligará a elegir tu propia clave.
    Si la olvidas, contacta con el organizador por Discord y volveremos a habilitar esta clave temporal.
  </p>

  <hr style="margin-top:24px;border:none;border-top:1px solid #e5e5e5;">
  <p style="color:#666;font-size:13px;">Mensaje automático. Si no reconoces esta solicitud, ignora este correo.</p>
</body></html>`;
  }
  return html`<!doctype html>
<html lang="en"><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:24px auto;color:#111;line-height:1.55;">
  <h2 style="margin:0 0 12px 0;">Hi ${e(name)},</h2>
  <p>${reset
    ? "We have reset your artist panel access on OC Data Collector. The temporary key is the usual one:"
    : "Your artist panel request for OC Data Collector has been approved. Here's what you got:"}</p>

  <h3 style="margin:22px 0 6px 0;">Your artist link</h3>
  <p>Share it with anyone commissioning you so they can sign up through it:</p>
  <p><a href="${e(refLink)}" style="color:#f650fe;">${e(refLink)}</a></p>

  <h3 style="margin:22px 0 6px 0;">Your temporary key</h3>
  <p>Go to <a href="${e(panelLink)}" style="color:#19d3c5;">${e(panelLink)}</a>, sign in with Discord and use this key:</p>
  <pre style="background:#f4f4f4;padding:12px 16px;border-radius:8px;font-size:15px;user-select:all;overflow-wrap:anywhere;">${e(key)}</pre>

  <p style="background:#fff8e1;border-left:4px solid #f0b400;padding:10px 14px;border-radius:6px;">
    <strong>Important:</strong> this key is temporary. On your first login the panel will make you choose your own key.
    If you forget it, contact the organizer on Discord and we'll re-enable this temporary key for you.
  </p>

  <hr style="margin-top:24px;border:none;border-top:1px solid #e5e5e5;">
  <p style="color:#666;font-size:13px;">Automated message. If this wasn't you, ignore this email.</p>
</body></html>`;
}

function renderText({ name, refLink, panelLink, key, lang, reset }: {
  name: string; refLink: string; panelLink: string; key: string;
  lang: "en" | "es"; reset: boolean;
}) {
  if (lang === "es") {
    return [
      `Hola ${name},`,
      "",
      reset
        ? "Hemos restablecido tu acceso al panel de artistas de OC Data Collector."
        : "Tu solicitud para el panel de artistas de OC Data Collector ha sido aprobada.",
      "",
      "Tu enlace de artista:",
      refLink,
      "",
      "Panel del artista:",
      panelLink,
      "",
      "Clave TEMPORAL:",
      key,
      "",
      "IMPORTANTE: esta clave es temporal. Al entrar por primera vez el panel te",
      "obligará a elegir tu propia clave. Si la olvidas, contacta con el",
      "organizador por Discord y volveremos a habilitar esta clave temporal.",
      "",
      "— Mensaje automático.",
    ].join("\n");
  }
  return [
    `Hi ${name},`,
    "",
    reset
      ? "We have reset your artist panel access on OC Data Collector."
      : "Your artist panel request for OC Data Collector has been approved.",
    "",
    "Your artist link:",
    refLink,
    "",
    "Artist panel:",
    panelLink,
    "",
    "TEMPORARY key:",
    key,
    "",
    "IMPORTANT: this key is temporary. On your first login the panel will make",
    "you choose your own key. If you forget it, contact the organizer on",
    "Discord and we'll re-enable this temporary key for you.",
    "",
    "— Automated message.",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response("Server not configured", { status: 500 });

  let id = "";
  try { id = String((await req.json())?.id ?? ""); } catch { /* sin cuerpo */ }
  if (!UUID_RE.test(id)) return new Response("Bad request", { status: 400 });

  const r = await rest(`artist_email_outbox?id=eq.${id}&sent_at=is.null&select=*`);
  const rows: Outbox[] = r.ok ? await r.json() : [];
  const row = rows[0];
  // Respuesta neutra: no revela si el id existe
  if (!row || !row.key || Date.now() - Date.parse(row.created_at) > MAX_AGE_MS) {
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    await mark(id, { error: "Gmail credentials not configured" });
    return new Response("Gmail credentials not configured", { status: 500 });
  }

  const language: "en" | "es" = row.lang === "es" ? "es" : "en";
  const reset = !!row.reset;
  const name = row.name || "artist";
  const refLink = `${SITE_URL}/?ref=${encodeURIComponent(row.slug)}`;
  const panelLink = `${SITE_URL}/?panel`;
  const subject = language === "es"
    ? (reset ? "Se ha restablecido tu clave del panel de artistas" : "Tu acceso al panel de artistas de OC Data Collector")
    : (reset ? "Your artist panel key has been reset" : "Your OC Data Collector artist access");

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com", port: 465, tls: true,
      auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
    },
  });
  try {
    await client.send({
      from: `OC Data Collector <${GMAIL_USER}>`,
      to: row.email,
      subject,
      content: renderText({ name, refLink, panelLink, key: row.key, lang: language, reset }),
      html: renderHtml({ name, refLink, panelLink, key: row.key, lang: language, reset }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("SMTP send failed:", msg);
    try { await client.close(); } catch { /* ignore */ }
    await mark(id, { error: msg.slice(0, 500) });
    return new Response("SMTP error", { status: 502 });
  }
  try { await client.close(); } catch { /* ignore */ }
  // Enviado: se borra la clave de la cola (no se queda en claro en la BBDD)
  await mark(id, { sent_at: new Date().toISOString(), key: null, error: null });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
