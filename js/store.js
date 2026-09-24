// Carga / guardado de la ficha en Supabase (BBDD + Storage)
import { supabase } from "./supabase.js";
import { X_LOGIN_ENABLED } from "./config.js";

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

// URLs firmadas reutilizadas (2026-09-25, ahorro de egress de Supabase): cada
// firma nueva es una URL distinta y el CDN/navegador la tratan como imagen
// nueva. Se firma por 24 h y se reutiliza la misma URL durante 6 h (memoria +
// localStorage), así las visitas repetidas salen de caché. Tras un re-render,
// la imagen nueva puede tardar hasta ~1 h en verse (Cache-Control del worker).
const SIGN_EXPIRES_S = 24 * 3600;
const SIGN_REUSE_MS = 6 * 3600 * 1000;
const SIGN_LS_KEY = "edc_signed_urls_v1";
const signMem = new Map();
function signCacheRead() {
  try { return JSON.parse(localStorage.getItem(SIGN_LS_KEY) || "{}") || {}; } catch { return {}; }
}
function signCacheWrite(all) {
  try { localStorage.setItem(SIGN_LS_KEY, JSON.stringify(all)); } catch { /* sin storage: solo memoria */ }
}
async function signedUrlCached(bucket, path) {
  const key = `${bucket}/${path}`;
  const now = Date.now();
  const hit = signMem.get(key) || signCacheRead()[key];
  if (hit && now - hit.at < SIGN_REUSE_MS) { signMem.set(key, hit); return hit.url; }
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, SIGN_EXPIRES_S);
  const url = data?.signedUrl ?? null;
  if (!url) return null;
  const entry = { url, at: now };
  signMem.set(key, entry);
  const all = signCacheRead();
  for (const k of Object.keys(all)) if (now - (all[k]?.at || 0) >= SIGN_REUSE_MS) delete all[k];
  all[key] = entry;
  signCacheWrite(all);
  return url;
}

export async function getBannerSignedUrl(path) {
  if (!path) return null;
  try { return await signedUrlCached("banners", path); } catch { return null; }
}

// Bucket privado `renders` (render.webp / spin.webp del worker de Blender).
// Devuelve null si no hay path, el bucket no existe o falla la firma: el que
// llama lo trata como "aún sin render".
export async function getRenderSignedUrl(path) {
  if (!path) return null;
  try {
    return await signedUrlCached("renders", path);
  } catch { return null; }
}
// Firma la primera ruta que exista de una lista de candidatos (firmar un
// objeto inexistente falla → se prueba el siguiente). Sirve para el cambio de
// formato de 2026-09-24: primero `render.webp` y, si aún no está, el
// `render.png` antiguo.
export async function getRenderSignedUrlFirst(paths) {
  for (const path of paths || []) {
    const url = await getRenderSignedUrl(path);
    if (url) return url;
  }
  return null;
}
// Candidatos del render principal, por orden de preferencia (WebP, luego PNG).
export const renderCandidates = (base) => [`${base}.webp`, `${base}.png`];
// Rutas del render principal (lista de candidatos) y del sprite de giro de un usuario.
export const renderPaths = (userId) => userId
  ? { png: renderCandidates(`${userId}/render`), spin: `${userId}/spin.webp` }
  : { png: null, spin: null };

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
  // Las columnas x_* solo existen tras la migración 20260915_01: con la flag
  // apagada no se mandan, así un deploy sin migrar no rompe el guardado.
  if (X_LOGIN_ENABLED) {
    row.x_id = profile?.x_id ?? null;
    row.x_username = profile?.x_username ?? null;
    row.x_avatar = profile?.x_avatar ?? null;
  }
  // La asociación a artistas ya NO va en esta fila: la hace el RPC
  // artist_link (tabla player_artists, varios artistas por jugador).

  const { error } = await supabase.from("players").upsert(row, { onConflict: "user_id" });
  if (error) throw error;

  state.banner_path = banner_path;
  state.banner_sha256 = banner_sha256;
  state.bannerFile = null;
  return row;
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
