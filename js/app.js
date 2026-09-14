// Orquestador de la SPA
import { DEFAULT_PLAYER, SPECIES } from "./config.js";
import { t, getLang, setLang, onLangChange } from "./i18n.js";
import { isConfigured } from "./supabase.js";
import { signInWithDiscord, signOut, getSession, onAuthChange, discordProfile } from "./auth.js";
import { loadData, colorToHex, data, getById, headName, clothName, shoesName } from "./data.js";
import { renderConfigurator, ensureValid } from "./configurator.js";
import { renderBanner } from "./banner.js";
import { loadPlayer, savePlayer, getBannerSignedUrl } from "./store.js";
import { el, clear, toast } from "./ui.js";

const $ = (id) => document.getElementById(id);
const appEl = () => $("app");

let session = null;
let dataReady = false;
let state = null;        // ficha en edición
let profile = null;
let hasRecord = false;   // ¿el usuario ya tenía ficha guardada?
let mode = "edit";        // "preview" | "edit"

// ── i18n estático ─────────────────────────────────────────────────────
function applyStaticI18n() {
  document.documentElement.lang = getLang();
  $("appSub").textContent = t("app_sub");
  renderFooter();
  for (const b of $("langSwitch").querySelectorAll("button"))
    b.classList.toggle("active", b.dataset.lang === getLang());
  renderAuthArea();
}

function renderAuthArea() {
  const area = $("authArea");
  clear(area);
  if (session?.user) {
    const p = discordProfile(session.user);
    const chip = el("div", { class: "edc-user-chip" });
    if (p.discord_avatar) chip.append(el("img", { src: p.discord_avatar, alt: "" }));
    chip.append(el("span", {}, p.discord_name || "Player"));
    chip.append(el("button", { class: "edc-btn edc-btn-sm", onClick: async () => { await signOut(); } }, t("logout")));
    area.append(chip);
  }
}

function renderFooter() {
  const f = $("footer");
  clear(f);
  f.append(el("div", { class: "edc-footer-row" },
    el("span", {}, t("footer")),
  ));
  f.append(el("div", { class: "edc-legal-line" }, t("legal_disclaimer")));
  const d = el("details", { class: "edc-legal" });
  d.append(el("summary", {}, t("legal_title")));
  d.append(el("div", { class: "edc-help-body", html: legalHtml(getLang()) }));
  f.append(d);
}

// ── Vistas ────────────────────────────────────────────────────────────
function renderLogin() {
  clear(appEl());
  const hero = el("section", { class: "edc-hero" },
    el("div", { class: "edc-hero-inner" },
      el("div", { class: "edc-hero-copy" },
        el("span", { class: "edc-hero-eyebrow" }, "ERO'S TEAM"),
        el("h2", { class: "edc-hero-title" }, t("login_title")),
        el("p", { class: "edc-hero-desc" }, t("login_desc")),
        el("button", { class: "edc-btn edc-btn-discord edc-hero-cta", onClick: doLogin },
          el("span", { html: discordSvg() }), t("login_btn")),
        el("p", { class: "edc-privacy edc-label" }, t("login_privacy")),
      ),
      el("div", { class: "edc-hero-art", "aria-hidden": "true" },
        el("span", { class: "edc-hero-splat" }),
        el("img", { class: "edc-hero-char", src: "assets/hero/char-octoling.webp", alt: "", loading: "eager" }),
      ),
    ),
  );
  appEl().append(hero);
}

async function doLogin() {
  try { await signInWithDiscord(); }
  catch (e) { toast(t("save_err") + e.message, "err"); }
}

async function renderApp() {
  clear(appEl());
  const loading = el("div", { class: "edc-loading" }, el("div", { class: "edc-inkloader" }), el("div", {}, t("loading_data")));
  appEl().append(loading);

  try {
    if (!dataReady) { await loadData(); dataReady = true; }
    profile = discordProfile(session.user);
    if (state === null) {
      const row = await loadPlayer(session.user.id);
      hasRecord = !!row;
      state = stateFromRow(row);
      state._userId = session.user.id; // clave de persistencia del generador de splattag
      if (!state.alias && profile?.discord_name) state.alias = profile.discord_name;
      ensureValid(state);
      if (state.banner_path) state.banner_signed_url = await getBannerSignedUrl(state.banner_path);
      mode = hasRecord ? "preview" : "edit";
    }
  } catch (e) {
    clear(appEl());
    appEl().append(el("div", { class: "edc-loading" }, el("div", {}, t("loading_err")), el("div", { class: "edc-label" }, e.message)));
    return;
  }
  renderModeView();
}

function renderModeView() {
  if (mode === "preview") renderPreviewScreen();
  else renderEditor();
}

// Pantalla de bienvenida para quien ya tiene ficha: preview de 1 línea + Editar
function renderPreviewScreen() {
  clear(appEl());
  const card = el("div", { class: "edc-card" });
  card.append(el("div", { class: "edc-section-title" }, t("saved_title")));
  if (state.banner_signed_url) card.append(el("img", { class: "edc-preview-banner", src: state.banner_signed_url, alt: "banner" }));
  card.append(summaryRow());
  card.append(el("div", { class: "edc-save-bar" },
    el("button", { class: "edc-btn edc-btn-primary", onClick: () => { mode = "edit"; renderModeView(); } }, t("edit_player"))));
  appEl().append(card);

  const help = el("div");
  appEl().append(help);
  renderHelp(help);
}

// Resumen de 1 línea con las opciones seleccionadas
function summaryRow() {
  const sp = SPECIES[state.player_type] || SPECIES[0];
  const d = data();
  const head = getById(d.headgear, state.gear_head);
  const cloth = getById(d.clothes, state.gear_cloth);
  const shoes = getById(d.shoes, state.gear_shoes);
  return el("div", { class: "edc-preview" },
    el("div", { class: "edc-color-preview", style: `background:${colorToHex(state.color)}` }),
    el("strong", {}, state.alias || t("your_char")),
    el("span", { class: "edc-preview-badge" }, `${t(sp.species)} · ${sp.male ? t("boy") : t("girl")}`),
    el("span", { class: "edc-preview-badge" }, "🧢 " + (head ? headName(head) : "—")),
    el("span", { class: "edc-preview-badge" }, "🎽 " + (cloth ? clothName(cloth) : "—")),
    el("span", { class: "edc-preview-badge" }, "👟 " + (shoes ? shoesName(shoes) : "—")),
    el("span", { class: "edc-preview-badge" }, (state.banner_signed_url || state.bannerFile) ? "🖼 ✓" : "🖼 —"),
  );
}

// ¿Habrá banner adjunto? (banner guardado, ya capturado, o generador activo que se capturará al guardar)
function willHaveBanner() {
  return !!(state.bannerFile || state.banner_signed_url || state._captureSplattag);
}

// Editor completo (configurador + banner + guardar/actualizar)
function renderEditor() {
  clear(appEl());

  const preview = el("div", { class: "edc-card edc-preview" });
  appEl().append(preview);
  updatePreview(preview);

  const cfg = el("div");
  appEl().append(cfg);
  renderConfigurator(cfg, state, () => updatePreview(preview));

  const bnr = el("div");
  appEl().append(bnr);
  renderBanner(bnr, state, () => updatePreview(preview));

  const help = el("div");
  appEl().append(help);
  renderHelp(help);

  const status = el("span", { class: "edc-save-status" });
  const saveBtn = el("button", { class: "edc-btn edc-btn-primary", onClick: () => doSave(saveBtn, status) },
    hasRecord ? t("update_player") : t("save"));
  const bar = el("div", { class: "edc-card", style: "padding:0" }, el("div", { class: "edc-save-bar" }, saveBtn, status));
  appEl().append(bar);
}

function updatePreview(node) {
  clear(node);
  const sp = SPECIES[state.player_type] || SPECIES[0];
  node.append(
    el("div", { class: "edc-color-preview", style: `background:${colorToHex(state.color)}` }),
    el("strong", {}, state.alias || t("your_char")),
    el("span", { class: "edc-preview-badge" }, `${t(sp.species)} · ${sp.male ? t("boy") : t("girl")}`),
    el("span", { class: "edc-preview-badge" }, willHaveBanner() ? "🖼 banner ✓" : "🖼 —"),
  );
}

// Frases del envío por fase, distintas para alta nueva (new) y actualización
// (upd); se elige una al azar de cada grupo en cada guardado, para variar.
const SUBMIT_PHRASES = {
  es: {
    pack: { new: ["Empaquetando personaje…", "Empaquetando características…", "Preparando tu ficha…"],
            upd: ["Empaquetando nuevo personaje…", "Recogiendo tus cambios…", "Empaquetando características…"] },
    send: { new: ["Registrando personaje…", "Dando de alta tu ficha…", "Reservando tu plaza…"],
            upd: ["Actualizando información…", "Sincronizando tus cambios…", "Actualizando tu ficha…"] },
    reg:  { new: ["Sellando el registro…", "Guardando en el servidor…"],
            upd: ["Aplicando la actualización…", "Guardando los cambios…"] },
    done: { new: ["¡Personaje registrado!"], upd: ["¡Información actualizada!"] },
  },
  en: {
    pack: { new: ["Packing your character…", "Bundling traits…", "Preparing your sheet…"],
            upd: ["Packing your new character…", "Gathering your changes…", "Bundling traits…"] },
    send: { new: ["Registering character…", "Signing up your sheet…", "Saving your spot…"],
            upd: ["Updating your info…", "Syncing your changes…", "Updating your sheet…"] },
    reg:  { new: ["Sealing the record…", "Saving to the server…"],
            upd: ["Applying the update…", "Saving your changes…"] },
    done: { new: ["Character registered!"], upd: ["Info updated!"] },
  },
};
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
function submitPhrases(isUpdate) {
  const L = SUBMIT_PHRASES[getLang()] || SUBMIT_PHRASES.en;
  const k = isUpdate ? "upd" : "new";
  return { pack: pickOne(L.pack[k]), send: pickOne(L.send[k]), reg: pickOne(L.reg[k]), done: pickOne(L.done[k]) };
}

// Overlay de envío: loader de tinta + barra de progreso + texto por fases.
// Cada fase se corresponde con un paso REAL del guardado; el pequeño margen
// entre fases es solo para que el texto sea legible (no falsea el resultado).
function renderSubmitOverlay() {
  const bar = el("div", { class: "edc-progress-bar" });
  const label = el("div", { class: "edc-submit-label" }, "…");
  const overlay = el("div", { class: "edc-submit-overlay", role: "status", "aria-live": "polite" },
    el("div", { class: "edc-submit-card" },
      el("div", { class: "edc-inkloader" }),
      label,
      el("div", { class: "edc-progress" }, bar)));
  document.body.append(overlay);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    async phase(text, pct, dwell = 440) { label.textContent = text; bar.style.width = pct + "%"; await wait(dwell); },
    close() { overlay.remove(); },
  };
}

async function doSave(btn, status) {
  if (!state.alias || !state.alias.trim()) {
    state._aliasError = true; renderEditor();
    toast(t("alias_required"), "err");
    return;
  }
  btn.disabled = true; status.className = "edc-save-status"; status.textContent = t("saving");
  const isUpdate = hasRecord;            // ¿ya tenía ficha? decide el juego de frases
  const P = submitPhrases(isUpdate);
  const ov = renderSubmitOverlay();
  try {
    // Genera y adjunta la splattag del canvas automáticamente (sin descargas ni subidas).
    // Solo cuando hace falta: primera ficha, el usuario tocó el generador, o su config está cargada.
    if (state._captureSplattag && (!state.banner_path || state._splattagDirty || state._splattagPersisted)) {
      await ov.phase(P.pack, 28);
      try { state.bannerFile = await state._captureSplattag(); }
      catch (e) { console.warn("No se pudo generar la splattag:", e); }
    }
    await ov.phase(P.send, 62);
    await savePlayer(state, session.user, profile);
    await ov.phase(P.reg, 88);
    if (state.banner_path) state.banner_signed_url = await getBannerSignedUrl(state.banner_path);
    hasRecord = true;
    await ov.phase(P.done, 100, 620);
    ov.close();
    toast(t("saved"), "ok");
    mode = "preview";
    renderModeView();
  } catch (e) {
    ov.close();
    status.className = "edc-save-status err"; status.textContent = t("save_err") + e.message;
    toast(t("save_err") + e.message, "err");
    btn.disabled = false;
  }
}

function stateFromRow(row) {
  const s = structuredClone(DEFAULT_PLAYER);
  s.bannerFile = null; s.banner_path = null; s.banner_signed_url = null;
  if (!row) return s;
  const keys = ["alias", "player_type", "hair", "bottom", "bottom_variation", "skin_tone",
    "eye_brows", "eye_color", "gear_head", "gear_head_variation", "gear_cloth", "gear_cloth_variation",
    "gear_shoes", "gear_shoes_variation", "weapon_main", "anim_name", "banner_path", "banner_sha256",
    "splattag_config"];
  for (const k of keys) if (row[k] !== null && row[k] !== undefined) s[k] = row[k];
  if (row.color) s.color = row.color;
  return s;
}

// ── Router ────────────────────────────────────────────────────────────
function route() {
  if (!isConfigured()) {
    clear(appEl());
    appEl().append(el("div", { class: "edc-loading" }, el("div", {}, t("not_configured"))));
    return;
  }
  if (session?.user) renderApp();
  else renderLogin();
}

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  applyStaticI18n();

  for (const b of $("langSwitch").querySelectorAll("button"))
    b.addEventListener("click", () => setLang(b.dataset.lang));

  onLangChange(() => {
    applyStaticI18n();
    if (!isConfigured()) { route(); return; }
    if (session?.user && state) renderModeView();
    else route();
  });

  if (isConfigured()) {
    session = await getSession();
    onAuthChange((s) => {
      const wasUser = !!session?.user;
      session = s;
      if (!!s?.user !== wasUser) { state = null; hasRecord = false; mode = "edit"; }
      applyStaticI18n();
      route();
    });
  }
  route();
}

function renderHelp(container) {
  clear(container);
  const d = el("details", { class: "edc-help" });
  d.append(el("summary", {}, t("help_title")));
  d.append(el("div", { class: "edc-help-body", html: helpHtml(getLang()) }));
  container.append(d);
}

function helpHtml(lang) {
  if (lang === "es") return `
<p>Conecta tu Discord, configura tu personaje, sube tu banner y guarda. Puedes volver con el mismo Discord y editarlo cuando quieras.</p>
<h4>Qué hace cada cosa</h4>
<ul>
  <li><b>Alias</b>: el nombre de tu ficha (no tiene por qué ser tu nombre de Discord).</li>
  <li><b>Color de tinta</b>: el color de tu personaje. Usa el selector o escribe el código <code>#RRGGBB</code>.</li>
  <li><b>Especie y género</b>: Inkling/Octoling × chica/chico.</li>
  <li><b>Tono de piel</b> y <b>color de ojos</b>: aspecto facial.</li>
  <li><b>Peinado</b> y <b>cejas</b>: dependen de la especie (mira las limitaciones).</li>
  <li><b>Piernas</b>: si la prenda tiene variantes aparece <b>Variación de piernas</b> (Base, V1, V2…).</li>
  <li><b>Equipamiento</b> (cabeza, ropa, zapatillas): pulsa <b>Cambiar</b> para elegir. El interruptor <b>Variante</b> activa la versión alternativa de esa prenda (si existe).</li>
  <li><b>Banner Splattag</b>: diséñalo aquí mismo (banner, nombre, título, ID e insignias). Se adjunta solo a tu perfil al pulsar <b>Guardar</b>; si ya tienes uno guardado, se conserva a menos que decidas crear uno nuevo. Tu configuración del generador también se guarda, así que puedes editar solo un detalle sin rehacer todo.</li>
</ul>
<h4>Limitaciones</h4>
<ul>
  <li><b>Peinados y cejas son por especie</b>: como Inkling solo ves peinados/cejas de Inkling; como Octoling solo los de Octoling. No se pueden mezclar. Si cambias de especie, el peinado y las cejas se reinician a los de la nueva especie.</li>
  <li><b>Variante</b>: el interruptor solo funciona en prendas que tienen versión alternativa; en las demás aparece desactivado.</li>
  <li><b>Arma y pose</b>: no se eligen aquí; las define el equipo al montar la foto.</li>
  <li><b>Editar</b>: para cambiar tu ficha, vuelve a entrar con el mismo Discord.</li>
</ul>`;
  return `
<p>Connect your Discord, set up your character, upload your banner and save. You can come back with the same Discord and edit it anytime.</p>
<h4>What each option does</h4>
<ul>
  <li><b>Alias</b>: the name on your sheet (doesn't have to be your Discord name).</li>
  <li><b>Ink color</b>: your character's color. Use the picker or type a <code>#RRGGBB</code> code.</li>
  <li><b>Species &amp; gender</b>: Inkling/Octoling × girl/boy.</li>
  <li><b>Skin tone</b> and <b>eye color</b>: facial look.</li>
  <li><b>Hairstyle</b> and <b>eyebrows</b>: depend on species (see limitations).</li>
  <li><b>Legs</b>: if the item has variants, a <b>Legs variation</b> row appears (Base, V1, V2…).</li>
  <li><b>Gear</b> (head, clothes, shoes): click <b>Change</b> to pick. The <b>Variant</b> switch enables the alternate version of that gear (if it has one).</li>
  <li><b>Splattag banner</b>: design it right here (banner, name, title, ID and badges). It's attached to your profile when you press <b>Save</b>. If you already have one, it's kept unless you explicitly create a new one. Your generator settings are saved too, so you can tweak one thing without redoing everything.</li>
</ul>
<h4>Limitations</h4>
<ul>
  <li><b>Hair and eyebrows are per species</b>: as an Inkling you only see Inkling hair/eyebrows; as an Octoling only Octoling ones. They can't be mixed. If you switch species, hair and eyebrows reset to the new species'.</li>
  <li><b>Variant</b>: the switch only works on gear that has an alternate version; otherwise it's disabled.</li>
  <li><b>Weapon and pose</b>: not chosen here; the team sets them when building the photo.</li>
  <li><b>Editing</b>: to change your sheet, log in again with the same Discord.</li>
</ul>`;
}

function legalHtml(lang) {
  if (lang === "es") return `
<p><b>Aviso:</b> Este sitio es un proyecto de fans para organizar contenido de la comunidad. Las donaciones recibidas se destinan exclusivamente a cubrir gastos de alojamiento e infraestructura. <b>No está afiliado, asociado, autorizado ni patrocinado por Nintendo</b> ni ninguna de sus filiales.</p>
<p><b>Marcas y propiedad:</b> «Splatoon», «Nintendo Switch», «Inkling», «Octoling» y los logotipos asociados son marcas registradas de Nintendo. Las imágenes, personajes y demás recursos del juego son propiedad intelectual de Nintendo Co., Ltd. y/o sus filiales. Los recursos gráficos se muestran únicamente con fines ilustrativos dentro de un contexto de fans. Todos los derechos pertenecen a sus respectivos propietarios.</p>
<h4>Datos que recogemos</h4>
<p>Al conectar tu Discord guardamos lo siguiente:</p>
<ul>
  <li><b>Nombre de usuario y avatar de Discord</b> — para identificarte en la comunidad.</li>
  <li><b>Configuración de personaje</b> — especie, género, skin, equipamiento, color de tinta y alias que eliges en el formulario.</li>
  <li><b>Banner (PNG)</b> — generado con el creador integrado.</li>
  <li><b>Configuración del generador de Splattag</b> — si usaste el creador integrado, guardamos también los ajustes del diseño (banner elegido, nombre, título, insignias…) para que puedas editarlos más adelante sin perder tu configuración.</li>
</ul>
<p><b>Finalidad:</b> preparar contenido y fotos para eventos de la comunidad. No se venden ni ceden datos a terceros con fines publicitarios.</p>
<p><b>Edad mínima:</b> debes tener al menos 14 años para usar este servicio. Si eres menor de 14 años, necesitas el consentimiento de tu padre, madre o tutor legal.</p>
<p><b>Tus derechos:</b> puedes consultar, modificar o vaciar tu ficha en cualquier momento volviendo a entrar con tu Discord. Para eliminar todos tus datos por completo, contacta con el organizador por Discord. Responderemos a solicitudes de acceso, rectificación o supresión en un plazo máximo de 30 días.</p>
<p><b>Conservación:</b> tus datos se mantienen mientras haya eventos de comunidad activos o hasta que solicites su eliminación.</p>
<p><b>Almacenamiento:</b> los datos se guardan en Supabase (base de datos y almacenamiento de archivos). Este sitio guarda tu idioma preferido y el estado del generador en el almacenamiento local de tu navegador (localStorage), sin cookies de terceros ni rastreo publicitario. Al diseñar tu banner con el generador integrado, confirmas que los datos que introduces (nombre, alias, ID) no infringen derechos de terceros.</p>
<h4>Créditos</h4>
<p>El creador de splattags está basado en el proyecto de código abierto <a href="https://github.com/SeymourSchlong/splashtags" target="_blank" rel="noopener">Splashtag Creator</a> (<a href="https://splashtagmaker.com/" target="_blank" rel="noopener">splashtagmaker.com</a>), licencia GPL-3.0. Todo el mérito es de sus autores:</p>
<ul>
  <li><b>seymour</b> (@spaghettitron) — creador de la web original</li>
  <li><b>LeanYoshi</b> — base de datos de Splatoon</li>
  <li><b>Raven_The_Cute</b> — traducciones</li>
  <li><b>DeadLineSMB</b> — banners Splatband</li>
  <li><b>ElectroDev</b> — banners de armas especiales</li>
  <li><b>Lucyfer</b> — banners Pride</li>
  <li><b>mya</b> — banners Grandfest</li>
  <li><b>Zeeto</b> — badges de bandas</li>
  <li><b>Sharkinodraws</b> — badges de huevos de Salmon Run</li>
</ul>
<p>Los datos e imágenes del juego (configurador de personaje) se cargan desde <a href="https://github.com/Flexlion/flexlion.github.io" target="_blank" rel="noopener">Flexlion</a>.</p>
<p>Lista completa en la <a href="https://splashtagmaker.com/credits/" target="_blank" rel="noopener">página de créditos original</a>. Fuentes, imágenes y datos de Splatoon son propiedad intelectual de Nintendo Co., Ltd.</p>`;
  return `
<p><b>Disclaimer:</b> This is a fan project made to organize community content. Any donations received go exclusively toward hosting and infrastructure costs. <b>It is not affiliated with, associated with, authorized, endorsed by, or in any way sponsored by Nintendo</b> or any of its subsidiaries.</p>
<p><b>Trademarks &amp; ownership:</b> "Splatoon", "Nintendo Switch", "Inkling", "Octoling" and associated logos are registered trademarks of Nintendo. Images, characters and other game assets are the intellectual property of Nintendo Co., Ltd. and/or its affiliates. Game artwork is shown for illustrative fan purposes only. All rights belong to their respective owners.</p>
<h4>Data we collect</h4>
<p>When you connect your Discord, we store the following:</p>
<ul>
  <li><b>Discord username and avatar</b> — to identify you within the community.</li>
  <li><b>Character configuration</b> — species, gender, skin tone, gear, ink color and alias you set in the form.</li>
  <li><b>Banner (PNG)</b> — generated with the built-in creator.</li>
  <li><b>Splattag generator settings</b> — if you used the built-in creator, we also save your design settings (chosen banner, name, title, badges…) so you can edit them later without losing your configuration.</li>
</ul>
<p><b>Purpose:</b> exclusively to prepare content and photos for community events. We do not sell or share your data with third parties for advertising.</p>
<p><b>Minimum age:</b> you must be at least 14 years old to use this service. If you are under 14, you need parental or legal guardian consent.</p>
<p><b>Your rights:</b> you can view, edit or clear your sheet at any time by logging in again with your Discord. To fully delete your data, contact the organizer on Discord. We will respond to access, rectification or deletion requests within 30 days.</p>
<p><b>Retention:</b> your data is kept while community events are active, or until you request its deletion.</p>
<p><b>Storage:</b> data is stored in Supabase (database and file storage). This site saves your preferred language and generator state in your browser's local storage (localStorage), with no third-party cookies or advertising trackers. By designing your banner with the built-in generator, you confirm that the data you enter (name, alias, ID) does not infringe third-party rights.</p>
<h4>Credits</h4>
<p>The splattag creator is based on the open-source project <a href="https://github.com/SeymourSchlong/splashtags" target="_blank" rel="noopener">Splashtag Creator</a> (<a href="https://splashtagmaker.com/" target="_blank" rel="noopener">splashtagmaker.com</a>), GPL-3.0 license. All credit goes to its authors:</p>
<ul>
  <li><b>seymour</b> (@spaghettitron) — original website creator</li>
  <li><b>LeanYoshi</b> — Splatoon database</li>
  <li><b>Raven_The_Cute</b> — translation help</li>
  <li><b>DeadLineSMB</b> — Splatband banners</li>
  <li><b>ElectroDev</b> — special weapon banners</li>
  <li><b>Lucyfer</b> — Pride banners</li>
  <li><b>mya</b> — Grandfest banners</li>
  <li><b>Zeeto</b> — Splatband badges</li>
  <li><b>Sharkinodraws</b> — Salmon Run egg badges</li>
</ul>
<p>Game data and images (character configurator) are loaded from <a href="https://github.com/Flexlion/flexlion.github.io" target="_blank" rel="noopener">Flexlion</a>.</p>
<p>Full list on the <a href="https://splashtagmaker.com/credits/" target="_blank" rel="noopener">original credits page</a>. Splatoon fonts, images and data are the intellectual property of Nintendo Co., Ltd.</p>`;
}

function discordSvg() {
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5c2 .6 3 .9 4.4 1.8a13.6 13.6 0 0 0-12-.5C8.7 4 9.7 3.6 11.2 3.5L11 3a19.8 19.8 0 0 0-4.9 1.4C2.6 9.7 2 14.9 2.3 20c1.8 1.3 3.6 2 5.3 2.6l1-1.7c-.9-.3-1.7-.7-2.4-1.2l.6-.4c4.6 2.1 9.5 2.1 14 0l.6.4c-.7.5-1.5.9-2.4 1.2l1 1.7c1.8-.6 3.5-1.3 5.3-2.6.4-6-.8-11.1-3.6-15.6zM9 16c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>';
}

init();
