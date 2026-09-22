-- ============================================================
-- Migración 20260922_07: un jugador puede estar con VARIOS artistas
--
-- Antes: players.referred_by (un solo artista). Si el jugador entraba por el
-- enlace de otro artista, o no se asociaba o pisaba al anterior, que perdía
-- la ficha. Ahora: tabla player_artists (jugador ↔ artista, N:M) con la fecha
-- de consentimiento. referred_by se queda como dato histórico (primer
-- artista) y deja de usarse para dar acceso.
--
-- La asociación solo se crea por RPC (artist_link / artist_save_char), que
-- comprueban que el artista está aprobado y usan auth.uid(): el jugador no
-- puede asociarse a mano escribiendo en la tabla.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

-- 1) Tabla N:M
CREATE TABLE IF NOT EXISTS public.player_artists (
  player_id  UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  artist_id  UUID NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  consent_at TIMESTAMPTZ,  -- NULL = asociación manual (pruebas/admin), sin consentimiento en la web
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, artist_id)
);
CREATE INDEX IF NOT EXISTS player_artists_artist_idx ON public.player_artists (artist_id);
ALTER TABLE public.player_artists ENABLE ROW LEVEL SECURITY;

-- El jugador ve y puede retirar (DELETE) sus propias asociaciones; no inserta.
REVOKE ALL ON public.player_artists FROM anon, authenticated;
GRANT SELECT, DELETE ON public.player_artists TO authenticated;
DROP POLICY IF EXISTS pa_select_own ON public.player_artists;
CREATE POLICY pa_select_own ON public.player_artists
  FOR SELECT TO authenticated
  USING (player_id IN (SELECT id FROM public.players WHERE user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS pa_delete_own ON public.player_artists;
CREATE POLICY pa_delete_own ON public.player_artists
  FOR DELETE TO authenticated
  USING (player_id IN (SELECT id FROM public.players WHERE user_id = (SELECT auth.uid())));

-- 2) Backfill desde referred_by (conserva la fecha de consentimiento)
INSERT INTO public.player_artists (player_id, artist_id, consent_at)
SELECT id, referred_by, referred_consent_at
  FROM public.players
 WHERE referred_by IS NOT NULL
ON CONFLICT (player_id, artist_id) DO NOTHING;

-- 3) RPC: asociarse a un artista con consentimiento (no toca a los demás)
CREATE OR REPLACE FUNCTION public.artist_link(p_artist_id UUID)
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
  SELECT id INTO v_player_id FROM public.players WHERE user_id = auth.uid();
  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'no player record for this user';
  END IF;
  INSERT INTO public.player_artists (player_id, artist_id, consent_at)
  VALUES (v_player_id, p_artist_id, NOW())
  ON CONFLICT (player_id, artist_id)
    DO UPDATE SET consent_at = COALESCE(public.player_artists.consent_at, EXCLUDED.consent_at);
  -- Histórico: primer artista del jugador
  UPDATE public.players SET referred_by = p_artist_id, referred_consent_at = NOW()
   WHERE id = v_player_id AND referred_by IS NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.artist_link(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.artist_link(UUID) TO authenticated;

-- 4) artist_save_char: asocia vía player_artists
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
  p_color         JSONB DEFAULT '{"r":1.0,"g":1.0,"b":1.0,"a":1.0}'
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

  -- Resolver el jugador por sesión activa
  SELECT id INTO v_player_id
    FROM public.players
   WHERE user_id = auth.uid();

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
GRANT EXECUTE ON FUNCTION public.artist_save_char TO authenticated;


-- 5) artist_group: jugadores del artista vía player_artists
CREATE OR REPLACE FUNCTION public.artist_group(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_artist_id   UUID;
  v_mcp         BOOLEAN;
  v_players     JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
     WHERE user_id = auth.uid() AND provider = 'discord'
  ) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT a.id, a.must_change_password
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

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',                   p.id,
      'user_id',              p.user_id,
      'alias',                p.alias,
      'discord_id',           p.discord_id,
      'discord_name',         p.discord_name,
      'discord_avatar',       p.discord_avatar,
      'x_id',                 p.x_id,
      'x_username',           p.x_username,
      'x_avatar',             p.x_avatar,
      'banner_path',          p.banner_path,
      'color',                COALESCE(pac.color,                p.color),
      'player_type',          COALESCE(pac.player_type,          p.player_type),
      'hair',                 COALESCE(pac.hair,                 p.hair),
      'bottom',               COALESCE(pac.bottom,               p.bottom),
      'bottom_variation',     COALESCE(pac.bottom_variation,     p.bottom_variation),
      'skin_tone',            COALESCE(pac.skin_tone,            p.skin_tone),
      'eye_brows',            COALESCE(pac.eye_brows,            p.eye_brows),
      'eye_color',            COALESCE(pac.eye_color,            p.eye_color),
      'gear_head',            COALESCE(pac.gear_head,            p.gear_head),
      'gear_head_variation',  COALESCE(pac.gear_head_variation,  p.gear_head_variation),
      'gear_cloth',           COALESCE(pac.gear_cloth,           p.gear_cloth),
      'gear_cloth_variation', COALESCE(pac.gear_cloth_variation, p.gear_cloth_variation),
      'gear_shoes',           COALESCE(pac.gear_shoes,           p.gear_shoes),
      'gear_shoes_variation', COALESCE(pac.gear_shoes_variation, p.gear_shoes_variation),
      'weapon_main',          COALESCE(pac.weapon_main,          p.weapon_main),
      'anim_name',            COALESCE(pac.anim_name,            p.anim_name),
      'has_variant',          (pac.player_id IS NOT NULL)
    )
    ORDER BY p.created_at
  ) INTO v_players
  FROM public.player_artists pa
  JOIN public.players p ON p.id = pa.player_id
  LEFT JOIN public.player_artist_chars pac
         ON pac.player_id = p.id AND pac.artist_id = v_artist_id
  WHERE pa.artist_id = v_artist_id;

  RETURN jsonb_build_object(
    'must_change_password', COALESCE(v_mcp, false),
    'players',              COALESCE(v_players, '[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.artist_group FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.artist_group TO authenticated;

-- 6) Storage (banners/renders): el artista ve a sus jugadores vía player_artists
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
      JOIN public.player_artists pa ON pa.player_id = p.id
      JOIN public.artists a         ON a.id = pa.artist_id AND a.status = 'approved'
      JOIN auth.identities i        ON i.provider = 'discord'
                                   AND i.provider_id = a.discord_id
                                   AND i.user_id = auth.uid()
     WHERE p.user_id::text = p_user_id
  );
$$;
REVOKE EXECUTE ON FUNCTION public.artist_can_see_user(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.artist_can_see_user(text) TO authenticated;

-- 7) admin_list: el contador de jugadores por artista usa player_artists.
--    Se reescribe sobre la definición viva (solo cambia esa subconsulta).
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.admin_list(text,text)'::regprocedure);
  v_old text := '(select count(*) from public.players p where p.referred_by = ar.id)';
  v_new text := '(select count(*) from public.player_artists pa where pa.artist_id = ar.id)';
BEGIN
  IF position(v_new in v_def) > 0 THEN RETURN; END IF;  -- ya aplicado
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'admin_list: no se encontró el contador de referred_by';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$do$;
