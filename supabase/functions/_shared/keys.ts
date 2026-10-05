const pick = (raw: string | undefined, re: RegExp): string[] => raw?.match(re) ?? [];

const SECRET_RE = /sb_secret_[A-Za-z0-9_-]+/g;
const PUBLISHABLE_RE = /sb_publishable_[A-Za-z0-9_-]+/g;

export function serviceKey(): string {
  return pick(Deno.env.get("SUPABASE_SECRET_KEYS"), SECRET_RE)[0]
    ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

export function publishableKey(): string {
  return pick(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"), PUBLISHABLE_RE)[0]
    ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

export function isPublicKey(token: string): boolean {
  if (!token) return false;
  return token === Deno.env.get("SUPABASE_ANON_KEY")
    || pick(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"), PUBLISHABLE_RE).includes(token)
    || token.startsWith("sb_publishable_");
}
