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
