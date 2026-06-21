// Capa de datos: carga RSDB de Flexlion + filtros por especie + helpers de imagen/nombre
import { RSDB, LANG_URL, ANIM_URL, IMG, DUMMY_IMG, isSquid, isMale } from "./config.js";

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

export async function loadData() {
  if (DATA) return DATA;
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

// ── Nombres (EUen) ────────────────────────────────────────────────────
const L = (k) => DATA.lang[k] ?? {};
export const weaponName = (e) => L("CommonMsg/Weapon/WeaponName_Main")[e.__RowId] ?? e.__RowId;
export const headName   = (e) => L("CommonMsg/Gear/GearName_Head")[e.__RowId.slice(4)] ?? e.__RowId.slice(4);
export const clothName  = (e) => L("CommonMsg/Gear/GearName_Clothes")[e.__RowId.slice(4)] ?? e.__RowId.slice(4);
export const shoesName  = (e) => L("CommonMsg/Gear/GearName_Shoes")[e.__RowId.slice(4)] ?? e.__RowId.slice(4);

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
