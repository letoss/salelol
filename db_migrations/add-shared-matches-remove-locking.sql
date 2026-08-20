-- Run once in Supabase Dashboard > SQL Editor.
begin;

create table if not exists public.shared_matches (
  match_id text primary key,
  game_start timestamptz not null,
  duration_seconds integer not null default 0,
  queue_id integer,
  teams jsonb not null default '[]'::jsonb,
  shared_player_count integer not null check (shared_player_count >= 2),
  refreshed_at timestamptz not null default now()
);

alter table public.shared_matches enable row level security;
drop policy if exists "Anyone can view shared matches" on public.shared_matches;
create policy "Anyone can view shared matches"
on public.shared_matches for select to anon using (true);
revoke all on public.shared_matches from anon, authenticated;
grant select(match_id,game_start,duration_seconds,queue_id,teams,shared_player_count)
on public.shared_matches to anon, authenticated;

alter table public.players drop column if exists locked_in;
revoke all on public.players from anon, authenticated;
grant select(game_date,name,slots,joined_at,last_seen) on public.players to anon, authenticated;

commit;
