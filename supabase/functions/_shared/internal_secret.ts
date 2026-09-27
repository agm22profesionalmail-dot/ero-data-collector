// Secreto interno de las Edge Functions que NO reciben JWT de usuario
// (las dispara pg_net desde SQL, pg_cron o un cron de GitHub Actions).
//
// Quien llama manda la cabecera `x-edc-secret`; se compara en tiempo constante
// con el secret EDC_INTERNAL_SECRET de la función. Fail-closed: si el secret
// no está configurado, TODO se rechaza (503), nunca se deja pasar.
//
// El mismo valor vive en Supabase Vault (`edc_internal_secret`, lo lee
// public.edc_internal_headers()) y en el secreto EDC_INTERNAL_SECRET del
// repositorio de GitHub (workflow relay-bot-dms).

const HEADER = "x-edc-secret";
const MIN_LEN = 16;

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Compara los SHA-256 de los dos valores byte a byte sin cortocircuito:
// longitud fija y tiempo independiente de dónde difieran.
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0 && a.length === b.length;
}

// null = OK; si no, la Response de rechazo que hay que devolver tal cual.
export async function requireInternalSecret(req: Request): Promise<Response | null> {
  const expected = Deno.env.get("EDC_INTERNAL_SECRET") ?? "";
  if (expected.length < MIN_LEN) {
    console.error("EDC_INTERNAL_SECRET not configured: rejecting request");
    return new Response("Not configured", { status: 503 });
  }
  const got = req.headers.get(HEADER) ?? "";
  if (!(await timingSafeEqual(got, expected))) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}
