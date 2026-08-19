-- Run this once in Supabase Dashboard > SQL Editor.
alter table public.players
add column if not exists locked_in boolean not null default false;
