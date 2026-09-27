// Cliente Supabase. La librería va VENDORIZADA (vendor/supabase-js, versión
// fija, bundle UMD oficial de npm) y la carga index.html antes de la app: la
// CSP del sitio solo permite scripts del propio origen, así que nada se
// descarga de un CDN en tiempo de ejecución. Ver vendor/supabase-js/README.md
// para actualizarla.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const lib = globalThis.supabase;
if (!lib || typeof lib.createClient !== "function") {
  throw new Error("supabase-js no cargó: falta vendor/supabase-js en index.html");
}

export const supabase = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const isConfigured = () =>
  !SUPABASE_URL.includes("TU-PROJECT-REF") && !SUPABASE_ANON_KEY.includes("TU_ANON_KEY");
