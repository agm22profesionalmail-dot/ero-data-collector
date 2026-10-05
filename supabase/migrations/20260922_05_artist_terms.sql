alter table public.artists
  add column if not exists terms_version     text,
  add column if not exists terms_accepted_at timestamptz;

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
