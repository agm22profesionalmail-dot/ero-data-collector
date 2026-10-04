// Embeds propios para los enlaces de los artistas beta (Cloudflare Pages Function).
//
// Discord, X, etc. leen las etiquetas Open Graph del HTML sin ejecutar JS, así
// que el ?ref=<slug> no basta para cambiar la tarjeta: este middleware reescribe
// og:image / twitter:image (y la URL) en la respuesta de index.html cuando el
// slug tiene imagen propia. Cualquier otra petición pasa intacta.
//
// Alta de un artista beta: dejar la imagen en assets/og/beta/<slug>.jpg y
// añadir aquí su entrada (ancho y alto reales de la imagen).

const SITE = "https://eroplayerdata.pages.dev";

const BETA_EMBEDS = {
  absinthe: { image: "/assets/og/beta/absinthe.jpg?v=1", width: 1150, height: 630 },
  isidraws: { image: "/assets/og/beta/isidraws.jpg?v=1", width: 1200, height: 630 },
  colorvalue: { image: "/assets/og/beta/colorvalue.jpg?v=1", width: 1200, height: 630 },
  madi: { image: "/assets/og/beta/madi.jpg?v=1", width: 1200, height: 675 },
  squibblekibble: { image: "/assets/og/beta/squibblekibble.jpg?v=1", width: 1200, height: 630 },
  reverie: { image: "/assets/og/beta/reverie.jpg?v=1", width: 1200, height: 675 },
  "luna-lechuza": { image: "/assets/og/beta/luna-lechuza.jpg?v=1", width: 1200, height: 630 },
};

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const slug = (url.searchParams.get("ref") || "").toLowerCase();
  const embed = Object.hasOwn(BETA_EMBEDS, slug) ? BETA_EMBEDS[slug] : null;

  const response = await next();
  if (!embed || request.method !== "GET") return response;
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  if (!(response.headers.get("content-type") || "").includes("text/html")) return response;

  const image = SITE + embed.image;
  const pageUrl = `${SITE}/?ref=${encodeURIComponent(slug)}`;
  const setContent = (value) => ({ element(el) { el.setAttribute("content", value); } });

  return new HTMLRewriter()
    .on('meta[property="og:image"]', setContent(image))
    .on('meta[property="og:image:width"]', setContent(String(embed.width)))
    .on('meta[property="og:image:height"]', setContent(String(embed.height)))
    .on('meta[name="twitter:image"]', setContent(image))
    .on('meta[property="og:url"]', setContent(pageUrl))
    .transform(response);
}
