-- Run this once in Supabase Dashboard > SQL Editor for the delete button.
drop policy if exists "Anyone can remove today's match proposals" on public.matches;

create policy "Anyone can remove today's match proposals"
on public.matches for delete to anon using (game_date = current_date);
