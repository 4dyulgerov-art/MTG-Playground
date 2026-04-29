-- ════════════════════════════════════════════════════════════════════════════
-- TCG Playsim v7.6.5 — Moderation & Lobby Chat schema patch
-- ════════════════════════════════════════════════════════════════════════════
-- Run this entire file in Supabase Dashboard → SQL Editor → New query.
-- Safe to re-run: uses IF NOT EXISTS where possible.
--
-- Adds:
--   • profiles.is_moderator           — flag for who can read the mod panel
--   • profiles.media_revoked          — when true, playmat / sleeve URLs are
--                                       hidden from other players
--   • profiles.strikes                — count of automod hits this account
--                                       has accumulated; used to revoke
--   • lobby_messages                  — global lobby chat
--   • moderation_log                  — every automod hit lands here
--   • usernames_history               — track every alias change for forensics
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. profiles flags ─────────────────────────────────────────────────────
alter table public.profiles add column if not exists is_moderator boolean default false;
alter table public.profiles add column if not exists media_revoked boolean default false;
alter table public.profiles add column if not exists strikes int default 0;

-- ─── 2. lobby_messages ─────────────────────────────────────────────────────
-- A small global chatroom on the main menu. Capped to last ~500 messages
-- via a periodic prune (run by maintenance cron) — clients only fetch the
-- last 100 anyway. RLS: anyone authenticated reads, only the author writes.
create table if not exists public.lobby_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  alias        text not null,
  avatar       text,
  text         text not null check (length(text) between 1 and 500),
  created_at   timestamptz not null default now()
);
create index if not exists lobby_messages_recent on public.lobby_messages(created_at desc);

alter table public.lobby_messages enable row level security;

drop policy if exists lobby_messages_read on public.lobby_messages;
create policy lobby_messages_read on public.lobby_messages
  for select using (auth.uid() is not null);

drop policy if exists lobby_messages_insert_own on public.lobby_messages;
create policy lobby_messages_insert_own on public.lobby_messages
  for insert with check (auth.uid() = user_id);

drop policy if exists lobby_messages_delete_own on public.lobby_messages;
create policy lobby_messages_delete_own on public.lobby_messages
  for delete using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
       where user_id = auth.uid() and is_moderator = true
    )
  );

-- ─── 3. moderation_log ─────────────────────────────────────────────────────
-- Every automod hit, every report, every revocation is logged here. Only
-- moderators can read; insert is unrestricted (clients log their own hits).
create table if not exists public.moderation_log (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in (
                  'automod_block',     -- message was hard-blocked
                  'automod_flag',      -- message let through but flagged
                  'report_user',       -- user-submitted report
                  'media_revoke',      -- playmat/sleeve auto-revoked
                  'media_restore',     -- moderator restored access
                  'manual_warning'     -- moderator-issued warning
                )),
  surface       text,                  -- 'lobby_chat' | 'in_game_chat' | 'profile' | 'deck' | 'custom_card'
  offender_id   uuid references auth.users(id) on delete set null,
  offender_alias text,
  reporter_id   uuid references auth.users(id) on delete set null,
  reporter_alias text,
  payload       jsonb default '{}'::jsonb,  -- {original_text, matched_terms, screenshot_data_url, ...}
  reviewed      boolean default false,
  reviewer_id   uuid references auth.users(id) on delete set null,
  reviewer_note text,
  created_at    timestamptz not null default now()
);
create index if not exists moderation_log_recent on public.moderation_log(created_at desc);
create index if not exists moderation_log_unreviewed on public.moderation_log(reviewed, created_at desc) where reviewed = false;
create index if not exists moderation_log_offender on public.moderation_log(offender_id);

alter table public.moderation_log enable row level security;

-- Only moderators can read.
drop policy if exists moderation_log_read on public.moderation_log;
create policy moderation_log_read on public.moderation_log
  for select using (
    exists (select 1 from public.profiles
             where user_id = auth.uid() and is_moderator = true)
  );

-- Authenticated users can write (they log their own automod hits and reports).
-- The reporter_id check ensures they can't impersonate someone else.
drop policy if exists moderation_log_insert on public.moderation_log;
create policy moderation_log_insert on public.moderation_log
  for insert with check (
    auth.uid() is not null
    and (reporter_id is null or reporter_id = auth.uid())
  );

-- Only moderators can update (mark reviewed, add note).
drop policy if exists moderation_log_update on public.moderation_log;
create policy moderation_log_update on public.moderation_log
  for update using (
    exists (select 1 from public.profiles
             where user_id = auth.uid() and is_moderator = true)
  );

-- ─── 4. usernames_history ─────────────────────────────────────────────────
-- Append-only record of every alias a user has had. Lets a moderator see
-- "this account previously called itself X" — a common social-engineering
-- pattern is to change alias right after a ban-evading offence.
create table if not exists public.usernames_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  alias        text not null,
  changed_at   timestamptz not null default now()
);
create index if not exists usernames_history_user on public.usernames_history(user_id, changed_at desc);

alter table public.usernames_history enable row level security;

drop policy if exists usernames_history_read on public.usernames_history;
create policy usernames_history_read on public.usernames_history
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles
                where user_id = auth.uid() and is_moderator = true)
  );

drop policy if exists usernames_history_insert on public.usernames_history;
create policy usernames_history_insert on public.usernames_history
  for insert with check (auth.uid() = user_id);

-- Trigger: every time profiles.alias changes, append a row to history.
create or replace function public.profiles_alias_history() returns trigger as $$
begin
  if (TG_OP = 'INSERT') or (NEW.alias is distinct from OLD.alias) then
    insert into public.usernames_history(user_id, alias)
    values (NEW.user_id, NEW.alias);
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists profiles_alias_history_trg on public.profiles;
create trigger profiles_alias_history_trg
  after insert or update of alias on public.profiles
  for each row execute function public.profiles_alias_history();

-- ─── 5. revoke_media RPC ───────────────────────────────────────────────────
-- Called by the client when a user crosses the strike threshold. Sets the
-- offender's media_revoked flag. Authenticated users can call it on
-- THEMSELVES (so the strike counter on the client honestly self-revokes
-- when it hits 5); moderators can call it on anyone.
create or replace function public.revoke_media(target uuid) returns void as $$
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;
  if auth.uid() <> target and not exists (
    select 1 from public.profiles where user_id = auth.uid() and is_moderator = true
  ) then
    raise exception 'forbidden';
  end if;
  update public.profiles set media_revoked = true where user_id = target;
end;
$$ language plpgsql security definer;

create or replace function public.restore_media(target uuid) returns void as $$
begin
  if not exists (select 1 from public.profiles
                  where user_id = auth.uid() and is_moderator = true) then
    raise exception 'moderator only';
  end if;
  update public.profiles set media_revoked = false, strikes = 0 where user_id = target;
end;
$$ language plpgsql security definer;

-- ─── 6. promote yourself to moderator (run once, manually) ─────────────────
-- Replace the email below with your own and run this single statement to
-- make yourself the first moderator. Subsequent moderators can be promoted
-- by editing the profiles row directly in the Supabase dashboard.
--
-- update public.profiles set is_moderator = true
--   where user_id = (select id from auth.users where email = 'tcgplaysim@gmail.com');

-- ════════════════════════════════════════════════════════════════════════════
-- End of v7.6.5 moderation patch.
-- ════════════════════════════════════════════════════════════════════════════
