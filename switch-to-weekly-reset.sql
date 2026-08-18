-- Run once in Supabase Dashboard > SQL Editor.
create or replace function public.current_lobby_week()
returns date
language sql
stable
as $$
  with clock as (
    select now() at time zone 'Europe/Amsterdam' as local_now
  )
  select case
    when extract(dow from local_now) = 6 and local_now::time >= time '23:59'
      then local_now::date + 1
    else local_now::date - extract(dow from local_now)::integer
  end
  from clock;
$$;

grant execute on function public.current_lobby_week() to anon;

alter table public.players
alter column game_date set default public.current_lobby_week();

drop policy if exists "Anyone can view today's players" on public.players;
drop policy if exists "Anyone can join today's lobby" on public.players;
drop policy if exists "Anyone can update today's availability" on public.players;

create policy "Anyone can view current week players"
on public.players for select to anon
using (game_date = public.current_lobby_week());

create policy "Anyone can join current week lobby"
on public.players for insert to anon
with check (game_date = public.current_lobby_week());

create policy "Anyone can update current week availability"
on public.players for update to anon
using (game_date = public.current_lobby_week())
with check (game_date = public.current_lobby_week());
