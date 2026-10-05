ALTER TABLE public.artist_email_outbox ADD COLUMN IF NOT EXISTS hero SMALLINT;
ALTER TABLE public.artist_email_outbox DROP CONSTRAINT IF EXISTS artist_email_outbox_hero_check;
ALTER TABLE public.artist_email_outbox
  ADD CONSTRAINT artist_email_outbox_hero_check CHECK (hero IS NULL OR hero BETWEEN 1 AND 3);
