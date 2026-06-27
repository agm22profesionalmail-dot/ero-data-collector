// Banner Splattag: generador integrado (única vía). No hay subida manual:
// la splattag creada se adjunta automáticamente al perfil al pulsar "Guardar".
//
// Caso especial — jugadores que subieron su PNG ANTES de esta versión: tienen
// banner guardado pero no config del generador. A ellos NO se les monta el
// generador automáticamente (un toque accidental no debe reemplazar su tag):
// se les muestra su splattag actual y un botón explícito "Crear una nueva".
import { t } from "./i18n.js";
import { el, clear } from "./ui.js";
import { renderSplattagGenerator, hasStoredSplattag } from "./splattag.js";

export function renderBanner(container, state, onChange) {
  clear(container);
  const card = el("div", { class: "edc-card" });
  card.append(el("div", { class: "edc-section-title" }, t("section_banner")));

  // "Legacy": tiene un banner guardado pero ninguna config del generador y aún
  // no ha decidido crear una nueva en esta sesión → conservar su PNG antiguo.
  const legacy = !!state.banner_signed_url && !hasStoredSplattag(state) && !state._splattagReplace;

  if (legacy) {
    state._captureSplattag = null; // doSave no regenerará → se conserva el PNG antiguo
    card.append(el("p", { class: "edc-label", style: "margin-top:0" }, t("banner_have_current")));
    card.append(el("img", { class: "edc-banner-preview", src: state.banner_signed_url, alt: "splattag" }));
    card.append(el("p", { class: "edc-banner-keep" }, t("banner_keep_note")));
    card.append(el("button", { class: "edc-btn", onClick: () => {
      state._splattagReplace = true;
      state._splattagDirty = true; // intención explícita de reemplazar al guardar
      renderBanner(container, state, onChange);
    } }, t("banner_make_new")));
    container.append(card);
    onChange && onChange(state);
    return;
  }

  card.append(el("p", { class: "edc-label", style: "margin-top:0" }, t("banner_desc_gen")));

  // Permitir volver atrás (mantener la antigua) si llegó aquí desde "Crear una nueva"
  if (state._splattagReplace && state.banner_signed_url) {
    card.append(el("button", { class: "edc-banner-link edc-btn-link", onClick: () => {
      state._splattagReplace = false;
      state._splattagDirty = false;
      state._captureSplattag = null;
      renderBanner(container, state, onChange);
    } }, "← " + t("banner_keep_old")));
  }

  const wrap = el("div", { class: "edc-gen" });
  card.append(wrap);
  container.append(card);

  renderSplattagGenerator(wrap, state, () => { onChange && onChange(state); });
}
