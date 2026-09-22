-- ============================================================
-- Migración 20260922_08: envío real del email de aprobación
--
-- Antes: admin_approve / admin_reset_generic solo enviaban si app_secrets
-- tenía send_email_url + service_role_key (nunca se configuraron) y la
-- función send-artist-credentials no estaba desplegada → "sent": false y
-- ningún email. Además pasaban el body a net.http_post como text.
--
-- Ahora: el email se deja en la cola artist_email_outbox y pg_net avisa a la
-- Edge Function con {"id": ...}. La función lee la fila con la service_role
-- que Supabase le inyecta, envía por Gmail, marca sent_at y BORRA la clave de
-- la fila. La service_role ya no se guarda en app_secrets (se elimina si
-- existía).
--
-- "sent" en la respuesta de las RPC = email encolado y función avisada. El
-- resultado real queda en artist_email_outbox (sent_at / error).
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

-- 1) Cola (cerrada a anon/authenticated: solo RPC security definer y service_role)
CREATE TABLE IF NOT EXISTS public.artist_email_outbox (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  name       TEXT,
  slug       TEXT NOT NULL,
  key        TEXT,                       -- se borra (NULL) al enviarse
  lang       TEXT NOT NULL DEFAULT 'en',
  reset      BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at    TIMESTAMPTZ,
  error      TEXT
);
ALTER TABLE public.artist_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.artist_email_outbox FROM anon, authenticated;

-- 2) URL de la función (pública, no es un secreto) y fuera la service_role
INSERT INTO public.app_secrets (k, v)
VALUES ('send_email_url', 'https://xwyauyjeteztlevvtydb.supabase.co/functions/v1/send-artist-credentials')
ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
DELETE FROM public.app_secrets WHERE k = 'service_role_key';

-- 3) Encolar + avisar a la función
CREATE OR REPLACE FUNCTION public.queue_artist_email(
  p_email TEXT, p_name TEXT, p_slug TEXT, p_key TEXT, p_lang TEXT, p_reset BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id  UUID;
  v_url TEXT;
BEGIN
  -- Claves pendientes de envíos anteriores de ese email: fuera (no se reenvían)
  UPDATE public.artist_email_outbox SET key = NULL
   WHERE email = p_email AND sent_at IS NULL AND key IS NOT NULL;

  INSERT INTO public.artist_email_outbox (email, name, slug, key, lang, reset)
  VALUES (p_email, p_name, p_slug, p_key, CASE WHEN p_lang = 'es' THEN 'es' ELSE 'en' END, COALESCE(p_reset, false))
  RETURNING id INTO v_id;

  SELECT v INTO v_url FROM public.app_secrets WHERE k = 'send_email_url';
  IF v_url IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'send_email_url not configured' WHERE id = v_id;
    RETURN false;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('id', v_id),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 20000
  );
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.queue_artist_email(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- 4) admin_approve (misma lógica que en producción; solo cambia el envío)
CREATE OR REPLACE FUNCTION public.admin_approve(p_user text, p_pass text, p_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_slug    text; v_base text;
  v_generic text; v_sent boolean;
  v_email   text; v_name text; v_lang text;
begin
  if not public.admin_check(p_user, p_pass) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  select email, name, coalesce(preferred_lang, 'en')
    into v_email, v_name, v_lang
    from public.artists where id = p_id;
  if v_email is null then
    raise exception 'artist has no email' using errcode = '22004';
  end if;

  select slug into v_slug from public.artists where id = p_id;
  if v_slug is null then
    select nullif(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), '')
      into v_base;
    v_base := coalesce(v_base, 'artist');
    v_slug := v_base;
    while exists (select 1 from public.artists where slug = v_slug and id <> p_id) loop
      v_slug := v_base || '-' || substr(encode(gen_random_bytes(2), 'hex'), 1, 3);
    end loop;
  end if;

  select v into v_generic from public.app_secrets where k = 'generic_artist_key';
  if v_generic is null then
    raise exception 'generic_artist_key not configured in app_secrets';
  end if;

  update public.artists
     set status = 'approved',
         slug = v_slug,
         access_key_hash = crypt(v_generic, gen_salt('bf', 12)),
         must_change_password = true,
         approved_at = now()
   where id = p_id;

  v_sent := public.queue_artist_email(v_email, v_name, v_slug, v_generic, v_lang, false);
  return json_build_object('slug', v_slug, 'sent', v_sent);
end $function$;

-- 5) admin_reset_generic (misma lógica que en producción; solo cambia el envío)
CREATE OR REPLACE FUNCTION public.admin_reset_generic(p_user text, p_pass text, p_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_generic text; v_sent boolean;
  v_email   text; v_name text; v_slug text; v_lang text;
begin
  if not public.admin_check(p_user, p_pass) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  select v into v_generic from public.app_secrets where k = 'generic_artist_key';
  if v_generic is null then
    raise exception 'generic_artist_key not configured in app_secrets';
  end if;

  select email, name, slug, coalesce(preferred_lang, 'en')
    into v_email, v_name, v_slug, v_lang
    from public.artists
   where id = p_id and status = 'approved';
  if v_email is null then
    raise exception 'artist not approved or missing email' using errcode = '22004';
  end if;

  update public.artists
     set access_key_hash = crypt(v_generic, gen_salt('bf', 12)),
         must_change_password = true
   where id = p_id;

  v_sent := public.queue_artist_email(v_email, v_name, v_slug, v_generic, v_lang, true);
  return json_build_object('sent', v_sent);
end $function$;

-- 6) Estado del último email de un artista (para el plugin ero-dashboard).
--    Protegida por admin_check como el resto de admin_*.
CREATE OR REPLACE FUNCTION public.admin_email_status(p_user text, p_pass text, p_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email text;
  r record;
BEGIN
  IF NOT public.admin_check(p_user, p_pass) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
  SELECT email INTO v_email FROM public.artists WHERE id = p_id;
  SELECT created_at, sent_at, error INTO r
    FROM public.artist_email_outbox
   WHERE email = v_email
   ORDER BY created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('state', 'none');
  END IF;
  RETURN json_build_object(
    'state', CASE WHEN r.sent_at IS NOT NULL THEN 'sent'
                  WHEN r.error IS NOT NULL THEN 'error'
                  ELSE 'pending' END,
    'error', r.error, 'created_at', r.created_at, 'sent_at', r.sent_at);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_email_status(text, text, uuid) TO anon, authenticated;
