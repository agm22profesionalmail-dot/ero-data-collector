// Carga / guardado de la ficha en Supabase (BBDD + Storage)
import { supabase } from "./supabase.js";

const FIELDS = [
  "player_type", "hair", "bottom", "bottom_variation", "skin_tone", "eye_brows", "eye_color",
  "gear_head", "gear_head_variation", "gear_cloth", "gear_cloth_variation",
  "gear_shoes", "gear_shoes_variation", "weapon_main", "anim_name",
];

async function sha256(file) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadPlayer(userId) {
  const { data, error } = await supabase.from("players").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getBannerSignedUrl(path) {
  if (!path) return null;
  const { data } = await supabase.storage.from("banners").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function savePlayer(state, user, profile) {
  let banner_path = state.banner_path || null;
  let banner_sha256 = state.banner_sha256 || null;

  if (state.bannerFile) {
    banner_path = `${user.id}/banner.png`;
    banner_sha256 = await sha256(state.bannerFile);
    const { error: upErr } = await supabase.storage.from("banners")
      .upload(banner_path, state.bannerFile, { upsert: true, contentType: "image/png" });
    if (upErr) throw upErr;
  }

  const row = {
    user_id: user.id,
    alias: (state.alias || "").trim(),
    discord_id: profile?.discord_id ?? null,
    discord_name: profile?.discord_name ?? null,
    discord_avatar: profile?.discord_avatar ?? null,
    color: state.color,
    banner_path, banner_sha256,
    splattag_config: state._splattag ?? null,
  };
  for (const f of FIELDS) row[f] = state[f];

  const { error } = await supabase.from("players").upsert(row, { onConflict: "user_id" });
  if (error) throw error;

  state.banner_path = banner_path;
  state.banner_sha256 = banner_sha256;
  state.bannerFile = null;
  return row;
}
