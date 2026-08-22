create table if not exists public.post_game_reports (
  game_id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.post_game_reports enable row level security;
revoke all on public.post_game_reports from anon, authenticated;

create index if not exists post_game_reports_created_at_idx
on public.post_game_reports (created_at desc);
