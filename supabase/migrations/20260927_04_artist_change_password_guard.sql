DO $do$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'artist_change_password'
     AND pg_get_function_identity_arguments(p.oid) = 'p_current text, p_new text'
   LIMIT 1;

  IF v_def IS NOT NULL AND v_def ~* 'must_change_password\s*=\s*false' THEN
    RAISE NOTICE 'artist_change_password ya cierra must_change_password: no se toca';
    RETURN;
  END IF;

  IF v_def IS NULL THEN
    RAISE NOTICE 'artist_change_password(p_current text, p_new text) no existe: se crea';
  ELSE
    RAISE NOTICE 'artist_change_password no ponía must_change_password = false: se sustituye';
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.artist_change_password(p_current text, p_new text)
    RETURNS void
    LANGUAGE plpgsql
    VOLATILE
    SECURITY DEFINER
    SET search_path = public, extensions
    AS $body$
    DECLARE
      v_artist_id uuid;
    BEGIN
      IF p_new IS NULL OR length(p_new) < 10 OR p_new = coalesce(p_current, '') THEN
        RAISE EXCEPTION 'weak password' USING ERRCODE = '22023';
      END IF;

      SELECT a.id INTO v_artist_id
        FROM public.artists a
        JOIN auth.identities i ON i.user_id = auth.uid() AND i.provider = 'discord'
       WHERE a.access_key_hash IS NOT NULL
         AND a.access_key_hash = crypt(coalesce(p_current, ''), a.access_key_hash)
         AND a.discord_id = i.provider_id
         AND a.status = 'approved';

      IF v_artist_id IS NULL THEN
        RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
      END IF;

      UPDATE public.artists
         SET access_key_hash = crypt(p_new, gen_salt('bf', 12)),
             must_change_password = false
       WHERE id = v_artist_id;
    END;
    $body$;
  $fn$;

  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.artist_change_password(text, text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.artist_change_password(text, text) TO authenticated';
END
$do$;

NOTIFY pgrst, 'reload schema';
