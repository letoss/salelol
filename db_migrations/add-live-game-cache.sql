-- Cache Spectator API results so every open browser shares the same Riot lookup.
create table if not exists public.live_game_cache (
  id smallint primary key default 1 check (id = 1),
  players jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now()
);

alter table public.live_game_cache enable row level security;
revoke all on public.live_game_cache from anon, authenticated;

insert into public.live_game_cache (id, players, checked_at)
values (1, '[]'::jsonb, to_timestamp(0))
on conflict (id) do nothing;
