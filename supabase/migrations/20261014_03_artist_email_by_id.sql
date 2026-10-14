BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS artists_email_lower_key ON public.artists (lower(email));

-- El envío localiza al artista por id: por correo podía coger otro artista distinto
ALTER TABLE public.artist_email_outbox
  ADD COLUMN IF NOT EXISTS artist_id UUID REFERENCES public.artists(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS artist_email_outbox_artist_idx ON public.artist_email_outbox (artist_id);

UPDATE public.artist_email_outbox o
   SET artist_id = a.id
  FROM public.artists a
 WHERE o.artist_id IS NULL
   AND lower(a.email) = lower(o.email);

DROP FUNCTION IF EXISTS public.queue_artist_email(text, text, text, text, text, boolean);
CREATE FUNCTION public.queue_artist_email(
  p_artist_id uuid, p_email text, p_name text, p_slug text, p_key text, p_lang text, p_reset boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id      UUID;
  v_url     TEXT;
  v_headers JSONB;
BEGIN
  UPDATE public.artist_email_outbox SET key = NULL
   WHERE artist_id = p_artist_id AND sent_at IS NULL AND key IS NOT NULL;

  INSERT INTO public.artist_email_outbox (artist_id, email, name, slug, key, lang, reset)
  VALUES (p_artist_id, p_email, p_name, p_slug, p_key, CASE WHEN p_lang = 'es' THEN 'es' ELSE 'en' END, COALESCE(p_reset, false))
  RETURNING id INTO v_id;

  SELECT v INTO v_url FROM public.app_secrets WHERE k = 'send_email_url';
  IF v_url IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'send_email_url not configured' WHERE id = v_id;
    RETURN false;
  END IF;
  v_headers := public.edc_internal_headers();
  IF v_headers IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'edc_internal_secret not configured (Vault)' WHERE id = v_id;
    RETURN false;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('id', v_id),
    headers := v_headers,
    timeout_milliseconds := 20000
  );
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.queue_artist_email(uuid, text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.queue_artist_email(uuid, text, text, text, text, text, boolean) TO service_role;

DROP FUNCTION IF EXISTS public.queue_artist_notice(text, text, text, text);
CREATE FUNCTION public.queue_artist_notice(p_artist_id uuid, p_email text, p_name text, p_lang text, p_kind text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id      UUID;
  v_url     TEXT;
  v_headers JSONB;
BEGIN
  IF p_kind NOT IN ('rejected') THEN
    RAISE EXCEPTION 'bad notice kind';
  END IF;

  INSERT INTO public.artist_email_outbox (artist_id, email, name, slug, key, lang, reset, kind)
  VALUES (p_artist_id, p_email, p_name, NULL, NULL, CASE WHEN p_lang = 'es' THEN 'es' ELSE 'en' END, false, p_kind)
  RETURNING id INTO v_id;

  SELECT v INTO v_url FROM public.app_secrets WHERE k = 'send_email_url';
  IF v_url IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'send_email_url not configured' WHERE id = v_id;
    RETURN false;
  END IF;
  v_headers := public.edc_internal_headers();
  IF v_headers IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'edc_internal_secret not configured (Vault)' WHERE id = v_id;
    RETURN false;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('id', v_id),
    headers := v_headers,
    timeout_milliseconds := 20000
  );
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.queue_artist_notice(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.queue_artist_notice(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_approve(p_token text, p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_slug  text; v_base text; v_key text; v_sent boolean;
  v_email text; v_name text; v_lang text;
BEGIN
  PERFORM public.admin_require(p_token);

  SELECT email, name, coalesce(preferred_lang, 'en')
    INTO v_email, v_name, v_lang
    FROM public.artists WHERE id = p_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'artist has no email' USING ERRCODE = '22004';
  END IF;

  SELECT slug INTO v_slug FROM public.artists WHERE id = p_id;
  IF v_slug IS NULL THEN
    SELECT nullif(trim(both '-' FROM regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), '')
      INTO v_base;
    v_base := coalesce(v_base, 'artist');
    v_slug := v_base;
    WHILE EXISTS (SELECT 1 FROM public.artists WHERE slug = v_slug AND id <> p_id) LOOP
      v_slug := v_base || '-' || substr(encode(gen_random_bytes(2), 'hex'), 1, 3);
    END LOOP;
  END IF;

  v_key := public.artist_new_temp_key();
  UPDATE public.artists
     SET status = 'approved',
         slug = v_slug,
         access_key_hash = crypt(v_key, gen_salt('bf', 12)),
         must_change_password = true,
         approved_at = now()
   WHERE id = p_id;

  v_sent := public.queue_artist_email(p_id, v_email, v_name, v_slug, v_key, v_lang, false);
  RETURN json_build_object('slug', v_slug, 'sent', v_sent);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject(p_token text, p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_status text; v_email text; v_name text; v_lang text;
  v_sent boolean := false;
BEGIN
  PERFORM public.admin_require(p_token);

  SELECT status, email, name, coalesce(preferred_lang, 'en')
    INTO v_status, v_email, v_name, v_lang
    FROM public.artists WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'artist not found' USING ERRCODE = '22004';
  END IF;

  UPDATE public.artists SET status = 'rejected' WHERE id = p_id;

  IF v_status = 'pending' AND v_email IS NOT NULL THEN
    v_sent := public.queue_artist_notice(p_id, v_email, v_name, v_lang, 'rejected');
  END IF;
  RETURN json_build_object('sent', v_sent, 'emailed', v_status = 'pending' AND v_email IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_generic(p_token text, p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key text; v_sent boolean;
  v_email text; v_name text; v_slug text; v_lang text;
BEGIN
  PERFORM public.admin_require(p_token);

  SELECT email, name, slug, coalesce(preferred_lang, 'en')
    INTO v_email, v_name, v_slug, v_lang
    FROM public.artists
   WHERE id = p_id AND status = 'approved';
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'artist not approved or missing email' USING ERRCODE = '22004';
  END IF;

  v_key := public.artist_new_temp_key();
  UPDATE public.artists
     SET access_key_hash = crypt(v_key, gen_salt('bf', 12)),
         must_change_password = true
   WHERE id = p_id;

  v_sent := public.queue_artist_email(p_id, v_email, v_name, v_slug, v_key, v_lang, true);
  RETURN json_build_object('sent', v_sent);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_send_email(
  p_token text, p_email text, p_name text, p_subject text, p_body text, p_lang text DEFAULT 'en'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id      uuid;
  v_url     text;
  v_headers jsonb;
BEGIN
  PERFORM public.admin_require(p_token);
  IF p_email IS NULL
     OR p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     OR length(p_email) NOT BETWEEN 5 AND 320
     OR coalesce(trim(p_subject), '') = '' OR length(p_subject) > 200
     OR coalesce(trim(p_body), '') = ''    OR length(p_body) > 10000 THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.artist_email_outbox (artist_id, email, name, slug, key, lang, reset, kind, subject, body)
  VALUES ((SELECT id FROM public.artists WHERE lower(email) = lower(trim(p_email))),
          trim(p_email), nullif(trim(coalesce(p_name, '')), ''), NULL, NULL,
          CASE WHEN p_lang = 'es' THEN 'es' ELSE 'en' END, false, 'custom',
          trim(p_subject), p_body)
  RETURNING id INTO v_id;

  SELECT v INTO v_url FROM public.app_secrets WHERE k = 'send_email_url';
  IF v_url IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'send_email_url not configured' WHERE id = v_id;
    RETURN json_build_object('id', v_id, 'queued', false);
  END IF;
  v_headers := public.edc_internal_headers();
  IF v_headers IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'edc_internal_secret not configured (Vault)' WHERE id = v_id;
    RETURN json_build_object('id', v_id, 'queued', false);
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('id', v_id),
    headers := v_headers,
    timeout_milliseconds := 20000
  );
  RETURN json_build_object('id', v_id, 'queued', true);
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
