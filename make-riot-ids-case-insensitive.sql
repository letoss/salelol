-- Run once in the Supabase SQL Editor.
-- PostgreSQL will then treat Test#123, TesT#123 and test#123 as the same player.

create extension if not exists citext with schema extensions;

do $$
begin
  if exists (
    select 1
    from public.players
    group by game_date, lower(name)
    having count(*) > 1
  ) then
    raise exception 'Case-only duplicate players already exist. Remove the duplicates before running this migration.';
  end if;
end;
$$;

alter table public.players
  alter column name type extensions.citext
  using name::extensions.citext;

comment on column public.players.name is
  'Riot ID matched case-insensitively; original display casing is preserved.';
