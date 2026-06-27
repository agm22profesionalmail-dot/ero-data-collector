// Banner Splattag: generador integrado (única vía). No hay subida manual:
// la splattag creada se adjunta automáticamente al perfil al pulsar "Guardar".
import { t } from "./i18n.js";
import { el, clear } from "./ui.js";
import { renderSplattagGenerator } from "./splattag.js";

export function renderBanner(container, state, onChange) {
  clear(container);
  const card = el("div", { class: "edc-card" });
  card.append(el("div", { class: "edc-section-title" }, t("section_banner")));
  card.append(el("p", { class: "edc-label", style: "margin-top:0" }, t("banner_desc_gen")));

  const wrap = el("div", { class: "edc-gen" });
  card.append(wrap);
  container.append(card);

  renderSplattagGenerator(wrap, state, () => { onChange && onChange(state); });
}
