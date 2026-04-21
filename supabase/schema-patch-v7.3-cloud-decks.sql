-- Run this ONCE in your Supabase SQL editor to enable cloud deck storage.
-- Safe to run multiple times.

create table if not exists public.user_decks (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  decks      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_decks enable row level security;

drop policy if exists "user_decks_owner_select" on public.user_decks;
create policy "user_decks_owner_select" on public.user_decks
  for select using (auth.uid() = user_id);

drop policy if exists "user_decks_owner_upsert" on public.user_decks;
create policy "user_decks_owner_upsert" on public.user_decks
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_decks_owner_update" on public.user_decks;
create policy "user_decks_owner_update" on public.user_decks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_decks_owner_delete" on public.user_decks;
create policy "user_decks_owner_delete" on public.user_decks
  for delete using (auth.uid() = user_id);
