-- Run once in Supabase Dashboard > SQL Editor before deploying protected functions.
begin;

alter table public.players add column if not exists owner_token_hash text;
alter table public.players add column if not exists owner_token_hashes text[] not null default '{}';
update public.players set owner_token_hashes=array[owner_token_hash]
where owner_token_hash is not null and not owner_token_hash=any(owner_token_hashes);

create table if not exists public.api_rate_limits (
  scope text not null,
  identifier text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (scope, identifier, window_start)
);
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from anon, authenticated;

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

drop policy if exists "Anyone can join current week lobby" on public.players;
drop policy if exists "Anyone can update current week availability" on public.players;
drop policy if exists "Anyone can propose today's matches" on public.matches;
drop policy if exists "Anyone can remove today's match proposals" on public.matches;

revoke all on public.players from anon, authenticated;
grant select(game_date,name,slots,locked_in,joined_at,last_seen) on public.players to anon, authenticated;
revoke all on public.matches from anon, authenticated;
grant select(id,game_date,match_time,creator,created_at) on public.matches to anon, authenticated;

commit;
