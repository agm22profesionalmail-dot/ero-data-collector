-- ============================================================
-- Migración 20260923_07: reportes de fallos y sugerencias (?feedback)
--
-- La web tiene un formulario público para avisar de un fallo o proponer una
-- mejora, con contacto obligatorio (email comprobado por DNS, o cuenta de
-- Discord que esté en el servidor de la comunidad). Los envíos NO entran por PostgREST: los
-- recibe la Edge Function submit-feedback, que valida, aplica el anti-spam
-- (5 por contacto y hora, 20 por IP y hora), inserta aquí con la service_role
-- y avisa al propietario por mensaje directo de Discord.
--
-- Seguridad: RLS activada y SIN políticas. anon/authenticated no tienen
-- ningún privilegio sobre la tabla (REVOKE ALL); solo service_role. La IP se
-- guarda únicamente como hash SHA-256 con sal (nunca en claro).
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- Desplegar la función con: supabase functions deploy submit-feedback --no-verify-jwt
-- ============================================================

CREATE TABLE IF NOT EXISTS public.feedback (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind                 TEXT        NOT NULL,
  message              TEXT        NOT NULL,
  contact_method       TEXT        NOT NULL,
  contact_email        TEXT,
  contact_discord_id   TEXT,
  contact_discord_name TEXT,
  user_id              UUID,                       -- auth.users.id si envió con sesión (sin FK: la fila sobrevive al borrado del usuario)
  page                 TEXT,                       -- ruta de la web desde la que se envió
  lang                 TEXT        NOT NULL DEFAULT 'en',
  ip_hash              TEXT,                       -- sha256(sal|ip), solo para el límite por IP
  status               TEXT        NOT NULL DEFAULT 'new',
  notified             BOOLEAN     NOT NULL DEFAULT false   -- ¿llegó el aviso por Discord?
);

-- Checks (se recrean para que la migración sea idempotente)
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_kind_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_kind_check CHECK (kind IN ('bug', 'suggestion', 'other'));

ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_message_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_message_check CHECK (char_length(message) BETWEEN 10 AND 2000);

ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_contact_method_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_contact_method_check CHECK (contact_method IN ('email', 'discord'));

ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_status_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_status_check CHECK (status IN ('new', 'read', 'done', 'discarded'));

ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_lang_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_lang_check CHECK (lang IN ('en', 'es'));

-- El contacto tiene que existir según el método elegido
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_contact_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_contact_check CHECK (
    (contact_method = 'email'   AND contact_email IS NOT NULL AND contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
    OR
    (contact_method = 'discord' AND contact_discord_id IS NOT NULL AND contact_discord_id ~ '^[0-9]{5,25}$')
  );

-- Índices para el anti-spam (contacto + hora, IP + hora) y para revisar lo nuevo
CREATE INDEX IF NOT EXISTS feedback_email_created_idx   ON public.feedback (contact_email, created_at DESC) WHERE contact_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS feedback_discord_created_idx ON public.feedback (contact_discord_id, created_at DESC) WHERE contact_discord_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS feedback_ip_created_idx      ON public.feedback (ip_hash, created_at DESC) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS feedback_status_created_idx  ON public.feedback (status, created_at DESC);

-- RLS activada y sin políticas: nadie entra por PostgREST salvo service_role
-- (que se salta RLS). Se eliminan políticas previas por si las hubiera.
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feedback' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.feedback', p.policyname);
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.feedback FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.feedback TO service_role;

COMMENT ON TABLE public.feedback IS
  'Reportes de fallos y sugerencias de la web (?feedback). Solo escribe la Edge Function submit-feedback (service_role).';
