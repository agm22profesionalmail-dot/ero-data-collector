// Banner Splattag: pestañas Crear (generador integrado) / Subir (PNG manual)
import { BANNER_MAX_BYTES, BANNER_MAX_DIM, PNG_MAGIC, SPLATTAG_URL } from "./config.js";
import { t } from "./i18n.js";
import { el, clear } from "./ui.js";
import { renderSplattagGenerator } from "./splattag.js";

function readDims(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 0, height: 0 }); };
    img.src = url;
  });
}

// Validación estricta: tamaño + magic bytes PNG + dimensiones (decodificable como imagen)
export async function validatePng(file) {
  if (file.size > BANNER_MAX_BYTES) return { ok: false, error: t("err_too_big") };
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  for (let i = 0; i < 8; i++) if (head[i] !== PNG_MAGIC[i]) return { ok: false, error: t("err_not_png") };
  const { width, height } = await readDims(file);
  if (!width || !height) return { ok: false, error: t("err_not_png") };
  if (width > BANNER_MAX_DIM || height > BANNER_MAX_DIM) return { ok: false, error: t("err_too_large_dims") };
  return { ok: true, width, height };
}

export function renderBanner(container, state, onChange) {
  // Pestaña por defecto: "crear" si aún no hay banner; "subir" si ya tenía uno guardado
  if (!state._bannerTab) state._bannerTab = state.banner_signed_url ? "upload" : "create";

  const paint = () => { clear(container); container.append(build()); };

  function tabBtn(key, label) {
    return el("button", {
      class: "edc-tab" + (state._bannerTab === key ? " active" : ""),
      onClick: () => { if (state._bannerTab !== key) { state._bannerTab = key; paint(); } },
    }, label);
  }

  function previewBlock() {
    const src = state._bannerPreviewUrl || state.banner_signed_url;
    if (!src) return null;
    return el("div", { class: "edc-banner-current" },
      el("div", { class: "edc-label", style: "margin-top:0" }, t("banner_current")),
      el("img", { class: "edc-banner-preview", src, alt: "banner" }));
  }

  function buildCreate() {
    const wrap = el("div", { class: "edc-gen" });
    renderSplattagGenerator(wrap, state, () => { onChange && onChange(state); });
    return wrap;
  }

  function buildUpload() {
    const drop = el("div", { class: "edc-banner-drop" + (state._bannerPreviewUrl || state.banner_signed_url ? " has-img" : "") });
    const previewSrc = state._bannerPreviewUrl || state.banner_signed_url;
    if (previewSrc) drop.append(el("img", { class: "edc-banner-preview", src: previewSrc, alt: "banner" }));
    else drop.append(el("div", { class: "edc-label" }, t("banner_none")));

    const fileInput = el("input", { type: "file", accept: "image/png", style: "display:none" });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const res = await validatePng(file);
      if (!res.ok) { state._bannerError = res.error; paint(); return; }
      if (state._bannerPreviewUrl) URL.revokeObjectURL(state._bannerPreviewUrl);
      state.bannerFile = file;
      state._bannerPreviewUrl = URL.createObjectURL(file);
      state._bannerError = null;
      onChange && onChange(state);
      paint();
    });

    const chooseBtn = el("button", { class: "edc-btn", onClick: () => fileInput.click() },
      previewSrc ? t("banner_replace") : t("banner_choose"));
    drop.append(el("div", {}, chooseBtn), fileInput);

    if (SPLATTAG_URL) {
      drop.append(el("div", { style: "margin-top:8px" },
        el("a", { class: "edc-banner-link", href: SPLATTAG_URL, target: "_blank", rel: "noopener" }, "↗ " + t("banner_link"))));
    }
    if (state._bannerError) drop.append(el("div", { class: "edc-banner-err" }, state._bannerError));
    return drop;
  }

  function build() {
    const card = el("div", { class: "edc-card" });
    card.append(el("div", { class: "edc-section-title" }, t("section_banner")));
    card.append(el("p", { class: "edc-label", style: "margin-top:0" }, t("banner_desc")));

    card.append(el("div", { class: "edc-tabs" },
      tabBtn("create", t("banner_tab_create")),
      tabBtn("upload", t("banner_tab_upload"))));

    card.append(state._bannerTab === "create" ? buildCreate() : buildUpload());

    // Vista del banner ya usado (común a ambas pestañas), salvo en "subir" que ya lo muestra
    if (state._bannerTab === "create") {
      const p = previewBlock();
      if (p) card.append(p);
    }
    return card;
  }

  paint();
}
