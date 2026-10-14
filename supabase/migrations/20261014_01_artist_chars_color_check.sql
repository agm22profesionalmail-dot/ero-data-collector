BEGIN;

-- Misma regla que players_color_chk; el CASE evita castear antes de comprobar el tipo
ALTER TABLE public.player_artist_chars DROP CONSTRAINT IF EXISTS player_artist_chars_color_chk;
ALTER TABLE public.player_artist_chars
  ADD CONSTRAINT player_artist_chars_color_chk CHECK (
    jsonb_typeof(color) = 'object'
    AND CASE
      WHEN jsonb_typeof(color->'r') = 'number'
       AND jsonb_typeof(color->'g') = 'number'
       AND jsonb_typeof(color->'b') = 'number'
      THEN (color->>'r')::numeric BETWEEN 0 AND 1
       AND (color->>'g')::numeric BETWEEN 0 AND 1
       AND (color->>'b')::numeric BETWEEN 0 AND 1
      ELSE false
    END
  );

-- Un color mal formado no debe tumbar artist_group entero
CREATE OR REPLACE FUNCTION public.ink_hex(p_color jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT '#'
    || lpad(to_hex(round(least(1, greatest(0, CASE WHEN jsonb_typeof(p_color->'r') = 'number' THEN (p_color->>'r')::numeric ELSE 1 END)) * 255)::int), 2, '0')
    || lpad(to_hex(round(least(1, greatest(0, CASE WHEN jsonb_typeof(p_color->'g') = 'number' THEN (p_color->>'g')::numeric ELSE 1 END)) * 255)::int), 2, '0')
    || lpad(to_hex(round(least(1, greatest(0, CASE WHEN jsonb_typeof(p_color->'b') = 'number' THEN (p_color->>'b')::numeric ELSE 1 END)) * 255)::int), 2, '0');
$$;
REVOKE EXECUTE ON FUNCTION public.ink_hex(jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;
