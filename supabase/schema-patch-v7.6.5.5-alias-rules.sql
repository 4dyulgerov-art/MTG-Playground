-- ════════════════════════════════════════════════════════════════════════════
-- TCG Playsim v7.6.5.5 — Alias uniqueness + impersonation prevention
-- ════════════════════════════════════════════════════════════════════════════
-- Run this AFTER schema-patch-v7.6.5.3-mod-and-inbox.sql.
-- Adds:
--   • is_alias_reserved(p_alias text) → bool — blocklist of restricted words
--   • profiles_validate_alias() trigger — enforces uniqueness + blocklist on
--     INSERT/UPDATE. Skipped when caller is a moderator.
--   • profiles_alias_lower_uniq — case-insensitive unique index, best-effort
--     (degrades to trigger-only enforcement if existing duplicates block it).
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Blocklist function. Returns true when the alias contains a restricted
--    term. Two layers:
--      a) SUBSTRING — applies anywhere. Used for clearly IP / brand /
--         official-sounding terms that any legitimate user can avoid by
--         renaming with no real loss (mtg, wotc, wizards, official, etc.).
--      b) WHOLE-WORD — applies only when bordered by non-alphanumeric. Used
--         for short ambiguous tokens (admin, mod, dev, staff) that could
--         otherwise reject legitimate names like "Modrana" or "ModelMaker".
--    The frontend mirrors this exact regex — keep them in sync.
create or replace function public.is_alias_reserved(p_alias text)
returns boolean as $$
declare
  norm text;
begin
  norm := lower(trim(coalesce(p_alias, '')));
  if norm = '' then return false; end if;

  -- Substring matches (case-insensitive).
  -- Brand / IP / officialness:
  --   administrator, moderator (long-form), developer, official(s),
  --   wizard / wizards, wotc, mtg / mtgo / mtga, "of the coast"
  --   (allowing - or _ between words),
  --   tcgplaysim / playsim / "tcg playsim", anthropic, claude.
  if norm ~* '(administrator|moderator|developer|official|officials|wizards?|wotc|mtg[oa]?|of[- _]?the[- _]?coast|tcg[- _]?playsim|playsim|anthropic|claude|magic[- _]?the[- _]?gathering)' then
    return true;
  end if;

  -- Whole-word matches (bordered by non-alphanumeric or string ends).
  if norm ~* '(^|[^a-z0-9])(admin|mod|mods|dev|devs|staff|ceo|owner|founder|support|system|server|bot|null|undefined|root|sudo|host|gm)([^a-z0-9]|$)' then
    return true;
  end if;

  return false;
end;
$$ language plpgsql immutable;

comment on function public.is_alias_reserved(text) is
  'TCG Playsim v7.6.5.5 — Returns true when the alias contains a reserved word. Frontend mirrors this regex; keep in sync.';

-- 2. Trigger that runs on every profiles insert/update. Validates:
--    a) Length: 2-24 chars after trim
--    b) Reserved-word blocklist (skipped if the EDITOR is a moderator —
--       use auth.uid() to look that up, falling back to "non-moderator"
--       on null because the welcome trigger inserts profiles where the
--       caller IS the new user)
--    c) Case-insensitive uniqueness
--
--    Skip-on-no-change: if alias is unchanged from OLD, all checks pass.
--    This means existing users with names that would now be reserved
--    don't get retroactively blocked from updating their avatar/gamemat.
create or replace function public.profiles_validate_alias()
returns trigger as $$
declare
  caller_is_mod boolean;
  trimmed_alias text;
begin
  -- Skip when alias hasn't changed
  if TG_OP = 'UPDATE' and NEW.alias is not distinct from OLD.alias then
    return NEW;
  end if;

  -- Trim and length-check
  trimmed_alias := trim(coalesce(NEW.alias, ''));
  if length(trimmed_alias) < 2 then
    raise exception 'alias_too_short' using
      detail = 'Alias must be at least 2 characters';
  end if;
  if length(trimmed_alias) > 24 then
    raise exception 'alias_too_long' using
      detail = 'Alias must be 24 characters or less';
  end if;

  -- Look up if the editor (auth.uid()) is a moderator.
  -- During welcome-trigger inserts, auth.uid() = NEW.user_id (new user, not
  -- a mod). So normal users still get blocked from impersonation names on
  -- signup, while a mod editing another user via mod_edit_profile can set
  -- whatever they like.
  select coalesce(is_moderator, false) into caller_is_mod
    from public.profiles where user_id = auth.uid();
  if caller_is_mod is null then
    caller_is_mod := false;
  end if;

  -- Reserved-word check (skipped only for moderators)
  if not caller_is_mod and public.is_alias_reserved(trimmed_alias) then
    raise exception 'alias_reserved' using
      detail = 'This alias contains a restricted word. Contact a moderator if you believe this is in error.';
  end if;

  -- Case-insensitive uniqueness (skipped for self-rows, of course)
  if exists (
    select 1 from public.profiles
     where lower(alias) = lower(trimmed_alias)
       and user_id <> NEW.user_id
  ) then
    raise exception 'alias_taken' using
      detail = 'This alias is already in use by another player.';
  end if;

  -- Normalise: store the trimmed version
  NEW.alias := trimmed_alias;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists profiles_validate_alias_trg on public.profiles;
create trigger profiles_validate_alias_trg
  before insert or update on public.profiles
  for each row execute function public.profiles_validate_alias();

-- 3. Case-insensitive unique index as a backstop against race conditions.
--    Wrapped in DO block so existing duplicates don't break the migration —
--    in that case the trigger remains the enforcement layer for new writes.
do $$
begin
  begin
    create unique index profiles_alias_lower_uniq
      on public.profiles (lower(alias));
    raise notice 'profiles_alias_lower_uniq: created';
  exception
    when duplicate_table then
      raise notice 'profiles_alias_lower_uniq: already exists';
    when unique_violation then
      raise notice 'profiles_alias_lower_uniq: existing alias duplicates prevent index creation. Trigger will enforce on new writes; review duplicates manually with:  select lower(alias),count(*) from public.profiles group by 1 having count(*)>1;';
    when others then
      raise notice 'profiles_alias_lower_uniq: skipped (%)', SQLERRM;
  end;
end $$;

-- 4. Moderator escape hatch — when mod_edit_profile is called, the trigger
--    above already detects the caller is a moderator via auth.uid() and
--    skips the reserved-word check. This re-creates mod_edit_profile so
--    its alias change is committed even if the trigger fires (idempotent).
create or replace function public.mod_edit_profile(target uuid, new_alias text default null, new_avatar text default null)
returns void as $$
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_moderator = true) then
    raise exception 'moderator only';
  end if;
  update public.profiles
     set alias  = coalesce(new_alias, alias),
         avatar = coalesce(new_avatar, avatar)
   where user_id = target;
end;
$$ language plpgsql security definer;

-- 5. Force PostgREST to reload schema cache — also fixes pending lobby_messages
--    + broadcast_announcement schema-cache misses.
notify pgrst, 'reload schema';
