-- 20260924_01_dm_relay.sql
-- Reenviador de MD del bot (Pelipper) a Zero: estado por destinatario + cron
-- cada 5 min que llama a la Edge Function relay-bot-dms. Ver la cabecera de
-- supabase/functions/relay-bot-dms/index.ts.

-- 1) Estado: canal de MD y último mensaje visto por destinatario.
CREATE TABLE IF NOT EXISTS public.bot_dm_relay (
  recipient_id    TEXT PRIMARY KEY,          -- id de Discord del destinatario
  channel_id      TEXT,                      -- canal de MD bot ↔ destinatario
  last_message_id TEXT,                      -- cursor (snowflake)
  label           TEXT,                      -- de dónde sale (feedback, artista, manual)
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.bot_dm_relay ENABLE ROW LEVEL SECURITY;   -- sin políticas: solo service_role
REVOKE ALL ON public.bot_dm_relay FROM anon, authenticated;

-- Shiro: se le contestó por MD directo el 2026-09-24 (sugerencias dd9dd897 + 9e28cd4c).
INSERT INTO public.bot_dm_relay (recipient_id, label)
VALUES ('950933228934545438', 'manual · Shiro (sugerencias render)')
ON CONFLICT (recipient_id) DO NOTHING;

-- 2) URL de la función y clave compartida del cron.
INSERT INTO public.app_secrets (k, v) VALUES
  ('relay_dm_url', 'https://xwyauyjeteztlevvtydb.supabase.co/functions/v1/relay-bot-dms'),
  ('relay_dm_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (k) DO NOTHING;

-- 3) Cron cada 5 min.
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'relay-bot-dms';
SELECT cron.schedule(
  'relay-bot-dms',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url     := (SELECT v FROM public.app_secrets WHERE k = 'relay_dm_url'),
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-relay-key', (SELECT v FROM public.app_secrets WHERE k = 'relay_dm_key')),
    timeout_milliseconds := 60000
  );
  $cron$
);
