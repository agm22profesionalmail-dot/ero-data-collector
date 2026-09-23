-- ============================================================
-- Migración 20260923_03: render de las versiones para artista
--
-- El worker renderiza también cada versión exclusiva (player_artist_chars)
-- y la sube a renders/<user_id>/artist/<artist_id>.png.
--
-- 1) artist_group devuelve `variant_render` (ruta de ese PNG) en los
--    jugadores con versión para el artista que consulta.
-- 2) Storage: un artista sigue viendo la carpeta de sus jugadores, pero de
--    la subcarpeta artist/ solo SU versión (no la que el jugador hizo para
--    otro artista). Dueño y admin (admin_media_ok) lo ven todo.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

-- 1) artist_group: se reescribe sobre la definición viva (como en 20260922_07)
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.artist_group(text)'::regprocedure);
  v_old text := '''has_variant'',          (pac.player_id IS NOT NULL)';
  v_new text := '''has_variant'',          (pac.player_id IS NOT NULL),
      ''variant_render'',       CASE WHEN pac.player_id IS NOT NULL
                                  THEN p.user_id::text || ''/artist/'' || v_artist_id::text || ''.png'' END';
BEGIN
  IF position('variant_render' in v_def) > 0 THEN RETURN; END IF;  -- ya aplicado
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'artist_group: no se encontró has_variant';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$do$;

-- 2) Storage de renders
CREATE OR REPLACE FUNCTION public.artist_can_see_render(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, storage
AS $$
  SELECT public.artist_can_see_user((storage.foldername(p_name))[1])
     AND ((storage.foldername(p_name))[2] IS DISTINCT FROM 'artist'
          OR EXISTS (
            SELECT 1
              FROM public.artists a
              JOIN auth.identities i ON i.provider = 'discord'
                                    AND i.provider_id = a.discord_id
                                    AND i.user_id = auth.uid()
             WHERE a.status = 'approved'
               AND a.id::text = split_part(storage.filename(p_name), '.', 1)));
$$;
REVOKE EXECUTE ON FUNCTION public.artist_can_see_render(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.artist_can_see_render(text) TO authenticated;

DROP POLICY IF EXISTS render_select_own_or_artist ON storage.objects;
CREATE POLICY render_select_own_or_artist ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'renders'
         AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
              OR public.artist_can_see_render(name)));
