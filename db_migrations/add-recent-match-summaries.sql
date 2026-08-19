alter table public.riot_profiles
add column if not exists recent_match_summaries jsonb not null default '[]'::jsonb;
