-- SaleLoL database bootstrap.
-- Run once on a new Supabase project from Dashboard > SQL Editor.
begin;

create extension if not exists citext with schema extensions;

create or replace function public.current_lobby_week()
returns date language sql stable as $$
  with clock as (select now() at time zone 'Europe/Amsterdam' as local_now)
  select case
    when extract(dow from local_now)=0 and local_now::time>=time '23:59' then local_now::date+1
    else local_now::date-((extract(dow from local_now)::integer+6)%7)
  end from clock;
$$;

create table public.players (
  game_date date not null default public.current_lobby_week(),
  name extensions.citext not null check (char_length(name) between 1 and 24),
  slots text[] not null default '{}',
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  owner_token_hash text,
  owner_token_hashes text[] not null default '{}',
  primary key(game_date,name)
);
comment on column public.players.name is 'Case-insensitive Riot ID; original display casing is preserved.';

create table public.matches (
  id uuid primary key,
  game_date date not null default current_date,
  match_time time not null,
  creator text not null check (char_length(creator) between 1 and 24),
  created_at timestamptz not null default now()
);

create table public.riot_profiles (
  riot_id_normalized text primary key,
  riot_id text not null,
  puuid text unique not null,
  profile_icon_url text,
  rank_tier text,
  rank_display text,
  ranked_queue text,
  recent_games boolean[] not null default '{}',
  recent_match_summaries jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now()
);

create table public.shared_matches (
  match_id text primary key,
  game_start timestamptz not null,
  duration_seconds integer not null default 0,
  queue_id integer,
  teams jsonb not null default '[]'::jsonb,
  shared_player_count integer not null check (shared_player_count>=2),
  refreshed_at timestamptz not null default now()
);
create index shared_matches_game_start_idx on public.shared_matches(game_start desc);

create table public.live_game_cache (
  id smallint primary key default 1 check(id=1),
  players jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now()
);
insert into public.live_game_cache(id,players,checked_at) values(1,'[]',to_timestamp(0));

create table public.desktop_live_stats (
  riot_id extensions.citext primary key,
  champion_name text not null check(char_length(champion_name) between 1 and 40),
  kills smallint not null default 0 check(kills between 0 and 100),
  deaths smallint not null default 0 check(deaths between 0 and 100),
  assists smallint not null default 0 check(assists between 0 and 200),
  creep_score integer not null default 0 check(creep_score between 0 and 5000),
  ward_score numeric(8,2) not null default 0 check(ward_score between 0 and 10000),
  game_time_seconds integer not null default 0 check(game_time_seconds between 0 and 86400),
  game_mode text,
  game_result text check(game_result in ('win','loss')),
  updated_at timestamptz not null default now()
);
create index desktop_live_stats_updated_at_idx on public.desktop_live_stats(updated_at desc);

create table public.post_game_reports (
  game_id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index post_game_reports_created_at_idx on public.post_game_reports(created_at desc);

create table public.api_rate_limits (
  scope text not null,
  identifier text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key(scope,identifier,window_start)
);

create or replace function public.consume_api_rate_limit(rate_scope text,rate_identifier text,rate_limit integer,window_seconds integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare bucket timestamptz; used integer;
begin
  bucket:=to_timestamp(floor(extract(epoch from now())/window_seconds)*window_seconds);
  insert into public.api_rate_limits(scope,identifier,window_start,request_count)
  values(rate_scope,rate_identifier,bucket,1)
  on conflict(scope,identifier,window_start) do update set request_count=public.api_rate_limits.request_count+1
  returning request_count into used;
  delete from public.api_rate_limits where window_start<now()-interval '2 days';
  return used<=rate_limit;
end $$;

create or replace function public.delete_expired_shared_matches()
returns void language sql security definer set search_path=public as $$
  delete from public.shared_matches where game_start<now()-interval '30 days';
$$;

create or replace function public.prune_shared_matches_after_write()
returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.delete_expired_shared_matches(); return null; end $$;
create trigger prune_shared_matches_after_write after insert or update on public.shared_matches
for each statement execute function public.prune_shared_matches_after_write();

create or replace function public.cleanup_invalid_players(p_dry_run boolean default true)
returns table(player_name text,deleted boolean) language plpgsql security definer set search_path='' as $$
begin
  if p_dry_run then
    return query select p.name::text,false from public.players p
      where not exists(select 1 from public.riot_profiles rp where rp.riot_id_normalized=lower(p.name)) order by p.joined_at;
  else
    return query delete from public.players p
      where not exists(select 1 from public.riot_profiles rp where rp.riot_id_normalized=lower(p.name)) returning p.name::text,true;
  end if;
end $$;

alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.riot_profiles enable row level security;
alter table public.shared_matches enable row level security;
alter table public.live_game_cache enable row level security;
alter table public.desktop_live_stats enable row level security;
alter table public.post_game_reports enable row level security;
alter table public.api_rate_limits enable row level security;

create policy "Public current-week players" on public.players for select to anon using(game_date=public.current_lobby_week());
create policy "Public current-day matches" on public.matches for select to anon using(game_date=current_date);
create policy "Public Riot profiles" on public.riot_profiles for select to anon using(true);
create policy "Public shared matches" on public.shared_matches for select to anon using(true);

revoke all on all tables in schema public from anon,authenticated;
grant select(game_date,name,slots,joined_at,last_seen) on public.players to anon,authenticated;
grant select(id,game_date,match_time,creator,created_at) on public.matches to anon,authenticated;
grant select(riot_id,profile_icon_url,rank_tier,rank_display,ranked_queue,recent_games,recent_match_summaries,refreshed_at) on public.riot_profiles to anon,authenticated;
grant select(match_id,game_start,duration_seconds,queue_id,teams,shared_player_count) on public.shared_matches to anon,authenticated;

revoke all on function public.consume_api_rate_limit(text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.delete_expired_shared_matches() from public,anon,authenticated;
revoke all on function public.cleanup_invalid_players(boolean) from public,anon,authenticated;
grant execute on function public.current_lobby_week() to anon,authenticated,service_role;
grant execute on function public.consume_api_rate_limit(text,text,integer,integer) to service_role;
grant execute on function public.delete_expired_shared_matches() to service_role;
grant execute on function public.cleanup_invalid_players(boolean) to postgres,service_role;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='players') then alter publication supabase_realtime add table public.players; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='matches') then alter publication supabase_realtime add table public.matches; end if;
end $$;

commit;
