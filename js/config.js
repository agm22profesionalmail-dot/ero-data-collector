// ── Config Supabase (rellenar tras SETUP.md) ──────────────────────────
// La anon key es PÚBLICA y segura de exponer (la protección real es RLS).
export const SUPABASE_URL = "https://xwyauyjeteztlevvtydb.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3eWF1eWpldGV6dGxldnZ0eWRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMDc0NDEsImV4cCI6MjA5NzU4MzQ0MX0.vYsgBJdbL8pak-LYPuj5jjefZH46YxPzAuAaVAvkaHw";

// ── Fuentes de assets Splatoon (Flexlion, públicas) ───────────────────
export const GITHUB_RAW = "https://raw.githubusercontent.com/Flexlion/flexlion.github.io/master";
export const IMG = GITHUB_RAW + "/assets/img";
export const RSDB = GITHUB_RAW + "/assets/RSDB";
export const LANG_URL = GITHUB_RAW + "/assets/lang/EUen.json";
export const ANIM_URL = GITHUB_RAW + "/assets/animations.txt";
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
export const SPLATTAG_CDN = "https://cdn.jsdelivr.net/gh/SeymourSchlong/splashtags@main";
export const BANNER_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const BANNER_MAX_DIM = 4096;              // px por lado
export const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Default de ficha nueva
export const DEFAULT_PLAYER = {
  alias: "",
  player_type: 0,
  hair: 0, bottom: 1, bottom_variation: 0,
  skin_tone: 0, eye_brows: 0, eye_color: 0,
  gear_head: 0, gear_head_variation: 0,
  gear_cloth: 0, gear_cloth_variation: 0,
  gear_shoes: 0, gear_shoes_variation: 0,
  weapon_main: 0,
  anim_name: "AW_BrandPoseCollectionA",
  color: { r: 0.965, g: 0.314, b: 0.996, a: 1.0 }, // #F650FE
};
