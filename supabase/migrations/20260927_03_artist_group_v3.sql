CREATE OR REPLACE FUNCTION public.ink_hex(p_color jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT '#'
    || lpad(to_hex(round(least(1, greatest(0, coalesce((p_color->>'r')::numeric, 1))) * 255)::int), 2, '0')
    || lpad(to_hex(round(least(1, greatest(0, coalesce((p_color->>'g')::numeric, 1))) * 255)::int), 2, '0')
    || lpad(to_hex(round(least(1, greatest(0, coalesce((p_color->>'b')::numeric, 1))) * 255)::int), 2, '0');
$$;
REVOKE EXECUTE ON FUNCTION public.ink_hex(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gear_sheet(p_kind text, p_id int, p_variation int)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
           'img',  'player/gear/' || g.row_id || '.png',
           'name', jsonb_build_array(coalesce(g.name_en, g.row_id), coalesce(g.name_es, g.name_en, g.row_id)),
           'alt',  (g.variation_num > 0 AND coalesce(p_variation, 0) = 1))
    FROM public.gear_catalog g
   WHERE g.kind = p_kind AND g.id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION public.gear_sheet(text, int, int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.player_sheet(
  p_player_type int, p_skin_tone int, p_eye_color int, p_color jsonb,
  p_hair int, p_eye_brows int, p_bottom int, p_bottom_variation int,
  p_gear_head int, p_gear_head_variation int,
  p_gear_cloth int, p_gear_cloth_variation int,
  p_gear_shoes int, p_gear_shoes_variation int
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'species_key', CASE coalesce(p_player_type, 0)
                     WHEN 1 THEN 'InkBoy' WHEN 2 THEN 'OctGirl' WHEN 3 THEN 'OctBoy' ELSE 'InkGirl' END,
    'skin_img',  'player/skin_color/' || greatest(0, coalesce(p_skin_tone, 0)) || '.png',
    'eye_img',   'player/eye_color/'  || greatest(0, coalesce(p_eye_color, 0)) || '.png',
    'ink_hex',   public.ink_hex(p_color),
    'hair_img',  (SELECT 'player/hair/' || g.row_id || '.png'
                    FROM public.gear_catalog g WHERE g.kind = 'hair' AND g.id = p_hair),
    'brows_img', (SELECT 'player/eyebrow/' || g.row_id
                         || CASE WHEN coalesce(p_player_type, 0) % 2 = 1 THEN '_M' ELSE '_F' END || '.png'
                    FROM public.gear_catalog g WHERE g.kind = 'eyebrow' AND g.id = p_eye_brows),
    'legs',      (SELECT jsonb_build_object(
                           'img',       'player/pants/' || g.row_id || '.png',
                           'img_var',   CASE WHEN coalesce(p_bottom_variation, 0) > 0
                                          THEN 'player/pants/' || g.row_id || '.' || p_bottom_variation || '.png' END,
                           'img_local', CASE WHEN coalesce(p_bottom_variation, 0) > 0
                                          THEN 'assets/pants/' || g.row_id || '.v' || p_bottom_variation || '.png' END,
                           'variant',   greatest(0, coalesce(p_bottom_variation, 0)))
                    FROM public.gear_catalog g WHERE g.kind = 'bottom' AND g.id = p_bottom),
    'head',      public.gear_sheet('head',    p_gear_head,  p_gear_head_variation),
    'cloth',     public.gear_sheet('clothes', p_gear_cloth, p_gear_cloth_variation),
    'shoes',     public.gear_sheet('shoes',   p_gear_shoes, p_gear_shoes_variation)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.player_sheet(int, int, int, jsonb, int, int, int, int, int, int, int, int, int, int)
  FROM PUBLIC, anon, authenticated;

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

  IF v_mcp THEN
    RETURN jsonb_build_object('must_change_password', true, 'players', '[]'::jsonb);
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
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
                          THEN p.user_id::text || '/artist/' || v_artist_id::text || '.png' END,
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
    ORDER BY p.created_at
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

NOTIFY pgrst, 'reload schema';
