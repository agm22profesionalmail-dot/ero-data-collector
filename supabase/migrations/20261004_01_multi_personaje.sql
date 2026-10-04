-- ============================================================
-- Migración 20261004_01: varios personajes por perfil (fase 2)
--
-- Hasta ahora: 1 ficha (players) por usuario. Ahora: hasta 3 fichas por
-- usuario, cada una con su propio players.id y un `slot` (0..2):
--   slot 0 = personaje principal (todas las filas actuales),
--   slot 1, 2 = personajes extra (solo con permiso, ver character_perks).
--
-- Qué hace (todo idempotente, ejecutable varias veces):
--   1) players.slot smallint not null default 0 (check 0..2) + índice único
--      (user_id, slot) que sustituye a players_user_id_uniq.
--   2) character_perks (discord_id → max_characters, source) con RLS activada
--      y SIN políticas: solo la lee/escribe service_role (script de roles Ko-fi
--      y alta manual). Los clientes no la ven.
--   3) my_character_limit(): 1 por defecto, o el máximo de character_perks de
--      las identidades Discord del usuario. Solo authenticated.
--   4) Triggers en players: límite al INSERTAR (error 'character_limit') y
--      slot inmutable al actualizar. service_role (auth.uid() null) no se limita.
--      Los extras de quien pierde el permiso SE CONSERVAN (el límite solo
--      actúa al insertar); el worker simplemente no los renderiza.
--   5) RPCs: artist_link y artist_save_char ganan p_player_id (null = slot 0,
--      compatible con el cliente actual; si se pasa, debe ser del auth.uid()).
--      artist_group devuelve además player_id y slot, y variant_render con el
--      prefijo de slot. admin_ban limpia el banner de TODAS las filas del
--      user_id. admin_list y admin_edc_overview cuentan usuarios distintos.
--   6) Storage de renders: la regla "del subdirectorio artist/ solo SU versión"
--      entiende también <uid>/c<n>/artist/<artist_id>.*
--
-- Rutas (slot 0 sin cambios):
--   slot 0  renders/<uid>/render.webp, <uid>/spin.webp, <uid>/artist/<aid>.webp
--           banner <uid>/banner.png
--   slot n  renders/<uid>/c<n>/render.webp, <uid>/c<n>/spin.webp,
--           <uid>/c<n>/artist/<aid>.webp   · banner <uid>/banner_c<n>.png
--
-- IMPORTANTE para el cliente web: al desaparecer el índice único por user_id,
-- un upsert con onConflict:'user_id' FALLA ("no unique or exclusion constraint");
-- hay que usar onConflict:'user_id,slot' (o update/insert por id). Aplicar esta
-- migración y publicar la web nueva a la vez.
--
-- ROLLBACK (solo si no hay filas con slot > 0; si las hay, borrarlas antes):
--   drop trigger if exists b_players_char_limit on public.players;
--   drop trigger if exists b_players_slot_immutable on public.players;
--   drop function if exists public.players_enforce_char_limit();
--   drop function if exists public.players_slot_immutable();
--   drop function if exists public.my_character_limit();
--   drop table if exists public.character_perks;
--   create unique index if not exists players_user_id_uniq on public.players (user_id);
--   drop index if exists players_user_slot_uniq;
--   alter table public.players drop constraint if exists players_slot_chk;
--   alter table public.players drop column if exists slot;
--   (y volver a aplicar 20260922_07 [artist_link, artist_save_char] y
--    20260927_03 [artist_group], 20260923_03 [artist_can_see_render]; admin_ban
--    de 20260927_01; los DO de admin_list/admin_edc_overview pueden revertirse
--    a mano con count(*) en lugar de count(DISTINCT user_id))
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) players.slot + índice único (user_id, slot)
-- ------------------------------------------------------------
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS slot smallint NOT NULL DEFAULT 0;

ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_slot_chk;
ALTER TABLE public.players
  ADD CONSTRAINT players_slot_chk CHECK (slot BETWEEN 0 AND 2);

-- Primero el nuevo (cubre todas las filas actuales, que tienen slot 0), luego se retira el viejo.
CREATE UNIQUE INDEX IF NOT EXISTS players_user_slot_uniq ON public.players (user_id, slot);
DROP INDEX IF EXISTS public.players_user_id_uniq;
-- Búsquedas por usuario (antes las cubría el único por user_id)
CREATE INDEX IF NOT EXISTS players_user_id_idx ON public.players (user_id);

COMMENT ON COLUMN public.players.slot IS
  'Personaje dentro del perfil: 0 = principal, 1..2 = extras (requieren character_perks). Único por (user_id, slot).';

-- ------------------------------------------------------------
-- 2) character_perks: límite de personajes por identidad Discord
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.character_perks (
  discord_id     text PRIMARY KEY,
  max_characters smallint NOT NULL DEFAULT 3 CHECK (max_characters BETWEEN 1 AND 3),
  source         text NOT NULL CHECK (source IN ('discord_role', 'manual')),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.character_perks ENABLE ROW LEVEL SECURITY;
-- Sin políticas a propósito: solo service_role (ignora RLS). Se quitan además los permisos de tabla.
REVOKE ALL ON public.character_perks FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.character_perks IS
  'Máximo de personajes por discord_id. source=discord_role lo gestiona kofi_roles_sync.py (puede borrarlas); source=manual solo a mano. RLS sin políticas: solo service_role.';

-- ------------------------------------------------------------
-- 3) my_character_limit(): límite del usuario autenticado
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_character_limit()
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT max(cp.max_characters)::int
      FROM public.character_perks cp
      JOIN auth.identities i
        ON i.provider = 'discord' AND i.provider_id = cp.discord_id
     WHERE i.user_id = auth.uid()
  ), 1);
$$;
REVOKE EXECUTE ON FUNCTION public.my_character_limit() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_character_limit() TO authenticated;

COMMENT ON FUNCTION public.my_character_limit() IS
  'Personajes permitidos al usuario actual: 1 por defecto o el máximo de character_perks de sus identidades Discord.';

-- ------------------------------------------------------------
-- 4) Triggers en players
-- ------------------------------------------------------------
-- 4a) Límite al insertar. auth.uid() null (service_role, SQL Editor) no se limita.
--     Además el slot debe caber en el límite (slot < límite): sin permiso no se
--     puede crear ni un slot 1 suelto como primera fila.
CREATE OR REPLACE FUNCTION public.players_enforce_char_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Un INSERT ... ON CONFLICT (user_id, slot) DO UPDATE ejecuta este trigger ANTES de
  -- resolver el conflicto: si la ficha de ese slot ya existe no es una ficha nueva
  -- (se convertirá en UPDATE, o dará unique_violation si era un INSERT plano).
  IF EXISTS (SELECT 1 FROM public.players p WHERE p.user_id = NEW.user_id AND p.slot = NEW.slot) THEN
    RETURN NEW;
  END IF;
  v_limit := public.my_character_limit();
  IF (SELECT count(*) FROM public.players p WHERE p.user_id = NEW.user_id) >= v_limit
     OR NEW.slot >= v_limit THEN
    RAISE EXCEPTION 'character_limit' USING HINT = 'max=' || v_limit::text;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.players_enforce_char_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS b_players_char_limit ON public.players;
CREATE TRIGGER b_players_char_limit
  BEFORE INSERT ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.players_enforce_char_limit();

-- 4b) El slot no se cambia después de crear la ficha (un cliente no puede
--     reubicar personajes ni saltarse el límite reasignando slots).
CREATE OR REPLACE FUNCTION public.players_slot_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.slot IS DISTINCT FROM OLD.slot THEN
    RAISE EXCEPTION 'slot_immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.players_slot_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS b_players_slot_immutable ON public.players;
CREATE TRIGGER b_players_slot_immutable
  BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.players_slot_immutable();

-- ------------------------------------------------------------
-- 5) RPCs de artista
-- ------------------------------------------------------------
-- Se retiran las firmas antiguas (si no, con el parámetro nuevo opcional la
-- llamada del cliente actual sería ambigua entre dos sobrecargas).
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('artist_link', 'artist_save_char')
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END
$do$;

-- 5a) Asociarse a un artista con consentimiento (por personaje)
CREATE OR REPLACE FUNCTION public.artist_link(p_artist_id UUID, p_player_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.artists WHERE id = p_artist_id AND status = 'approved') THEN
    RAISE EXCEPTION 'artist not found or not approved' USING ERRCODE = '28000';
  END IF;
  IF p_player_id IS NULL THEN
    SELECT id INTO v_player_id FROM public.players WHERE user_id = auth.uid() AND slot = 0;
  ELSE
    SELECT id INTO v_player_id FROM public.players WHERE id = p_player_id AND user_id = auth.uid();
  END IF;
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'no player record for this user';
  END IF;
  INSERT INTO public.player_artists (player_id, artist_id, consent_at)
  VALUES (v_player_id, p_artist_id, NOW())
  ON CONFLICT (player_id, artist_id)
    DO UPDATE SET consent_at = COALESCE(public.player_artists.consent_at, EXCLUDED.consent_at);
  -- Histórico: primer artista del personaje
  UPDATE public.players SET referred_by = p_artist_id, referred_consent_at = NOW()
   WHERE id = v_player_id AND referred_by IS NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.artist_link(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.artist_link(UUID, UUID) TO authenticated;

-- 5b) Guardar la versión exclusiva para un artista (por personaje)
CREATE OR REPLACE FUNCTION public.artist_save_char(
  p_artist_id     UUID,
  p_player_type   INT   DEFAULT 0,
  p_hair          INT   DEFAULT 0,
  p_bottom        INT   DEFAULT 0,
  p_bottom_var    INT   DEFAULT 0,
  p_skin_tone     INT   DEFAULT 0,
  p_eye_brows     INT   DEFAULT 0,
  p_eye_color     INT   DEFAULT 0,
  p_gear_head     INT   DEFAULT 0,
  p_gear_head_v   INT   DEFAULT 0,
  p_gear_cloth    INT   DEFAULT 0,
  p_gear_cloth_v  INT   DEFAULT 0,
  p_gear_shoes    INT   DEFAULT 0,
  p_gear_shoes_v  INT   DEFAULT 0,
  p_weapon_main   INT   DEFAULT -1,
  p_anim_name     TEXT  DEFAULT 'AW_BrandPoseCollectionA',
  p_color         JSONB DEFAULT '{"r":1.0,"g":1.0,"b":1.0,"a":1.0}',
  p_player_id     UUID  DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_artist_ok  BOOLEAN;
  v_player_id  UUID;
BEGIN
  -- Verificar que el artista existe y está aprobado
  SELECT EXISTS(
    SELECT 1 FROM public.artists WHERE id = p_artist_id AND status = 'approved'
  ) INTO v_artist_ok;

  IF NOT v_artist_ok THEN
    RAISE EXCEPTION 'artist not found or not approved' USING ERRCODE = '28000';
  END IF;

  -- Resolver el personaje: null = slot 0; si se pasa, debe ser del usuario de la sesión
  IF p_player_id IS NULL THEN
    SELECT id INTO v_player_id FROM public.players WHERE user_id = auth.uid() AND slot = 0;
  ELSE
    SELECT id INTO v_player_id FROM public.players WHERE id = p_player_id AND user_id = auth.uid();
  END IF;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'no player record for this user';
  END IF;

  -- Upsert de la variante de personaje
  INSERT INTO public.player_artist_chars (
    player_id, artist_id,
    player_type, hair, bottom, bottom_variation, skin_tone, eye_brows, eye_color,
    gear_head, gear_head_variation, gear_cloth, gear_cloth_variation,
    gear_shoes, gear_shoes_variation, weapon_main, anim_name, color, updated_at
  ) VALUES (
    v_player_id, p_artist_id,
    p_player_type, p_hair, p_bottom, p_bottom_var, p_skin_tone, p_eye_brows, p_eye_color,
    p_gear_head, p_gear_head_v, p_gear_cloth, p_gear_cloth_v,
    p_gear_shoes, p_gear_shoes_v, p_weapon_main, p_anim_name, p_color, NOW()
  )
  ON CONFLICT (player_id, artist_id) DO UPDATE SET
    player_type          = EXCLUDED.player_type,
    hair                 = EXCLUDED.hair,
    bottom               = EXCLUDED.bottom,
    bottom_variation     = EXCLUDED.bottom_variation,
    skin_tone            = EXCLUDED.skin_tone,
    eye_brows            = EXCLUDED.eye_brows,
    eye_color            = EXCLUDED.eye_color,
    gear_head            = EXCLUDED.gear_head,
    gear_head_variation  = EXCLUDED.gear_head_variation,
    gear_cloth           = EXCLUDED.gear_cloth,
    gear_cloth_variation = EXCLUDED.gear_cloth_variation,
    gear_shoes           = EXCLUDED.gear_shoes,
    gear_shoes_variation = EXCLUDED.gear_shoes_variation,
    weapon_main          = EXCLUDED.weapon_main,
    anim_name            = EXCLUDED.anim_name,
    color                = EXCLUDED.color,
    updated_at           = NOW();

  -- Asociar al artista (sin quitar los demás). La web solo llama aquí con la
  -- casilla de consentimiento marcada.
  INSERT INTO public.player_artists (player_id, artist_id, consent_at)
  VALUES (v_player_id, p_artist_id, NOW())
  ON CONFLICT (player_id, artist_id)
    DO UPDATE SET consent_at = COALESCE(public.player_artists.consent_at, EXCLUDED.consent_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.artist_save_char FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.artist_save_char TO authenticated;

-- 5c) artist_group v4 (= v3 de 20260927_03 + player_id, slot y variant_render con prefijo de slot)
CREATE OR REPLACE FUNCTION public.artist_group(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_artist_id UUID;
  v_mcp       BOOLEAN;
  v_players   JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
     WHERE user_id = auth.uid() AND provider = 'discord'
  ) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT a.id, coalesce(a.must_change_password, false)
    INTO v_artist_id, v_mcp
    FROM public.artists a
    JOIN auth.identities i ON i.user_id = auth.uid() AND i.provider = 'discord'
   WHERE a.access_key_hash IS NOT NULL
     AND a.access_key_hash = crypt(p_key, a.access_key_hash)
     AND a.discord_id = i.provider_id
     AND a.status = 'approved';

  IF v_artist_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  -- Clave temporal sin cambiar: solo el aviso, ningún jugador
  IF v_mcp THEN
    RETURN jsonb_build_object('must_change_password', true, 'players', '[]'::jsonb);
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'player_id',      p.id,
      'slot',           p.slot,
      'user_id',        p.user_id,
      'alias',          p.alias,
      'discord_id',     p.discord_id,
      'discord_name',   p.discord_name,
      'discord_avatar', p.discord_avatar,
      'x_username',     p.x_username,
      'x_avatar',       p.x_avatar,
      'banner_path',    p.banner_path,
      'has_variant',    (pac.player_id IS NOT NULL),
      'variant_render', CASE WHEN pac.player_id IS NOT NULL
                          THEN p.user_id::text
                               || CASE WHEN p.slot > 0 THEN '/c' || p.slot::text ELSE '' END
                               || '/artist/' || v_artist_id::text || '.png' END,
      'sheet',          public.player_sheet(
                          coalesce(pac.player_type,          p.player_type),
                          coalesce(pac.skin_tone,            p.skin_tone),
                          coalesce(pac.eye_color,            p.eye_color),
                          coalesce(pac.color,                p.color),
                          coalesce(pac.hair,                 p.hair),
                          coalesce(pac.eye_brows,            p.eye_brows),
                          coalesce(pac.bottom,               p.bottom),
                          coalesce(pac.bottom_variation,     p.bottom_variation),
                          coalesce(pac.gear_head,            p.gear_head),
                          coalesce(pac.gear_head_variation,  p.gear_head_variation),
                          coalesce(pac.gear_cloth,           p.gear_cloth),
                          coalesce(pac.gear_cloth_variation, p.gear_cloth_variation),
                          coalesce(pac.gear_shoes,           p.gear_shoes),
                          coalesce(pac.gear_shoes_variation, p.gear_shoes_variation))
    )
    ORDER BY p.created_at, p.slot
  ) INTO v_players
  FROM public.player_artists pa
  JOIN public.players p ON p.id = pa.player_id
  LEFT JOIN public.player_artist_chars pac
         ON pac.player_id = p.id AND pac.artist_id = v_artist_id
  WHERE pa.artist_id = v_artist_id;

  RETURN jsonb_build_object(
    'must_change_password', false,
    'players',              coalesce(v_players, '[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.artist_group(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.artist_group(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 6) Admin
-- ------------------------------------------------------------
-- 6a) admin_ban: limpia el banner de TODAS las fichas del usuario y devuelve
--     todas las rutas antiguas (banner_path = la de la ficha baneada, como antes;
--     banner_paths = las de todos sus personajes, para borrarlas del bucket/R2).
--     Resto idéntico a 20260927_01 (9h).
CREATE OR REPLACE FUNCTION public.admin_ban(p_token text, p_player_id uuid, p_reason text)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_p       public.players%ROWTYPE;
  v_ban_id  uuid;
  v_reason  text;
  v_paths   json;
BEGIN
  PERFORM public.admin_require(p_token);

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

  -- Rutas de banner de todos los personajes del usuario (antes de limpiarlas)
  SELECT coalesce(json_agg(x.banner_path ORDER BY x.slot), '[]'::json)
    INTO v_paths
    FROM public.players x
   WHERE x.user_id = v_p.user_id AND x.banner_path IS NOT NULL;

  UPDATE public.players
     SET banner_path = NULL, banner_sha256 = NULL, splattag_config = NULL
   WHERE user_id = v_p.user_id;

  RETURN json_build_object('ban_id', v_ban_id, 'alias', v_p.alias,
                           'banner_path', v_p.banner_path, 'banner_paths', v_paths);
END;
$$;

-- 6b) Conteos por usuarios distintos (se reescribe sobre la definición viva:
--     en admin_edc_overview hay IDs de prueba sustituidos a mano que no deben perderse).
DO $do$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- admin_list: jugadores por artista = usuarios distintos
  v_def := pg_get_functiondef('public.admin_list(text)'::regprocedure);
  IF position('count(DISTINCT p0.user_id)' in v_def) = 0 THEN
    v_new := regexp_replace(
      v_def,
      'count\(\*\)\s+from\s+public\.player_artists\s+pa\s+where\s+pa\.artist_id\s*=\s*ar\.id',
      'count(DISTINCT p0.user_id) from public.player_artists pa join public.players p0 on p0.id = pa.player_id where pa.artist_id = ar.id',
      'i');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'admin_list: no se encontró el contador de player_artists';
    END IF;
    EXECUTE v_new;
  END IF;

  -- admin_edc_overview: players = usuarios distintos
  v_def := pg_get_functiondef('public.admin_edc_overview(text)'::regprocedure);
  IF position('count(DISTINCT user_id) FROM public.players' in v_def) = 0 THEN
    v_new := regexp_replace(
      v_def,
      '(''players'',\s*)\(SELECT\s+count\(\*\)\s+FROM\s+public\.players\)',
      '\1(SELECT count(DISTINCT user_id) FROM public.players)',
      'i');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'admin_edc_overview: no se encontró el contador de players';
    END IF;
    EXECUTE v_new;
  END IF;
END
$do$;

-- ------------------------------------------------------------
-- 7) Storage de renders: <uid>/c<n>/artist/<aid>.* sigue el mismo filtro que <uid>/artist/<aid>.*
--    (= 20260923_03 con el subdirectorio de personaje saltado al mirar "artist")
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.artist_can_see_render(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, storage
AS $$
  SELECT public.artist_can_see_user((storage.foldername(p_name))[1])
     AND (
       (CASE WHEN (storage.foldername(p_name))[2] ~ '^c[1-2]$'
             THEN (storage.foldername(p_name))[3]
             ELSE (storage.foldername(p_name))[2] END) IS DISTINCT FROM 'artist'
       OR EXISTS (
         SELECT 1
           FROM public.artists a
           JOIN auth.identities i ON i.provider = 'discord'
                                 AND i.provider_id = a.discord_id
                                 AND i.user_id = auth.uid()
          WHERE a.status = 'approved'
            AND a.id::text = split_part(split_part(storage.filename(p_name), '.', 1), '_', 1)));
$$;
REVOKE EXECUTE ON FUNCTION public.artist_can_see_render(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.artist_can_see_render(text) TO authenticated;

-- Banners de personajes extra: el propietario puede borrar el suyo (banner_c1.png / banner_c2.png).
-- Nunca el del principal (banner.png). Lo usa /api/sync-banner con action=delete.
DROP POLICY IF EXISTS "banner_delete_own_extra" ON storage.objects;
CREATE POLICY "banner_delete_own_extra" ON storage.objects FOR DELETE TO authenticated
  USING ( bucket_id = 'banners'
          AND (storage.foldername(name))[1] = (select auth.uid())::text
          AND storage.filename(name) ~ '^banner_c[1-2]\.png$' );

NOTIFY pgrst, 'reload schema';
