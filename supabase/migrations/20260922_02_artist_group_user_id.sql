-- ============================================================
-- Migración 20260922_02: añadir user_id al output de artist_group
--
-- FIX: el panel de artista no mostraba el render porque artist_group
-- no devolvía user_id, y loadRenderInto lo necesita para construir
-- la ruta del bucket (renders/<user_id>/render.png).
--
-- Este parche SOLO modifica el SELECT de artist_group para incluir
-- user_id. No toca player_artist_chars ni artist_save_char.
--
-- ANTES DE EJECUTAR:
--   Comprueba cómo almacenas la clave del artista en la tabla artists:
--   - Si usas bcrypt/pgcrypto:  deja   panel_key_hash = crypt(p_key, panel_key_hash)
--   - Si almacenas en plano:    cambia a panel_key = p_key
--   (la función actual ya funciona con una de las dos; usar la misma)
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

DROP FUNCTION IF EXISTS public.artist_group(TEXT);
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
  -- Requiere Discord en la sesión
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
     WHERE user_id = auth.uid() AND provider = 'discord'
  ) THEN
    RAISE EXCEPTION 'no discord identity' USING ERRCODE = '28000';
  END IF;

  -- Autenticar artista por clave y Discord
  -- ⚠️  ADAPTAR la comparación según tu BD (ver cabecera de este fichero)
  SELECT a.id, a.must_change_password
    INTO v_artist_id, v_mcp
    FROM public.artists a
    JOIN auth.identities i ON i.user_id = auth.uid() AND i.provider = 'discord'
   WHERE a.panel_key = p_key
     AND a.discord_id = i.provider_id
     AND a.status = 'approved';

  IF v_artist_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  -- Devolver jugadores del grupo (user_id incluido para el bucket de renders)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',                   p.id,
      'user_id',              p.user_id,       -- ← campo añadido
      'alias',                p.alias,
      'discord_id',           p.discord_id,
      'discord_name',         p.discord_name,
      'discord_avatar',       p.discord_avatar,
      'x_id',                 p.x_id,
      'x_username',           p.x_username,
      'x_avatar',             p.x_avatar,
      'banner_path',          p.banner_path,
      'color',                p.color,
      'player_type',          p.player_type,
      'hair',                 p.hair,
      'bottom',               p.bottom,
      'bottom_variation',     p.bottom_variation,
      'skin_tone',            p.skin_tone,
      'eye_brows',            p.eye_brows,
      'eye_color',            p.eye_color,
      'gear_head',            p.gear_head,
      'gear_head_variation',  p.gear_head_variation,
      'gear_cloth',           p.gear_cloth,
      'gear_cloth_variation', p.gear_cloth_variation,
      'gear_shoes',           p.gear_shoes,
      'gear_shoes_variation', p.gear_shoes_variation,
      'weapon_main',          p.weapon_main,
      'anim_name',            p.anim_name
    )
    ORDER BY p.created_at
  ) INTO v_players
  FROM public.players p
  WHERE p.referred_by = v_artist_id;

  RETURN jsonb_build_object(
    'must_change_password', COALESCE(v_mcp, false),
    'players',              COALESCE(v_players, '[]'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.artist_group FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.artist_group TO authenticated;
