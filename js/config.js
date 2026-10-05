// ── Config Supabase (rellenar tras SETUP.md) ──────────────────────────
// La anon key es PÚBLICA y segura de exponer (la protección real es RLS).
export const SUPABASE_URL = "https://xwyauyjeteztlevvtydb.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_z9ASUAdn2ahI0gRVWBnWyA_aXoAGKmd";

// ── Assets (banners, renders) servidos desde Cloudflare R2 (público, sin egress) ──
export const R2_PUBLIC_URL = "https://pub-5e28d3ea68944786851f5d81e47de75c.r2.dev";

// ── Login con X (Twitter) ─────────────────────────────────────────────
// Ponlo a true SOLO cuando el proveedor "X / Twitter (OAuth 2.0)" esté activado
// en Supabase y las migraciones supabase/migrations/20260915_01_x_identity.sql y
// 20260915_02_identity_trigger.sql estén ejecutadas (ver SETUP.md → "Login con X"). Con false la web se comporta
// exactamente igual que antes: solo Discord, sin botones ni vinculación de X.
export const X_LOGIN_ENABLED = true;

// ── Render 3D propio del jugador ──────────────────────────────────────
// Obsoleta: el jugador ve SIEMPRE su render en la ficha de su personaje (app.js).
// Ya no se consulta; se mantiene exportada solo por compatibilidad.
export const SHOW_OWN_RENDER = true;

// ── Fuentes de assets Splatoon (Flexlion, públicas) ───────────────────
export const GITHUB_RAW = "https://raw.githubusercontent.com/Flexlion/flexlion.github.io/master";
export const IMG = GITHUB_RAW + "/assets/img";
// Datos del juego: copia propia en assets/ (no depende de GitHub); la de Flexlion queda de respaldo.
const LOCAL = new URL("../assets", import.meta.url).href;
export const RSDB = LOCAL + "/RSDB";
export const LANG_URL = LOCAL + "/lang/EUen.json";
export const ANIM_URL = LOCAL + "/animations.txt";
export const DATA_FALLBACK = (url) => url.startsWith(LOCAL) ? GITHUB_RAW + "/assets" + url.slice(LOCAL.length) : null;
export const DUMMY_IMG = IMG + "/player/gear/Dummy.png";

// ── Especies seleccionables (índices = mismos que el plugin Calico) ────
// 0 InkGirl · 1 InkBoy · 2 OctGirl · 3 OctBoy  (Inkling = IsSquid:true)
export const SPECIES = [
  { idx: 0, key: "InkGirl", species: "inkling", male: false },
  { idx: 1, key: "InkBoy",  species: "inkling", male: true  },
  { idx: 2, key: "OctGirl", species: "octoling", male: false },
  { idx: 3, key: "OctBoy",  species: "octoling", male: true  },
];

export const isSquid = (playerType) => Number(playerType) < 2; // Inkling
export const isMale  = (playerType) => Number(playerType) % 2 === 1;

export const SKIN_TONES = 9;   // 0..8
export const EYE_COLORS = 21;  // 0..20

// Banner / upload
// URL del generador de Splattags (opcional). Si la rellenas, aparece un enlace en la web.
export const SPLATTAG_URL = "https://splashtagmaker.com/";

// Generador de splattags integrado. Assets servidos vía jsDelivr desde el repo
// open-source (GPL-3.0) de SeymourSchlong/splashtags (= splashtagmaker.com).
// Créditos completos en el aviso legal. jsDelivr envía cabeceras CORS, necesario
// para exportar el canvas (crossOrigin="anonymous") sin "tainted canvas".
// Fijado a un commit concreto (no a @main): el contenido servido no puede
// cambiar sin tocar este fichero. Para actualizar: `git ls-remote
// https://github.com/SeymourSchlong/splashtags refs/heads/main` y sustituir
// el SHA aquí y en css/styles.css y 404.html (fuentes).
export const SPLATTAG_CDN = "https://cdn.jsdelivr.net/gh/SeymourSchlong/splashtags@93e794dd46c75c4b4af3770513a2877715cda900";
// Fuente secundaria de imágenes de badge (niveles altos de arma y otras oficiales que
// SeymourSchlong no incluye). Datos del juego de Leanny/splat3, servidos por jsDelivr
// (envía CORS *, igual que el CDN principal). Solo .png, naming Badge_<Name>.png.
// También fijado a un commit (`git ls-remote https://github.com/Leanny/splat3 refs/heads/main`).
export const LEANNY_BADGE_CDN = "https://cdn.jsdelivr.net/gh/Leanny/splat3@7280ff9cde8bb1c5dcef46c700c326471584d2e6/images/badge";
export const LEANNY_NPL_CDN = "https://cdn.jsdelivr.net/gh/Leanny/splat3@7280ff9cde8bb1c5dcef46c700c326471584d2e6/images/npl";
export const BANNER_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const BANNER_MAX_DIM = 4096;              // px por lado
export const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Arma: no se elige en la web. -1 = "Sin arma"; el equipo asigna arma al montar la foto.
export const NO_WEAPON = -1;

// Default de ficha nueva
export const DEFAULT_PLAYER = {
  alias: "",
  player_type: 0,
  hair: 0, bottom: 1, bottom_variation: 0,
  skin_tone: 0, eye_brows: 0, eye_color: 0,
  gear_head: 0, gear_head_variation: 0,
  gear_cloth: 0, gear_cloth_variation: 0,
  gear_shoes: 0, gear_shoes_variation: 0,
  weapon_main: NO_WEAPON,  // sin arma: la elige el equipo al montar la foto
  anim_name: "AW_BrandPoseCollectionA",
  color: { r: 0.965, g: 0.314, b: 0.996, a: 1.0 }, // #F650FE
};
