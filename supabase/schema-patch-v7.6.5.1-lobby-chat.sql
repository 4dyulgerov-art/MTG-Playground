-- ════════════════════════════════════════════════════════════════════════════
-- TCG Playsim v7.6.5.1 — Lobby chat fixes
-- ════════════════════════════════════════════════════════════════════════════
-- Run this AFTER schema-patch-v7.6.5-moderation.sql.
-- Adds:
--   • lobby_messages.edited_at      — timestamp of last edit, null if unedited
--   • lobby_messages_update_own     — RLS policy so users can edit their own
--   • realtime publication          — required for live broadcast of inserts,
--                                     updates, deletes to other clients
-- ════════════════════════════════════════════════════════════════════════════

-- 1. edited_at column
alter table public.lobby_messages
  add column if not exists edited_at timestamptz;

-- 2. UPDATE policy — own messages only; moderators can also edit
drop policy if exists lobby_messages_update_own on public.lobby_messages;
create policy lobby_messages_update_own on public.lobby_messages
  for update using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
       where user_id = auth.uid() and is_moderator = true
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
       where user_id = auth.uid() and is_moderator = true
    )
  );

-- 3. Enable realtime broadcast for lobby_messages
-- This is the critical step — without this, INSERT/UPDATE/DELETE events
-- do NOT reach subscribed clients via supabase.channel().on('postgres_changes').
-- Safe to run multiple times: pg_publication_tables check makes it idempotent.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'lobby_messages'
  ) then
    alter publication supabase_realtime add table public.lobby_messages;
  end if;
end $$;

-- Optional: if you want moderators to see automod_block events live too,
-- enable realtime on moderation_log as well. Off by default — uncomment
-- if you want a live mod queue.
-- do $$
-- begin
--   if not exists (
--     select 1 from pg_publication_tables
--      where pubname = 'supabase_realtime'
--        and schemaname = 'public'
--        and tablename  = 'moderation_log'
--   ) then
--     alter publication supabase_realtime add table public.moderation_log;
--   end if;
-- end $$;
