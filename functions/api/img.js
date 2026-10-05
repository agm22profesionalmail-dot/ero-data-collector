// Proxy del mismo origen para renders y banners de R2.
//
// R2 sirve las imágenes sin cabecera CORS: un <canvas> que las dibuje queda
// "contaminado" y no se puede exportar. La tarjeta "Compartir OC" las pide
// aquí, desde el propio dominio de la web. Solo reenvía rutas públicas con la
// forma exacta de un render o un banner; no es un proxy abierto.

const R2_PUBLIC = "https://pub-5e28d3ea68944786851f5d81e47de75c.r2.dev";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ALLOWED = new RegExp(
  `^(renders/${UUID}/(c[12]/)?render\.(webp|png)|banners/${UUID}/banner(_c[12])?\.png)$`);

export async function onRequestGet({ request }) {
  const p = new URL(request.url).searchParams.get("p") || "";
  if (!ALLOWED.test(p)) return new Response("bad path", { status: 400 });
  const up = await fetch(`${R2_PUBLIC}/${p}`);
  if (!up.ok) return new Response("not found", { status: up.status === 404 ? 404 : 502 });
  const type = up.headers.get("Content-Type") || "";
  if (!/^image\/(webp|png)$/.test(type)) return new Response("bad type", { status: 502 });
  return new Response(up.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
