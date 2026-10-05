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

DROP POLICY IF EXISTS banner_select_artist ON storage.objects;
CREATE POLICY banner_select_artist ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'banners'
         AND public.artist_can_see_user((storage.foldername(name))[1]));

DROP POLICY IF EXISTS "authenticated can read renders" ON storage.objects;
DROP POLICY IF EXISTS render_select_own_or_artist ON storage.objects;
CREATE POLICY render_select_own_or_artist ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'renders'
         AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
              OR public.artist_can_see_user((storage.foldername(name))[1])));
