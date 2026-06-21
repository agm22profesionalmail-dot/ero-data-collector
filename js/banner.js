// Subida y validación de banner Splattag (PNG, cliente)
import { BANNER_MAX_BYTES, BANNER_MAX_DIM, PNG_MAGIC, SPLATTAG_URL } from "./config.js";
import { t } from "./i18n.js";
import { el, clear } from "./ui.js";

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
  const paint = () => { clear(container); container.append(build()); };

  function build() {
    const card = el("div", { class: "edc-card" });
    card.append(el("div", { class: "edc-section-title" }, t("section_banner")));
    card.append(el("p", { class: "edc-label", style: "margin-top:0" }, t("banner_desc")));

    const drop = el("div", { class: "edc-banner-drop" + (state._bannerPreviewUrl || state.banner_signed_url ? " has-img" : "") });
    const previewSrc = state._bannerPreviewUrl || state.banner_signed_url;
    if (previewSrc) {
      drop.append(el("img", { class: "edc-banner-preview", src: previewSrc, alt: "banner" }));
    } else {
      drop.append(el("div", { class: "edc-label" }, t("banner_none")));
    }

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

    card.append(drop);
    return card;
  }

  paint();
}
