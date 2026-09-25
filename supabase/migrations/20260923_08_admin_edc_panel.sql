-- ============================================================
-- Migración 20260923_08: RPCs del panel de administración externo
--
-- Una herramienta de administración gestiona todo lo de la web (OC Data
-- Collector): cifras generales, reportes de ?feedback, cola de avisos a
-- artistas y estado de la beta. Todo pasa por RPCs SECURITY DEFINER que
-- validan las credenciales de admin con admin_check (migración 04 del repo
-- edc-discord-btn): la herramienta solo tiene la anon key + usuario/clave admin.
--
--  1) admin_edc_overview      → cifras del resumen (jugadores, artistas,
--                               reportes, envíos fallidos, último registro)
--  2) admin_feedback_list     → reportes (por estado; por defecto abiertos)
--  3) admin_feedback_set_status → marcar leído / hecho / descartado
--  4) admin_email_log         → últimos avisos de artist_email_outbox
--                               (NUNCA devuelve la columna key)
--
-- Las cuentas de prueba del equipo no cuentan como artistas aprobados, igual
-- que en el roster de la beta. Sustituye <TEST_DISCORD_ID_1/2> por sus IDs de
-- Discord al ejecutar esta migración (en el repo no se publican).
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

-- 1) Resumen ---------------------------------------------------------------
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

-- 2) Reportes: lista ------------------------------------------------------
--    p_status NULL → abiertos (new + read). Nunca devuelve ip_hash.
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

-- 3) Reportes: cambiar estado --------------------------------------------
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

-- 4) Cola de avisos: últimos envíos (sin la clave) --------------------------
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
