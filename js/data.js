// Capa de datos: carga RSDB de Flexlion + filtros por especie + helpers de imagen/nombre
import { RSDB, LANG_URL, ANIM_URL, IMG, DUMMY_IMG, isSquid, isMale } from "./config.js";
import { getLang } from "./i18n.js";

let DATA = null;

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

// Nombres OFICIALES del juego en inglés y español de España (gear, armas,
// badges). Los genera tools/build_names.py desde Leanny/splat3:
// { head|clothes|shoes: {código: [en, es]}, weapon: {RowId: [en, es]},
//   badge: {"Badge_…": [en, es]} }. Si no carga, se usa el EUen de Flexlion.
let NAMES = null;
let namesPromise = null;
export function loadNames() {
  if (!namesPromise) {
    namesPromise = getJson(new URL("../assets/lang/names.json", import.meta.url).href)
      .then((n) => (NAMES = n))
      .catch((e) => { console.warn("names.json:", e); NAMES = {}; return NAMES; });
  }
  return namesPromise;
}

export async function loadData() {
  if (DATA) return DATA;
  await loadNames();
  const [weapons, headgear, clothes, shoes, hair, eyebrows, bottoms, lang, animTxt] =
    await Promise.all([
      getJson(RSDB + "/WeaponInfoMain.json"),
      getJson(RSDB + "/GearInfoHead.json"),
      getJson(RSDB + "/GearInfoClothes.json"),
      getJson(RSDB + "/GearInfoShoes.json"),
      getJson(RSDB + "/HairInfo.json"),
      getJson(RSDB + "/EyebrowInfo.json"),
      getJson(RSDB + "/BottomInfo.json"),
      getJson(LANG_URL),
      getText(ANIM_URL),
    ]);
  DATA = {
    weapons, headgear, clothes, shoes, hair, eyebrows, bottoms, lang,
    anims: animTxt.split("\n").map((s) => s.trim()).filter(Boolean),
  };
  return DATA;
}

export const data = () => DATA;
export const getById = (arr, id) => arr.find((e) => e.Id === Number(id)) ?? null;

// ── Filtros por especie ───────────────────────────────────────────────
// Inkling (IsSquid:true) → Har_SQD / Eyb_SQD · Octoling (false) → Har_OCT / Eyb_OCT
export function hairFor(playerType) {
  const squid = isSquid(playerType);
  return DATA.hair.filter(
    (h) => h.IsSquid === squid && !h.__RowId.includes("Sdodr") && h.Order !== -1
  );
}
export function eyebrowsFor(playerType) {
  const squid = isSquid(playerType);
  return DATA.eyebrows.filter((e) => e.IsSquid === squid);
}
export const validBottoms = () => DATA.bottoms.filter((b) => b.Order !== -1);
export const validWeapons = () =>
  DATA.weapons.filter((w) => w.Type === "Versus" || w.__RowId === "Free");

// ── Nombres oficiales EN/ES ───────────────────────────────────────────
// xxxNames(e) → [en, es]; xxxName(e) → en el idioma de la web;
// altName(pair) → en el OTRO idioma (para mostrarlo debajo o en el tooltip).
const L = (k) => DATA.lang[k] ?? {};
const langIdx = () => (getLang() === "es" ? 1 : 0);
function namePair(cat, key, flexSection) {
  const p = NAMES?.[cat]?.[key];
  if (p) return p;
  const en = (flexSection && DATA ? L(flexSection)[key] : null) || key;
  return [en, en];
}
export const curName = (pair) => (pair ? pair[langIdx()] : "");
export const altName = (pair) => {
  if (!pair) return "";
  const o = pair[1 - langIdx()];
  return o && o !== pair[langIdx()] ? o : "";
};
export const weaponNames = (e) => namePair("weapon", e.__RowId, "CommonMsg/Weapon/WeaponName_Main");
export const headNames   = (e) => namePair("head", e.__RowId.slice(4), "CommonMsg/Gear/GearName_Head");
export const clothNames  = (e) => namePair("clothes", e.__RowId.slice(4), "CommonMsg/Gear/GearName_Clothes");
export const shoesNames  = (e) => namePair("shoes", e.__RowId.slice(4), "CommonMsg/Gear/GearName_Shoes");
export const weaponName = (e) => curName(weaponNames(e));
export const headName   = (e) => curName(headNames(e));
export const clothName  = (e) => curName(clothNames(e));
export const shoesName  = (e) => curName(shoesNames(e));

// Badges (fichero "Badge_<Name>" del generador) → texto oficial [en, es] o null
export const badgeNames = (file) => NAMES?.badge?.[String(file).split("/").pop()] ?? null;

// Banners: el juego NO les da nombre. names.json trae etiqueta de origen
// para los oficiales (catálogo, Salmon Run, Side Order…) y el nombre oficial
// del escenario/arma especial en los de fans; el resto → null.
export const bannerNames = (file) =>
  NAMES?.banner?.[String(file).replace(/^(custom\/)?banners\//, "")] ?? null;

// ── URLs de imagen ────────────────────────────────────────────────────
export const skinUrl = (i) => `${IMG}/player/skin_color/${i}.png`;
export const eyeUrl  = (i) => `${IMG}/player/eye_color/${i}.png`;
export const typeUrl = (name) => `${IMG}/player/playertype/${name}.png`;
export const hairUrl = (e) => `${IMG}/player/hair/${e.__RowId}.png`;
export const eyebrowUrl = (e, pType) => `${IMG}/player/eyebrow/${e.__RowId}_${isMale(pType) ? "M" : "F"}.png`;
export const pantsUrl = (e) => `${IMG}/player/pants/${e.__RowId}.png`;
export const pantsVarUrl = (e, v) =>
  v === 0 ? pantsUrl(e) : `${IMG}/player/pants/${e.__RowId}.${v}.png`;
export const pantsVarLocalUrl = (e, v) => `./assets/pants/${e.__RowId}.v${v}.png`;
export const gearUrl = (e) => `${IMG}/player/gear/${e.__RowId}.png`;
export const weaponUrl = (e) => `${IMG}/player/weapon/Wst_${e.__RowId}.png`;
export const animUrl = (a) => `${IMG}/player/animations/${a}.png`;
export const fallbackImg = DUMMY_IMG;

// ── Color (jsonb {r,g,b,a} 0..1) <-> hex ──────────────────────────────
export function colorToHex(c) {
  const h = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return "#" + h(c.r) + h(c.g) + h(c.b);
}
export function hexToColor(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
    a: 1.0,
  };
}
