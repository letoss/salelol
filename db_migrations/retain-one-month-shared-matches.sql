-- Run once in Supabase Dashboard > SQL Editor.
-- Keeps a rolling 30-day shared-match history and removes older match data daily.
begin;

create index if not exists shared_matches_game_start_idx
on public.shared_matches (game_start desc);

create or replace function public.delete_expired_shared_matches()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.shared_matches
  where game_start < now() - interval '30 days';
$$;

revoke all on function public.delete_expired_shared_matches() from public, anon, authenticated;
grant execute on function public.delete_expired_shared_matches() to service_role;

create or replace function public.prune_shared_matches_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.delete_expired_shared_matches();
  return null;
end;
$$;

drop trigger if exists prune_shared_matches_after_write on public.shared_matches;
create trigger prune_shared_matches_after_write
after insert or update on public.shared_matches
for each statement execute function public.prune_shared_matches_after_write();

commit;

-- pg_cron is available on hosted Supabase projects. This makes cleanup happen
-- even during a quiet month with no new Riot profile refreshes.
create extension if not exists pg_cron;
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'salelol-prune-shared-matches';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'salelol-prune-shared-matches',
    '17 3 * * *',
    'select public.delete_expired_shared_matches()'
  );
end $$;

select public.delete_expired_shared_matches();
