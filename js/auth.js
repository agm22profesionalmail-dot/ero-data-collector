// Auth Discord vía Supabase
import { supabase } from "./supabase.js";

export async function signInWithDiscord() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      scopes: "identify email",
    },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Perfil Discord estable: provider_id (snowflake) vive en identities, no en metadata
export function discordProfile(user) {
  if (!user) return null;
  const ident = (user.identities || []).find((i) => i.provider === "discord");
  const meta = user.user_metadata || {};
  return {
    discord_id: ident?.id || ident?.identity_data?.provider_id || meta.provider_id || null,
    discord_name: meta.custom_claims?.global_name || meta.full_name || meta.name || meta.user_name || "Player",
    discord_avatar: meta.avatar_url || null,
  };
}

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_event, session) => cb(session));
}
