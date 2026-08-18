-- Run this file once in Supabase Dashboard > SQL Editor.
create table if not exists public.players (
  game_date date not null default current_date,
  name text not null check (char_length(name) between 1 and 24),
  slots text[] not null default '{}',
  locked_in boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (game_date, name)
);

create table if not exists public.matches (
  id uuid primary key,
  game_date date not null default current_date,
  match_time time not null,
  creator text not null check (char_length(creator) between 1 and 24),
  created_at timestamptz not null default now()
);

alter table public.players enable row level security;
alter table public.matches enable row level security;

-- This is an intentionally public friends-only board. No private data is stored.
create policy "Anyone can view today's players"
on public.players for select to anon using (game_date = current_date);

create policy "Anyone can join today's lobby"
on public.players for insert to anon with check (game_date = current_date);

create policy "Anyone can update today's availability"
on public.players for update to anon
using (game_date = current_date) with check (game_date = current_date);

create policy "Anyone can view today's matches"
on public.matches for select to anon using (game_date = current_date);

create policy "Anyone can propose today's matches"
on public.matches for insert to anon with check (game_date = current_date);

create policy "Anyone can remove today's match proposals"
on public.matches for delete to anon using (game_date = current_date);

alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.matches;
