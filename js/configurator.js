// Configurador de personaje — paridad PlayerConfig.json + filtro por especie
import { SPECIES, isMale, SKIN_TONES, EYE_COLORS } from "./config.js";
import {
  data, getById, hairFor, eyebrowsFor, validBottoms, validWeapons,
  weaponName, headName, clothName, shoesName,
  skinUrl, eyeUrl, typeUrl, hairUrl, eyebrowUrl, pantsUrl, pantsVarUrl,
  gearUrl, weaponUrl, animUrl, colorToHex, hexToColor,
} from "./data.js";
import { t } from "./i18n.js";
import { el, clear, imgWithFallback, openGallery } from "./ui.js";

const firstId = (arr) => (arr[0] ? arr[0].Id : 0);
const inList = (arr, id) => arr.some((e) => e.Id === Number(id));

// Normaliza una ficha para que todos los Ids sean válidos con los datos cargados
export function ensureValid(s) {
  if (s.player_type < 0 || s.player_type > 3) s.player_type = 0;
  if (!inList(hairFor(s.player_type), s.hair)) s.hair = firstId(hairFor(s.player_type));
  if (!inList(eyebrowsFor(s.player_type), s.eye_brows)) s.eye_brows = firstId(eyebrowsFor(s.player_type));
  if (!inList(validBottoms(), s.bottom)) s.bottom = firstId(validBottoms());
  const bot = getById(validBottoms(), s.bottom);
  const maxBv = bot?.VariationNum ?? 0;
  if (s.bottom_variation > maxBv || s.bottom_variation < 0) s.bottom_variation = 0;
  s.skin_tone = Math.min(SKIN_TONES - 1, Math.max(0, s.skin_tone));
  s.eye_color = Math.min(EYE_COLORS - 1, Math.max(0, s.eye_color));
  const d = data();
  if (!inList(d.headgear, s.gear_head)) s.gear_head = firstId(d.headgear);
  if (!inList(d.clothes, s.gear_cloth)) s.gear_cloth = firstId(d.clothes);
  if (!inList(d.shoes, s.gear_shoes)) s.gear_shoes = firstId(d.shoes);
  if (!inList(validWeapons(), s.weapon_main)) s.weapon_main = firstId(validWeapons());
  for (const [f, arr] of [["gear_head", d.headgear], ["gear_cloth", d.clothes], ["gear_shoes", d.shoes]]) {
    const g = getById(arr, s[f]);
    if (!g?.VariationNum) s[f + "_variation"] = 0;
  }
  if (!d.anims.includes(s.anim_name)) s.anim_name = d.anims[0] || s.anim_name;
}

export function renderConfigurator(container, state, onChange) {
  const paint = () => { clear(container); container.append(build()); };
  const change = () => { onChange && onChange(state); };
  const set = (field, val) => { state[field] = val; change(); paint(); };

  function opt(active, img, label, onClick) {
    const cell = el("div", { class: "edc-opt" + (active ? " active" : ""), onClick }, imgWithFallback(img, label));
    if (label) cell.append(el("div", { class: "edc-opt-label" }, label));
    return cell;
  }

  function build() {
    const card = el("div", { class: "edc-card" });

    // Identidad
    card.append(el("div", { class: "edc-section-title" }, t("section_identity")));
    card.append(el("label", { class: "edc-label" }, t("alias")));
    const alias = el("input", {
      class: "edc-input" + (state._aliasError ? " error" : ""),
      type: "text", maxlength: "40", placeholder: t("alias_ph"), value: state.alias || "",
    });
    alias.addEventListener("input", () => { state.alias = alias.value; state._aliasError = false; change(); });
    card.append(alias);
    if (state._aliasError) card.append(el("div", { class: "edc-banner-err" }, t("alias_required")));

    // Color
    card.append(el("label", { class: "edc-label" }, t("ink_color")));
    const hex = colorToHex(state.color).toUpperCase();
    const prev = el("div", { class: "edc-color-preview", style: `background:${hex}` });
    const native = el("input", { type: "color", class: "edc-color-native", value: hex });
    const hexIn = el("input", { class: "edc-input edc-hex", type: "text", maxlength: "7", value: hex });
    const applyHex = (v) => {
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        state.color = hexToColor(v); prev.style.background = v;
        native.value = v; hexIn.classList.remove("error"); change();
      } else hexIn.classList.add("error");
    };
    native.addEventListener("input", () => { hexIn.value = native.value.toUpperCase(); applyHex(native.value); });
    hexIn.addEventListener("input", () => applyHex(hexIn.value.startsWith("#") ? hexIn.value : "#" + hexIn.value));
    card.append(el("div", { class: "edc-color-row" }, prev, native, hexIn));

    // Especie y género
    card.append(el("div", { class: "edc-section-title" }, t("section_type")));
    const typeRow = el("div", { class: "edc-type-row" });
    for (const sp of SPECIES) {
      const active = Number(state.player_type) === sp.idx;
      const label = `${t(sp.species)} ${sp.male ? t("boy") : t("girl")}`;
      const cell = el("div", { class: "edc-type-cell" + (active ? " active" : ""), onClick: () => {
        state.player_type = sp.idx;
        // resetear peinado/cejas a los válidos de la nueva especie
        state.hair = firstId(hairFor(sp.idx));
        state.eye_brows = firstId(eyebrowsFor(sp.idx));
        change(); paint();
      } }, imgWithFallback(typeUrl(sp.key), label), el("div", { class: "edc-type-name" }, label));
      typeRow.append(cell);
    }
    card.append(typeRow);

    // Tono de piel
    card.append(el("div", { class: "edc-section-title" }, t("section_skin")));
    const skin = el("div", { class: "edc-row" });
    for (let i = 0; i < SKIN_TONES; i++) skin.append(opt(state.skin_tone === i, skinUrl(i), "", () => set("skin_tone", i)));
    card.append(skin);

    // Color de ojos
    card.append(el("div", { class: "edc-section-title" }, t("section_eye")));
    const eyes = el("div", { class: "edc-row" });
    for (let i = 0; i < EYE_COLORS; i++) eyes.append(opt(state.eye_color === i, eyeUrl(i), "", () => set("eye_color", i)));
    card.append(eyes);

    // Peinado (filtrado por especie)
    card.append(el("div", { class: "edc-section-title" }, t("section_hair")));
    const hairRow = el("div", { class: "edc-row" });
    for (const e of hairFor(state.player_type))
      hairRow.append(opt(state.hair === e.Id, hairUrl(e), "", () => set("hair", e.Id)));
    card.append(hairRow);

    // Cejas (filtrado por especie)
    card.append(el("div", { class: "edc-section-title" }, t("section_eyebrows")));
    const browRow = el("div", { class: "edc-row" });
    for (const e of eyebrowsFor(state.player_type))
      browRow.append(opt(state.eye_brows === e.Id, eyebrowUrl(e, state.player_type), "", () => set("eye_brows", e.Id)));
    card.append(browRow);

    // Piernas
    card.append(el("div", { class: "edc-section-title" }, t("section_legs")));
    const legRow = el("div", { class: "edc-row" });
    for (const e of validBottoms())
      legRow.append(opt(state.bottom === e.Id, pantsUrl(e), "", () => {
        state.bottom = e.Id; state.bottom_variation = 0; change(); paint();
      }));
    card.append(legRow);

    // Variación de piernas
    const bot = getById(validBottoms(), state.bottom);
    if (bot?.VariationNum > 0) {
      card.append(el("div", { class: "edc-section-title" }, t("section_legs_var")));
      const varRow = el("div", { class: "edc-row" });
      for (let v = 0; v <= bot.VariationNum; v++)
        varRow.append(opt(Number(state.bottom_variation) === v, pantsVarUrl(bot, v), v === 0 ? t("base") : "V" + v,
          () => set("bottom_variation", v)));
      card.append(varRow);
    }

    // Equipamiento
    card.append(el("div", { class: "edc-section-title" }, t("section_gear")));
    const d = data();
    card.append(gearRow(t("gear_head"), "gear_head", d.headgear, gearUrl, headName, true));
    card.append(gearRow(t("gear_cloth"), "gear_cloth", d.clothes, gearUrl, clothName, true));
    card.append(gearRow(t("gear_shoes"), "gear_shoes", d.shoes, gearUrl, shoesName, true));
    card.append(gearRow(t("gear_weapon"), "weapon_main", validWeapons(), weaponUrl, weaponName, false));

    // Animación
    card.append(el("div", { class: "edc-section-title" }, t("section_anim")));
    const animRow = el("div", { class: "edc-color-row" });
    const sel = el("select", { class: "edc-input", style: "flex:1" });
    for (const a of d.anims) {
      const o = el("option", { value: a }, a);
      if (a === state.anim_name) o.selected = true;
      sel.append(o);
    }
    const animImg = el("img", { class: "edc-gear-preview", src: animUrl(state.anim_name) });
    animImg.onerror = () => { animImg.style.visibility = "hidden"; };
    sel.addEventListener("change", () => { state.anim_name = sel.value; animImg.style.visibility = "visible"; animImg.src = animUrl(sel.value); change(); });
    animRow.append(sel, animImg);
    card.append(animRow);

    return card;
  }

  function gearRow(label, field, entries, urlFn, nameFn, hasVar) {
    const cur = getById(entries, state[field]);
    const row = el("div", { class: "edc-gear-row" });
    row.append(el("div", { class: "edc-gear-label" }, label));
    const prevImg = imgWithFallback(cur ? urlFn(cur) : "");
    prevImg.className = "edc-gear-preview";
    row.append(prevImg);
    row.append(el("div", { class: "edc-gear-name" }, cur ? nameFn(cur) : "—"));
    row.append(el("button", { class: "edc-btn edc-btn-sm", onClick: () => {
      openGallery({
        title: label,
        items: entries.map((e) => ({ id: String(e.Id), label: nameFn(e), img: urlFn(e) })),
        onSelect: (id) => { state[field] = Number(id); state[field + "_variation"] = 0; change(); paint(); },
      });
    } }, t("change")));

    if (hasVar) {
      const has = !!cur?.VariationNum;
      const on = has && Number(state[field + "_variation"]) === 1;
      const toggle = el("div", { class: "edc-var-toggle" + (has ? "" : " disabled"), title: t("alt_variation") },
        el("span", { class: "edc-var-label" }, "ALT"),
        el("div", { class: "edc-var-switch" + (on ? " on" : "") }, el("div", { class: "edc-var-knob" })));
      if (has) toggle.addEventListener("click", () => set(field + "_variation", on ? 0 : 1));
      row.append(toggle);
    }
    return row;
  }

  paint();
}
