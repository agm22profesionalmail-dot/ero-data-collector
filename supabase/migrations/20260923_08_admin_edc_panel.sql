CREATE OR REPLACE FUNCTION public.admin_edc_overview(p_user text, p_pass text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_test_ids CONSTANT text[] := ARRAY['<TEST_DISCORD_ID_1>', '<TEST_DISCORD_ID_2>']; -- cuentas de prueba
BEGIN
  IF NOT public.admin_check(p_user, p_pass) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  RETURN json_build_object(
    'players',          (SELECT count(*) FROM public.players),
    'artists_approved', (SELECT count(*) FROM public.artists
                          WHERE status = 'approved'
                            AND (discord_id IS NULL OR NOT (discord_id = ANY (v_test_ids)))),
    'artists_pending',  (SELECT count(*) FROM public.artists WHERE status = 'pending'),
    'artist_slots',     15,
    'feedback_new',     (SELECT count(*) FROM public.feedback WHERE status = 'new'),
    'feedback_open',    (SELECT count(*) FROM public.feedback WHERE status IN ('new', 'read')),
    'emails_failed_7d', (SELECT count(*) FROM public.artist_email_outbox
                          WHERE created_at > now() - interval '7 days'
                            AND (error IS NOT NULL
                                 OR (bounced_at IS NOT NULL AND channel IS DISTINCT FROM 'discord'))),
    'last_player_at',   (SELECT max(created_at) FROM public.players)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_edc_overview(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_edc_overview(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_feedback_list(p_user text, p_pass text, p_status text DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_check(p_user, p_pass) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('new', 'read', 'done', 'discarded') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = '22023';
  END IF;

  RETURN COALESCE((
    SELECT json_agg(json_build_object(
             'id', f.id, 'created_at', f.created_at, 'kind', f.kind, 'message', f.message,
             'contact_method', f.contact_method, 'contact_email', f.contact_email,
             'contact_discord_id', f.contact_discord_id, 'contact_discord_name', f.contact_discord_name,
             'page', f.page, 'lang', f.lang, 'status', f.status, 'notified', f.notified)
           ORDER BY f.created_at DESC)
      FROM (
        SELECT * FROM public.feedback
         WHERE (p_status IS NULL AND status IN ('new', 'read')) OR status = p_status
         ORDER BY created_at DESC
         LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))
      ) f
  ), '[]'::json);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_feedback_list(text, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_feedback_list(text, text, text, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_feedback_set_status(p_user text, p_pass text, p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_check(p_user, p_pass) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('new', 'read', 'done', 'discarded') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = '22023';
  END IF;
  UPDATE public.feedback SET status = p_status WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_feedback_set_status(text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_feedback_set_status(text, text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_email_log(p_user text, p_pass text, p_limit int DEFAULT 20)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_check(p_user, p_pass) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  RETURN COALESCE((
    SELECT json_agg(json_build_object(
             'id', o.id, 'email', o.email, 'name', o.name, 'kind', o.kind,
             'created_at', o.created_at, 'sent_at', o.sent_at, 'error', o.error,
             'channel', o.channel, 'delivered_to', o.delivered_to,
             'bounced_at', o.bounced_at, 'note', o.note)
           ORDER BY o.created_at DESC)
      FROM (
        SELECT id, email, name, kind, created_at, sent_at, error, channel, delivered_to, bounced_at, note
          FROM public.artist_email_outbox
         ORDER BY created_at DESC
         LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 200))
      ) o
  ), '[]'::json);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_email_log(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_email_log(text, text, int) TO anon, authenticated;
