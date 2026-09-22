// Términos y condiciones del programa beta de artistas (OC Data Collector).
// Se muestran en el formulario de solicitud (?apply), que exige aceptarlos, y
// en el pie de la web para cualquiera. La versión aceptada se guarda en
// artists.terms_version (migración 20260922_05); si el texto cambia de forma
// sustancial, sube ARTIST_TERMS_VERSION para que quede constancia de qué
// versión aceptó cada artista.

export const ARTIST_TERMS_VERSION = "v1-2026-09-22";

const CREDIT = "Character sheet &amp; 3D render: OC Data Collector by @_ZeroSplat";

export function artistTermsHtml(lang) {
  if (lang === "es") return `
<p class="edc-terms-meta">Versión 1 · 22 de septiembre de 2026</p>
<p>Al solicitar acceso al programa beta de artistas aceptas estas condiciones. El acceso a la beta es gratuito.</p>
<ol class="edc-terms-list">
  <li><b>Créditos al mostrar contenido del panel.</b> Si muestras públicamente contenido del Panel de artistas (la ficha del personaje, los renders 3D o sus poses personalizadas, ya sea entero, recortado o como parte de un WIP o de un post de proceso), debes dar créditos en esa publicación: <i>"${CREDIT}"</i>. Las obras que creas tú no necesitan ningún crédito.</li>
  <li><b>Anuncio de la beta.</b> Cuando te aprobemos, publica un post en cualquiera de tus redes contando que participas en la beta de artistas de OC Data Collector, con el enlace a la web. Con un post es suficiente.</li>
  <li><b>Permiso para mostrar tus OCs.</b> Permites que ERO's Team use los personajes originales (OCs) que registres en OC Data Collector en su contenido y actividades: fotos in-game, eventos, publicaciones promocionales y escaparates. <b>Siempre se te mencionará y dará crédito.</b> Puedes pedir en cualquier momento que un OC quede excluido del contenido futuro.</li>
  <li><b>Datos de los jugadores.</b> Los personajes y datos de contacto de tus clientes solo pueden usarse para la comisión que te pidieron. No se pueden compartir, vender, publicar ni usar para entrenar modelos de IA.</li>
  <li><b>Propiedad del contenido del panel.</b> Las fichas de personaje, los renders 3D y las poses personalizadas los crea ERO's Team y le pertenecen. Puedes usarlos como referencia y mostrarlos con créditos (punto 1), pero no puedes atribuírtelos, quitar los créditos, revenderlos, redistribuirlos en packs ni usarlos para entrenar modelos de IA.</li>
  <li><b>Feedback (opcional).</b> Los reportes de fallos y las sugerencias son bienvenidos y ayudan a mejorar el panel.</li>
  <li><b>Revocación.</b> Incumplir estas condiciones puede suponer la retirada de tu acceso. El acceso a la beta es gratuito y puede retirarse en cualquier momento.</li>
  <li><b>Cambios.</b> Si estas condiciones cambian, te avisaremos y te pediremos que aceptes la nueva versión.</li>
  <li><b>Aviso.</b> ERO's Team no está afiliado a Nintendo.</li>
</ol>`;
  return `
<p class="edc-terms-meta">Version 1 · 22 September 2026</p>
<p>By requesting access to the Artist Beta Program you agree to these terms. Beta access is free.</p>
<ol class="edc-terms-list">
  <li><b>Credit when showing panel content.</b> If you publicly show content from the Artist Panel (the character sheet, the 3D renders or its custom poses, whether in full, cropped or as part of a WIP or process post), you must credit it in that post: <i>"${CREDIT}"</i>. The artworks you create yourself don't need any credit.</li>
  <li><b>Beta announcement.</b> Once you are approved, publish one post on any of your social networks saying that you take part in the OC Data Collector Artist Beta, with a link to the website. One post is enough.</li>
  <li><b>Permission to feature your OCs.</b> You allow ERO's Team to use the original characters (OCs) you register in OC Data Collector in its content and activities: in-game photos, events, promotional posts and showcases. <b>You will always be credited and tagged.</b> You can ask for an OC to be excluded from future content at any time.</li>
  <li><b>Player data.</b> The characters and contact details of your clients may only be used for the commission they requested from you. They may not be shared, sold, published or used to train AI models.</li>
  <li><b>Ownership of panel content.</b> The character sheets, 3D renders and custom poses are created by and belong to ERO's Team. You may use them as a reference and show them with credit (point 1), but you may not claim them as your own, remove the credit, resell them, redistribute them as a pack or use them to train AI models.</li>
  <li><b>Feedback (optional).</b> Bug reports and suggestions are welcome and help improve the panel.</li>
  <li><b>Revocation.</b> Failing to meet these terms may result in your access being revoked. Beta access is free and can be withdrawn at any time.</li>
  <li><b>Changes.</b> If these terms change, we will notify you and ask you to accept the new version.</li>
  <li><b>Disclaimer.</b> ERO's Team is not affiliated with Nintendo.</li>
</ol>`;
}
