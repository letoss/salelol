create table if not exists public.riot_profiles (
  riot_id_normalized text primary key,
  riot_id text not null,
  puuid text unique not null,
  profile_icon_url text,
  rank_tier text,
  rank_display text,
  ranked_queue text,
  recent_games boolean[] not null default '{}',
  refreshed_at timestamptz not null default now()
);

alter table public.riot_profiles enable row level security;

drop policy if exists "Anyone can view Riot profiles" on public.riot_profiles;
create policy "Anyone can view Riot profiles"
on public.riot_profiles for select to anon using (true);
