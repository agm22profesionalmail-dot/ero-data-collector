-- ============================================================
-- Migración 20260922_06: acceso del artista a banners y renders
--
-- Antes:
--   - banners: solo el dueño podía leer su banner → en el panel de artista
--     los banners de los jugadores daban 400 ("No Splashtag").
--   - renders: "authenticated can read renders" dejaba a CUALQUIER usuario
--     con sesión leer el render de cualquier jugador (fuga).
-- Ahora, en ambos buckets: el dueño lee lo suyo y un artista APROBADO lee
-- lo de los jugadores asociados a él (players.referred_by), identificado por
-- su identidad de Discord (igual que artist_group).
--
-- Rutas: <user_id>/banner.png y <user_id>/render.png (carpeta = user_id).
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.artist_can_see_user(p_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.players p
      JOIN public.artists a     ON a.id = p.referred_by AND a.status = 'approved'
      JOIN auth.identities i    ON i.provider = 'discord'
                               AND i.provider_id = a.discord_id
                               AND i.user_id = auth.uid()
     WHERE p.user_id::text = p_user_id
  );
$$;
REVOKE EXECUTE ON FUNCTION public.artist_can_see_user(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.artist_can_see_user(text) TO authenticated;

-- Banners: lectura para el artista del jugador (la del dueño ya existe)
DROP POLICY IF EXISTS banner_select_artist ON storage.objects;
CREATE POLICY banner_select_artist ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'banners'
         AND public.artist_can_see_user((storage.foldername(name))[1]));

-- Renders: fuera la lectura abierta; dueño o su artista
DROP POLICY IF EXISTS "authenticated can read renders" ON storage.objects;
DROP POLICY IF EXISTS render_select_own_or_artist ON storage.objects;
CREATE POLICY render_select_own_or_artist ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'renders'
         AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
              OR public.artist_can_see_user((storage.foldername(name))[1])));
