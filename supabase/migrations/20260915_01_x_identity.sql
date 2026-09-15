-- ============================================================
-- Migración 2026-09-15 (01) — identidad X (Twitter) en players
-- Ejecutar ANTES de activar X_LOGIN_ENABLED en js/config.js (y antes del merge).
-- Después: 20260915_02_identity_trigger.sql.
-- Idempotente: se puede ejecutar varias veces sin error.
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
-- No toca las políticas RLS (siguen siendo por user_id).
-- ============================================================

alter table public.players
  add column if not exists x_id       text,   -- id numérico de la cuenta de X (estable)
  add column if not exists x_username text,   -- @handle sin la arroba (puede cambiar)
  add column if not exists x_avatar   text;   -- URL del avatar de X

create index if not exists players_x_username_idx
  on public.players (lower(x_username));
