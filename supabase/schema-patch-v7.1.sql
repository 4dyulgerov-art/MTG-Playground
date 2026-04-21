-- ════════════════════════════════════════════════════════════════════════════
-- MTG Playground v7 → v7.1 schema patch
-- ════════════════════════════════════════════════════════════════════════════
-- Run this in Supabase Dashboard → SQL Editor → New query if you already
-- deployed v7. Safe to re-run (uses IF NOT EXISTS).
--
-- If you're deploying v7 for the first time, use schema.sql instead — it
-- already contains these changes.
-- ════════════════════════════════════════════════════════════════════════════

-- v7.1: store the full profile object, not just alias/avatar. Fixes bug #1
-- (opponent showing as "Opponent" because v6 passes profile as a nested
-- object, not flat columns).
alter table public.room_players
  add column if not exists profile jsonb;

-- Helpful: reclaim seats when users leave rooms.
-- No DDL needed here — the application now calls DELETE on room_players
-- directly, and RLS already allows users to delete their own rows.

-- Verify:
-- select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='room_players';
