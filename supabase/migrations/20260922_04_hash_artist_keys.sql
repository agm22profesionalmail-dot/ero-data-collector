-- ============================================================
-- Migración 20260922_04: claves de artista siempre con bcrypt
--
-- Problema: artist_group comparaba la clave en claro
-- (access_key_hash = p_key) porque su search_path era solo `public` y
-- crypt() vive en el schema `extensions` → alguien la cambió a
-- comparación directa y la clave de Caca se guardó sin cifrar.
-- admin_approve / admin_reset_* / artist_change_password ya escriben bcrypt.
--
-- 1) Cifra con bcrypt las claves que estén en claro (la clave del artista
--    NO cambia: se hashea el mismo valor).
-- 2) CHECK: access_key_hash solo admite NULL o un hash bcrypt.
-- 3) artist_group vuelve a comparar con crypt() (search_path + extensions).
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

-- 1) Hashear las claves en claro
UPDATE public.artists
   SET access_key_hash = extensions.crypt(access_key_hash, extensions.gen_salt('bf', 12))
 WHERE access_key_hash IS NOT NULL
   AND access_key_hash !~ '^\$2[aby]\$[0-9]{2}\$';

-- 2) Impedir que vuelva a guardarse una clave en claro
ALTER TABLE public.artists DROP CONSTRAINT IF EXISTS artists_access_key_bcrypt;
ALTER TABLE public.artists ADD CONSTRAINT artists_access_key_bcrypt
  CHECK (access_key_hash IS NULL OR access_key_hash ~ '^\$2[aby]\$[0-9]{2}\$.{53}$');

-- 3) artist_group con comparación bcrypt
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
