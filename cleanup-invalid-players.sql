-- Install once from the Supabase SQL Editor.
-- Preview: select * from public.cleanup_invalid_players();
-- Delete:  select * from public.cleanup_invalid_players(false);

create or replace function public.cleanup_invalid_players(p_dry_run boolean default true)
returns table(player_name text, deleted boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_dry_run then
    return query
      select p.name::text, false
      from public.players as p
      where not exists (
        select 1
        from public.riot_profiles as rp
        where rp.riot_id_normalized = lower(p.name)
      )
      order by p.joined_at;
  else
    return query
      delete from public.players as p
      where not exists (
        select 1
        from public.riot_profiles as rp
        where rp.riot_id_normalized = lower(p.name)
      )
      returning p.name::text, true;
  end if;
end;
$$;

comment on function public.cleanup_invalid_players(boolean) is
  'Preview or delete lobby players that have no cached Riot profile.';

-- Keep this maintenance function unavailable to the public SPA.
revoke all on function public.cleanup_invalid_players(boolean) from public;
revoke all on function public.cleanup_invalid_players(boolean) from anon;
revoke all on function public.cleanup_invalid_players(boolean) from authenticated;
grant execute on function public.cleanup_invalid_players(boolean) to postgres;
grant execute on function public.cleanup_invalid_players(boolean) to service_role;
