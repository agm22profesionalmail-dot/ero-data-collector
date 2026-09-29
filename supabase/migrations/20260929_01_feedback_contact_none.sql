-- ============================================================
-- Migración 20260929_01: reportes sin contacto (?feedback)
--
-- El formulario permite ahora enviar un reporte o sugerencia SIN dejar
-- contacto ("Nada"). En ese caso no se guarda ni email ni Discord y la web
-- avisa de que no se podrá notificar al usuario. Esta migración amplía los
-- checks de public.feedback con contact_method = 'none' (sin datos de contacto).
--
-- Idempotente. Aplicar ANTES de desplegar la Edge Function submit-feedback
-- y el frontend que envían 'none'.
-- ============================================================

BEGIN;

ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_contact_method_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_contact_method_check CHECK (contact_method IN ('email', 'discord', 'none'));

ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_contact_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_contact_check CHECK (
    (contact_method = 'email'   AND contact_email IS NOT NULL AND contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
    OR
    (contact_method = 'discord' AND contact_discord_id IS NOT NULL AND contact_discord_id ~ '^[0-9]{5,25}$')
    OR
    (contact_method = 'none'    AND contact_email IS NULL AND contact_discord_id IS NULL AND contact_discord_name IS NULL)
  );

COMMIT;
