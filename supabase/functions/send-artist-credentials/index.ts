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
//   GMAIL_USER          = cuenta de Gmail de envío del proyecto
//   GMAIL_APP_PASSWORD  = app password de Google (16 caracteres)
//   SITE_URL            = https://eroplayerdata.pages.dev
//   DISCORD_BOT_TOKEN   = token del bot de Discord (opcional: sin él no hay
//                         plan B por mensaje directo)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
//
// Entrega (migración 20260923_06):
//  1) Antes de enviar se mira el DNS del dominio (MX, o A/AAAA). Si no puede
//     recibir correo, se usa el email verificado de la cuenta de Discord del
//     artista (auth.users) y, si tampoco vale, un mensaje directo de Discord.
//  2) Si Gmail rechaza el envío, también se tira de Discord.
//  3) {"action":"check_bounces"} (pg_cron cada 15 min): lee por IMAP los
//     rebotes de mailer-daemon del buzón de envío, marca bounced_at en la
//     cola y reenvía el aviso por Discord.
//
// Desplegar con verify_jwt = false (pg_net no manda JWT de usuario).
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://eroplayerdata.pages.dev").replace(/\/+$/, "");
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const MAX_AGE_MS = 15 * 60 * 1000;
const BOUNCE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Outbox = {
  id: string; email: string; name: string | null; slug: string | null; key: string | null;
  lang: string; reset: boolean; created_at: string; sent_at: string | null;
  kind?: "credentials" | "rejected" | "custom";   // migración 20260923_04 (+ custom 20260925_02)
  subject?: string | null;              // migración 20260925_02: solo kind = custom
  body?: string | null;
  hero?: number | null;                 // migración 20260923_05 (portada fija, pruebas)
  channel?: string | null;              // migración 20260923_06: email | email_alt | discord
  delivered_to?: string | null;
  bounced_at?: string | null;
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
// Comunidad de Discord (ZeroServer): se invita en los emails de aprobación y rechazo (2026-09-25).
const DISCORD_INVITE = "https://discord.gg/Hckay4PGNR";
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
// hero (1-3) en la fila de la cola fija la portada (envíos de prueba); si no, al azar
const pickHero = (n?: number | null) =>
  (n && APPROVED_HEROES[n - 1]) || APPROVED_HEROES[Math.floor(Math.random() * APPROVED_HEROES.length)];
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
        `Únete a nuestra comunidad de Discord para una comunicación más fluida (avisos, ayuda y sugerencias): ${DISCORD_INVITE}`,
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
      `Join our Discord community for smoother communication (announcements, help and feedback): ${DISCORD_INVITE}`,
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

type Args = { name: string; refLink: string; panelLink: string; key: string; lang: "en" | "es"; reset: boolean; hero?: number | null };

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

function renderHtmlRaw({ name, refLink, panelLink, key, lang, reset, hero }: Args) {
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
      <a href="${e(panelLink)}" style="text-decoration:none;"><img src="${ASSETS}/${pickHero(hero)}" width="600" alt="OC Data Collector" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></a>
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
      help: `Si crees que se trata de un error o quieres aportar más información, escríbenos en nuestro Discord: ${DISCORD_INVITE}`,
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
    help: `If you think this is a mistake or want to share more information, message us on our Discord: ${DISCORD_INVITE}`,
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

// ── Entrega: DNS, alternativas y Discord ───────────────────────────────

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// DNS-over-HTTPS (Cloudflare y Google de reserva). null = no se pudo consultar.
async function doh(name: string, type: "MX" | "A" | "AAAA") {
  const code = { MX: 15, A: 1, AAAA: 28 }[type];
  for (const base of ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"]) {
    try {
      const r = await fetch(`${base}?name=${encodeURIComponent(name)}&type=${type}`, {
        headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(4000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      if (j.Status === 3) return { nx: true, answers: [] as { data: string }[] };
      if (j.Status !== 0) continue;
      return { nx: false, answers: ((j.Answer ?? []) as { type: number; data: string }[]).filter((a) => a.type === code) };
    } catch { /* siguiente resolver */ }
  }
  return null;
}

// "ok" = el dominio recibe correo; "dead" = no existe, MX nulo o sin MX/A/AAAA;
// "unknown" = DNS sin respuesta (no se bloquea: se intenta enviar igual).
async function domainAccepts(email: string): Promise<"ok" | "dead" | "unknown"> {
  const domain = (email.split("@").pop() ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!domain) return "dead";
  const mx = await doh(domain, "MX");
  if (!mx) return "unknown";
  if (mx.nx) return "dead";
  if (mx.answers.length) return mx.answers.every((a) => /^\s*0\s+\.?\s*$/.test(a.data)) ? "dead" : "ok";
  const a = await doh(domain, "A");
  if (a?.answers.length) return "ok";
  const aaaa = await doh(domain, "AAAA");
  if (aaaa?.answers.length) return "ok";
  return a || aaaa ? "dead" : "unknown";
}

type ArtistInfo = { discord_id: string | null; status: string; must_change_password: boolean | null };

async function artistByEmail(email: string): Promise<ArtistInfo | null> {
  const r = await rest(`artists?email=eq.${encodeURIComponent(email)}&select=discord_id,status,must_change_password&order=created_at.desc&limit=1`);
  const rows = r.ok ? await r.json() : [];
  return rows[0] ?? null;
}

// Email verificado de la cuenta de Discord (auth.users), vía RPC solo service_role
async function discordAccountEmail(discordId: string): Promise<string | null> {
  const r = await rest("rpc/artist_discord_email", { method: "POST", body: JSON.stringify({ p_discord_id: discordId }) });
  if (!r.ok) return null;
  const v = await r.json();
  return typeof v === "string" && v.includes("@") ? v : null;
}

// Clave genérica vigente (la misma que ponen admin_approve / admin_reset_generic)
async function genericKey(): Promise<string | null> {
  const r = await rest("app_secrets?k=eq.generic_artist_key&select=v");
  const rows = r.ok ? await r.json() : [];
  return rows[0]?.v ?? null;
}

async function sendSmtp(to: string, subject: string, text: string, html: string) {
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com", port: 465, tls: true,
      auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
    },
  });
  try {
    await client.send({
      from: `OC Data Collector <${GMAIL_USER}>`,
      to,
      subject,
      // base64 en vez del quoted-printable de denomailer (su codificador
      // dejaba "=20" visibles en Gmail)
      mimeContent: [
        { mimeType: 'text/plain; charset="utf-8"', transferEncoding: "base64", content: b64(text) },
        { mimeType: 'text/html; charset="utf-8"', transferEncoding: "base64", content: b64(html) },
      ],
    });
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
}

// Mensaje directo por Discord. null = enviado; si no, el motivo del fallo.
// Un bot solo puede escribir a quien comparte servidor con él (error 50007).
async function sendDiscordDm(discordId: string, payload: DiscordPayload): Promise<string | null> {
  if (!DISCORD_BOT_TOKEN) return "discord bot not configured";
  const api = (path: string, body: unknown) => fetch(`https://discord.com/api/v10${path}`, {
    method: "POST",
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  try {
    const ch = await api("/users/@me/channels", { recipient_id: discordId });
    if (!ch.ok) return `discord ${ch.status}: ${(await ch.text()).slice(0, 200)}`;
    const { id } = await ch.json();
    const msg = await api(`/channels/${id}/messages`, payload);
    if (!msg.ok) return `discord ${msg.status}: ${(await msg.text()).slice(0, 200)}`;
    return null;
  } catch (err) {
    return `discord: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Mensaje de Discord con el aspecto del email: embed con la franja morada de
// la marca, cabecera con el logo, la misma portada, clave tras spoiler, pasos
// numerados, botones de enlace y el pie legal. key = null → sin clave
// (rechazo, o el artista ya eligió la suya): solo se le manda al panel.
type DiscordPayload = {
  content?: string;
  embeds: Record<string, unknown>[];
  components: Record<string, unknown>[];
  allowed_mentions: { parse: string[] };
};

// alsoEmailed (2026-09-25): el DM se manda SIEMPRE, no solo si falla el email,
// porque Gmail mete muchos de estos correos en spam; el texto cambia según el caso.
function discordMessage(row: Outbox, key: string | null, alsoEmailed = false): DiscordPayload {
  if (row.kind === "custom") {
    // Aviso libre (enviar_email.py / admin_send_email): texto plano tal cual.
    const why = row.lang === "es"
      ? "-# Te escribimos por aquí porque no hemos podido hacerte llegar el email."
      : "-# We're messaging you here because we couldn't get the email to you.";
    return {
      allowed_mentions: { parse: [] },
      content: `${why}\n**${row.subject ?? ""}**\n\n${row.body ?? ""}`.slice(0, 2000),
      embeds: [], components: [],
    };
  }
  const lang: "en" | "es" = row.lang === "es" ? "es" : "en";
  const name = row.name || "artist";
  const panelLink = `${SITE_URL}/?panel`;
  const siteLink = `${SITE_URL}/`;
  const icon = `${ASSETS}/apple-touch-icon.png`;
  const why = alsoEmailed
    ? (lang === "es"
      ? "-# También te lo hemos mandado por email. Si no lo ves, mira en spam y márcalo como «No es spam»."
      : "-# We've also sent this to your email. If you can't find it, check your spam folder and mark it as \"Not spam\".")
    : (lang === "es"
      ? "-# Te escribimos por aquí porque no hemos podido hacerte llegar el email."
      : "-# We're messaging you here because we couldn't get the email to you.");
  const button = (label: string, url: string) => ({ type: 2, style: 5, label, url });
  const base = { allowed_mentions: { parse: [] as string[] }, content: why };

  if (row.kind === "rejected") {
    const t = rejectCopy(lang, name);
    return {
      ...base,
      embeds: [{
        color: 0x7a7f96,
        author: { name: `OC Data Collector · ${t.kicker}`, icon_url: icon, url: siteLink },
        title: t.title,
        description: [t.hello, "", ...t.paras.flatMap((p) => [p, ""]), `-# ${t.help}`].join("\n"),
        image: { url: `${ASSETS}/email-hero-rejected.jpg` },
        footer: { text: t.legal, icon_url: icon },
        timestamp: new Date().toISOString(),
      }],
      components: [{ type: 1, components: [button(t.cta, siteLink)] }],
    };
  }

  const reset = !!row.reset;
  const t = copy(lang, reset, name);
  const refLink = `${SITE_URL}/?ref=${encodeURIComponent(row.slug ?? "")}`;
  const steps = (reset ? t.steps.slice(0, 3) : t.steps).map((s, i) => `**${i + 1}.** ${s}`).join("\n");
  const fields: { name: string; value: string }[] = [];
  if (key) fields.push({ name: t.keyTitle, value: `||\`${key}\`||\n-# ${t.keyNote}` });
  if (!reset && row.slug) fields.push({ name: t.linkTitle, value: `\`${refLink}\`\n-# ${t.linkNote}` });
  fields.push({ name: t.stepsTitle, value: steps });
  const linkLabel = lang === "es" ? "Mi enlace de artista" : "My artist link";
  return {
    ...base,
    embeds: [{
      color: 0x8b5cff,
      author: { name: `OC Data Collector · ${t.kicker}`, icon_url: icon, url: siteLink },
      title: t.title,
      url: panelLink,
      description: `${t.hello}\n\n${t.intro}`,
      fields,
      image: { url: `${ASSETS}/${pickHero(row.hero)}` },
      footer: { text: `${t.help}\n${t.legal}`, icon_url: icon },
      timestamp: new Date().toISOString(),
    }],
    components: [{
      type: 1,
      components: [button(t.cta, panelLink), ...(!reset && row.slug ? [button(linkLabel, refLink)] : [])],
    }],
  };
}

// Plan B por Discord. Devuelve el parche para la fila de la cola.
async function discordFallback(row: Outbox, artist: ArtistInfo | null, key: string | null, reason: string) {
  const dmErr = artist?.discord_id ? await sendDiscordDm(artist.discord_id, discordMessage(row, key)) : "no discord id";
  if (!dmErr) {
    return {
      sent_at: row.sent_at ?? new Date().toISOString(), key: null, error: null, note: reason,
      channel: "discord", delivered_to: `discord:${artist?.discord_id}`,
    };
  }
  return { error: `${reason} | ${dmErr}`.slice(0, 500), note: reason };
}

// Aviso libre (kind = custom, migración 20260925_02): el asunto y el texto los
// escribe el propietario. Plantilla mínima (texto plano + HTML sencillo, sin imágenes)
// para que parezca un correo normal y no un boletín. Sale de GMAIL_USER
// (cuenta del proyecto), nunca de un correo personal. Si Gmail lo rechaza → Discord.
function customHtml(row: Outbox): string {
  const linkify = (t: string) => e(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  const paras = (row.body ?? "").split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 14px 0;">${linkify(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html lang="${row.lang === "es" ? "es" : "en"}"><body style="margin:0;padding:16px;` +
    `font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#1f2330;">${paras}</body></html>`;
}

async function sendCustom(row: Outbox) {
  const text = row.body ?? "";
  const artist = await artistByEmail(row.email);
  try {
    await sendSmtp(row.email, row.subject ?? "OC Data Collector", text, customHtml(row));
    await mark(row.id, { sent_at: new Date().toISOString(), error: null, channel: "email" });
    return json({ ok: true, channel: "email" });
  } catch (err) {
    const reason = `smtp: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
    const patch = await discordFallback(row, artist, null, reason);
    await mark(row.id, patch);
    return "channel" in patch ? json({ ok: true, channel: "discord" }) : json({ ok: false, error: patch.error }, 502);
  }
}

async function sendRow(row: Outbox) {
  if (row.kind === "custom") return await sendCustom(row);
  const id = row.id;
  const rejected = row.kind === "rejected";
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
    : renderHtml({ name, refLink, panelLink, key: row.key as string, lang: language, reset, hero: row.hero });

  const artist = await artistByEmail(row.email);

  // 1) ¿El dominio recibe correo? Si no, email de la cuenta de Discord.
  let target = row.email;
  let channel = "email";
  let reason = "";
  if (await domainAccepts(row.email) === "dead") {
    reason = `email domain can't receive mail (${row.email.split("@").pop()})`;
    const alt = artist?.discord_id ? await discordAccountEmail(artist.discord_id) : null;
    if (alt && alt.toLowerCase() !== row.email.toLowerCase() && await domainAccepts(alt) !== "dead") {
      target = alt;
      channel = "email_alt";
    } else {
      channel = "discord";
    }
  }

  // 2) Email (principal o alternativo); si Gmail lo rechaza, Discord.
  if (channel !== "discord") {
    try {
      await sendSmtp(target, subject, text, html);
      // Copia por Discord aunque el email haya salido (muchos acaban en spam).
      // Si el DM falla no pasa nada: el email ya se envió.
      const dmErr = artist?.discord_id
        ? await sendDiscordDm(artist.discord_id, discordMessage(row, rejected ? null : (row.key ?? null), true))
        : "no discord id";
      const dmNote = dmErr ? `discord dm: ${dmErr}` : "discord dm ok";
      // Enviado: se borra la clave de la cola (no se queda en claro en la BBDD)
      await mark(id, {
        sent_at: new Date().toISOString(), key: null, error: null, channel,
        delivered_to: channel === "email_alt" ? target : null,
        note: [reason, dmNote].filter(Boolean).join(" | ").slice(0, 500),
      });
      return json({ ok: true, channel });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("SMTP send failed:", msg);
      reason = `smtp: ${msg}`.slice(0, 300);
    }
  }

  // 3) Discord
  const patch = await discordFallback(row, artist, rejected ? null : row.key, reason);
  await mark(id, patch);
  return "channel" in patch ? json({ ok: true, channel: "discord" }) : json({ ok: false, error: patch.error }, 502);
}

// ── Rebotes (IMAP) ─────────────────────────────────────────────────────
// Gmail acepta el envío y el rebote llega después al buzón como un correo de
// mailer-daemon. Cliente IMAP mínimo sobre TLS: LOGIN, SELECT, UID SEARCH,
// UID FETCH (BODY.PEEK: no marca como leído) y LOGOUT.

class Imap {
  private buf = "";
  private dec = new TextDecoder();
  private enc = new TextEncoder();
  private n = 0;
  private constructor(private conn: Deno.TlsConn) {}

  static async open(host: string) {
    const imap = new Imap(await Deno.connectTls({ hostname: host, port: 993 }));
    await imap.readUntil(/\r\n/);
    return imap;
  }

  private async readUntil(re: RegExp, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    const chunk = new Uint8Array(65536);
    while (!re.test(this.buf)) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const n = await Promise.race([
        this.conn.read(chunk),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("imap timeout")), Math.max(0, deadline - Date.now())); }),
      ]).finally(() => clearTimeout(timer));
      if (n === null) throw new Error("imap connection closed");
      this.buf += this.dec.decode(chunk.subarray(0, n), { stream: true });
    }
    const out = this.buf;
    this.buf = "";
    return out;
  }

  async cmd(command: string) {
    const tag = `a${++this.n}`;
    await this.conn.write(this.enc.encode(`${tag} ${command}\r\n`));
    const done = new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD)([^\\r\\n]*)\\r\\n`);
    const out = await this.readUntil(done);
    const m = out.match(done);
    if (m?.[1] !== "OK") throw new Error(`imap ${command.split(" ")[0]}: ${m?.[1]}${m?.[2] ?? ""}`);
    return out;
  }

  close() { try { this.conn.close(); } catch { /* ignore */ } }
}

const imapQuote = (s: string) => `"${s.replace(/(["\\])/g, "\\$1")}"`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const imapDate = (d: Date) => `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;

async function checkBounces() {
  const since = new Date(Date.now() - BOUNCE_WINDOW_MS);
  const r = await rest(
    `artist_email_outbox?sent_at=gte.${since.toISOString()}&bounced_at=is.null` +
    `&or=(channel.is.null,channel.in.(email,email_alt))&select=*`,
  );
  const rows: Outbox[] = r.ok ? await r.json() : [];
  if (!rows.length) return json({ ok: true, checked: 0, bounced: 0 });
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return json({ ok: false, error: "Gmail credentials not configured" }, 500);

  // Rebotes recientes: cabeceras + primeros 30 KB del cuerpo de cada uno
  const bounces: { at: number; text: string }[] = [];
  const imap = await Imap.open("imap.gmail.com");
  try {
    await imap.cmd(`LOGIN ${imapQuote(GMAIL_USER)} ${imapQuote(GMAIL_APP_PASSWORD)}`);
    await imap.cmd("SELECT INBOX");
    const found = await imap.cmd(`UID SEARCH SINCE ${imapDate(since)} OR FROM "mailer-daemon" FROM "postmaster"`);
    const uids = (found.match(/\* SEARCH([^\r\n]*)/)?.[1] ?? "").trim().split(/\s+/).filter(Boolean).slice(-50);
    for (const uid of uids) {
      const out = await imap.cmd(`UID FETCH ${uid} (INTERNALDATE BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.30000>)`);
      const date = out.match(/INTERNALDATE "([^"]+)"/)?.[1] ?? "";
      const at = Date.parse(date.replace(/-/g, " "));
      bounces.push({ at: Number.isFinite(at) ? at : Date.now(), text: out.toLowerCase() });
    }
    try { await imap.cmd("LOGOUT"); } catch { /* ignore */ }
  } finally {
    imap.close();
  }

  let bounced = 0;
  for (const row of rows) {
    const addr = (row.delivered_to || row.email).toLowerCase();
    const sentAt = Date.parse(row.sent_at as string);
    // Margen de 2 min por diferencias de reloj entre Gmail y Supabase
    const hit = bounces.find((b) => b.at >= sentAt - 120000 && b.text.includes(addr));
    if (!hit) continue;
    bounced++;
    const diag = hit.text.match(/diagnostic-code:[^\r\n]*/)?.[0]
      ?? hit.text.match(/\b5\d\d[ -][^\r\n]{0,160}/)?.[0] ?? "bounced";
    const reason = `bounced: ${diag.trim()}`.slice(0, 300);
    const artist = await artistByEmail(row.email);
    // Email de acceso y aún no ha elegido su clave → va la genérica vigente
    const key = row.kind === "credentials" && artist?.status === "approved" && artist.must_change_password
      ? await genericKey() : null;
    const patch = await discordFallback(row, artist, key, reason);
    await mark(row.id, { bounced_at: new Date(hit.at).toISOString(), ...patch });
  }
  return json({ ok: true, checked: rows.length, bounces: bounces.length, bounced });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response("Server not configured", { status: 500 });

  let body: { id?: unknown; action?: unknown } = {};
  try { body = (await req.json()) ?? {}; } catch { /* sin cuerpo */ }

  // Revisión de rebotes (pg_cron). No recibe datos: solo mira la cola.
  if (body.action === "check_bounces") {
    try {
      return await checkBounces();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("check_bounces failed:", msg);
      return json({ ok: false, error: msg }, 502);
    }
  }

  const id = String(body.id ?? "");
  if (!UUID_RE.test(id)) return new Response("Bad request", { status: 400 });

  const r = await rest(`artist_email_outbox?id=eq.${id}&sent_at=is.null&select=*`);
  const rows: Outbox[] = r.ok ? await r.json() : [];
  const row = rows[0];
  const keyless = row?.kind === "rejected" || (row?.kind === "custom" && !!row.subject && !!row.body);
  // Respuesta neutra: no revela si el id existe. El de acceso necesita clave;
  // el de rechazo y el aviso libre no llevan ninguna.
  if (!row || (!keyless && !row.key) || Date.now() - Date.parse(row.created_at) > MAX_AGE_MS) {
    return json({ ok: false });
  }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    await mark(id, { error: "Gmail credentials not configured" });
    return new Response("Gmail credentials not configured", { status: 500 });
  }
  return await sendRow(row);
});
