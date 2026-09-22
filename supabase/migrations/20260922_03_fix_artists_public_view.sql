-- ============================================================
-- Migración 20260922_03: arreglar la vista artists_public
--
-- La vista (security_invoker) filtraba `where status = 'approved'`, pero
-- anon/authenticated solo tienen grant de columnas (id, name, slug) sobre
-- public.artists → "permission denied for table artists" y el ?ref del
-- artista no se resolvía nunca.
--
-- El filtro sobra: la política RLS artists_public_select ya limita las filas
-- visibles a status = 'approved' (las políticas no exigen grant de columna).
-- La web (js/artists.js) ya consulta `artists` directamente; esto solo deja la
-- vista coherente por si algo más la usa.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run
-- ============================================================
create or replace view public.artists_public
  with (security_invoker = true) as
  select id, name, slug
  from public.artists;

grant select on public.artists_public to anon, authenticated;
