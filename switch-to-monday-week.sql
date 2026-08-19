-- Run once in Supabase Dashboard > SQL Editor before using the Monday-first UI.
-- It keeps Monday-Saturday availability, drops the previous Sunday, and leaves
-- the upcoming Sunday empty under the new Monday week key.
begin;

do $$
declare
  local_today date := (now() at time zone 'Europe/Amsterdam')::date;
  old_sunday date;
  new_monday date;
begin
  old_sunday := local_today - extract(dow from local_today)::integer;
  new_monday := old_sunday + 1;

  insert into public.players (game_date, name, slots, locked_in, joined_at, last_seen)
  select new_monday,
         name,
         array(
           select slot
           from unnest(slots) as slot
           where (slot::timestamptz at time zone 'Europe/Amsterdam')::date
                 between new_monday and new_monday + 6
         ),
         locked_in,
         joined_at,
         last_seen
  from public.players
  where game_date = old_sunday
  on conflict (game_date, name) do update
  set slots = array(
        select distinct slot
        from unnest(public.players.slots || excluded.slots) as slot
        where (slot::timestamptz at time zone 'Europe/Amsterdam')::date
              between new_monday and new_monday + 6
      ),
      locked_in = public.players.locked_in or excluded.locked_in,
      joined_at = least(public.players.joined_at, excluded.joined_at),
      last_seen = greatest(public.players.last_seen, excluded.last_seen);

  delete from public.players where game_date = old_sunday;
end $$;

create or replace function public.current_lobby_week()
returns date
language sql
stable
as $$
  with clock as (
    select now() at time zone 'Europe/Amsterdam' as local_now
  )
  select case
    when extract(dow from local_now) = 0 and local_now::time >= time '23:59'
      then local_now::date + 1
    else local_now::date - ((extract(dow from local_now)::integer + 6) % 7)
  end
  from clock;
$$;

grant execute on function public.current_lobby_week() to anon;

alter table public.players
alter column game_date set default public.current_lobby_week();

commit;
