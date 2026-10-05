alter table public.players
  add column if not exists x_id       text,
  add column if not exists x_username text,
  add column if not exists x_avatar   text;

create or replace function public.players_fill_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d_pid  text;
  d_data jsonb;
  x_pid  text;
  x_data jsonb;
begin
  select i.provider_id, i.identity_data
    into d_pid, d_data
    from auth.identities i
   where i.user_id = new.user_id and i.provider = 'discord'
   order by i.created_at
   limit 1;

  if d_pid is not null then
    new.discord_id     := d_pid;
    new.discord_name   := coalesce(d_data->'custom_claims'->>'global_name',
                                   d_data->>'full_name', d_data->>'name', d_data->>'user_name');
    new.discord_avatar := coalesce(d_data->>'avatar_url', d_data->>'picture');
  else
    new.discord_id := null; new.discord_name := null; new.discord_avatar := null;
  end if;

  select i.provider_id, i.identity_data
    into x_pid, x_data
    from auth.identities i
   where i.user_id = new.user_id and i.provider in ('x', 'twitter')
   order by i.created_at
   limit 1;

  if x_pid is not null then
    new.x_id       := x_pid;
    new.x_username := nullif(ltrim(coalesce(x_data->>'user_name', x_data->>'preferred_username',
                                            x_data->>'username', x_data->>'screen_name', ''), '@'), '');
    new.x_avatar   := coalesce(x_data->>'avatar_url', x_data->>'picture', x_data->>'profile_image_url');
  else
    new.x_id := null; new.x_username := null; new.x_avatar := null;
  end if;

  return new;
end;
$$;

revoke execute on function public.players_fill_identity() from public, anon, authenticated;

drop trigger if exists players_fill_identity on public.players;
create trigger players_fill_identity
  before insert or update on public.players
  for each row execute function public.players_fill_identity();

update public.players set user_id = user_id;
