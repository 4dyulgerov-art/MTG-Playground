-- ════════════════════════════════════════════════════════════════════════════
-- MTG Playground v7 — Supabase Schema
-- ════════════════════════════════════════════════════════════════════════════
-- Run this entire file in Supabase Dashboard → SQL Editor → New query.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE where possible.
-- ════════════════════════════════════════════════════════════════════════════

-- Extensions
create extension if not exists "pgcrypto";

-- ─── profiles ──────────────────────────────────────────────────────────────
-- One row per authenticated user. Linked to auth.users via user_id.
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  alias        text not null,
  avatar       text default '🧙',                -- emoji OR empty if avatar_url set
  avatar_url   text,                              -- optional image URL
  gamemat_idx  int  default 3,
  gamemat_custom text,
  theme_id     text default 'arcane',
  sleeve_color text default '#c8a870',
  settings     jsonb default '{}'::jsonb,         -- freeform: sfx prefs, weather, etc.
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Auto-update updated_at on change
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists profiles_updated on public.profiles;
create trigger profiles_updated
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ─── rooms ─────────────────────────────────────────────────────────────────
-- A gathering space. Status moves: waiting → playing → closed.
create table if not exists public.rooms (
  id           text primary key,                  -- short human-shareable id
  name         text not null,
  host_id      uuid not null references auth.users(id) on delete cascade,
  max_players  int  not null default 2 check (max_players between 2 and 4),
  gamemode     text default 'standard',
  status       text default 'waiting' check (status in ('waiting','playing','closed')),
  is_public    boolean default true,
  password     text,                              -- optional; plaintext is fine for a private room code
  meta         jsonb default '{}'::jsonb,         -- host avatar, etc.
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists rooms_status_idx on public.rooms(status, created_at desc);

drop trigger if exists rooms_updated on public.rooms;
create trigger rooms_updated
  before update on public.rooms
  for each row execute function public.touch_updated_at();

-- Auto-close stale rooms: any waiting room older than 2h gets closed on list.
-- (Implemented client-side via filter; also a nightly job could do it.)

-- ─── room_players ──────────────────────────────────────────────────────────
-- Who's in a room, in which seat, ready state, selected deck.
create table if not exists public.room_players (
  room_id     text not null references public.rooms(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  seat        int  not null check (seat between 0 and 3),
  ready       boolean default false,
  deck        jsonb,                              -- selected deck snapshot
  alias       text,
  avatar      text,
  joined_at   timestamptz default now(),
  primary key (room_id, user_id),
  unique (room_id, seat)
);
create index if not exists room_players_room_idx on public.room_players(room_id);

-- ─── game_state ────────────────────────────────────────────────────────────
-- One row per active game. Contains the whole game state as JSON.
-- Written by any player in the room (optimistic last-write-wins for now).
-- Phase 2 will add per-zone authority or CRDT.
create table if not exists public.game_state (
  room_id     text primary key references public.rooms(id) on delete cascade,
  state       jsonb not null,
  version     bigint default 1,                  -- monotonically increments each write
  last_writer uuid,
  updated_at  timestamptz default now()
);

-- ─── game_events ───────────────────────────────────────────────────────────
-- Append-only log for chat + action log + disputes.
create table if not exists public.game_events (
  id         bigserial primary key,
  room_id    text not null references public.rooms(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  kind       text not null,                      -- 'chat' | 'action' | 'system' | 'priority'
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists game_events_room_idx on public.game_events(room_id, id desc);

-- ═══ Row Level Security ════════════════════════════════════════════════════
alter table public.profiles      enable row level security;
alter table public.rooms         enable row level security;
alter table public.room_players  enable row level security;
alter table public.game_state    enable row level security;
alter table public.game_events   enable row level security;

-- PROFILES: read public, write own
drop policy if exists "profiles_read"  on public.profiles;
drop policy if exists "profiles_write" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_read"  on public.profiles for select using (true);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = user_id);
create policy "profiles_write" on public.profiles for update using (auth.uid() = user_id);

-- ROOMS: any authed user reads waiting/playing rooms; host can update/delete own
drop policy if exists "rooms_read"   on public.rooms;
drop policy if exists "rooms_create" on public.rooms;
drop policy if exists "rooms_update" on public.rooms;
drop policy if exists "rooms_delete" on public.rooms;
create policy "rooms_read"   on public.rooms for select using (auth.role() = 'authenticated');
create policy "rooms_create" on public.rooms for insert with check (auth.uid() = host_id);
create policy "rooms_update" on public.rooms for update using (auth.uid() = host_id);
create policy "rooms_delete" on public.rooms for delete using (auth.uid() = host_id);

-- ROOM_PLAYERS: anyone in same room reads; you can insert/update/delete your own row
drop policy if exists "rp_read"   on public.room_players;
drop policy if exists "rp_insert" on public.room_players;
drop policy if exists "rp_update" on public.room_players;
drop policy if exists "rp_delete" on public.room_players;
create policy "rp_read"   on public.room_players for select using (auth.role() = 'authenticated');
create policy "rp_insert" on public.room_players for insert with check (auth.uid() = user_id);
create policy "rp_update" on public.room_players for update using (auth.uid() = user_id);
create policy "rp_delete" on public.room_players for delete using (auth.uid() = user_id);

-- GAME_STATE: readable + writable by any authed user who is a player in the room
drop policy if exists "gs_read"  on public.game_state;
drop policy if exists "gs_write" on public.game_state;
drop policy if exists "gs_upsert" on public.game_state;
create policy "gs_read" on public.game_state for select using (
  auth.role() = 'authenticated'
  and exists (select 1 from public.room_players rp where rp.room_id = game_state.room_id and rp.user_id = auth.uid())
);
create policy "gs_upsert" on public.game_state for insert with check (
  exists (select 1 from public.room_players rp where rp.room_id = game_state.room_id and rp.user_id = auth.uid())
);
create policy "gs_write" on public.game_state for update using (
  exists (select 1 from public.room_players rp where rp.room_id = game_state.room_id and rp.user_id = auth.uid())
);

-- GAME_EVENTS: read by players in room; write as self
drop policy if exists "ge_read"   on public.game_events;
drop policy if exists "ge_insert" on public.game_events;
create policy "ge_read"   on public.game_events for select using (
  auth.role() = 'authenticated'
  and exists (select 1 from public.room_players rp where rp.room_id = game_events.room_id and rp.user_id = auth.uid())
);
create policy "ge_insert" on public.game_events for insert with check (auth.uid() = user_id);

-- ═══ Realtime Publication ══════════════════════════════════════════════════
-- Enable realtime on the tables we subscribe to.
-- (Supabase often enables `supabase_realtime` by default; these ALTERs add our tables.)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.rooms;        exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.room_players; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.game_state;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.game_events;  exception when duplicate_object then null; end;
  end if;
end $$;

-- ═══ Helpful helper function: auto-create profile row on signup ════════════
-- Without this, a new user has no profiles row until they save their profile manually.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, alias, avatar)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'alias', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'avatar', '🧙')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══ Done ══════════════════════════════════════════════════════════════════
-- Verify: select * from public.profiles limit 1;
