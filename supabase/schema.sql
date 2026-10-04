-- ============================================================
-- ERO_Data_Collector — Esquema Supabase
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================

-- ------------------------------------------------------------
-- Tabla players (1..3 fichas de personaje por usuario; slot 0 = principal)
-- Campos de config = espejo exacto de PlayerConfig.json del plugin Calico
-- ------------------------------------------------------------
create table if not exists public.players (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid()
                    references auth.users (id) on delete cascade,
  slot            smallint not null default 0
                    constraint players_slot_chk check (slot between 0 and 2),  -- 0 = principal; 1..2 = extras (character_perks)

  -- Identidad (display; la autorización va por user_id + RLS, no por estos campos)
  alias           text not null,
  discord_id      text,                 -- provider_id (snowflake) estable, solo referencia
  discord_name    text,
  discord_avatar  text,
  x_id            text,                 -- id numérico de X (estable), solo referencia
  x_username      text,                 -- @handle de X sin la arroba
  x_avatar        text,

  -- Config Splatoon (mismos nombres/tipos que PlayerConfig.json)
  player_type           int  not null default 0,
  hair                  int  not null default 0,
  bottom                int  not null default 0,
  bottom_variation      int  not null default 0,
  skin_tone             int  not null default 0,
  eye_brows             int  not null default 0,
  eye_color             int  not null default 0,
  gear_head             int  not null default 0,
  gear_head_variation   int  not null default 0,
  gear_cloth            int  not null default 0,
  gear_cloth_variation  int  not null default 0,
  gear_shoes            int  not null default 0,
  gear_shoes_variation  int  not null default 0,
  weapon_main           int  not null default -1,   -- -1 = sin arma (no se elige en la web)
  anim_name             text not null default 'AW_BrandPoseCollectionA',
  color                 jsonb not null default '{"r":1.0,"g":1.0,"b":1.0,"a":1.0}'::jsonb,

  -- Banner Splattag
  banner_path     text,                 -- ruta dentro del bucket 'banners' (= "<user_id>/banner.png"; extras: "<user_id>/banner_c<slot>.png")
  banner_sha256   text,                 -- hash del PNG subido (informativo)
  splattag_config jsonb,                -- config del generador (null = subida manual; solo lo tienen quienes usaron el generador)

  -- Auditoría
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 1 fila por (usuario, slot) (upsert con onConflict 'user_id,slot'). Sustituye a players_user_id_uniq.
create unique index if not exists players_user_slot_uniq on public.players (user_id, slot);
create index if not exists players_user_id_idx on public.players (user_id);
-- Búsqueda por @handle de X (case-insensitive)
create index if not exists players_x_username_idx on public.players (lower(x_username));

-- ------------------------------------------------------------
-- RLS — OBLIGATORIO activarlo (NO viene por defecto en SQL puro)
-- ------------------------------------------------------------
alter table public.players enable row level security;

drop policy if exists "players_select_own" on public.players;
create policy "players_select_own"
  on public.players for select
  to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "players_insert_own" on public.players;
create policy "players_insert_own"
  on public.players for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "players_update_own" on public.players;
create policy "players_update_own"
  on public.players for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "players_delete_own" on public.players;
create policy "players_delete_own"
  on public.players for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- Nota: el sync local usa la service_role key (servidor de confianza),
-- que IGNORA RLS y puede leer todas las fichas. NUNCA exponer esa key.

-- ------------------------------------------------------------
-- Trigger updated_at
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists players_set_updated_at on public.players;
create trigger players_set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Identidad desde auth.identities (= migrations/20260915_02_identity_trigger.sql)
-- BEFORE INSERT OR UPDATE: rellena discord_* y x_* del new.user_id leyendo
-- auth.identities e ignora lo que mande el cliente. security definer con
-- search_path vacío; owner = postgres (SQL Editor), con acceso a auth.identities.
-- ------------------------------------------------------------
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
  select i.provider_id, i.identity_data into d_pid, d_data
    from auth.identities i
   where i.user_id = new.user_id and i.provider = 'discord'
   order by i.created_at limit 1;
  if d_pid is not null then
    new.discord_id     := d_pid;
    new.discord_name   := coalesce(d_data->'custom_claims'->>'global_name',
                                   d_data->>'full_name', d_data->>'name', d_data->>'user_name');
    new.discord_avatar := coalesce(d_data->>'avatar_url', d_data->>'picture');
  else
    new.discord_id := null; new.discord_name := null; new.discord_avatar := null;
  end if;

  select i.provider_id, i.identity_data into x_pid, x_data
    from auth.identities i
   where i.user_id = new.user_id and i.provider in ('x', 'twitter')
   order by i.created_at limit 1;
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

-- ------------------------------------------------------------
-- Storage — bucket 'banners' (privado, solo PNG, 2 MB)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banners', 'banners', false, 2097152, array['image/png'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = excluded.public;

-- Cada usuario solo gestiona archivos dentro de su carpeta "<user_id>/..."
drop policy if exists "banner_insert_own" on storage.objects;
create policy "banner_insert_own" on storage.objects for insert to authenticated
  with check ( bucket_id = 'banners'
    and (storage.foldername(name))[1] = (select auth.uid())::text );

drop policy if exists "banner_update_own" on storage.objects;
create policy "banner_update_own" on storage.objects for update to authenticated
  using ( bucket_id = 'banners'
    and (storage.foldername(name))[1] = (select auth.uid())::text )
  with check ( bucket_id = 'banners'
    and (storage.foldername(name))[1] = (select auth.uid())::text );

drop policy if exists "banner_select_own" on storage.objects;
create policy "banner_select_own" on storage.objects for select to authenticated
  using ( bucket_id = 'banners'
    and (storage.foldername(name))[1] = (select auth.uid())::text );

-- IMPORTANTE: allowed_mime_types y file_size_limit NO son antivirus.
-- La validación real (magic bytes + re-encode Pillow + Defender) la hace el sync local.

-- ------------------------------------------------------------
-- Anti-pausa: RPC público trivial que mantiene viva la BBDD
-- Lo llama un GitHub Action cron semanal con la anon key.
-- ------------------------------------------------------------
create or replace function public.keep_alive()
returns timestamptz language sql security definer set search_path = public as $$
  select now();
$$;
grant execute on function public.keep_alive() to anon, authenticated;

-- ------------------------------------------------------------
-- Migración: columna splattag_config (si el schema ya existía antes de añadirla)
-- Ejecutar solo una vez en instalaciones existentes.
-- ------------------------------------------------------------
alter table public.players add column if not exists splattag_config jsonb;

-- Migración: identidad X (2026-09-15). Equivale a supabase/migrations/20260915_01_x_identity.sql
alter table public.players
  add column if not exists x_id text,
  add column if not exists x_username text,
  add column if not exists x_avatar text;

-- ------------------------------------------------------------
-- Varios personajes por perfil (= migrations/20261004_01_multi_personaje.sql)
-- Límite por identidad Discord en character_perks (solo service_role), función
-- my_character_limit() y triggers de límite/slot. Las RPC artist_link,
-- artist_save_char (p_player_id), artist_group (player_id, slot), admin_ban,
-- admin_list y admin_edc_overview viven en esa migración (versión vigente).
-- ------------------------------------------------------------
create table if not exists public.character_perks (
  discord_id     text primary key,
  max_characters smallint not null default 3 check (max_characters between 1 and 3),
  source         text not null check (source in ('discord_role', 'manual')),
  updated_at     timestamptz not null default now()
);
alter table public.character_perks enable row level security;   -- sin políticas: solo service_role
revoke all on public.character_perks from public, anon, authenticated;

create or replace function public.my_character_limit()
returns int language sql stable security definer set search_path = '' as $$
  select coalesce((
    select max(cp.max_characters)::int
      from public.character_perks cp
      join auth.identities i on i.provider = 'discord' and i.provider_id = cp.discord_id
     where i.user_id = auth.uid()), 1);
$$;
revoke execute on function public.my_character_limit() from public, anon;
grant  execute on function public.my_character_limit() to authenticated;

create or replace function public.players_enforce_char_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit int;
begin
  if auth.uid() is null then return new; end if;
  -- upsert sobre una ficha existente (ON CONFLICT ejecuta este trigger antes): no es ficha nueva
  if exists (select 1 from public.players p where p.user_id = new.user_id and p.slot = new.slot) then
    return new;
  end if;
  v_limit := public.my_character_limit();
  if (select count(*) from public.players p where p.user_id = new.user_id) >= v_limit
     or new.slot >= v_limit then
    raise exception 'character_limit' using hint = 'max=' || v_limit::text;
  end if;
  return new;
end; $$;
revoke execute on function public.players_enforce_char_limit() from public, anon, authenticated;
drop trigger if exists b_players_char_limit on public.players;
create trigger b_players_char_limit before insert on public.players
  for each row execute function public.players_enforce_char_limit();

create or replace function public.players_slot_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.slot is distinct from old.slot then
    raise exception 'slot_immutable';
  end if;
  return new;
end; $$;
revoke execute on function public.players_slot_immutable() from public, anon, authenticated;
drop trigger if exists b_players_slot_immutable on public.players;
create trigger b_players_slot_immutable before update on public.players
  for each row execute function public.players_slot_immutable();
