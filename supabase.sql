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
  locked_in boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  owner_token_hash text,
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

alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.api_rate_limits enable row level security;

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

revoke all on public.players from anon, authenticated;
grant select(game_date,name,slots,locked_in,joined_at,last_seen) on public.players to anon, authenticated;
revoke all on public.matches from anon, authenticated;
grant select(id,game_date,match_time,creator,created_at) on public.matches to anon, authenticated;
revoke all on public.api_rate_limits from anon, authenticated;

alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.matches;
