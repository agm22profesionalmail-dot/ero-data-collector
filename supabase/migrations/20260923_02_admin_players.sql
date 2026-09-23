-- ============================================================
-- Migración 20260923_02: el admin ve TODOS los registros de OC
--
-- Además de aprobar/denegar solicitudes, el panel de admin (?admin) lista
-- todas las fichas de la web con sus datos, banner y render 3D, igual que el
-- panel del artista, más las versiones exclusivas que cada jugador hizo para
-- un artista (player_artist_chars).
--
-- Buckets privados: la web necesita una sesión de Supabase para firmar URLs.
-- Al llamar a admin_players con las credenciales correctas y una sesión
-- iniciada (Discord/X), esa sesión queda marcada como admin durante 12 h
-- (admin_sessions) y las políticas de storage le dejan leer renders/banners.
-- Sin sesión, los datos salen igual pero sin imágenes.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

-- 1) Sesiones de admin (solo se tocan desde funciones SECURITY DEFINER)
CREATE TABLE IF NOT EXISTS public.admin_sessions (
  user_id    UUID PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_sessions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_media_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_sessions
     WHERE user_id = auth.uid() AND expires_at > NOW()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.admin_media_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_media_ok() TO authenticated;

-- 2) Storage: lectura de renders y banners para la sesión de admin
DROP POLICY IF EXISTS render_select_admin ON storage.objects;
CREATE POLICY render_select_admin ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'renders' AND public.admin_media_ok());

DROP POLICY IF EXISTS banner_select_admin ON storage.objects;
CREATE POLICY banner_select_admin ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'banners' AND public.admin_media_ok());

-- 3) RPC: todas las fichas + artistas asociados + versiones exclusivas
CREATE OR REPLACE FUNCTION public.admin_players(p_user TEXT, p_pass TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_players JSONB;
BEGIN
  IF NOT public.admin_check(p_user, p_pass) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.admin_sessions (user_id, expires_at)
    VALUES (auth.uid(), NOW() + INTERVAL '12 hours')
    ON CONFLICT (user_id) DO UPDATE SET expires_at = EXCLUDED.expires_at;
  END IF;
  DELETE FROM public.admin_sessions WHERE expires_at < NOW();

  SELECT jsonb_agg(
    (to_jsonb(p) - 'banner_sha256' - 'splattag_config')
    || jsonb_build_object('artists', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'artist_id',  a.id,
               'name',       a.name,
               'slug',       a.slug,
               'consent_at', pa.consent_at,
               'variant',    (SELECT to_jsonb(pac) - 'player_id' - 'artist_id'
                                FROM public.player_artist_chars pac
                               WHERE pac.player_id = p.id AND pac.artist_id = a.id))
             ORDER BY pa.created_at)
        FROM public.player_artists pa
        JOIN public.artists a ON a.id = pa.artist_id
       WHERE pa.player_id = p.id), '[]'::jsonb))
    ORDER BY p.created_at DESC
  ) INTO v_players
  FROM public.players p;

  RETURN jsonb_build_object(
    'media',   auth.uid() IS NOT NULL,
    'players', COALESCE(v_players, '[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_players(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_players(TEXT, TEXT) TO anon, authenticated;
