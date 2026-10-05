create or replace view public.artists_public
  with (security_invoker = true) as
  select id, name, slug
  from public.artists;

grant select on public.artists_public to anon, authenticated;
