import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serviceKey as getServiceKey } from "../_shared/keys.ts";

const COMMISSION_TYPE_MAP: Record<string, string> = {
  "full group photo": "full_group_photo",
  "full_group_photo": "full_group_photo",
  "simple group photo": "simple_group_photo",
  "simple_group_photo": "simple_group_photo",
  "individual photo": "individual_photo",
  "individual_photo": "individual_photo",
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
  for (const item of shopItems) {
    const byCode = DIRECT_LINK_CODE_MAP[String(item?.direct_link_code || "").toLowerCase()];
    if (byCode) return byCode;
  }
  for (const item of shopItems) {
    const byName = matchName(`${item?.name || ""} ${item?.variation_name || ""}`);
    if (byName) return byName;
  }
  const byMsg = matchName(message);
  if (byMsg) return byMsg;
  console.warn("[kofi-webhook] Tipo no identificado; se deduce por importe", amount);
  return amount >= 20 ? "full_group_photo" : "individual_photo";
}

function firstText(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha), vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const kofiToken = Deno.env.get("KOFI_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = getServiceKey();

  let kofi: Record<string, unknown>;
  try {
    const contentType = req.headers.get("content-type") || "";
    let raw: string;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      raw = form.get("data") as string;
    } else {
      raw = await req.text();
    }

    kofi = JSON.parse(raw);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  if (!kofiToken) {
    return new Response("Webhook not configured", { status: 503 });
  }
  if (!(await safeEqual(String(kofi.verification_token ?? ""), kofiToken))) {
    return new Response("Forbidden", { status: 403 });
  }

  if (kofi.type !== "Commission") {
    return new Response(JSON.stringify({ skipped: true, type: kofi.type }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log("[kofi-webhook] payload:", JSON.stringify({
    type: kofi.type,
    kofi_transaction_id: kofi.kofi_transaction_id,
    keys: Object.keys(kofi),
    shop_items: Array.isArray(kofi.shop_items) ? kofi.shop_items.length : 0,
  }));

  const shopItems = (Array.isArray(kofi.shop_items) ? kofi.shop_items : []) as ShopItem[];
  const message = firstText(kofi, ["message", "buyer_description", "commission_description", "description"]) || "";
  const amount = parseFloat(String(kofi.amount || "0"));
  const commissionType = detectCommissionType(shopItems, message, amount);

  const addons: string[] = shopItems
    .map((i) => i?.variation_name || i?.name || "")
    .filter(Boolean);

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
    { onConflict: "kofi_transaction_id", ignoreDuplicates: true }
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
