-- ============================================================
-- Migración 2026-09-16 (01) — sin arma por defecto en players
-- El arma nunca se elige en la web (la asigna el equipo al montar la foto),
-- pero el default 0 dejaba a todo el mundo con el Splattershot.
-- -1 = "Sin arma": valor que ya entienden el plugin calico-configurator
-- (galería "Sin arma") y sync.py al escribir la ficha en el vault.
-- Idempotente: se puede ejecutar varias veces sin error.
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================

alter table public.players
  alter column weapon_main set default -1;

-- Fichas ya registradas: nadie eligió arma, el 0 venía del default anterior.
update public.players
   set weapon_main = -1
 where weapon_main = 0;
