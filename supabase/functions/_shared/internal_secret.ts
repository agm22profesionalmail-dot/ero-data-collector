const HEADER = "x-edc-secret";
const MIN_LEN = 16;

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0 && a.length === b.length;
}

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
