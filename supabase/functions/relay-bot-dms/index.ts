// Edge Function: relay-bot-dms
//
// Reenvía al propietario (OWNER_DISCORD_ID) por MD las respuestas que la gente
// escribe al bot en los mensajes directos que el bot usó para contestar reportes
// o avisar a artistas. No contesta nada por su cuenta: solo reenvía.
//
// Sin estado en la base de datos: cada reenvío lleva en el pie "src <id>" del
// mensaje original, y antes de reenviar se leen los últimos mensajes del MD
// bot ↔ propietario para no repetir. Es idempotente: llamarla de más no duplica.
// Solo mira mensajes de las últimas LOOKBACK horas.
//
// La dispara .github/workflows/relay-bot-dms.yml cada 5 min (GitHub Actions).
//
// A quién mira: contactos de Discord de public.feedback (últimos 90 días),
// artistas con discord_id y EXTRA_RECIPIENTS (IDs a los que se escribió a
// mano, separados por comas). Los bots no pueden listar sus MD por REST, por eso se abre el canal
// por destinatario (POST /users/@me/channels devuelve siempre el mismo).
//
// Secrets: DISCORD_BOT_TOKEN, OWNER_DISCORD_ID y EXTRA_RECIPIENTS (opcional). SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los
// inyecta Supabase. Desplegada con verify_jwt = false.

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";

const ZERO_ID = Deno.env.get("OWNER_DISCORD_ID") ?? "";
const EXTRA_RECIPIENTS: Record<string, string> = Object.fromEntries(
  (Deno.env.get("EXTRA_RECIPIENTS") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    .map((id) => [id, "manual"]),
);
const LOOKBACK_MS = 72 * 60 * 60 * 1000;
const FEEDBACK_DAYS = 90;
const DISCORD_EPOCH = 1420070400000n;
const SRC_RE = /^src (\d{5,25})$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const rest = (path: string) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });

class RateLimited extends Error {}

async function discord(path: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (r.status === 429) throw new RateLimited(path);
  return r;
}

const snowflakeFrom = (ms: number) => ((BigInt(ms) - DISCORD_EPOCH) << 22n).toString();

type Msg = {
  id: string; content: string; timestamp: string;
  author: { id: string; username: string; global_name?: string | null; bot?: boolean };
  attachments?: { url: string; filename: string }[];
  embeds?: { footer?: { text?: string } }[];
};

async function recipients(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const add = (id: unknown, label: string) => {
    const s = typeof id === "string" ? id.trim() : "";
    if (/^\d{5,25}$/.test(s) && s !== ZERO_ID && !out.has(s)) out.set(s, label);
  };
  for (const [id, label] of Object.entries(EXTRA_RECIPIENTS)) add(id, label);
  const since = new Date(Date.now() - FEEDBACK_DAYS * 86400000).toISOString();
  const fb = await rest(`feedback?contact_method=eq.discord&created_at=gte.${since}&select=contact_discord_id,contact_discord_name`);
  if (fb.ok) for (const f of await fb.json()) add(f.contact_discord_id, f.contact_discord_name ? `feedback · ${f.contact_discord_name}` : "feedback");
  const ar = await rest("artists?discord_id=not.is.null&select=discord_id");
  if (ar.ok) for (const a of await ar.json()) add(a.discord_id, "artista");
  return out;
}

async function dmChannel(userId: string): Promise<string | null> {
  const ch = await discord("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: userId }) });
  return ch.ok ? (await ch.json()).id : null;
}

async function messagesSince(channelId: string, after: string): Promise<Msg[]> {
  const out: Msg[] = [];
  let cursor = after;
  for (let page = 0; page < 5; page++) {
    const r = await discord(`/channels/${channelId}/messages?limit=100&after=${cursor}`);
    if (!r.ok) break;
    const batch = await r.json() as Msg[];
    if (!batch.length) break;
    out.push(...batch);
    cursor = batch.reduce((m, x) => (BigInt(x.id) > BigInt(m) ? x.id : m), cursor);
    if (batch.length < 100) break;
  }
  return out.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

function forwardPayload(m: Msg, label: string) {
  const name = m.author.global_name || m.author.username;
  const files = (m.attachments ?? []).map((a) => `[${a.filename}](${a.url})`).join("\n");
  const text = [m.content || "", files].filter(Boolean).join("\n\n").slice(0, 3900) || "(sin texto)";
  return {
    content: `📨 Respuesta por MD a Pelipper de <@${m.author.id}>`,
    allowed_mentions: { parse: [] },
    embeds: [{
      color: 0x8b5cff,
      author: { name: `${name} (@${m.author.username})` },
      description: text,
      fields: [{ name: "ID", value: `\`${m.author.id}\``, inline: true }, { name: "Origen", value: label, inline: true }],
      footer: { text: `src ${m.id}` },
      timestamp: m.timestamp,
    }],
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false });
  if (!DISCORD_BOT_TOKEN || !SERVICE_ROLE_KEY) return json(500, { ok: false, error: "not configured" });

  const after = snowflakeFrom(Date.now() - LOOKBACK_MS);
  let checked = 0, forwarded = 0;
  const errors: string[] = [];
  try {
    if (!ZERO_ID) return json(500, { ok: false, error: "OWNER_DISCORD_ID not configured" });
    const zeroCh = await dmChannel(ZERO_ID);
    if (!zeroCh) return json(502, { ok: false, error: "owner channel" });
    const done = new Set<string>();
    for (const m of await messagesSince(zeroCh, after)) {
      const src = m.author.bot ? m.embeds?.[0]?.footer?.text?.match(SRC_RE)?.[1] : undefined;
      if (src) done.add(src);
    }
    for (const [userId, label] of await recipients()) {
      try {
        const ch = await dmChannel(userId);
        checked++;
        if (!ch) continue;                       // usuario sin MD posibles
        for (const m of await messagesSince(ch, after)) {
          if (m.author.id !== userId || m.author.bot || done.has(m.id)) continue;
          const r = await discord(`/channels/${zeroCh}/messages`, { method: "POST", body: JSON.stringify(forwardPayload(m, label)) });
          if (!r.ok) throw new Error(`send ${r.status}: ${(await r.text()).slice(0, 200)}`);
          done.add(m.id);
          forwarded++;
        }
      } catch (err) {
        if (err instanceof RateLimited) { errors.push("rate limited, sigue en la próxima pasada"); break; }
        errors.push(`${userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    if (err instanceof RateLimited) errors.push("rate limited");
    else errors.push(err instanceof Error ? err.message : String(err));
  }
  if (errors.length) console.error("relay-bot-dms:", errors.join(" | "));
  return json(200, { ok: errors.length === 0, checked, forwarded, errors });
});
