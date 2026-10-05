BEGIN;

ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

UPDATE public.feedback SET resolved_at = now()
 WHERE status IN ('done', 'discarded') AND resolved_at IS NULL;

CREATE OR REPLACE FUNCTION public.feedback_set_resolved_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('done', 'discarded') THEN
    IF TG_OP = 'INSERT' OR OLD.status NOT IN ('done', 'discarded') OR NEW.resolved_at IS NULL THEN
      NEW.resolved_at := now();
    END IF;
  ELSE
    NEW.resolved_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feedback_resolved_at ON public.feedback;
CREATE TRIGGER feedback_resolved_at
  BEFORE INSERT OR UPDATE OF status ON public.feedback
  FOR EACH ROW EXECUTE FUNCTION public.feedback_set_resolved_at();

CREATE OR REPLACE FUNCTION public.feedback_purge_resolved()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    DELETE FROM public.feedback
     WHERE status IN ('done', 'discarded') AND resolved_at < now() - interval '7 days'
    RETURNING 1
  )
  SELECT count(*)::int FROM d;
$$;
REVOKE ALL ON FUNCTION public.feedback_purge_resolved() FROM PUBLIC, anon, authenticated;

COMMIT;

SELECT cron.schedule('feedback-purge-resolved', '17 4 * * *', $$SELECT public.feedback_purge_resolved()$$);
