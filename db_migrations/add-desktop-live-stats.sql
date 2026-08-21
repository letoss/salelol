-- Temporary, opt-in live stats published by the SaleLoL Windows companion.
create table if not exists public.desktop_live_stats (
  riot_id extensions.citext primary key,
  champion_name text not null check (char_length(champion_name) between 1 and 40),
  kills smallint not null default 0 check (kills between 0 and 100),
  deaths smallint not null default 0 check (deaths between 0 and 100),
  assists smallint not null default 0 check (assists between 0 and 200),
  creep_score integer not null default 0 check (creep_score between 0 and 5000),
  ward_score numeric(8,2) not null default 0 check (ward_score between 0 and 10000),
  game_time_seconds integer not null default 0 check (game_time_seconds between 0 and 86400),
  game_mode text,
  updated_at timestamptz not null default now()
);

create index if not exists desktop_live_stats_updated_at_idx
on public.desktop_live_stats (updated_at desc);

alter table public.desktop_live_stats enable row level security;
revoke all on public.desktop_live_stats from anon, authenticated;
