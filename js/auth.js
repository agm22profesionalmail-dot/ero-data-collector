import { supabase } from "./supabase.js";
const redirectTo = () => window.location.origin + window.location.pathname;
export async function signInWithDiscord() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: redirectTo(), scopes: "identify" }
  });
  if (error)
    throw error;
}
export async function signInWithX() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "x",
    options: { redirectTo: redirectTo() }
  });
  if (error)
    throw error;
}
export async function linkX() {
  const { error } = await supabase.auth.linkIdentity({
    provider: "x",
    options: { redirectTo: redirectTo() }
  });
  if (error)
    throw error;
}
export async function linkDiscord() {
  const { error } = await supabase.auth.linkIdentity({
    provider: "discord",
    options: { redirectTo: redirectTo(), scopes: "identify" }
  });
  if (error)
    throw error;
}
export async function getIdentities() {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error)
    throw error;
  return data?.identities || [];
}
export async function unlinkX() {
  const identities = await getIdentities();
  const x = identities.find((i) => i.provider === "x" || i.provider === "twitter");
  if (!x || identities.length < 2)
    return false;
  const { error } = await supabase.auth.unlinkIdentity(x);
  if (error)
    throw error;
  return true;
}
export async function signOut() {
  await supabase.auth.signOut();
}
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export async function refreshSessionUser() {
  const { data, error } = await supabase.auth.refreshSession();
  if (error)
    throw error;
  return data?.session || null;
}
const firstOf = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== void 0 && v !== null && v !== "")
      return v;
  }
  return null;
};
const stripAt = (s) => typeof s === "string" ? s.replace(/^@+/, "") : s;
export function identityProfile(user) {
  if (!user)
    return null;
  const idents = user.identities || [];
  const meta = user.user_metadata || {};
  const dc = idents.find((i) => i.provider === "discord");
  const x = idents.find((i) => i.provider === "x" || i.provider === "twitter");
  const dcd = dc?.identity_data || {};
  const xd = x?.identity_data || {};
  const nameOf = (d) => d.custom_claims?.global_name || firstOf(d, ["full_name", "name", "user_name"]);
  const discord_id = (dc ? firstOf(dcd, ["provider_id", "sub"]) || dc.id : null) || (!x ? meta.provider_id : null) || null;
  const discord_name = (dc ? nameOf(dcd) : null) || (!x ? nameOf(meta) : null) || null;
  const discord_avatar = (dc ? firstOf(dcd, ["avatar_url", "picture"]) : null) || (!x ? firstOf(meta, ["avatar_url", "picture"]) : null) || null;
  const x_id = x ? firstOf(xd, ["provider_id", "sub"]) || x.id || null : null;
  const x_username = x ? stripAt(firstOf(xd, ["user_name", "preferred_username", "username", "screen_name"])) : null;
  const x_name = x ? firstOf(xd, ["full_name", "name"]) || x_username || null : null;
  const x_avatar = x ? firstOf(xd, ["avatar_url", "picture", "profile_image_url"]) || null : null;
  const providers = idents.map((i) => i.provider === "twitter" ? "x" : i.provider);
  return {
    discord_id,
    discord_name,
    discord_avatar,
    x_id,
    x_username,
    x_name,
    x_avatar,
    providers,
    display_name: discord_name || x_name || (x_username ? "@" + x_username : null) || "Player",
    display_avatar: discord_avatar || x_avatar || null,
    hasDiscord: providers.includes("discord"),
    hasX: providers.includes("x")
  };
}
export function discordProfile(user) {
  const p = identityProfile(user);
  if (!p)
    return null;
  return {
    discord_id: p.discord_id,
    discord_name: p.discord_name || p.display_name,
    discord_avatar: p.discord_avatar
  };
}
export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_event, session) => cb(session));
}
export function consumeAuthError() {
  const read = (str) => new URLSearchParams(str.replace(/^[?#]/, ""));
  const q = read(window.location.search);
  const h = read(window.location.hash);
  const get = (k) => q.get(k) || h.get(k);
  const error = get("error");
  if (!error)
    return null;
  const out = { error, code: get("error_code") || null, description: get("error_description") || null };
  history.replaceState(null, "", window.location.pathname);
  return out;
}
