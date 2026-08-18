-- Run this once in Supabase Dashboard > SQL Editor.
alter table public.players
alter column game_date set default ((now() at time zone 'Europe/Amsterdam')::date);

drop policy if exists "Anyone can view today's players" on public.players;
drop policy if exists "Anyone can join today's lobby" on public.players;
drop policy if exists "Anyone can update today's availability" on public.players;

create policy "Anyone can view today's players"
on public.players for select to anon
using (game_date = (now() at time zone 'Europe/Amsterdam')::date);

create policy "Anyone can join today's lobby"
on public.players for insert to anon
with check (game_date = (now() at time zone 'Europe/Amsterdam')::date);

create policy "Anyone can update today's availability"
on public.players for update to anon
using (game_date = (now() at time zone 'Europe/Amsterdam')::date)
with check (game_date = (now() at time zone 'Europe/Amsterdam')::date);
