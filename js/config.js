export const SUPABASE_URL = "https://xwyauyjeteztlevvtydb.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_z9ASUAdn2ahI0gRVWBnWyA_aXoAGKmd";
export const R2_PUBLIC_URL = "https://pub-5e28d3ea68944786851f5d81e47de75c.r2.dev";
export const X_LOGIN_ENABLED = true;
export const SHOW_OWN_RENDER = true;
export const GITHUB_RAW = "https://raw.githubusercontent.com/Flexlion/flexlion.github.io/master";
export const IMG = GITHUB_RAW + "/assets/img";
const LOCAL = new URL("../assets", import.meta.url).href;
export const RSDB = LOCAL + "/RSDB";
export const LANG_URL = LOCAL + "/lang/EUen.json";
export const ANIM_URL = LOCAL + "/animations.txt";
export const DATA_FALLBACK = (url) => url.startsWith(LOCAL) ? GITHUB_RAW + "/assets" + url.slice(LOCAL.length) : null;
export const DUMMY_IMG = IMG + "/player/gear/Dummy.png";
export const SPECIES = [
  { idx: 0, key: "InkGirl", species: "inkling", male: false },
  { idx: 1, key: "InkBoy", species: "inkling", male: true },
  { idx: 2, key: "OctGirl", species: "octoling", male: false },
  { idx: 3, key: "OctBoy", species: "octoling", male: true }
];
export const isSquid = (playerType) => Number(playerType) < 2;
export const isMale = (playerType) => Number(playerType) % 2 === 1;
export const SKIN_TONES = 9;
export const EYE_COLORS = 21;
export const SPLATTAG_URL = "https://splashtagmaker.com/";
export const SPLATTAG_CDN = "https://cdn.jsdelivr.net/gh/SeymourSchlong/splashtags@93e794dd46c75c4b4af3770513a2877715cda900";
export const LEANNY_BADGE_CDN = "https://cdn.jsdelivr.net/gh/Leanny/splat3@7280ff9cde8bb1c5dcef46c700c326471584d2e6/images/badge";
export const LEANNY_NPL_CDN = "https://cdn.jsdelivr.net/gh/Leanny/splat3@7280ff9cde8bb1c5dcef46c700c326471584d2e6/images/npl";
export const BANNER_MAX_BYTES = 2 * 1024 * 1024;
export const BANNER_MAX_DIM = 4096;
export const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];
export const NO_WEAPON = -1;
export const DEFAULT_PLAYER = {
  alias: "",
  player_type: 0,
  hair: 0,
  bottom: 1,
  bottom_variation: 0,
  skin_tone: 0,
  eye_brows: 0,
  eye_color: 0,
  gear_head: 0,
  gear_head_variation: 0,
  gear_cloth: 0,
  gear_cloth_variation: 0,
  gear_shoes: 0,
  gear_shoes_variation: 0,
  weapon_main: NO_WEAPON,
  anim_name: "AW_BrandPoseCollectionA",
  color: { r: 0.965, g: 0.314, b: 0.996, a: 1 }
};
export const SHARE_OC_PUBLIC = true;
export const SHARE_OC_USERS = [
  "1b9c5abe-86a9-4f0b-8203-78b7b85c47bc",
  "c2a9cf8d-7753-48b8-9df8-70c81f1b3037"
];
export const SHARE_RAFFLE_ENDS = "2026-10-19T23:59:00+02:00";
