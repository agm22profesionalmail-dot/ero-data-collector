-- ============================================================
-- Migración 20260923_05: portada fija en la cola de emails (pruebas)
--
-- artist_email_outbox.hero (1-3) hace que el email de acceso use esa portada
-- (1 Deep Cut, 2 Squid Sisters, 3 Off the Hook). NULL = al azar, que es lo
-- que usan admin_approve / admin_reset_generic. Solo para envíos de prueba
-- desde el SQL Editor.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================
ALTER TABLE public.artist_email_outbox ADD COLUMN IF NOT EXISTS hero SMALLINT;
ALTER TABLE public.artist_email_outbox DROP CONSTRAINT IF EXISTS artist_email_outbox_hero_check;
ALTER TABLE public.artist_email_outbox
  ADD CONSTRAINT artist_email_outbox_hero_check CHECK (hero IS NULL OR hero BETWEEN 1 AND 3);
