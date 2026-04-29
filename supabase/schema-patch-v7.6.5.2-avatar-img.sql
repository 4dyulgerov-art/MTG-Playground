-- ════════════════════════════════════════════════════════════════════════════
-- TCG Playsim v7.6.5.2 — Lobby chat avatar image support
-- ════════════════════════════════════════════════════════════════════════════
-- Run this AFTER schema-patch-v7.6.5.1-lobby-chat.sql.
-- Adds:
--   • lobby_messages.avatar_img — URL of the user's avatar image at post time
-- ════════════════════════════════════════════════════════════════════════════

alter table public.lobby_messages
  add column if not exists avatar_img text;
