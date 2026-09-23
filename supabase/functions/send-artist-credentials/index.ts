// Edge Function: send-artist-credentials
//
// Envía el email de acceso al artista aprobado (o restablecido) y el aviso de
// solicitud rechazada. La disparan las RPCs admin_approve /
// admin_reset_generic / admin_reject vía pg_net con {"id": <uuid>} de una fila
// de public.artist_email_outbox (migraciones 20260922_08 y 20260923_04).
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
  id: string; email: string; name: string | null; slug: string | null; key: string | null;
  lang: string; reset: boolean; created_at: string; sent_at: string | null;
  kind?: "credentials" | "rejected";   // migración 20260923_04
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

// UTF-8 → base64 en líneas de 76 caracteres (RFC 2045)
function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return (btoa(bin).match(/.{1,76}/g) ?? []).join("\r\n");
}

async function mark(id: string, patch: Record<string, unknown>) {
  await rest(`artist_email_outbox?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// ── Plantilla del email ─────────────────────────────────────────────────
// Correo transaccional "corporativo": tarjeta blanca de 600px sobre gris
// claro, cabecera de marca, imagen de portada, un único botón y bloques de
// datos. HTML de email: tablas + estilos inline, sin CSS externo ni JS, las
// imágenes con URL absoluta (servidas por la web).

const ASSETS = "https://eroplayerdata.pages.dev/assets";
const C = {
  page: "#eef0f4",
  card: "#ffffff",
  ink: "#16182b",
  body: "#474b63",
  muted: "#7a7f96",
  line: "#e4e6ee",
  soft: "#f5f3ff",       // fondo lila muy suave de los bloques
  softLine: "#e2dafd",
  brand: "#8b5cff",      // morado de la web (franja y detalles)
  cta: "#5b2ee0",        // morado oscuro: contraste AA con texto blanco
};
// Portadas del email de acceso: una al azar por envío (Deep Cut, Squid
// Sisters, Off the Hook; ilustraciones de las cartas de Tableturf).
const APPROVED_HEROES = ["email-hero-approved-1.jpg", "email-hero-approved-2.jpg", "email-hero-approved-3.jpg"];
const pickHero = () => APPROVED_HEROES[Math.floor(Math.random() * APPROVED_HEROES.length)];
const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

type Copy = {
  htmlLang: string; preheader: string; subject: string;
  kicker: string; title: string; hello: string; intro: string; cta: string;
  keyTitle: string; keyNote: string; linkTitle: string; linkNote: string;
  stepsTitle: string; steps: string[];
  help: string; auto: string; legal: string;
};

function copy(lang: "en" | "es", reset: boolean, name: string): Copy {
  if (lang === "es") {
    return {
      htmlLang: "es",
      subject: reset ? "Se ha restablecido tu clave del panel de artistas" : "Tu acceso al panel de artistas de OC Data Collector",
      preheader: reset
        ? "Tu clave temporal del panel de artistas ya está activa."
        : "Tu solicitud ha sido aprobada. Aquí tienes tu enlace de artista y tu clave temporal.",
      kicker: "Programa beta de artistas",
      title: reset ? "Hemos restablecido tu clave" : "¡Ya formas parte de la beta!",
      hello: `Hola, ${name}:`,
      intro: reset
        ? "Hemos restablecido tu acceso al panel de artistas. Entra con la clave temporal de abajo y elige una nueva."
        : "Tu solicitud para el panel de artistas de OC Data Collector ha sido aprobada. Desde tu panel verás las fichas de los jugadores que se registren con tu enlace.",
      cta: "Abrir mi panel",
      keyTitle: "Tu clave temporal",
      keyNote: "Solo sirve para el primer acceso: el panel te pedirá que elijas tu propia clave.",
      linkTitle: "Tu enlace de artista",
      linkNote: "Compártelo con quien te encargue una comisión. Quien se registre con él aparecerá en tu panel.",
      stepsTitle: "Cómo empezar",
      steps: [
        "Abre tu panel e inicia sesión con Discord.",
        "Escribe la clave temporal.",
        "Elige tu propia clave.",
        "Comparte tu enlace de artista.",
      ],
      help: "¿Problemas para entrar? Escríbenos por Discord y volveremos a activar tu clave temporal.",
      auto: "Mensaje automático. Si no has solicitado acceso, puedes ignorar este correo.",
      legal: "Proyecto fan sin afiliación con Nintendo. Splatoon es una marca registrada de Nintendo.",
    };
  }
  return {
    htmlLang: "en",
    subject: reset ? "Your artist panel key has been reset" : "Your OC Data Collector artist access",
    preheader: reset
      ? "Your temporary artist panel key is active."
      : "Your request was approved. Here are your artist link and temporary key.",
    kicker: "Artist beta program",
    title: reset ? "Your key has been reset" : "You're in the beta!",
    hello: `Hi ${name},`,
    intro: reset
      ? "We've reset your artist panel access. Sign in with the temporary key below and choose a new one."
      : "Your request for the OC Data Collector artist panel has been approved. Your panel shows the character sheets of players who sign up through your link.",
    cta: "Open my panel",
    keyTitle: "Your temporary key",
    keyNote: "It only works for your first sign-in: the panel will ask you to choose your own key.",
    linkTitle: "Your artist link",
    linkNote: "Share it with anyone commissioning you. Players who sign up through it will show up in your panel.",
    stepsTitle: "Getting started",
    steps: [
      "Open your panel and sign in with Discord.",
      "Enter the temporary key.",
      "Choose your own key.",
      "Share your artist link.",
    ],
    help: "Trouble signing in? Message us on Discord and we'll re-enable your temporary key.",
    auto: "Automated message. If you didn't request access, you can ignore this email.",
    legal: "Fan project, not affiliated with Nintendo. Splatoon is a trademark of Nintendo.",
  };
}

function e(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

type Args = { name: string; refLink: string; panelLink: string; key: string; lang: "en" | "es"; reset: boolean };

function subjectFor(lang: "en" | "es", reset: boolean) {
  return copy(lang, reset, "").subject;
}

// El HTML se compacta antes de enviarlo: denomailer codifica en
// quoted-printable y los espacios al final de línea salían como "=20"
// visibles en Gmail (móvil). Sin saltos de línea ni sangría no hay nada que
// codificar mal.
function compact(html: string) {
  return html.replace(/>\s+</g, "><").replace(/\s*\n\s*/g, " ").trim();
}

function renderHtml(args: Args) {
  return compact(renderHtmlRaw(args));
}

function renderHtmlRaw({ name, refLink, panelLink, key, lang, reset }: Args) {
  const t = copy(lang, reset, name);
  const block = (title: string, inner: string, note: string) => `
<tr><td class="px" style="padding:0 40px 20px 40px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.soft};border:1px solid ${C.softLine};border-radius:12px;">
    <tr><td style="padding:18px 20px;">
      <div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${C.cta};margin:0 0 8px 0;">${e(title)}</div>
      ${inner}
      <div style="font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};margin:10px 0 0 0;">${e(note)}</div>
    </td></tr>
  </table>
</td></tr>`;

  // Restablecer: el enlace de artista no va en el correo, fuera su paso
  const stepList = reset ? t.steps.slice(0, 3) : t.steps;
  const steps = stepList.map((s, i) => `
    <tr>
      <td width="36" valign="top" style="padding:0 0 12px 0;">
        <div style="width:26px;height:26px;border-radius:13px;background:${C.cta};color:#ffffff;font-family:${FONT};font-size:13px;font-weight:700;line-height:26px;text-align:center;">${i + 1}</div>
      </td>
      <td valign="top" style="padding:3px 0 12px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.body};">${e(s)}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(t.subject)}</title>
<style>
  @media only screen and (max-width:480px) {
    .px { padding-left:22px !important; padding-right:22px !important; }
    .kicker { display:none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(t.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
<tr><td align="center" style="padding:32px 12px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <!-- Cabecera de marca -->
    <tr><td style="padding:0 4px 16px 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" width="44"><img src="${ASSETS}/apple-touch-icon.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:8px;"></td>
        <td valign="middle" style="font-family:${FONT};font-size:17px;font-weight:800;color:${C.ink};letter-spacing:.2px;"><span style="color:${C.cta};">OC</span> Data Collector</td>
        <td class="kicker" valign="middle" align="right" style="font-family:${FONT};font-size:12px;color:${C.muted};">${e(t.kicker)}</td>
      </tr></table>
    </td></tr>
  </table>

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.card};border-radius:16px;overflow:hidden;border:1px solid ${C.line};">
    <!-- Franja de marca -->
    <tr><td style="height:6px;line-height:6px;font-size:0;background:${C.brand};">&nbsp;</td></tr>
    <!-- Portada -->
    <tr><td style="padding:0;">
      <a href="${e(panelLink)}" style="text-decoration:none;"><img src="${ASSETS}/${pickHero()}" width="600" alt="OC Data Collector" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></a>
    </td></tr>
    <!-- Titular -->
    <tr><td class="px" style="padding:32px 40px 8px 40px;">
      <h1 style="margin:0;font-family:${FONT};font-size:26px;line-height:32px;font-weight:800;color:${C.ink};">${e(t.title)}</h1>
    </td></tr>
    <tr><td class="px" style="padding:12px 40px 0 40px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.body};">
      <p style="margin:0 0 12px 0;">${e(t.hello)}</p>
      <p style="margin:0;">${e(t.intro)}</p>
    </td></tr>
    <!-- Botón -->
    <tr><td class="px" style="padding:24px 40px 28px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="border-radius:999px;background:${C.cta};">
          <a href="${e(panelLink)}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${e(t.cta)}</a>
        </td>
      </tr></table>
    </td></tr>

    ${block(t.keyTitle,
      `<div style="font-family:${MONO};font-size:20px;line-height:28px;font-weight:700;color:${C.ink};letter-spacing:1px;word-break:break-all;">${e(key)}</div>`,
      t.keyNote)}
    ${reset ? "" : block(t.linkTitle,
      `<a href="${e(refLink)}" style="font-family:${FONT};font-size:15px;line-height:22px;font-weight:600;color:${C.cta};text-decoration:underline;word-break:break-all;">${e(refLink)}</a>`,
      t.linkNote)}

    <!-- Pasos -->
    <tr><td class="px" style="padding:12px 40px 8px 40px;">
      <div style="font-family:${FONT};font-size:17px;font-weight:800;color:${C.ink};margin:0 0 14px 0;">${e(t.stepsTitle)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${steps}</table>
    </td></tr>

    <tr><td class="px" style="padding:8px 40px 32px 40px;">
      <div style="border-top:1px solid ${C.line};padding-top:18px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.body};">${e(t.help)}</div>
    </td></tr>
  </table>

  <!-- Pie -->
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td align="center" style="padding:20px 24px 0 24px;font-family:${FONT};font-size:12px;line-height:19px;color:${C.muted};">
      <p style="margin:0 0 6px 0;">${e(t.auto)}</p>
      <p style="margin:0 0 6px 0;">OC Data Collector by ERO's Team &middot; <a href="https://eroplayerdata.pages.dev" style="color:${C.muted};text-decoration:underline;">eroplayerdata.pages.dev</a></p>
      <p style="margin:0;">${e(t.legal)}</p>
    </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>`;
}

// ── Solicitud rechazada ─────────────────────────────────────────────────
// Misma maqueta que el de acceso, sin clave, enlace ni pasos. El botón lleva
// a la web.
type RejectCopy = {
  htmlLang: string; subject: string; preheader: string; kicker: string;
  title: string; hello: string; paras: string[]; cta: string;
  help: string; auto: string; legal: string;
};

function rejectCopy(lang: "en" | "es", name: string): RejectCopy {
  if (lang === "es") {
    return {
      htmlLang: "es",
      subject: "Tu solicitud al programa beta de artistas",
      preheader: "Hemos revisado tu solicitud al panel de artistas de OC Data Collector.",
      kicker: "Programa beta de artistas",
      title: "No hemos podido aceptar tu solicitud",
      hello: `Hola, ${name}:`,
      paras: [
        "Gracias por tu interés en el programa beta de artistas de OC Data Collector. Hemos revisado tu solicitud y, por ahora, no podemos aceptarla.",
        "El motivo es que no cumple los requisitos del programa o no incluye la información suficiente para considerarla una solicitud válida.",
      ],
      cta: "Ir a OC Data Collector",
      help: "Si crees que se trata de un error o quieres aportar más información, escríbenos por Discord.",
      auto: "Mensaje automático. Si no has solicitado acceso, puedes ignorar este correo.",
      legal: "Proyecto fan sin afiliación con Nintendo. Splatoon es una marca registrada de Nintendo.",
    };
  }
  return {
    htmlLang: "en",
    subject: "Your artist beta program application",
    preheader: "We've reviewed your application to the OC Data Collector artist panel.",
    kicker: "Artist beta program",
    title: "We couldn't accept your application",
    hello: `Hi ${name},`,
    paras: [
      "Thank you for your interest in the OC Data Collector artist beta program. We've reviewed your application and, for now, we can't accept it.",
      "This is because it doesn't meet the program requirements or doesn't include enough information to be considered a valid application.",
    ],
    cta: "Go to OC Data Collector",
    help: "If you think this is a mistake or want to share more information, message us on Discord.",
    auto: "Automated message. If you didn't request access, you can ignore this email.",
    legal: "Fan project, not affiliated with Nintendo. Splatoon is a trademark of Nintendo.",
  };
}

function renderRejectHtml(lang: "en" | "es", name: string, siteLink: string) {
  const t = rejectCopy(lang, name);
  return compact(`<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(t.subject)}</title>
<style>
  @media only screen and (max-width:480px) {
    .px { padding-left:22px !important; padding-right:22px !important; }
    .kicker { display:none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(t.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
<tr><td align="center" style="padding:32px 12px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td style="padding:0 4px 16px 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" width="44"><img src="${ASSETS}/apple-touch-icon.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:8px;"></td>
        <td valign="middle" style="font-family:${FONT};font-size:17px;font-weight:800;color:${C.ink};letter-spacing:.2px;"><span style="color:${C.cta};">OC</span> Data Collector</td>
        <td class="kicker" valign="middle" align="right" style="font-family:${FONT};font-size:12px;color:${C.muted};">${e(t.kicker)}</td>
      </tr></table>
    </td></tr>
  </table>

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.card};border-radius:16px;overflow:hidden;border:1px solid ${C.line};">
    <tr><td style="height:6px;line-height:6px;font-size:0;background:${C.brand};">&nbsp;</td></tr>
    <tr><td style="padding:0;">
      <img src="${ASSETS}/email-hero-rejected.jpg" width="600" alt="OC Data Collector" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
    </td></tr>
    <tr><td class="px" style="padding:32px 40px 8px 40px;">
      <h1 style="margin:0;font-family:${FONT};font-size:24px;line-height:31px;font-weight:800;color:${C.ink};">${e(t.title)}</h1>
    </td></tr>
    <tr><td class="px" style="padding:12px 40px 0 40px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.body};">
      <p style="margin:0 0 12px 0;">${e(t.hello)}</p>
      ${t.paras.map((p) => `<p style="margin:0 0 12px 0;">${e(p)}</p>`).join("")}
    </td></tr>
    <tr><td class="px" style="padding:12px 40px 28px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="border-radius:999px;background:${C.cta};">
          <a href="${e(siteLink)}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${e(t.cta)}</a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td class="px" style="padding:0 40px 32px 40px;">
      <div style="border-top:1px solid ${C.line};padding-top:18px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.body};">${e(t.help)}</div>
    </td></tr>
  </table>

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td align="center" style="padding:20px 24px 0 24px;font-family:${FONT};font-size:12px;line-height:19px;color:${C.muted};">
      <p style="margin:0 0 6px 0;">${e(t.auto)}</p>
      <p style="margin:0 0 6px 0;">OC Data Collector by ERO's Team &middot; <a href="https://eroplayerdata.pages.dev" style="color:${C.muted};text-decoration:underline;">eroplayerdata.pages.dev</a></p>
      <p style="margin:0;">${e(t.legal)}</p>
    </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>`);
}

function renderRejectText(lang: "en" | "es", name: string, siteLink: string) {
  const t = rejectCopy(lang, name);
  return [t.title, "", t.hello, "", ...t.paras.flatMap((p) => [p, ""]),
    `${t.cta}: ${siteLink}`, "", t.help, "", t.auto, t.legal].join("\n");
}

function renderText({ name, refLink, panelLink, key, lang, reset }: Args) {
  const t = copy(lang, reset, name);
  const lines = [
    t.title, "", t.hello, "", t.intro, "",
    `${t.cta}: ${panelLink}`, "",
    `${t.keyTitle}: ${key}`, t.keyNote, "",
  ];
  if (!reset) lines.push(`${t.linkTitle}: ${refLink}`, t.linkNote, "");
  lines.push(t.stepsTitle, ...(reset ? t.steps.slice(0, 3) : t.steps).map((s, i) => `${i + 1}. ${s}`), "", t.help, "", t.auto, t.legal);
  return lines.join("\n");
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
  const rejected = row?.kind === "rejected";
  // Respuesta neutra: no revela si el id existe. El de acceso necesita clave;
  // el de rechazo no lleva ninguna.
  if (!row || (!rejected && !row.key) || Date.now() - Date.parse(row.created_at) > MAX_AGE_MS) {
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    await mark(id, { error: "Gmail credentials not configured" });
    return new Response("Gmail credentials not configured", { status: 500 });
  }

  const language: "en" | "es" = row.lang === "es" ? "es" : "en";
  const reset = !!row.reset;
  const name = row.name || "artist";
  const refLink = `${SITE_URL}/?ref=${encodeURIComponent(row.slug ?? "")}`;
  const panelLink = `${SITE_URL}/?panel`;
  const siteLink = `${SITE_URL}/`;
  const subject = rejected ? rejectCopy(language, name).subject : subjectFor(language, reset);
  const text = rejected
    ? renderRejectText(language, name, siteLink)
    : renderText({ name, refLink, panelLink, key: row.key as string, lang: language, reset });
  const html = rejected
    ? renderRejectHtml(language, name, siteLink)
    : renderHtml({ name, refLink, panelLink, key: row.key as string, lang: language, reset });

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
      // base64 en vez del quoted-printable de denomailer (su codificador
      // dejaba "=20" visibles en Gmail)
      mimeContent: [
        { mimeType: 'text/plain; charset="utf-8"', transferEncoding: "base64", content: b64(text) },
        { mimeType: 'text/html; charset="utf-8"', transferEncoding: "base64", content: b64(html) },
      ],
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
