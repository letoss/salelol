-- Run this once in Supabase Dashboard > SQL Editor.
alter table public.players
add column if not exists last_seen timestamptz not null default now();
