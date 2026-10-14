-- El Discord ID sale de auth.identities: user_metadata lo puede editar el propio usuario
CREATE OR REPLACE FUNCTION public.artist_discord_email(p_discord_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.email
    FROM auth.identities i
    JOIN auth.users u ON u.id = i.user_id
   WHERE i.provider = 'discord'
     AND i.provider_id = p_discord_id
     AND u.email IS NOT NULL
     AND u.email_confirmed_at IS NOT NULL
   LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.artist_discord_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.artist_discord_email(TEXT) TO service_role;
