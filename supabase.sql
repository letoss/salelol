-- Run this file once in Supabase Dashboard > SQL Editor.
create extension if not exists citext with schema extensions;

create or replace function public.current_lobby_week()
returns date language sql stable as $$
  with clock as (select now() at time zone 'Europe/Amsterdam' as local_now)
  select case
    when extract(dow from local_now) = 0 and local_now::time >= time '23:59' then local_now::date + 1
    else local_now::date - ((extract(dow from local_now)::integer + 6) % 7)
  end from clock;
$$;

create table if not exists public.players (
  game_date date not null default public.current_lobby_week(),
  name extensions.citext not null check (char_length(name) between 1 and 24),
  slots text[] not null default '{}',
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  owner_token_hash text,
  owner_token_hashes text[] not null default '{}',
  primary key (game_date, name)
);

create table if not exists public.matches (
  id uuid primary key,
  game_date date not null default current_date,
  match_time time not null,
  creator text not null check (char_length(creator) between 1 and 24),
  created_at timestamptz not null default now()
);

create table if not exists public.api_rate_limits (
  scope text not null,
  identifier text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (scope, identifier, window_start)
);

create table if not exists public.shared_matches (
  match_id text primary key,
  game_start timestamptz not null,
  duration_seconds integer not null default 0,
  queue_id integer,
  teams jsonb not null default '[]'::jsonb,
  shared_player_count integer not null check (shared_player_count >= 2),
  refreshed_at timestamptz not null default now()
);

create table if not exists public.live_game_cache (
  id smallint primary key default 1 check (id = 1),
  players jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now()
);
insert into public.live_game_cache(id,players,checked_at) values(1,'[]'::jsonb,to_timestamp(0)) on conflict(id) do nothing;

create index if not exists shared_matches_game_start_idx
on public.shared_matches (game_start desc);

create or replace function public.delete_expired_shared_matches()
returns void language sql security definer set search_path=public as $$
  delete from public.shared_matches where game_start < now()-interval '30 days';
$$;
revoke all on function public.delete_expired_shared_matches() from public, anon, authenticated;
grant execute on function public.delete_expired_shared_matches() to service_role;

create or replace function public.prune_shared_matches_after_write()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.delete_expired_shared_matches();
  return null;
end $$;
drop trigger if exists prune_shared_matches_after_write on public.shared_matches;
create trigger prune_shared_matches_after_write after insert or update on public.shared_matches
for each statement execute function public.prune_shared_matches_after_write();

alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.api_rate_limits enable row level security;
alter table public.shared_matches enable row level security;
alter table public.live_game_cache enable row level security;

create or replace function public.consume_api_rate_limit(rate_scope text, rate_identifier text, rate_limit integer, window_seconds integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare bucket timestamptz; used integer;
begin
  bucket := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
  insert into public.api_rate_limits(scope,identifier,window_start,request_count)
  values(rate_scope,rate_identifier,bucket,1)
  on conflict(scope,identifier,window_start) do update set request_count=public.api_rate_limits.request_count+1
  returning request_count into used;
  delete from public.api_rate_limits where window_start < now()-interval '2 days';
  return used <= rate_limit;
end $$;
revoke all on function public.consume_api_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text,text,integer,integer) to service_role;

-- This is an intentionally public friends-only board. No private data is stored.
create policy "Anyone can view current week players"
on public.players for select to anon using (game_date = public.current_lobby_week());

create policy "Anyone can view today's matches"
on public.matches for select to anon using (game_date = current_date);

create policy "Anyone can view shared matches"
on public.shared_matches for select to anon using (true);

revoke all on public.players from anon, authenticated;
grant select(game_date,name,slots,joined_at,last_seen) on public.players to anon, authenticated;
revoke all on public.matches from anon, authenticated;
grant select(id,game_date,match_time,creator,created_at) on public.matches to anon, authenticated;
revoke all on public.api_rate_limits from anon, authenticated;
revoke all on public.shared_matches from anon, authenticated;
grant select(match_id,game_start,duration_seconds,queue_id,teams,shared_player_count) on public.shared_matches to anon, authenticated;
revoke all on public.live_game_cache from anon, authenticated;

alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.matches;
