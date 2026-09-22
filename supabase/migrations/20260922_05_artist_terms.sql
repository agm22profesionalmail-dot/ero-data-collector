-- ============================================================
-- Migración 2026-09-22 (05) — Términos del programa beta de artistas
--
-- La web (js/artist_terms.js) muestra los términos en el formulario de
-- solicitud (?apply) y exige aceptarlos. Aquí se deja constancia en la BD:
--   - terms_version      : versión aceptada (la manda la web, p. ej. 'v1-2026-09-22').
--   - terms_accepted_at  : cuándo. La pone un trigger con la hora del
--                          servidor; el cliente no puede falsearla.
--
-- La política artists_request_insert (última versión: 20260920_06) se
-- recrea IGUAL + "terms_version is not null": sin aceptar los términos no
-- se puede enviar una solicitud, aunque alguien salte la web.
--
-- ORDEN DE DESPLIEGUE: ejecutar esta migración ANTES de publicar la web que
-- envía terms_version (si no, el insert falla por columna desconocida).
-- Las 4 filas existentes (1 aprobada + 3 pendientes del 2026-09-22) quedan
-- con terms_version NULL = no han aceptado los términos.
--
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Idempotente: se puede ejecutar varias veces sin error.
-- ============================================================

alter table public.artists
  add column if not exists terms_version     text,
  add column if not exists terms_accepted_at timestamptz;

-- Hora del servidor al aceptar (insert con términos, o cambio de versión).
create or replace function public.artists_stamp_terms()
returns trigger
language plpgsql
as $$
begin
  if new.terms_version is null then
    new.terms_accepted_at := null;
  elsif tg_op = 'INSERT' or new.terms_version is distinct from old.terms_version then
    new.terms_accepted_at := now();
  else
    new.terms_accepted_at := old.terms_accepted_at;
  end if;
  return new;
end;
$$;

drop trigger if exists artists_stamp_terms on public.artists;
create trigger artists_stamp_terms
  before insert or update of terms_version, terms_accepted_at on public.artists
  for each row execute function public.artists_stamp_terms();

-- Política INSERT de solicitud: la de 20260920_06 + términos aceptados.
drop policy if exists artists_request_insert on public.artists;
create policy artists_request_insert on public.artists
  for insert to authenticated
  with check (
    status = 'pending'
    and slug is null
    and access_key_hash is null
    and approved_at is null
    and email is not null
    and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and length(email) between 5 and 320
    and preferred_lang in ('en','es')
    and terms_version is not null
    and length(terms_version) between 1 and 40
  );
