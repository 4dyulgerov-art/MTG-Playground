-- ════════════════════════════════════════════════════════════════════════════
-- TCG Playsim v7.6.5.3 — Moderator powers + user inbox
-- ════════════════════════════════════════════════════════════════════════════
-- Run this AFTER schema-patch-v7.6.5.2-avatar-img.sql.
-- Adds:
--   • profiles.banned, profiles.chat_muted     — moderator-controlled flags
--   • inbox_messages                           — per-user notification inbox
--   • RPCs for ban / unban / mute / unmute / edit_profile / broadcast
--   • Welcome-message trigger on new profile
--   • Realtime publication for inbox_messages
-- ════════════════════════════════════════════════════════════════════════════

-- 1. profiles flags
alter table public.profiles add column if not exists banned     boolean default false;
alter table public.profiles add column if not exists chat_muted boolean default false;

-- 2. inbox_messages
create table if not exists public.inbox_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in (
                  'welcome',         -- auto-sent on first profile creation
                  'warning',         -- moderator-issued warning
                  'update',          -- maintainer broadcast (deploy notes etc.)
                  'notice',          -- generic system notice
                  'restriction',     -- media revoke / chat mute notice
                  'ban_notice',      -- ban applied
                  'unban_notice'     -- ban lifted
                )),
  title         text not null,
  body          text not null,
  sender_id     uuid references auth.users(id) on delete set null,
  sender_alias  text,
  read          boolean default false,
  created_at    timestamptz not null default now()
);
create index if not exists inbox_user on public.inbox_messages(user_id, read, created_at desc);

alter table public.inbox_messages enable row level security;

drop policy if exists inbox_select_own on public.inbox_messages;
create policy inbox_select_own on public.inbox_messages for select
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where user_id = auth.uid() and is_moderator = true)
  );

-- Users CANNOT insert into their own inbox; only moderators can write.
drop policy if exists inbox_insert_mod on public.inbox_messages;
create policy inbox_insert_mod on public.inbox_messages for insert
  with check (
    exists (select 1 from public.profiles where user_id = auth.uid() and is_moderator = true)
  );

drop policy if exists inbox_update_own on public.inbox_messages;
create policy inbox_update_own on public.inbox_messages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists inbox_delete_own on public.inbox_messages;
create policy inbox_delete_own on public.inbox_messages for delete
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles where user_id = auth.uid() and is_moderator = true)
  );

-- 3. Moderator RPCs
create or replace function public.ban_user(target uuid, reason text default null) returns void as $$
declare mod_alias text;
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_moderator = true) then
    raise exception 'moderator only';
  end if;
  update public.profiles set banned = true where user_id = target;
  select alias into mod_alias from public.profiles where user_id = auth.uid();
  insert into public.inbox_messages(user_id, kind, title, body, sender_id, sender_alias)
  values (target, 'ban_notice', 'Account banned',
          coalesce(reason, 'Your account has been banned for violations of the Code of Conduct. Contact tcgplaysim@gmail.com if you believe this is in error.'),
          auth.uid(), mod_alias);
end;
$$ language plpgsql security definer;

create or replace function public.unban_user(target uuid) returns void as $$
declare mod_alias text;
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_moderator = true) then
    raise exception 'moderator only';
  end if;
  update public.profiles set banned = false where user_id = target;
  select alias into mod_alias from public.profiles where user_id = auth.uid();
  insert into public.inbox_messages(user_id, kind, title, body, sender_id, sender_alias)
  values (target, 'unban_notice', 'Account restored',
          'Your account has been restored. Welcome back. Please review the Code of Conduct.',
          auth.uid(), mod_alias);
end;
$$ language plpgsql security definer;

create or replace function public.mute_user(target uuid) returns void as $$
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_moderator = true) then
    raise exception 'moderator only';
  end if;
  update public.profiles set chat_muted = true where user_id = target;
end;
$$ language plpgsql security definer;

create or replace function public.unmute_user(target uuid) returns void as $$
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_moderator = true) then
    raise exception 'moderator only';
  end if;
  update public.profiles set chat_muted = false where user_id = target;
end;
$$ language plpgsql security definer;

create or replace function public.mod_edit_profile(
  target uuid, new_alias text default null, new_avatar text default null
) returns void as $$
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_moderator = true) then
    raise exception 'moderator only';
  end if;
  update public.profiles set
    alias  = coalesce(new_alias,  alias),
    avatar = coalesce(new_avatar, avatar)
   where user_id = target;
end;
$$ language plpgsql security definer;

-- Broadcast a single inbox message to every existing user.
create or replace function public.broadcast_announcement(p_title text, p_body text) returns int as $$
declare cnt int; mod_alias text;
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_moderator = true) then
    raise exception 'moderator only';
  end if;
  select alias into mod_alias from public.profiles where user_id = auth.uid();
  insert into public.inbox_messages(user_id, kind, title, body, sender_id, sender_alias)
  select p.user_id, 'update', p_title, p_body, auth.uid(), mod_alias
    from public.profiles p;
  get diagnostics cnt = ROW_COUNT;
  return cnt;
end;
$$ language plpgsql security definer;

-- 4. Auto welcome message when a new profile is created.
create or replace function public.profiles_send_welcome() returns trigger as $$
begin
  insert into public.inbox_messages(user_id, kind, title, body, sender_alias)
  values (
    NEW.user_id, 'welcome', 'Welcome to TCG Playsim',
    'Welcome ' || NEW.alias || E' to TCG Playsim! \U0001F389\n\n' ||
    E'This is a free browser-based playtester for Magic: The Gathering. Build decks ' ||
    E'with Scryfall search, customise sleeves and playmats, and play with up to four ' ||
    E'players online — no download required.\n\n' ||
    E'Quick tips:\n' ||
    E'• Press ? or / at any time during a game to see all hotkeys.\n' ||
    E'• The Help menu (top right) has the full Manual, the Code of Conduct, and forms ' ||
    E'for reporting bugs or suggesting features.\n' ||
    E'• Multiplayer rooms support 2-4 players in formats like Standard, Commander, ' ||
    E'Oathbreaker, Modern, Pioneer, Pauper, and the shared-deck Dandân format.\n\n' ||
    E'Have fun. Be excellent to each other.',
    'TCG Playsim'
  );
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists profiles_welcome_trg on public.profiles;
create trigger profiles_welcome_trg
  after insert on public.profiles
  for each row execute function public.profiles_send_welcome();

-- 5. Realtime publication for inbox_messages so users see new messages live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'inbox_messages'
  ) then
    alter publication supabase_realtime add table public.inbox_messages;
  end if;
end $$;
