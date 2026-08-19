-- Run once in Supabase Dashboard > SQL Editor.
-- Keeps existing ownership and allows up to ten authorized devices per player.
begin;

alter table public.players
add column if not exists owner_token_hashes text[] not null default '{}';

update public.players
set owner_token_hashes = array[owner_token_hash]
where owner_token_hash is not null
  and not owner_token_hash = any(owner_token_hashes);

commit;
