// Edge Function: kofi-webhook
//
// Recibe el POST de Ko-fi cuando llega una comisión y la inserta en
// public.orders (upsert por kofi_transaction_id; los duplicados se ignoran).
//
// Seguridad (auditoría 2026-09-27):
//  - KOFI_TOKEN es OBLIGATORIO: sin él se rechaza todo (503). Antes, si
//    faltaba, se aceptaba cualquier payload.
//  - El verification_token se compara en tiempo constante.
//  - Ko-fi no manda cabeceras de firma: el token en el cuerpo es la única
//    autenticación, por eso es fail-closed.
//
// Variables de entorno (Supabase → Edge Functions → Secrets):
//   KOFI_TOKEN                — token de verificación (Ko-fi → API → Webhook Token)
//   SUPABASE_URL              — inyectada por Supabase
//   SUPABASE_SERVICE_ROLE_KEY — inyectada por Supabase
// Desplegar con verify_jwt = false (Ko-fi no manda JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { timingSafeEqual } from "../_shared/internal_secret.ts";

const COMMISSION_TYPE_MAP: Record<string, string> = {
  // Fotos (orden importa: frases más específicas primero)
  "full group photo": "full_group_photo",
  "full_group_photo": "full_group_photo",
  "simple group photo": "simple_group_photo",
  "simple_group_photo": "simple_group_photo",
  "individual photo": "individual_photo",
  "individual_photo": "individual_photo",
  // Transformaciones
  "get canonised": "get_canonised",
  "get_canonised": "get_canonised",
  "canonised": "get_canonised",
  "canonico": "get_canonised",
  "get sanitized": "get_sanitized",
  "get_sanitized": "get_sanitized",
  "sanitized": "get_sanitized",
  "get fuzzed": "get_fuzzed",
  "get_fuzzed": "get_fuzzed",
  "fuzzed": "get_fuzzed",
};

// Ko-fi NO manda el nombre de la comisión: en shop_items solo viene el código
// del enlace directo (ko-fi.com/c/<código>) y la variación elegida.
// Al crear una comisión nueva en Ko-fi, añadir aquí su código.
const DIRECT_LINK_CODE_MAP: Record<string, string> = {
  "9f29d12127": "individual_photo", // Individual Photo (€1+)
  "285cf9e2be": "full_group_photo", // Full Group Photo (€20+)
};

type ShopItem = { direct_link_code?: string; variation_name?: string; name?: string; quantity?: number };

function matchName(text: string): string | null {
  const t = (text || "").toLowerCase();
  for (const [key, val] of Object.entries(COMMISSION_TYPE_MAP)) {
    if (t.includes(key)) return val;
  }
  return null;
}

function detectCommissionType(shopItems: ShopItem[], message: string, amount: number): string {
  // 1. Código del enlace directo de la comisión
  for (const item of shopItems) {
    const byCode = DIRECT_LINK_CODE_MAP[String(item?.direct_link_code || "").toLowerCase()];
    if (byCode) return byCode;
  }
  // 2. Nombre/variación del item o mensaje del comprador
  for (const item of shopItems) {
    const byName = matchName(`${item?.name || ""} ${item?.variation_name || ""}`);
    if (byName) return byName;
  }
  const byMsg = matchName(message);
  if (byMsg) return byMsg;
  // 3. Último recurso por importe (solo hay Individual €1+ y Full Group €20+)
  console.warn("[kofi-webhook] Tipo no identificado; se deduce por importe", amount);
  return amount >= 20 ? "full_group_photo" : "individual_photo";
}

// Primer campo de texto no vacío del payload (Ko-fi cambia el nombre según el tipo).
function firstText(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Fail-closed: sin token configurado no se acepta nada
  const kofiToken = (Deno.env.get("KOFI_TOKEN") ?? "").trim();
  if (kofiToken.length < 8) {
    console.error("[kofi-webhook] KOFI_TOKEN not configured: rejecting request");
    return new Response("Not configured", { status: 503 });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return new Response("Server not configured", { status: 500 });
  }

  // Parsear payload Ko-fi (application/x-www-form-urlencoded con campo "data" JSON)
  let kofi: Record<string, unknown>;
  try {
    const contentType = req.headers.get("content-type") || "";
    let raw: string;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      raw = String(form.get("data") ?? "");
    } else {
      // Algunos planes Ko-fi envían JSON directamente
      raw = await req.text();
    }

    kofi = JSON.parse(raw);
    if (!kofi || typeof kofi !== "object") throw new Error("not an object");
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  // Verificar el token de Ko-fi (tiempo constante)
  const sent = typeof kofi.verification_token === "string" ? kofi.verification_token : "";
  if (!(await timingSafeEqual(sent, kofiToken))) {
    return new Response("Forbidden", { status: 403 });
  }

  // Solo procesar comisiones (type === "Commission")
  if (kofi.type !== "Commission") {
    return new Response(JSON.stringify({ skipped: true, type: kofi.type }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Payload sin token ni email en los logs (Edge Functions → Logs) para depurar
  // qué campos manda Ko-fi en cada pedido.
  const { verification_token: _t, email: _e, ...logged } = kofi;
  console.log("[kofi-webhook] payload:", JSON.stringify(logged));

  const shopItems = (Array.isArray(kofi.shop_items) ? kofi.shop_items : []) as ShopItem[];
  const message = firstText(kofi, ["message", "buyer_description", "commission_description", "description"]) || "";
  const amount = parseFloat(String(kofi.amount || "0"));
  const commissionType = detectCommissionType(shopItems, message, amount);

  // Add-ons = variaciones elegidas (el nombre de la comisión no viene en el payload)
  const addons: string[] = shopItems
    .map((i) => i?.variation_name || i?.name || "")
    .filter(Boolean);

  // Discord: campo nativo de Ko-fi o "Discord name: X" en la descripción del comprador
  const discordFromMsg = message.match(/discord(?:\s*(?:name|user(?:name)?))?\s*[:：]\s*@?([^\s,;]+)/i)?.[1] ?? null;
  const discordUsername = firstText(kofi, ["discord_username"]) || discordFromMsg;

  const supabase = createClient(supabaseUrl, serviceKey);

  const { error } = await supabase.from("orders").upsert(
    {
      kofi_transaction_id: String(kofi.kofi_transaction_id),
      buyer_name: String(kofi.from_name || "Desconocido"),
      email: kofi.email ? String(kofi.email) : null,
      amount,
      currency: String(kofi.currency || "EUR"),
      message: message || null,
      commission_type: commissionType,
      addons,
      discord_username: discordUsername,
      status: "pending",
    },
    { onConflict: "kofi_transaction_id", ignoreDuplicates: true },
  );

  if (error) {
    console.error("[kofi-webhook] Error insertando order:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(`[kofi-webhook] Order insertada: ${kofi.kofi_transaction_id} (${commissionType})`);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
