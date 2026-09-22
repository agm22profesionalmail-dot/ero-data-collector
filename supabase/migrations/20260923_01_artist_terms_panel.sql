-- ============================================================
-- Migración 2026-09-23 (01) — Aceptar los términos desde el panel del artista
--
-- Los artistas registrados antes de 20260922_05 no aceptaron los términos del
-- programa beta. El panel (js/artist_panel.js) les pide aceptarlos antes de ver
-- su galería. Dos RPC con la MISMA validación que artist_group (sesión Discord
-- + clave bcrypt + artista aprobado):
--   - artist_terms_status(p_key)            -> versión aceptada (o NULL)
--   - artist_accept_terms(p_key, p_version) -> la guarda; terms_accepted_at lo
--     pone el trigger artists_stamp_terms (hora del servidor).
-- Requiere: 20260922_04_hash_artist_keys.sql, 20260922_05_artist_terms.sql
-- Ejecutar en: Supabase Dashboard -> SQL Editor. Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.artist_terms_status(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id  UUID;
  v_ver TEXT;
BEGIN
  SELECT a.id, a.terms_version INTO v_id, v_ver
    FROM public.artists a
    JOIN auth.identities i ON i.user_id = auth.uid() AND i.provider = 'discord'
   WHERE a.access_key_hash IS NOT NULL
     AND a.access_key_hash = crypt(p_key, a.access_key_hash)
     AND a.discord_id = i.provider_id
     AND a.status = 'approved';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
  RETURN v_ver;
END;
$$;

CREATE OR REPLACE FUNCTION public.artist_accept_terms(p_key TEXT, p_version TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_version IS NULL OR length(p_version) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'bad version' USING ERRCODE = '22023';
  END IF;
  SELECT a.id INTO v_id
    FROM public.artists a
    JOIN auth.identities i ON i.user_id = auth.uid() AND i.provider = 'discord'
   WHERE a.access_key_hash IS NOT NULL
     AND a.access_key_hash = crypt(p_key, a.access_key_hash)
     AND a.discord_id = i.provider_id
     AND a.status = 'approved';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
  UPDATE public.artists SET terms_version = p_version WHERE id = v_id;
  RETURN p_version;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.artist_terms_status(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.artist_accept_terms(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.artist_terms_status(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.artist_accept_terms(TEXT, TEXT) TO authenticated;
