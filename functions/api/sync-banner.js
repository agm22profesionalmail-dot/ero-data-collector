import { putR2, deleteR2 } from "../_lib/r2.js";

const MAX_BYTES = 2 * 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  const need = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
  if (need.some((k) => !env[k])) return json(503, { error: "not_configured" });

  const auth = request.headers.get("Authorization") || "";
  if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(auth)) return json(401, { error: "no_token" });

  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const who = await fetch(`${base}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!who.ok) return json(401, { error: "bad_token" });
  const user = await who.json();
  if (!user?.id || !/^[0-9a-f-]{36}$/.test(user.id)) return json(401, { error: "bad_user" });

  let slot = 0, action = "";
  try {
    const body = await request.json();
    if (body && body.slot !== undefined && body.slot !== null) slot = body.slot;
    if (body && typeof body.action === "string") action = body.action;
  } catch (_) { /* sin cuerpo: slot 0 */ }
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) return json(400, { error: "bad_slot" });
  const name = slot === 0 ? "banner.png" : `banner_c${slot}.png`;

  if (action === "delete") {
    if (slot < 1) return json(400, { error: "bad_slot" });
    try {
      await deleteR2(env, `banners/${user.id}/${name}`);
    } catch (e) {
      return json(502, { error: "r2_failed" });
    }
    let storage = "ok";
    try {
      const del = await fetch(`${base}/storage/v1/object/banners/${user.id}/${name}`, {
        method: "DELETE",
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth },
      });
      if (!del.ok) storage = "failed";
    } catch (_) { storage = "failed"; }
    return json(200, { ok: true, storage });
  }

  const key = `banners/${user.id}/${name}`;
  const src = await fetch(`${base}/storage/v1/object/authenticated/banners/${user.id}/${name}`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth },
  });
  if (!src.ok) return json(404, { error: "no_banner" });

  const data = new Uint8Array(await src.arrayBuffer());
  if (data.length < 64 || data.length > MAX_BYTES) return json(413, { error: "bad_size" });
  if (!PNG_MAGIC.every((b, i) => data[i] === b)) return json(415, { error: "not_png" });

  try {
    await putR2(env, key, data, "image/png");
  } catch (e) {
    return json(502, { error: "r2_failed" });
  }
  return json(200, { ok: true });
}
