-- Keep the companion-reported end-of-game result long enough to show the lobby reaction.
alter table public.desktop_live_stats
add column if not exists game_result text
check (game_result in ('win','loss'));
