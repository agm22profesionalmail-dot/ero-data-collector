alter table public.players
  alter column weapon_main set default -1;

update public.players
   set weapon_main = -1
 where weapon_main = 0;
