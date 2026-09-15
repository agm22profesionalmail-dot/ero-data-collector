// Cliente Supabase (ESM desde CDN, sin build step)
// Versión fijada: evita que un cambio de comportamiento en una minor nueva rompa la web sin aviso
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const isConfigured = () =>
  !SUPABASE_URL.includes("TU-PROJECT-REF") && !SUPABASE_ANON_KEY.includes("TU_ANON_KEY");
