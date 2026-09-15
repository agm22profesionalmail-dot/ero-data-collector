-- ============================================================
-- Migración 2026-09-15 (02) — identidad de players desde auth.identities
-- Idempotente. Ejecutar DESPUÉS de 20260915_01_x_identity.sql (por seguridad
-- este fichero vuelve a crear las columnas x_* si faltan, así el trigger nunca
-- falla por columnas inexistentes).
--
-- Qué hace: un trigger BEFORE INSERT OR UPDATE en public.players rellena
-- discord_id / discord_name / discord_avatar y x_id / x_username / x_avatar
-- leyendo auth.identities del new.user_id, e IGNORA lo que mande el cliente.
-- Así ningún usuario puede escribirse una identidad ajena en su ficha.
--
-- Requisitos: ejecutarlo desde el SQL Editor del panel (rol postgres), que es
-- el owner de la función y tiene permisos sobre auth.identities. La función es
-- security definer con search_path vacío (todo va cualificado por esquema).
-- ============================================================

-- 1) Columnas (repetido a propósito, idempotente)
alter table public.players
  add column if not exists x_id       text,
  add column if not exists x_username text,
  add column if not exists x_avatar   text;

-- 2) Función
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
  -- Discord
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

  -- X (Supabase puede etiquetar la identidad OAuth 2.0 como 'x' o 'twitter')
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

-- No se expone por la API (devuelve trigger; PostgREST no puede invocarla), pero
-- por higiene se retira el execute a los roles de la API.
revoke execute on function public.players_fill_identity() from public, anon, authenticated;

-- 3) Trigger (se ejecuta antes que players_set_updated_at por orden alfabético)
drop trigger if exists players_fill_identity on public.players;
create trigger players_fill_identity
  before insert or update on public.players
  for each row execute function public.players_fill_identity();

-- 4) Rellenar las filas existentes (dispara el trigger; no cambia nada más)
update public.players set user_id = user_id;
