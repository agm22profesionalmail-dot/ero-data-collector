import { supabase } from "./supabase.js";
import { X_LOGIN_ENABLED, R2_PUBLIC_URL } from "./config.js";
const FIELDS = [
  "player_type",
  "hair",
  "bottom",
  "bottom_variation",
  "skin_tone",
  "eye_brows",
  "eye_color",
  "gear_head",
  "gear_head_variation",
  "gear_cloth",
  "gear_cloth_variation",
  "gear_shoes",
  "gear_shoes_variation",
  "weapon_main",
  "anim_name"
];
async function sha256(file) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function loadPlayers(userId) {
  const { data, error } = await supabase.from("players").select("*").eq("user_id", userId);
  if (error)
    throw error;
  const rows = (data || []).map((r) => ({ ...r, slot: Number.isInteger(r.slot) ? r.slot : 0 }));
  rows.sort((a, b) => a.slot - b.slot);
  return rows;
}
export async function loadPlayer(userId) {
  const rows = await loadPlayers(userId);
  return rows.find((r) => r.slot === 0) || rows[0] || null;
}
let limitPromise = null;
export function getCharacterLimit() {
  if (!limitPromise) {
    limitPromise = (async () => {
      try {
        const { data, error } = await supabase.rpc("my_character_limit");
        if (error)
          return 1;
        const n = Number(Array.isArray(data) ? data[0] : data);
        return Number.isInteger(n) ? Math.min(3, Math.max(1, n)) : 1;
      } catch {
        return 1;
      }
    })();
  }
  return limitPromise;
}
export const resetCharacterLimit = () => {
  limitPromise = null;
};
export function getBannerUrl(path, version) {
  if (!path)
    return null;
  const v = version ? `?v=${encodeURIComponent(String(version).slice(0, 12))}` : "";
  return `${R2_PUBLIC_URL}/banners/${path}${v}`;
}
export function getRenderUrl(path) {
  if (!path)
    return null;
  return `${R2_PUBLIC_URL}/renders/${path}`;
}
export function getRenderUrlFirst(paths) {
  for (const path of paths || []) {
    const url = getRenderUrl(path);
    if (url)
      return url;
  }
  return null;
}
export const renderCandidates = (base) => [`${base}.webp`, `${base}.png`];
export const renderPaths = (userId, slot = 0) => {
  if (!userId)
    return { png: null, spin: null };
  const dir = slot > 0 ? `${userId}/c${slot}` : userId;
  return { png: renderCandidates(`${dir}/render`), spin: `${dir}/spin.webp` };
};
export const bannerPathFor = (userId, slot = 0) => slot > 0 ? `${userId}/banner_c${slot}.png` : `${userId}/banner.png`;
async function mirrorBannerToR2(slot = 0) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token)
      return;
    await fetch("/api/sync-banner", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ slot })
    });
  } catch (e) {
    console.warn("sync-banner:", e);
  }
}
export async function savePlayer(state, user, profile, usedSlots = []) {
  const existingId = state._charId || null;
  const slot = existingId ? state._slot || 0 : Number.isInteger(state._slot) ? state._slot : [0, 1, 2].find((n) => !usedSlots.includes(n)) ?? 0;
  let banner_path = state.banner_path || null;
  let banner_sha256 = state.banner_sha256 || null;
  if (state.bannerFile) {
    banner_path = bannerPathFor(user.id, slot);
    banner_sha256 = await sha256(state.bannerFile);
    const { error: upErr } = await supabase.storage.from("banners").upload(banner_path, state.bannerFile, { upsert: true, contentType: "image/png" });
    if (upErr)
      throw upErr;
    await mirrorBannerToR2(slot);
  }
  const row = {
    alias: (state.alias || "").trim(),
    discord_id: profile?.discord_id ?? null,
    discord_name: profile?.discord_name ?? null,
    discord_avatar: profile?.discord_avatar ?? null,
    color: state.color,
    banner_path,
    banner_sha256,
    splattag_config: state._splattag ?? null
  };
  for (const f of FIELDS)
    row[f] = state[f];
  if (X_LOGIN_ENABLED) {
    row.x_id = profile?.x_id ?? null;
    row.x_username = profile?.x_username ?? null;
    row.x_avatar = profile?.x_avatar ?? null;
  }
  const updateById = async (id) => {
    const { data, error } = await supabase.from("players").update(row).eq("id", id).select("id").maybeSingle();
    if (error)
      throw error;
    if (!data?.id)
      throw new Error("player_not_updated");
    return { id: data.id };
  };
  let saved;
  if (existingId) {
    saved = await updateById(existingId);
  } else {
    const ins = { ...row, user_id: user.id };
    if (slot > 0)
      ins.slot = slot;
    const { data, error } = await supabase.from("players").insert(ins).select("id").maybeSingle();
    if (error) {
      if (/character_limit/i.test(error.message || "")) {
        const e = new Error("character_limit");
        e.code = "character_limit";
        throw e;
      }
      if (error.code === "23505") {
        const mine = (await loadPlayers(user.id)).find((p) => (Number.isInteger(p.slot) ? p.slot : 0) === slot);
        if (!mine?.id)
          throw error;
        saved = await updateById(mine.id);
      } else
        throw error;
    } else
      saved = { id: data?.id || null };
  }
  state._charId = saved.id;
  state._slot = slot;
  state.banner_path = banner_path;
  state.banner_sha256 = banner_sha256;
  state.bannerFile = null;
  return { ...row, id: saved.id, slot };
}
export async function deletePlayer(id, slot) {
  if (!id || !(slot >= 1))
    throw new Error("main character cannot be deleted");
  const { error } = await supabase.from("players").delete().eq("id", id);
  if (error)
    throw error;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) {
      const res = await fetch("/api/sync-banner", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ slot, action: "delete" })
      });
      if (!res.ok)
        console.warn("sync-banner delete:", res.status);
    }
  } catch (e) {
    console.warn("sync-banner delete:", e);
  }
}
const IDENTITY_FIELDS = ["discord_id", "discord_name", "discord_avatar"];
const X_IDENTITY_FIELDS = ["x_id", "x_username", "x_avatar"];
export async function syncIdentityFields(user, profile) {
  if (!user || !profile)
    return false;
  const patch = {};
  const fields = X_LOGIN_ENABLED ? [...IDENTITY_FIELDS, ...X_IDENTITY_FIELDS] : IDENTITY_FIELDS;
  for (const f of fields)
    patch[f] = profile[f] ?? null;
  const { data, error } = await supabase.from("players").update(patch).eq("user_id", user.id).select("id");
  if (error)
    throw error;
  return (data || []).length > 0;
}
