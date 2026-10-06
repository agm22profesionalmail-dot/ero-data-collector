create or replace function public.artists_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  did text;
begin
  if auth.uid() is null then
    return new;
  end if;
  select provider_id into did from auth.identities
   where user_id = auth.uid() and provider = 'discord';
  if did is null then
    raise exception 'no discord identity' using errcode = '28000';
  end if;
  if length(new.name) > 60 or length(new.portfolio) > 200 or length(new.reason) > 500 then
    raise exception 'field too long' using errcode = '22023';
  end if;
  new.discord_id := did;
  new.notes := null;
  return new;
end $$;

drop trigger if exists artists_insert_guard on public.artists;
create trigger artists_insert_guard
  before insert on public.artists
  for each row execute function public.artists_insert_guard();
  