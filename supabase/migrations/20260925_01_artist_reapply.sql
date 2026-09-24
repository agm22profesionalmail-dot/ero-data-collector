-- ============================================================
-- 20260925_01 — Volver a solicitar acceso de artista tras un rechazo
-- ============================================================
-- Antes: la solicitud es un INSERT en public.artists y discord_id es único.
-- Si el artista fue rechazado, su fila seguía ahí → el INSERT fallaba con
-- 23505 y la web decía "Ya tienes una solicitud pendiente", sin forma de
-- apelar. Está permitido volver a pedir acceso tras un rechazo.
--
-- artist_reapply(): la web la llama cuando el INSERT da 23505. Solo actúa
-- sobre la fila del Discord del usuario logueado (auth.identities):
--   rejected → vuelve a 'pending' con los datos nuevos → 'reapplied'
--   pending  → sin cambios → 'pending'
--   approved / revoked / otro → sin cambios → el estado
-- Mismas validaciones que la política artists_request_insert.
-- Idempotente: se puede ejecutar varias veces sin error.
-- ============================================================

create or replace function public.artist_reapply(
  p_discord_id    text,
  p_name          text,
  p_email         text,
  p_portfolio     text,
  p_reason        text,
  p_lang          text,
  p_terms_version text
) returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (
    select 1 from auth.identities i
     where i.user_id = auth.uid() and i.provider = 'discord' and i.provider_id = p_discord_id
  ) then
    raise exception 'discord id does not match session' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = ''
     or p_email is null
     or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or length(p_email) not between 5 and 320
     or p_lang not in ('en', 'es')
     or p_terms_version is null
     or length(p_terms_version) not between 1 and 40 then
    raise exception 'invalid request' using errcode = '22023';
  end if;

  select id, status into v_id, v_status
    from public.artists where discord_id = p_discord_id
    for update;
  if not found then
    return 'missing';
  end if;
  if v_status <> 'rejected' then
    return v_status;
  end if;

  update public.artists set
    status          = 'pending',
    name            = trim(p_name),
    email           = trim(p_email),
    portfolio       = nullif(trim(coalesce(p_portfolio, '')), ''),
    reason          = nullif(trim(coalesce(p_reason, '')), ''),
    preferred_lang  = p_lang,
    terms_version   = p_terms_version,
    terms_accepted_at = now(),
    slug            = null,
    access_key_hash = null,
    approved_at     = null,
    created_at      = now()
  where id = v_id;
  return 'reapplied';
end $$;

revoke all on function public.artist_reapply(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.artist_reapply(text, text, text, text, text, text, text) to authenticated;
notify pgrst, 'reload schema';
