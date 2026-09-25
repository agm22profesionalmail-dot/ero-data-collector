-- ============================================================
-- 20260925_02 — Avisos libres por email desde zerosplatoon22
-- ============================================================
-- Regla de Zero (2026-09-25): los correos a artistas / jugadores / comunidad
-- salen SIEMPRE de zerosplatoon22@gmail.com (GMAIL_USER de la Edge Function
-- send-artist-credentials), nunca del correo personal.
--
-- La cola artist_email_outbox admite kind = 'custom' con asunto y texto
-- libres. admin_send_email() los encola y avisa a la función, que los envía
-- con una plantilla mínima (texto + HTML sencillo). Si Gmail lo rechaza, la
-- función cae a un DM de Pelipper (si el email es de un artista con Discord).
--
-- Se llama con las credenciales admin (p_user / p_pass) o con la service_role
-- (script local 08_Scripts/ero_data_collector/enviar_email.py).
-- Idempotente: se puede ejecutar varias veces sin error.
-- ============================================================

alter table public.artist_email_outbox
  add column if not exists subject text,
  add column if not exists body    text;

alter table public.artist_email_outbox drop constraint if exists artist_email_outbox_kind_check;
alter table public.artist_email_outbox
  add constraint artist_email_outbox_kind_check check (kind in ('credentials', 'rejected', 'custom'));

create or replace function public.admin_send_email(
  p_user    text,
  p_pass    text,
  p_email   text,
  p_name    text,
  p_subject text,
  p_body    text,
  p_lang    text default 'en'
) returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id  uuid;
  v_url text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.admin_check(p_user, p_pass) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_email is null
     or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or length(p_email) not between 5 and 320
     or coalesce(trim(p_subject), '') = '' or length(p_subject) > 200
     or coalesce(trim(p_body), '') = ''    or length(p_body) > 10000 then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  insert into public.artist_email_outbox (email, name, slug, key, lang, reset, kind, subject, body)
  values (trim(p_email), nullif(trim(coalesce(p_name, '')), ''), null, null,
          case when p_lang = 'es' then 'es' else 'en' end, false, 'custom',
          trim(p_subject), p_body)
  returning id into v_id;

  select v into v_url from public.app_secrets where k = 'send_email_url';
  if v_url is null then
    update public.artist_email_outbox set error = 'send_email_url not configured' where id = v_id;
    return json_build_object('id', v_id, 'queued', false);
  end if;

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('id', v_id),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 20000
  );
  return json_build_object('id', v_id, 'queued', true);
end $$;

revoke all on function public.admin_send_email(text, text, text, text, text, text, text) from public;
grant execute on function public.admin_send_email(text, text, text, text, text, text, text) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
