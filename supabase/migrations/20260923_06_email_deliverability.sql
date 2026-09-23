-- ============================================================
-- Migración 20260923_06: que el aviso llegue a cualquier artista
--
-- Problema: la cola daba el email por enviado en cuanto Gmail lo aceptaba.
-- Un dominio muerto (p. ej. ajimelo.net) o un buzón inexistente rebotaba
-- después y nadie se enteraba.
--
-- La Edge Function send-artist-credentials (misma fecha) ahora:
--  1) mira el DNS del dominio antes de enviar; si no recibe correo, usa el
--     email verificado de la cuenta de Discord del artista y, si tampoco,
--     un mensaje directo por Discord (secret DISCORD_BOT_TOKEN);
--  2) si Gmail rechaza el envío, también tira de Discord;
--  3) con {"action":"check_bounces"} lee por IMAP los rebotes del buzón de
--     envío y los marca aquí (bounced_at) + reenvía por Discord.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

-- 1) Cola: por dónde salió y si rebotó
ALTER TABLE public.artist_email_outbox
  ADD COLUMN IF NOT EXISTS channel      TEXT,         -- email | email_alt | discord
  ADD COLUMN IF NOT EXISTS delivered_to TEXT,         -- email alternativo o discord:<id>
  ADD COLUMN IF NOT EXISTS bounced_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS note         TEXT;         -- por qué no fue al email del formulario
ALTER TABLE public.artist_email_outbox DROP CONSTRAINT IF EXISTS artist_email_outbox_channel_check;
ALTER TABLE public.artist_email_outbox
  ADD CONSTRAINT artist_email_outbox_channel_check CHECK (channel IS NULL OR channel IN ('email', 'email_alt', 'discord'));

-- 2) Email verificado de la cuenta de Discord del artista (auth.users). Solo
--    la usa la Edge Function (service_role) como alternativa.
CREATE OR REPLACE FUNCTION public.artist_discord_email(p_discord_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.email
    FROM auth.users u
   WHERE u.raw_user_meta_data->>'provider_id' = p_discord_id
     AND u.email IS NOT NULL
     AND u.email_confirmed_at IS NOT NULL
   ORDER BY u.last_sign_in_at DESC NULLS LAST
   LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.artist_discord_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.artist_discord_email(TEXT) TO service_role;

-- 3) Estado del último aviso (plugin ero-dashboard): + canal, destino y rebote.
--    Rebotado sin plan B que funcionara = 'error'.
CREATE OR REPLACE FUNCTION public.admin_email_status(p_user text, p_pass text, p_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email text;
  r record;
BEGIN
  IF NOT public.admin_check(p_user, p_pass) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
  SELECT email INTO v_email FROM public.artists WHERE id = p_id;
  SELECT created_at, sent_at, error, channel, delivered_to, bounced_at, note INTO r
    FROM public.artist_email_outbox
   WHERE email = v_email
   ORDER BY created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('state', 'none');
  END IF;
  RETURN json_build_object(
    'state', CASE WHEN r.bounced_at IS NOT NULL AND r.channel IS DISTINCT FROM 'discord' THEN 'error'
                  WHEN r.sent_at IS NOT NULL THEN 'sent'
                  WHEN r.error IS NOT NULL THEN 'error'
                  ELSE 'pending' END,
    'error', r.error, 'created_at', r.created_at, 'sent_at', r.sent_at,
    'channel', r.channel, 'delivered_to', r.delivered_to,
    'bounced_at', r.bounced_at, 'note', r.note);
END;
$$;

-- 4) Revisión de rebotes cada 15 min, solo si hay envíos de los últimos
--    3 días por revisar (si no, ni se llama a la función).
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'artist-email-bounces';
SELECT cron.schedule(
  'artist-email-bounces',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url     := (SELECT v FROM public.app_secrets WHERE k = 'send_email_url'),
    body    := '{"action":"check_bounces"}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 60000
  )
  WHERE EXISTS (
    SELECT 1 FROM public.artist_email_outbox
     WHERE sent_at > now() - interval '3 days'
       AND bounced_at IS NULL
       AND (channel IS NULL OR channel IN ('email', 'email_alt'))
  );
  $cron$
);
