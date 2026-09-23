// Render 3D con giro (turntable) — componente reutilizable.
//
// Muestra el render principal (PNG HD, 1000x1250, 4:5). Si además existe el
// sprite `spin.webp` (tira horizontal de 10 fotogramas 480x600), habilita el
// giro: arrastre horizontal (ratón/táctil), flechas del teclado y botones.
//
// Contrato del sprite (worker de Blender):
//   0-7 → vueltas cada 45° (0 = mismo encuadre que el PNG HD)
//   8   → vista desde arriba (coronilla)
//   9   → vista desde abajo (pies)
// Arrastrar hacia la IZQUIERDA avanza el fotograma (el personaje gira como en
// un tocadiscos). En reposo en el fotograma 0 se ve el PNG HD; en cualquier
// otro fotograma (o mientras se arrastra) se ve el sprite por background-position.
//
// El componente NO firma URLs ni conoce Supabase: recibe `pngUrl` y `spinUrl`
// (string, Promise<string|null> o null). Sin spin (o si falla) se queda solo el
// PNG, sin controles — exactamente como antes.
import { el } from "./ui.js";
import { getLang } from "./i18n.js";

const S = {
  en: {
    group: "3D render of the character. Drag sideways or use the arrow keys to rotate.",
    hint: "Drag to rotate",
    rotate: "Rotate", left: "Rotate left", right: "Rotate right",
    top: "Top", bottom: "Bottom", front: "Front",
    top_l: "View from above", bottom_l: "View from below", front_l: "Front view (HD render)",
    v_front: "Front view", v_deg: "Rotated {n}°", v_top: "View from above", v_bottom: "View from below",
  },
  es: {
    group: "Render 3D del personaje. Arrastra en horizontal o usa las flechas del teclado para girarlo.",
    hint: "Arrastra para girar",
    rotate: "Girar", left: "Girar a la izquierda", right: "Girar a la derecha",
    top: "Arriba", bottom: "Abajo", front: "Frente",
    top_l: "Vista desde arriba", bottom_l: "Vista desde abajo", front_l: "Vista frontal (render HD)",
    v_front: "Vista frontal", v_deg: "Girado {n}°", v_top: "Vista desde arriba", v_bottom: "Vista desde abajo",
  },
};
const tr = (k) => (S[getLang()] || S.en)[k] || k;

export const SPIN_FRAMES = 10;   // fotogramas totales de la tira
export const SPIN_TURNS = 8;     // 0-7: vueltas de 45°
export const SPIN_TOP = 8;
export const SPIN_BOTTOM = 9;

const mod = (n, m) => ((n % m) + m) % m;
const asPromise = (v) => (v && typeof v.then === "function") ? v : Promise.resolve(v || null);

// Carga una imagen y resuelve true/false (nunca rechaza).
function probe(url) {
  return new Promise((res) => {
    if (!url) return res(false);
    const im = new Image();
    im.decoding = "async";
    im.onload = () => res(true);
    im.onerror = () => res(false);
    im.src = url;
  });
}

/**
 * createRenderSpin({ pngUrl, spinUrl, placeholder, onLoaded, onFail })
 *  - pngUrl / spinUrl: string | Promise<string|null> | null
 *  - placeholder: nodo que se muestra hasta que carga el PNG (se quita al cargar)
 *  - onLoaded(): el PNG cargó; onFail(): no hay PNG (se queda el placeholder)
 * Devuelve el nodo raíz (.edc-rspin) con el escenario (.edc-pcard-render) dentro.
 */
export function createRenderSpin({ pngUrl, spinUrl, placeholder, onLoaded, onFail } = {}) {
  const stage = el("div", { class: "edc-pcard-render edc-rspin-stage" });
  const root = el("div", { class: "edc-rspin" }, stage);
  if (placeholder) stage.append(placeholder);

  const img = el("img", { class: "edc-pcard-render-img", alt: "", decoding: "async" });
  const sprite = el("div", { class: "edc-rspin-sprite", "aria-hidden": "true" });
  const hint = el("div", { class: "edc-rspin-hint", "aria-hidden": "true" }, tr("hint"));
  const live = el("span", { class: "edc-sr-only", "aria-live": "polite" });
  const ctrls = el("div", { class: "edc-rspin-ctrls" });

  let frame = 0;
  let dragging = false;
  let spinOn = false;
  let hinted = false;

  const viewText = (f) => f === 0 ? tr("v_front")
    : f === SPIN_TOP ? tr("v_top")
    : f === SPIN_BOTTOM ? tr("v_bottom")
    : tr("v_deg").replace("{n}", String(f * 45));

  function paint() {
    const useSprite = spinOn && (frame !== 0 || dragging);
    sprite.style.backgroundPosition = `${(frame * 100) / (SPIN_FRAMES - 1)}% 0`;
    sprite.hidden = !useSprite;
    img.hidden = useSprite;
    root.dataset.frame = String(frame);
    for (const b of ctrls.querySelectorAll("[data-view]"))
      b.setAttribute("aria-pressed", String(Number(b.dataset.view) === frame));
  }
  function setFrame(f, announce = true) {
    if (!spinOn) return;
    frame = mod(f, SPIN_FRAMES);
    paint();
    if (announce) live.textContent = viewText(frame);
  }
  const dismissHint = () => { if (!hinted) { hinted = true; root.classList.add("is-hinted"); } };
  const turnFrom = () => (frame < SPIN_TURNS ? frame : 0);   // desde arriba/abajo se gira desde el frente
  const step = (d) => { dismissHint(); setFrame(mod(turnFrom() + d, SPIN_TURNS)); };

  // ── Arrastre (pointer events; touch-action: pan-y en CSS deja pasar el scroll vertical)
  let startX = 0, startFrame = 0, pid = null;
  stage.addEventListener("pointerdown", (e) => {
    if (!spinOn || (e.pointerType === "mouse" && e.button !== 0)) return;
    pid = e.pointerId; startX = e.clientX; startFrame = turnFrom();
    dragging = true; root.classList.add("is-dragging");
    try { stage.setPointerCapture(pid); } catch { /* sin captura */ }
    paint();
    e.preventDefault();
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== pid) return;
    const w = stage.clientWidth || 1;
    const steps = Math.round(((e.clientX - startX) / w) * SPIN_TURNS); // ancho completo = vuelta entera
    const f = mod(startFrame - steps, SPIN_TURNS);                     // izquierda → avanza
    if (f !== frame) { dismissHint(); setFrame(f, false); }
  });
  const endDrag = (e) => {
    if (!dragging || (e && e.pointerId !== pid)) return;
    dragging = false; pid = null; root.classList.remove("is-dragging");
    try { if (e && stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
    paint();
    live.textContent = viewText(frame);
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("lostpointercapture", endDrag);
  stage.addEventListener("dragstart", (e) => e.preventDefault());

  // ── Teclado (el root recibe el foco cuando hay spin)
  root.addEventListener("keydown", (e) => {
    if (!spinOn) return;
    const k = e.key;
    if (k === "ArrowLeft") step(-1);
    else if (k === "ArrowRight") step(1);
    else if (k === "ArrowUp") { dismissHint(); setFrame(SPIN_TOP); }
    else if (k === "ArrowDown") { dismissHint(); setFrame(SPIN_BOTTOM); }
    else if (k === "Home" || k === "0") { dismissHint(); setFrame(0); }
    else return;
    e.preventDefault();
  });

  // ── Botones
  function btn(label, aria, onClick, extra = {}) {
    const b = el("button", { type: "button", class: "edc-rspin-btn", "aria-label": aria, title: aria, ...extra }, label);
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
  }
  function buildControls() {
    ctrls.append(
      el("div", { class: "edc-rspin-group", role: "group", "aria-label": tr("rotate") },
        el("span", { class: "edc-rspin-label", "aria-hidden": "true" }, tr("rotate")),
        btn("◀", tr("left"), () => step(-1)),
        btn("▶", tr("right"), () => step(1))),
      btn(tr("top"), tr("top_l"), () => { dismissHint(); setFrame(SPIN_TOP); }, { "data-view": SPIN_TOP }),
      btn(tr("bottom"), tr("bottom_l"), () => { dismissHint(); setFrame(SPIN_BOTTOM); }, { "data-view": SPIN_BOTTOM }),
      btn(tr("front"), tr("front_l"), () => { dismissHint(); setFrame(0); }, { "data-view": 0 }));
  }

  // ── Carga: primero el PNG (sin él no hay nada), luego el sprite.
  (async () => {
    const png = await asPromise(pngUrl);
    if (!png) { onFail?.(); return; }
    if (!(await probe(png))) { onFail?.(); return; }
    img.src = png;
    placeholder?.remove();
    stage.append(img, sprite, hint, live);
    root.classList.add("has-img");
    paint();
    onLoaded?.();

    const spin = await asPromise(spinUrl);
    if (!spin || !(await probe(spin))) return;   // sin spin: solo PNG, sin controles
    sprite.style.backgroundImage = `url("${spin}")`;
    spinOn = true;
    buildControls();
    root.append(ctrls);
    root.classList.add("has-spin");
    root.setAttribute("tabindex", "0");
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", tr("group"));
    paint();
  })();

  return root;
}
