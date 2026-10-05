-- ============================================================
-- Migración 2026-10-05 (01) — Sorteo "Compartir OC"
-- ============================================================
-- Quien comparte su OC en X (tarjeta con el render) pega el enlace de su
-- publicación y entra en un sorteo; el ganador desbloquea 1 personaje extra
-- (sube su máximo en character_perks, tope 3).
--
-- * share_entries: una participación por usuario. Sin políticas RLS: solo se
--   toca por RPC (SECURITY DEFINER) o con la service_role.
-- * share_submit / my_share_entry: lado jugador (authenticated).
-- * admin_share_list / admin_share_set_status / admin_share_draw: panel local
--   (service_role, igual que el resto de admin_*).
--
-- Cómo se aplica: SQL Editor → New query → pegar → Run. Se puede repetir
-- sin romper nada (todo es IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Tabla de participaciones
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.share_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_id   uuid,
  post_url    text NOT NULL,
  x_handle    text NOT NULL,
  status      text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'rejected', 'won')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  won_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS share_entries_user_uniq ON public.share_entries (user_id);
ALTER TABLE public.share_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.share_entries FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.share_entries IS
  'Participaciones del sorteo Compartir OC (1 por usuario). status: valid | rejected | won. RLS sin políticas: solo RPC o service_role.';

-- ------------------------------------------------------------
-- 2) Jugador: apuntarse / ver su participación
-- ------------------------------------------------------------
-- p_url: enlace a SU publicación en X (https://x.com/<usuario>/status/<id>).
-- Si su ficha ya trae cuenta de X (login con X), el usuario del enlace debe
-- coincidir. Puede reenviar otro enlace mientras no haya ganado.
CREATE OR REPLACE FUNCTION public.share_submit(p_url text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_url    text := btrim(coalesce(p_url, ''));
  v_handle text;
  v_xuser  text;
  v_player uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
  IF length(v_url) > 300 OR v_url !~* '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{5,25}(\?[^[:space:]]*)?$' THEN
    RAISE EXCEPTION 'bad_url';
  END IF;
  v_handle := substring(v_url from '(?i)^https://(?:www\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/');

  SELECT p.id, nullif(btrim(p.x_username), '')
    INTO v_player, v_xuser
    FROM public.players p
   WHERE p.user_id = v_uid
   ORDER BY p.slot
   LIMIT 1;
  IF v_player IS NULL THEN
    RAISE EXCEPTION 'no_character';
  END IF;
  IF v_xuser IS NOT NULL AND lower(ltrim(v_xuser, '@')) <> lower(v_handle) THEN
    RAISE EXCEPTION 'handle_mismatch';
  END IF;

  SELECT status INTO v_status FROM public.share_entries WHERE user_id = v_uid;
  IF v_status = 'won' THEN
    RETURN json_build_object('ok', true, 'status', 'won');
  END IF;

  INSERT INTO public.share_entries (user_id, player_id, post_url, x_handle, status)
  VALUES (v_uid, v_player, v_url, v_handle, 'valid')
  ON CONFLICT (user_id) DO UPDATE
    SET post_url = EXCLUDED.post_url,
        x_handle = EXCLUDED.x_handle,
        player_id = EXCLUDED.player_id,
        status = 'valid',
        updated_at = now();
  RETURN json_build_object('ok', true, 'status', 'valid');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.share_submit(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.share_submit(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_share_entry()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object('status', e.status, 'post_url', e.post_url, 'x_handle', e.x_handle)
    FROM public.share_entries e
   WHERE e.user_id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.my_share_entry() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_share_entry() TO authenticated;

-- ------------------------------------------------------------
-- 3) Panel admin (service_role sin token; mismo patrón que admin_*)
-- ------------------------------------------------------------
-- Máximo de personajes actual de un usuario (por sus identidades de Discord).
CREATE OR REPLACE FUNCTION public.share_current_limit(p_uid uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT max(cp.max_characters)::int
      FROM public.character_perks cp
      JOIN auth.identities i ON i.provider = 'discord' AND i.provider_id = cp.discord_id
     WHERE i.user_id = p_uid
  ), 1);
$$;
REVOKE EXECUTE ON FUNCTION public.share_current_limit(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_share_list(p_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.admin_require(p_token);
  RETURN coalesce((
    SELECT json_agg(r ORDER BY
             CASE r.status WHEN 'won' THEN 0 WHEN 'valid' THEN 1 ELSE 2 END, r.created_at DESC)
    FROM (
      SELECT e.id, e.status, e.post_url, e.x_handle, e.created_at, e.won_at,
             p.alias, p.discord_name, p.discord_id,
             public.share_current_limit(e.user_id) AS current_limit,
             EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = e.user_id AND i.provider = 'discord') AS has_discord
        FROM public.share_entries e
        LEFT JOIN public.players p ON p.id = e.player_id
    ) r
  ), '[]'::json);
END;
$$;

-- Aceptar (valid) o rechazar (rejected) una participación. Una ganadora no se toca.
CREATE OR REPLACE FUNCTION public.admin_share_set_status(p_token text, p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.admin_require(p_token);
  IF p_status IS NULL OR p_status NOT IN ('valid', 'rejected') THEN
    RAISE EXCEPTION 'bad_status';
  END IF;
  UPDATE public.share_entries SET status = p_status, updated_at = now()
   WHERE id = p_id AND status <> 'won';
END;
$$;

-- Sortea p_winners entre las participaciones válidas cuyo usuario tiene Discord
-- (character_perks va por discord_id) y aún no está en el tope de 3. Cada
-- ganador sube 1 su máximo (source = 'manual': kofi_roles_sync no lo retira).
CREATE OR REPLACE FUNCTION public.admin_share_draw(p_token text, p_winners int DEFAULT 1)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r        record;
  v_dc     text;
  v_new    int;
  v_out    json[] := ARRAY[]::json[];
BEGIN
  PERFORM public.admin_require(p_token);
  IF p_winners IS NULL OR p_winners < 1 OR p_winners > 20 THEN
    RAISE EXCEPTION 'bad_winners';
  END IF;

  FOR r IN
    SELECT e.id, e.user_id, e.x_handle, p.alias,
           (SELECT i.provider_id FROM auth.identities i
             WHERE i.user_id = e.user_id AND i.provider = 'discord' LIMIT 1) AS discord_id
      FROM public.share_entries e
      LEFT JOIN public.players p ON p.id = e.player_id
     WHERE e.status = 'valid'
       AND EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = e.user_id AND i.provider = 'discord')
       AND public.share_current_limit(e.user_id) < 3
     ORDER BY random()
     LIMIT p_winners
  LOOP
    v_dc  := r.discord_id;
    v_new := public.share_current_limit(r.user_id) + 1;
    INSERT INTO public.character_perks (discord_id, max_characters, source, updated_at)
    VALUES (v_dc, v_new, 'manual', now())
    ON CONFLICT (discord_id) DO UPDATE
      SET max_characters = EXCLUDED.max_characters, source = 'manual', updated_at = now();
    UPDATE public.share_entries SET status = 'won', won_at = now(), updated_at = now() WHERE id = r.id;
    v_out := v_out || json_build_object('alias', r.alias, 'x_handle', r.x_handle,
                                        'discord_id', v_dc, 'new_limit', v_new);
  END LOOP;
  RETURN to_json(v_out);
END;
$$;

-- ------------------------------------------------------------
-- 4) Permisos: NUNCA anon. Panel local = service_role; la web con token admin = authenticated.
-- ------------------------------------------------------------
DO $do$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.admin_share_list(text)',
    'public.admin_share_set_status(text, uuid, text)',
    'public.admin_share_draw(text, int)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END
$do$;

NOTIFY pgrst, 'reload schema';
