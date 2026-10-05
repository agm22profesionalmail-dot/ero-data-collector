CREATE TABLE IF NOT EXISTS public.banned_users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid,                          -- auth.users.id en el momento del baneo (puede ser null)
  discord_id text,                          -- provider_id de Discord (snowflake)
  x_id       text,                          -- id numérico de X
  alias      text,                          -- alias que tenía la ficha (solo informativo)
  reason     text,                          -- motivo (se muestra al usuario baneado)
  banned_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS banned_users_discord_id_uniq
  ON public.banned_users (discord_id) WHERE discord_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS banned_users_user_id_uniq
  ON public.banned_users (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS banned_users_x_id_idx
  ON public.banned_users (x_id) WHERE x_id IS NOT NULL;

ALTER TABLE public.banned_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.banned_users FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_banned_uid(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_uid IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.banned_users b
     WHERE b.user_id = p_uid
        OR EXISTS (
             SELECT 1
               FROM auth.identities i
              WHERE i.user_id = p_uid
                AND (   (i.provider = 'discord'          AND b.discord_id IS NOT NULL AND i.provider_id = b.discord_id)
                     OR (i.provider IN ('x', 'twitter') AND b.x_id       IS NOT NULL AND i.provider_id = b.x_id))
           )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_banned_uid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_banned_uid(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.am_i_banned()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_banned_uid(auth.uid()) THEN
    RETURN json_build_object('banned', false, 'reason', NULL);
  END IF;

  SELECT b.reason INTO v_reason
    FROM public.banned_users b
   WHERE b.user_id = auth.uid()
      OR EXISTS (
           SELECT 1 FROM auth.identities i
            WHERE i.user_id = auth.uid()
              AND (   (i.provider = 'discord'          AND b.discord_id IS NOT NULL AND i.provider_id = b.discord_id)
                   OR (i.provider IN ('x', 'twitter') AND b.x_id       IS NOT NULL AND i.provider_id = b.x_id)))
   ORDER BY b.banned_at DESC
   LIMIT 1;

  RETURN json_build_object('banned', true, 'reason', v_reason);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.am_i_banned() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.am_i_banned() TO authenticated;

CREATE OR REPLACE FUNCTION public.block_banned_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_banned_uid(auth.uid()) THEN
    RAISE EXCEPTION 'account banned' USING ERRCODE = '28000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.block_banned_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_block_banned_write ON public.players;
CREATE TRIGGER a_block_banned_write
  BEFORE INSERT OR UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.block_banned_write();

DROP TRIGGER IF EXISTS a_block_banned_write ON public.artists;
CREATE TRIGGER a_block_banned_write
  BEFORE INSERT ON public.artists
  FOR EACH ROW EXECUTE FUNCTION public.block_banned_write();

DROP POLICY IF EXISTS "banner_insert_own" ON storage.objects;
CREATE POLICY "banner_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ( bucket_id = 'banners'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND NOT public.is_banned_uid((SELECT auth.uid())) );

DROP POLICY IF EXISTS "banner_update_own" ON storage.objects;
CREATE POLICY "banner_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING ( bucket_id = 'banners'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND NOT public.is_banned_uid((SELECT auth.uid())) )
  WITH CHECK ( bucket_id = 'banners'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND NOT public.is_banned_uid((SELECT auth.uid())) );

CREATE OR REPLACE FUNCTION public.admin_ban(p_user text, p_pass text, p_player_id uuid, p_reason text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_p       public.players%ROWTYPE;
  v_ban_id  uuid;
  v_reason  text;
BEGIN
  IF NOT public.admin_check(p_user, p_pass) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_p FROM public.players WHERE id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT b.id INTO v_ban_id
    FROM public.banned_users b
   WHERE b.user_id = v_p.user_id
      OR (b.discord_id IS NOT NULL AND b.discord_id = v_p.discord_id)
      OR (b.x_id       IS NOT NULL AND b.x_id       = v_p.x_id)
   ORDER BY b.banned_at
   LIMIT 1;

  IF v_ban_id IS NULL THEN
    INSERT INTO public.banned_users (user_id, discord_id, x_id, alias, reason)
    VALUES (v_p.user_id, v_p.discord_id, v_p.x_id, v_p.alias, v_reason)
    RETURNING id INTO v_ban_id;
  ELSE
    UPDATE public.banned_users
       SET user_id    = coalesce(v_p.user_id, user_id),
           discord_id = coalesce(v_p.discord_id, discord_id),
           x_id       = coalesce(v_p.x_id, x_id),
           alias      = coalesce(v_p.alias, alias),
           reason     = v_reason,
           banned_at  = now()
     WHERE id = v_ban_id;
  END IF;

  UPDATE public.players
     SET banner_path = NULL, banner_sha256 = NULL, splattag_config = NULL
   WHERE id = p_player_id;

  RETURN json_build_object(
    'ban_id',      v_ban_id,
    'alias',       v_p.alias,
    'banner_path', v_p.banner_path
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_ban(text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_ban(text, text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_unban(p_user text, p_pass text, p_ban_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_check(p_user, p_pass) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
  DELETE FROM public.banned_users WHERE id = p_ban_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ban not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_unban(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_unban(text, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_banned_list(p_user text, p_pass text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_check(p_user, p_pass) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
  RETURN COALESCE((
    SELECT json_agg(json_build_object(
             'id', b.id, 'user_id', b.user_id, 'discord_id', b.discord_id, 'x_id', b.x_id,
             'alias', b.alias, 'reason', b.reason, 'banned_at', b.banned_at)
           ORDER BY b.banned_at DESC)
      FROM public.banned_users b
  ), '[]'::json);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_banned_list(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_banned_list(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
