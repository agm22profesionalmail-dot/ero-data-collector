// Edge Function: relay-bot-dms
//
// Reenvía a Zero por MD las respuestas que la gente escribe al bot (Pelipper)
// en los mensajes directos que el bot usó para contestar reportes o avisar a
// artistas. Así se ven aunque el PC de Zero esté apagado. No contesta nada
// por su cuenta: solo reenvía.
//
// La llama pg_cron cada 5 min (migración 20260924_01_dm_relay.sql) con la
// cabecera x-relay-key = app_secrets.relay_dm_key. Sin ella responde 401.
//
// A quién mira:
//  - contactos de Discord de public.feedback (últimos 90 días),
//  - artistas con discord_id,
//  - cualquier fila ya presente en public.bot_dm_relay (se pueden añadir a
//    mano: INSERT INTO public.bot_dm_relay (recipient_id, label) VALUES (...)).
// Los bots no pueden listar sus MD por REST, por eso se abre el canal por
// destinatario (POST /users/@me/channels devuelve el mismo canal siempre).
//
// Primera vez que ve un canal: reenvía lo que el destinatario escribió en las
// últimas 48 h y a partir de ahí solo lo nuevo (last_message_id).
//
// Secrets: DISCORD_BOT_TOKEN. SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los
// inyecta Supabase. Desplegar con verify_jwt = false.

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";

const ZERO_ID = "575014104197234699";
const FIRST_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const FEEDBACK_DAYS = 90;
const DISCORD_EPOCH = 1420070400000n;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
const bigger = (a: string | null, b: string) => (!a || BigInt(b) > BigInt(a) ? b : a);

type Row = { recipient_id: string; channel_id: string | null; last_message_id: string | null; label: string | null };
type Msg = {
  id: string; content: string; timestamp: string;
  author: { id: string; username: string; global_name?: string | null; bot?: boolean };
  attachments?: { url: string; filename: string }[];
};

async function recipients(): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  const add = (id: unknown, label: string | null) => {
    const s = typeof id === "string" ? id.trim() : "";
    if (!/^\d{5,25}$/.test(s) || s === ZERO_ID || out.has(s)) return;
    out.set(s, { recipient_id: s, channel_id: null, last_message_id: null, label });
  };
  const state = await rest("bot_dm_relay?select=recipient_id,channel_id,last_message_id,label");
  if (!state.ok) throw new Error(`bot_dm_relay ${state.status}: ${(await state.text()).slice(0, 200)}`);
  for (const r of await state.json() as Row[]) out.set(r.recipient_id, r);

  const since = new Date(Date.now() - FEEDBACK_DAYS * 86400000).toISOString();
  const fb = await rest(`feedback?contact_method=eq.discord&created_at=gte.${since}&select=contact_discord_id,contact_discord_name`);
  if (fb.ok) for (const f of await fb.json()) add(f.contact_discord_id, f.contact_discord_name ? `feedback · ${f.contact_discord_name}` : "feedback");
  const ar = await rest("artists?discord_id=not.is.null&select=discord_id");
  if (ar.ok) for (const a of await ar.json()) add(a.discord_id, "artista");
  return out;
}

async function save(row: Row) {
  const r = await rest("bot_dm_relay?on_conflict=recipient_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`save ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

let zeroChannel: string | null = null;
async function sendToZero(payload: unknown) {
  if (!zeroChannel) {
    const ch = await discord("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: ZERO_ID }) });
    if (!ch.ok) throw new Error(`zero channel ${ch.status}`);
    zeroChannel = (await ch.json()).id;
  }
  const r = await discord(`/channels/${zeroChannel}/messages`, { method: "POST", body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`zero send ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

function forwardPayload(m: Msg, row: Row) {
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
      fields: [{ name: "ID", value: `\`${m.author.id}\``, inline: true }, { name: "Origen", value: row.label ?? "—", inline: true }],
      timestamp: m.timestamp,
    }],
  };
}

async function processRecipient(row: Row): Promise<number> {
  if (!row.channel_id) {
    const ch = await discord("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: row.recipient_id }) });
    if (!ch.ok) return 0;           // usuario inexistente o sin MD posibles
    row.channel_id = (await ch.json()).id;
  }
  const after = row.last_message_id ?? snowflakeFrom(Date.now() - FIRST_LOOKBACK_MS);
  const r = await discord(`/channels/${row.channel_id}/messages?limit=50&after=${after}`);
  if (!r.ok) { await save(row); return 0; }
  const msgs = (await r.json() as Msg[]).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  let sent = 0;
  let last = row.last_message_id;
  for (const m of msgs) {
    if (m.author.id === row.recipient_id && !m.author.bot) {
      await sendToZero(forwardPayload(m, row));
      sent++;
    }
    last = bigger(last, m.id);
  }
  // Sin mensajes nuevos el cursor se queda donde estaba (en la primera pasada,
  // el inicio de la ventana de 48 h): no hay nada que reenviar dos veces.
  row.last_message_id = last ?? after;
  await save(row);
  return sent;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false });
  if (!DISCORD_BOT_TOKEN || !SERVICE_ROLE_KEY) return json(500, { ok: false, error: "not configured" });

  const key = req.headers.get("x-relay-key") ?? "";
  const k = await rest("app_secrets?k=eq.relay_dm_key&select=v");
  const expected = k.ok ? ((await k.json())[0]?.v ?? "") : "";
  if (!expected || key !== expected) return json(401, { ok: false });

  let checked = 0, forwarded = 0;
  const errors: string[] = [];
  try {
    for (const row of (await recipients()).values()) {
      try {
        forwarded += await processRecipient(row);
        checked++;
      } catch (err) {
        if (err instanceof RateLimited) { errors.push("rate limited, sigue en la próxima pasada"); break; }
        errors.push(`${row.recipient_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  if (errors.length) console.error("relay-bot-dms:", errors.join(" | "));
  return json(200, { ok: errors.length === 0, checked, forwarded, errors });
});
