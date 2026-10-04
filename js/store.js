// Carga / guardado de la ficha en Supabase (BBDD + Storage)
import { supabase } from "./supabase.js";
import { X_LOGIN_ENABLED, R2_PUBLIC_URL } from "./config.js";

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

// Todas las filas del usuario (un personaje por fila), ordenadas por slot.
// Si la columna `slot` aún no existe (migración pendiente) no hay `slot` en la
// respuesta: se trata como 0 y el orden es el de creación.
export async function loadPlayers(userId) {
  const { data, error } = await supabase.from("players").select("*").eq("user_id", userId);
  if (error) throw error;
  const rows = (data || []).map((r) => ({ ...r, slot: Number.isInteger(r.slot) ? r.slot : 0 }));
  rows.sort((a, b) => a.slot - b.slot);
  return rows;
}

// Wrapper de compatibilidad: personaje principal (slot 0)
export async function loadPlayer(userId) {
  const rows = await loadPlayers(userId);
  return rows.find((r) => r.slot === 0) || rows[0] || null;
}

// Tope de personajes del usuario (RPC my_character_limit, entero 1..3). Si el
// RPC falla o no existe aún, 1. Una llamada por sesión: se cachea la promesa.
let limitPromise = null;
export function getCharacterLimit() {
  if (!limitPromise) {
    limitPromise = (async () => {
      try {
        const { data, error } = await supabase.rpc("my_character_limit");
        if (error) return 1;
        const n = Number(Array.isArray(data) ? data[0] : data);
        return Number.isInteger(n) ? Math.min(3, Math.max(1, n)) : 1;
      } catch { return 1; }
    })();
  }
  return limitPromise;
}
export const resetCharacterLimit = () => { limitPromise = null; };

// URLs públicas en Cloudflare R2 (zero egress, sin signed URLs).
// `version` (el sha del banner) rompe la caché del navegador al cambiar de banner.
export function getBannerUrl(path, version) {
  if (!path) return null;
  const v = version ? `?v=${encodeURIComponent(String(version).slice(0, 12))}` : "";
  return `${R2_PUBLIC_URL}/banners/${path}${v}`;
}

export function getRenderUrl(path) {
  if (!path) return null;
  return `${R2_PUBLIC_URL}/renders/${path}`;
}
export function getRenderUrlFirst(paths) {
  for (const path of paths || []) {
    const url = getRenderUrl(path);
    if (url) return url;
  }
  return null;
}
export const renderCandidates = (base) => [`${base}.webp`, `${base}.png`];
// Slot 0 (principal): <uid>/render, <uid>/spin.webp. Extras (slot n>=1): <uid>/c<n>/...
export const renderPaths = (userId, slot = 0) => {
  if (!userId) return { png: null, spin: null };
  const dir = slot > 0 ? `${userId}/c${slot}` : userId;
  return { png: renderCandidates(`${dir}/render`), spin: `${dir}/spin.webp` };
};
// Banner: slot 0 → <uid>/banner.png; extras → <uid>/banner_c<n>.png
export const bannerPathFor = (userId, slot = 0) => slot > 0 ? `${userId}/banner_c${slot}.png` : `${userId}/banner.png`;

// El banner se sube a Supabase pero la web lo lee de R2: esta llamada lo copia
// al momento. No es fatal: si falla, el sync del vault lo copia en unos minutos.
async function mirrorBannerToR2(slot = 0) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;
    await fetch("/api/sync-banner", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ slot }),
    });
  } catch (e) { console.warn("sync-banner:", e); }
}

// Guarda UN personaje. `state._charId` (players.id) presente → UPDATE por id.
// Sin id → INSERT en el primer slot libre (`state._slot` si viene fijado), sin
// onConflict. El principal (slot 0) no envía `slot` (la columna puede no existir
// aún); los extras sí. Si la BD rechaza el alta por el tope, lanza un Error con
// code "character_limit". Devuelve la fila guardada con su `id` y `slot`.
export async function savePlayer(state, user, profile, usedSlots = []) {
  const existingId = state._charId || null;
  const slot = existingId ? (state._slot || 0)
    : (Number.isInteger(state._slot) ? state._slot : [0, 1, 2].find((n) => !usedSlots.includes(n)) ?? 0);
  let banner_path = state.banner_path || null;
  let banner_sha256 = state.banner_sha256 || null;

  if (state.bannerFile) {
    banner_path = bannerPathFor(user.id, slot);
    banner_sha256 = await sha256(state.bannerFile);
    const { error: upErr } = await supabase.storage.from("banners")
      .upload(banner_path, state.bannerFile, { upsert: true, contentType: "image/png" });
    if (upErr) throw upErr;
    await mirrorBannerToR2(slot);
  }

  const row = {
    alias: (state.alias || "").trim(),
    discord_id: profile?.discord_id ?? null,
    discord_name: profile?.discord_name ?? null,
    discord_avatar: profile?.discord_avatar ?? null,
    color: state.color,
    banner_path, banner_sha256,
    splattag_config: state._splattag ?? null,
  };
  for (const f of FIELDS) row[f] = state[f];
  // Las columnas x_* solo existen tras la migración 20260915_01: con la flag
  // apagada no se mandan, así un deploy sin migrar no rompe el guardado.
  if (X_LOGIN_ENABLED) {
    row.x_id = profile?.x_id ?? null;
    row.x_username = profile?.x_username ?? null;
    row.x_avatar = profile?.x_avatar ?? null;
  }
  // La asociación a artistas ya NO va en esta fila: la hace el RPC
  // artist_link (tabla player_artists, varios artistas por jugador).

  const updateById = async (id) => {
    const { data, error } = await supabase.from("players").update(row).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error("player_not_updated");
    return { id: data.id };
  };

  let saved;
  if (existingId) {
    saved = await updateById(existingId);
  } else {
    const ins = { ...row, user_id: user.id };
    if (slot > 0) ins.slot = slot;
    const { data, error } = await supabase.from("players").insert(ins).select("id").maybeSingle();
    if (error) {
      if (/character_limit/i.test(error.message || "")) {
        const e = new Error("character_limit"); e.code = "character_limit"; throw e;
      }
      if (error.code === "23505") {
        // Alta repetida (doble clic, reintento): el personaje de ese slot ya existe → se actualiza
        const mine = (await loadPlayers(user.id)).find((p) => (Number.isInteger(p.slot) ? p.slot : 0) === slot);
        if (!mine?.id) throw error;
        saved = await updateById(mine.id);
      } else throw error;
    } else saved = { id: data?.id || null };
  }

  state._charId = saved.id;
  state._slot = slot;
  state.banner_path = banner_path;
  state.banner_sha256 = banner_sha256;
  state.bannerFile = null;
  return { ...row, id: saved.id, slot };
}

// Elimina un personaje extra (slot >= 1) por id. El principal no se borra desde
// la web. RLS propia en la BD: solo filas del propio usuario.
export async function deletePlayer(id, slot) {
  if (!id || !(slot >= 1)) throw new Error("main character cannot be deleted");
  const { error } = await supabase.from("players").delete().eq("id", id);
  if (error) throw error;
  // Banner huérfano del extra (R2 + Storage vía función). Un fallo no impide el borrado.
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) {
      const res = await fetch("/api/sync-banner", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ slot, action: "delete" }),
      });
      if (!res.ok) console.warn("sync-banner delete:", res.status);
    }
  } catch (e) { console.warn("sync-banner delete:", e); }
}

// Tras vincular/desvincular una identidad (Discord o X): refresca los campos de
// identidad de la fila existente del usuario. Update de la propia fila (RLS
// players_update_own). Con el trigger players_fill_identity (migración
// 20260915_02) el servidor recalcula estos campos desde auth.identities e
// ignora lo que mande el cliente: este update actúa entonces como un "toque"
// que dispara el trigger. Sin el trigger, el patch sigue siendo útil. Si aún no
// hay ficha, no hace nada: los datos se guardarán con el primer savePlayer.
const IDENTITY_FIELDS = ["discord_id", "discord_name", "discord_avatar"];
const X_IDENTITY_FIELDS = ["x_id", "x_username", "x_avatar"];

export async function syncIdentityFields(user, profile) {
  if (!user || !profile) return false;
  const patch = {};
  const fields = X_LOGIN_ENABLED ? [...IDENTITY_FIELDS, ...X_IDENTITY_FIELDS] : IDENTITY_FIELDS;
  for (const f of fields) patch[f] = profile[f] ?? null;
  const { data, error } = await supabase.from("players").update(patch).eq("user_id", user.id).select("id");
  if (error) throw error;
  return (data || []).length > 0;
}
