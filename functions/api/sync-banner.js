// Copia a R2 el banner que el jugador acaba de guardar en Supabase Storage.
//
// La web sube el banner a Supabase (con las políticas RLS de siempre) y lee de
// R2; esta función cierra el hueco: con la sesión del propio jugador lee SU
// banner de Supabase, comprueba que es un PNG de tamaño razonable y lo escribe
// en R2 en la misma ruta. La clave sale del token, no de la petición: nadie
// puede tocar el banner de otro. Los secretos (R2_*, SUPABASE_*) viven en el
// entorno del proyecto de Pages, no en el repo.

import { putR2 } from "../_lib/r2.js";

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

  const key = `banners/${user.id}/banner.png`;
  const src = await fetch(`${base}/storage/v1/object/authenticated/banners/${user.id}/banner.png`, {
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
