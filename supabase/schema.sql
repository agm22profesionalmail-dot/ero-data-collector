-- ============================================================
-- ERO_Data_Collector — Esquema Supabase
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================

-- ------------------------------------------------------------
-- Tabla players (1 ficha de personaje por usuario Discord)
-- Campos de config = espejo exacto de PlayerConfig.json del plugin Calico
-- ------------------------------------------------------------
create table if not exists public.players (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid()
                    references auth.users (id) on delete cascade,

  -- Identidad (display; la autorización va por user_id + RLS, no por estos campos)
  alias           text not null,
  discord_id      text,                 -- provider_id (snowflake) estable, solo referencia
  discord_name    text,
  discord_avatar  text,

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
  weapon_main           int  not null default 0,
  anim_name             text not null default 'AW_BrandPoseCollectionA',
  color                 jsonb not null default '{"r":1.0,"g":1.0,"b":1.0,"a":1.0}'::jsonb,

  -- Banner Splattag
  banner_path     text,                 -- ruta dentro del bucket 'banners' (= "<user_id>/banner.png")
  banner_sha256   text,                 -- hash del PNG subido (informativo)

  -- Auditoría
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 1 fila por usuario (permite upsert por user_id)
create unique index if not exists players_user_id_uniq on public.players (user_id);

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
