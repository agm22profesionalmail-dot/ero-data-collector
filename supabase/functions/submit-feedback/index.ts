import { isPublicKey, publishableKey, serviceKey } from "../_shared/keys.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const ANON_KEY = publishableKey();
const SERVICE_ROLE_KEY = serviceKey();
const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const IP_SALT = Deno.env.get("FEEDBACK_IP_SALT") ?? "";

const GUILD_ID = (Deno.env.get("DISCORD_GUILD_ID") ?? "").trim();
const NOTIFY_USER_ID = Deno.env.get("OWNER_DISCORD_ID") ?? "";
const SITE_URL = "https://eroplayerdata.pages.dev";
const ICON_URL = `${SITE_URL}/assets/apple-touch-icon.png`;

const KINDS = ["bug", "suggestion", "other"] as const;
type Kind = typeof KINDS[number];
const MSG_MIN = 10;
const MSG_MAX = 2000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_CONTACT = 5;
const MAX_PER_IP = 20;
const MAX_NONE_PER_IP = 5; // sin contacto no hay otra barrera: límite más estricto

const ALLOWED_ORIGINS = ["https://eroplayerdata.pages.dev"];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin :ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

type ErrCode = "bad_request" | "email_dead" | "not_member" | "not_logged" | "rate_limited" | "server";

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

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

type AuthUser = {
  id: string;
  user_metadata?: Record<string, unknown>;
  identities?: { provider: string; id?: string; identity_data?: Record<string, unknown> }[];
};
type DiscordIdentity = { userId: string; discordId: string; discordName: string | null };

async function userFromRequest(req: Request): Promise<AuthUser | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || isPublicKey(token)) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? u as AuthUser : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function discordIdentity(u: AuthUser): DiscordIdentity | null {
  const idents = u.identities ?? [];
  const dc = idents.find((i) => i.provider === "discord");
  const hasX = idents.some((i) => i.provider === "x" || i.provider === "twitter");
  const meta = u.user_metadata ?? {};
  const nameOf = (d: Record<string, unknown>) =>
    str((d.custom_claims as Record<string, unknown> | undefined)?.global_name) ?? str(d.full_name) ?? str(d.name) ?? str(d.user_name);
  let discordId: string | null = null;
  let discordName: string | null = null;
  if (dc) {
    const d = dc.identity_data ?? {};
    discordId = str(d.provider_id) ?? str(d.sub) ?? str(dc.id);
    discordName = nameOf(d);
  } else if (!hasX) {
    discordId = str(meta.provider_id);
    discordName = nameOf(meta);
  }
  if (!discordId || !/^\d{5,25}$/.test(discordId)) return null;
  return { userId: u.id, discordId, discordName };
}

const discordApi = (path: string, init: RequestInit = {}) =>
  fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(10000),
  });

async function isGuildMember(discordId: string): Promise<boolean | null> {
  if (!/^\d{5,25}$/.test(GUILD_ID)) { console.error("DISCORD_GUILD_ID not configured"); return false; }
  if (!DISCORD_BOT_TOKEN) return null;
  try {
    const r = await discordApi(`/guilds/${GUILD_ID}/members/${discordId}`);
    if (r.ok) return true;
    if (r.status === 404) return false;
    console.error("guild member check:", r.status, (await r.text()).slice(0, 200));
    return null;
  } catch (err) {
    console.error("guild member check:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function sendDiscordDm(discordId: string, payload: unknown): Promise<string | null> {
  if (!DISCORD_BOT_TOKEN) return "discord bot not configured";
  try {
    const ch = await discordApi("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: discordId }) });
    if (!ch.ok) return `discord ${ch.status}: ${(await ch.text()).slice(0, 200)}`;
    const { id } = await ch.json();
    const msg = await discordApi(`/channels/${id}/messages`, { method: "POST", body: JSON.stringify(payload) });
    if (!msg.ok) return `discord ${msg.status}: ${(await msg.text()).slice(0, 200)}`;
    return null;
  } catch (err) {
    return `discord: ${err instanceof Error ? err.message : String(err)}`;
  }
}

type Row = {
  id: string; created_at: string; kind: Kind; message: string;
  contact_method: "email" | "discord" | "none"; contact_email: string | null;
  contact_discord_id: string | null; contact_discord_name: string | null;
  page: string | null; lang: string;
};

const KIND_META: Record<Kind, { label: string; color: number }> = {
  bug:        { label: "Fallo",      color: 0xf87171 },
  suggestion: { label: "Sugerencia", color: 0x60d8c0 },
  other:      { label: "Otro",       color: 0x8b5cff },
};

function notifyPayload(row: Row) {
  const meta = KIND_META[row.kind];
  const firstWords = row.message.replace(/\s+/g, " ").split(" ").slice(0, 8).join(" ");
  const title = `${meta.label} · ${firstWords.length < 70 ? firstWords : firstWords.slice(0, 67) + "..."}`;
  const contact = row.contact_method === "email"
    ? `${row.contact_email}`
    : row.contact_method === "none"
      ? "Sin contacto (no se le puede avisar)"
          : `<@${row.contact_discord_id}> - ${row.contact_discord_name ?? "?"} (\`${row.contact_discord_id}\`)`;
  const page = row.page ? `${SITE_URL}${row.page.startsWith("/") ? "" : "/"}${row.page}` : "—";
  return {
    allowed_mentions: { parse: [] as string[] },
    embeds: [{
      color: meta.color,
      author: { name: "OC Data Collector · Reportes y sugerencias", icon_url: ICON_URL, url: `${SITE_URL}/?feedback` },
      title,
      description: row.message.length > 4000 ? row.message.slice(0, 3997) + "…" : row.message,
      fields: [
        { name: "Contacto", value: contact, inline: false },
        { name: "Idioma", value: row.lang, inline: true },
        { name: "Página", value: page, inline: true },
        { name: "Fecha", value: `<t:${Math.floor(Date.parse(row.created_at) / 1000)}:F>`, inline: false },
      ],
      footer: { text: `id ${row.id}`, icon_url: ICON_URL },
      timestamp: row.created_at,
    }],
  };
}

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
const fail = (req: Request, error: ErrCode, status = 400) => json(req, { ok: false, error }, status);

async function checkMember(req: Request) {
  const u = await userFromRequest(req);
  const who = u && discordIdentity(u);
  if (!who) return fail(req, "not_logged", 401);
  const member = await isGuildMember(who.discordId);
  if (member === null) return fail(req, "server", 502);
  return json(req, { ok: true, member });
}

type SubmitBody = {
  kind?: unknown; message?: unknown; contact_method?: unknown; email?: unknown;
  page?: unknown; lang?: unknown; website?: unknown;
};

const cleanText = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim().slice(0, max) : "";

async function countRecent(filter: string, limit: number): Promise<number | null> {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const r = await rest(`feedback?select=id&created_at=gte.${since}&${filter}&limit=${limit}`);
  if (!r.ok) { console.error("rate count:", r.status, (await r.text()).slice(0, 200)); return null; }
  const rows = await r.json();
  return Array.isArray(rows) ? rows.length : null;
}

async function submit(req: Request, body: SubmitBody) {
  if (typeof body.website === "string" && body.website.trim()) return json(req, { ok: true });

  const kind = body.kind as Kind;
  if (!KINDS.includes(kind)) return fail(req, "bad_request");
  const message = cleanText(body.message, MSG_MAX + 1);
  if (message.length < MSG_MIN || message.length > MSG_MAX) return fail(req, "bad_request");
  const method = body.contact_method;
  if (method !== "email" && method !== "discord" && method !== "none") return fail(req, "bad_request");
  const lang = body.lang === "es" ? "es" : "en";
  const page = cleanText(body.page, 300).replace(/[\r\n\t]/g, "") || null;
  if (page && !page.startsWith("/")) return fail(req, "bad_request");

  let email: string | null = null;
  let discord: DiscordIdentity | null = null;

  if (method === "email") {
    email = cleanText(body.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email) || email.length < 5) return fail(req, "bad_request");
    if (await domainAccepts(email) === "dead") return fail(req, "email_dead");
  } else if (method === "discord") {
    const u = await userFromRequest(req);
    discord = u && discordIdentity(u);
    if (!discord) return fail(req, "not_logged", 401);
    const member = await isGuildMember(discord.discordId);
    if (member === null) return fail(req, "server", 502);
    if (!member) return fail(req, "not_member", 403);
  }

  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip")
    || (req.headers.get("x-forwarded-for") ?? "").split(",").pop()?.trim() || "";
  const ipHash = ip ? await sha256Hex(`${IP_SALT}|${ip}`) : null;
  if (method !== "none") {
    const contactFilter = method === "email"
      ? `contact_email=eq.${encodeURIComponent(email as string)}`
      : `contact_discord_id=eq.${encodeURIComponent((discord as DiscordIdentity).discordId)}`;
    const byContact = await countRecent(contactFilter, MAX_PER_CONTACT);
    if (byContact === null) return fail(req, "server", 500);
    if (byContact >= MAX_PER_CONTACT) return fail(req, "rate_limited", 429);
  } else {
    if (!ipHash) return fail(req, "rate_limited", 429);
    const noneByIp = await countRecent(`ip_hash=eq.${ipHash}&contact_method=eq.none`, MAX_NONE_PER_IP);
    if (noneByIp === null) return fail(req, "server", 500);
    if (noneByIp >= MAX_NONE_PER_IP) return fail(req, "rate_limited", 429);
  }
  if (ipHash) {
    const byIp = await countRecent(`ip_hash=eq.${ipHash}`, MAX_PER_IP);
    if (byIp === null) return fail(req, "server", 500);
    if (byIp >= MAX_PER_IP) return fail(req, "rate_limited", 429);
  }

  const insert = await rest("feedback", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      kind, message, contact_method: method,
      contact_email: email,
      contact_discord_id: discord?.discordId ?? null,
      contact_discord_name: discord?.discordName ?? null,
      user_id: discord?.userId ?? null,
      page, lang, ip_hash: ipHash,
    }),
  });
  if (!insert.ok) {
    console.error("feedback insert:", insert.status, (await insert.text()).slice(0, 300));
    return fail(req, "server", 500);
  }
  const row = ((await insert.json()) as Row[])[0];
  if (!row?.id) return fail(req, "server", 500);

  const dmErr = await sendDiscordDm(NOTIFY_USER_ID, notifyPayload(row));
  if (dmErr) {
    console.error("feedback notify:", dmErr);
  } else {
    await rest(`feedback?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ notified: true }) });
  }
  return json(req, { ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "bad_request" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || !IP_SALT) return json(req, { ok: false, error: "server" }, 500);

  let body: SubmitBody & { action?: unknown } = {};
  try { body = (await req.json()) ?? {}; } catch { /* sin cuerpo */ }

  try {
    if (body.action === "check_member") return await checkMember(req);
    if (body.action === "submit") return await submit(req, body);
    return fail(req, "bad_request");
  } catch (err) {
    console.error("submit-feedback:", err instanceof Error ? err.message : String(err));
    return fail(req, "server", 500);
  }
});
