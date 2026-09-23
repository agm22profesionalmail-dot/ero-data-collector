-- ============================================================
-- Migración 20260923_04: email al rechazar una solicitud de artista
--
-- Antes: "Rechazar" (admin_set_status → 'rejected') solo cambiaba el estado;
-- el solicitante no se enteraba de nada.
--
-- Ahora: admin_reject cambia el estado y deja en la cola artist_email_outbox
-- un email de tipo 'rejected' (sin clave ni enlace). La Edge Function
-- send-artist-credentials lo envía con su propia plantilla: la solicitud no
-- cumple los requisitos o no aporta información suficiente para ser válida.
--
-- admin_set_status sigue igual (revocar / reactivar / volver a pendiente).
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- ============================================================

-- 1) Tipo de email en la cola; los rechazos no tienen slug
ALTER TABLE public.artist_email_outbox
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'credentials';
ALTER TABLE public.artist_email_outbox DROP CONSTRAINT IF EXISTS artist_email_outbox_kind_check;
ALTER TABLE public.artist_email_outbox
  ADD CONSTRAINT artist_email_outbox_kind_check CHECK (kind IN ('credentials', 'rejected'));
ALTER TABLE public.artist_email_outbox ALTER COLUMN slug DROP NOT NULL;

-- 2) Encolar un aviso sin clave (de momento solo 'rejected') + avisar a la función
CREATE OR REPLACE FUNCTION public.queue_artist_notice(
  p_email TEXT, p_name TEXT, p_lang TEXT, p_kind TEXT
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
  IF p_kind NOT IN ('rejected') THEN
    RAISE EXCEPTION 'bad notice kind';
  END IF;

  INSERT INTO public.artist_email_outbox (email, name, slug, key, lang, reset, kind)
  VALUES (p_email, p_name, NULL, NULL, CASE WHEN p_lang = 'es' THEN 'es' ELSE 'en' END, false, p_kind)
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
REVOKE EXECUTE ON FUNCTION public.queue_artist_notice(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- 3) Rechazar + email. Solo envía si la solicitud estaba pendiente (rechazar
--    dos veces o rechazar a alguien ya revocado no manda nada).
CREATE OR REPLACE FUNCTION public.admin_reject(p_user text, p_pass text, p_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_status text; v_email text; v_name text; v_lang text;
  v_sent boolean := false;
begin
  if not public.admin_check(p_user, p_pass) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  select status, email, name, coalesce(preferred_lang, 'en')
    into v_status, v_email, v_name, v_lang
    from public.artists where id = p_id;
  if not found then
    raise exception 'artist not found' using errcode = '22004';
  end if;

  update public.artists set status = 'rejected' where id = p_id;

  if v_status = 'pending' and v_email is not null then
    v_sent := public.queue_artist_notice(v_email, v_name, v_lang, 'rejected');
  end if;
  return json_build_object('sent', v_sent, 'emailed', v_status = 'pending' and v_email is not null);
end $function$;
GRANT EXECUTE ON FUNCTION public.admin_reject(text, text, uuid) TO anon, authenticated;
