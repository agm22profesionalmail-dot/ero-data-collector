-- ============================================================
-- Migración 20260922_01: Variantes de personaje por artista
--
-- Permite que un jugador registrado tenga una configuración de
-- personaje diferente para cada artista (sin tocar su ficha principal).
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ------------------------------------------------------------
-- 1) Tabla player_artist_chars
--    Clave primaria compuesta: (player_id, artist_id)
--    Un jugador puede tener como máximo 1 variante por artista.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.player_artist_chars (
  player_id            UUID  NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  artist_id            UUID  NOT NULL,
  -- Campos de personaje (mismos nombres/tipos que players)
  player_type          INT   NOT NULL DEFAULT 0,
  hair                 INT   NOT NULL DEFAULT 0,
  bottom               INT   NOT NULL DEFAULT 0,
  bottom_variation     INT   NOT NULL DEFAULT 0,
  skin_tone            INT   NOT NULL DEFAULT 0,
  eye_brows            INT   NOT NULL DEFAULT 0,
  eye_color            INT   NOT NULL DEFAULT 0,
  gear_head            INT   NOT NULL DEFAULT 0,
  gear_head_variation  INT   NOT NULL DEFAULT 0,
  gear_cloth           INT   NOT NULL DEFAULT 0,
  gear_cloth_variation INT   NOT NULL DEFAULT 0,
  gear_shoes           INT   NOT NULL DEFAULT 0,
  gear_shoes_variation INT   NOT NULL DEFAULT 0,
  weapon_main          INT   NOT NULL DEFAULT -1,
  anim_name            TEXT  NOT NULL DEFAULT 'AW_BrandPoseCollectionA',
  color                JSONB NOT NULL DEFAULT '{"r":1.0,"g":1.0,"b":1.0,"a":1.0}',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, artist_id)
);

ALTER TABLE public.player_artist_chars ENABLE ROW LEVEL SECURITY;

-- El jugador gestiona solo sus propias variantes
DROP POLICY IF EXISTS "pac_manage_own" ON public.player_artist_chars;
CREATE POLICY "pac_manage_own" ON public.player_artist_chars
  FOR ALL TO authenticated
  USING (
    player_id IN (SELECT id FROM public.players WHERE user_id = auth.uid())
  )
  WITH CHECK (
    player_id IN (SELECT id FROM public.players WHERE user_id = auth.uid())
  );

-- ------------------------------------------------------------
-- 2) RPC artist_save_char
--    Llamada por el jugador para guardar su variante para un artista.
--    Usa el artist_id resuelto desde artists_public (slug público).
--    También enlaza referred_by si aún no está asignado.
-- ------------------------------------------------------------
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

  -- Enlazar referred_by si aún no está asignado (aparece en artist_group)
  UPDATE public.players
     SET referred_by = p_artist_id, referred_consent_at = NOW()
   WHERE id = v_player_id
     AND referred_by IS NULL;

END;
$$;
REVOKE EXECUTE ON FUNCTION public.artist_save_char FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.artist_save_char TO authenticated;

-- ------------------------------------------------------------
-- 3) Actualización de artist_group para devolver variantes
--
-- NOTA: Este bloque REEMPLAZA la función artist_group existente.
-- Compara con tu versión actual antes de ejecutar.
-- La comparación de panel_key usa crypt() — si tu implementación
-- almacena la clave en plano, sustituye:
--   panel_key_hash = crypt(p_key, panel_key_hash)
-- por:
--   panel_key = p_key
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.artist_group(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_artist_id   UUID;
  v_mcp         BOOLEAN;
  v_players     JSONB;
BEGIN
  -- Autenticar al artista (requiere Discord en la sesión)
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
     WHERE user_id = auth.uid() AND provider = 'discord'
  ) THEN
    RAISE EXCEPTION 'no discord identity' USING ERRCODE = '28000';
  END IF;

  -- Resolver artista por clave y Discord
  -- ADAPTAR la comparación según cómo almacenes panel_key en tu BD:
  SELECT a.id, a.must_change_password
    INTO v_artist_id, v_mcp
    FROM public.artists a
    JOIN auth.identities i ON i.user_id = auth.uid() AND i.provider = 'discord'
   WHERE a.panel_key_hash = crypt(p_key, a.panel_key_hash)
     AND a.discord_id = i.provider_id
     AND a.status = 'approved';

  IF v_artist_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  -- Construir array de jugadores, prefiriendo la variante si existe
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
      'color',                COALESCE(pac.color,                p.color),
      'banner_path',          p.banner_path,
      -- Campos de personaje: variante si existe, si no el principal
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
  FROM public.players p
  LEFT JOIN public.player_artist_chars pac
         ON pac.player_id = p.id AND pac.artist_id = v_artist_id
  WHERE p.referred_by = v_artist_id;

  RETURN jsonb_build_object(
    'must_change_password', COALESCE(v_mcp, false),
    'players',              COALESCE(v_players, '[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.artist_group FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.artist_group TO authenticated;
