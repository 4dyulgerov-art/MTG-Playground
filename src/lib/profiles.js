import { supabase } from './supabase';

// ════════════════════════════════════════════════════════════════════════════
// v7.6.5.5 — Alias validation. MIRROR of public.is_alias_reserved() in SQL.
// Keep these regexes IN SYNC with the migration (schema-patch-v7.6.5.5).
// ════════════════════════════════════════════════════════════════════════════

const RESERVED_SUBSTR = /(administrator|moderator|developer|official|officials|wizards?|wotc|mtg[oa]?|of[- _]?the[- _]?coast|tcg[- _]?playsim|playsim|anthropic|claude|magic[- _]?the[- _]?gathering)/i;
const RESERVED_WORD = /(^|[^a-z0-9])(admin|mod|mods|dev|devs|staff|ceo|owner|founder|support|system|server|bot|null|undefined|root|sudo|host|gm)([^a-z0-9]|$)/i;

export function isAliasReserved(alias) {
  if (!alias) return false;
  const s = String(alias).trim();
  if (!s) return false;
  if (RESERVED_SUBSTR.test(s)) return true;
  if (RESERVED_WORD.test(s)) return true;
  return false;
}

// Async availability check: validates length + reserved word + DB uniqueness.
// Returns { available: boolean, reason?: 'empty'|'too_short'|'too_long'|'reserved'|'taken'|'check_failed' }.
// The DB trigger is the source of truth — this is for fast UX feedback.
export async function isAliasAvailable(alias) {
  if (!alias) return { available: false, reason: 'empty' };
  const trimmed = String(alias).trim();
  if (trimmed.length < 2)  return { available: false, reason: 'too_short' };
  if (trimmed.length > 24) return { available: false, reason: 'too_long' };
  if (isAliasReserved(trimmed)) return { available: false, reason: 'reserved' };

  // Case-insensitive DB check (best-effort; fall through to trigger on error).
  try {
    const { data: u } = await supabase.auth.getUser();
    const myUserId = u?.user?.id || null;
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, alias')
      .ilike('alias', trimmed) // ilike with no wildcards = case-insensitive equality
      .maybeSingle();
    if (error) return { available: true, reason: 'check_failed' };
    if (data && data.user_id !== myUserId) return { available: false, reason: 'taken' };
    return { available: true };
  } catch (e) {
    return { available: true, reason: 'check_failed' };
  }
}

// Map a reason code OR a DB Error to a single human-friendly sentence.
export function aliasErrorToMessage(reasonOrError) {
  let r = reasonOrError;
  if (r && typeof r === 'object') r = (r.message || '').toLowerCase();
  if (typeof r !== 'string') r = '';
  r = r.toLowerCase();

  if (r.includes('alias_taken') || r.includes('duplicate') || r === 'taken') {
    return 'This alias is already in use by another player.';
  }
  if (r.includes('alias_reserved') || r === 'reserved') {
    return 'This alias contains a restricted word. Pick a different one.';
  }
  if (r.includes('alias_too_short') || r === 'too_short') {
    return 'Alias must be at least 2 characters.';
  }
  if (r.includes('alias_too_long') || r === 'too_long') {
    return 'Alias must be 24 characters or less.';
  }
  if (r === 'empty') return 'Please enter an alias.';
  return 'Could not save this alias. Please try a different one.';
}

// ════════════════════════════════════════════════════════════════════════════
// Profile shape mappers
// ════════════════════════════════════════════════════════════════════════════

function rowToProfile(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    alias: row.alias,
    avatar: row.avatar,
    avatarImg: row.avatar_url || '',
    gamematIdx: row.gamemat_idx ?? 3,
    gamematCustom: row.gamemat_custom || '',
    themeId: row.theme_id || 'arcane',
    sleeveColor: row.sleeve_color || '#c8a870',
    settings: row.settings || {},
    isModerator: !!row.is_moderator,
    mediaRevoked: !!row.media_revoked,
    strikes: row.strikes || 0,
    banned:    !!row.banned,
    chatMuted: !!row.chat_muted,
  };
}

function profileToRow(p, userId) {
  return {
    user_id: userId,
    alias: p.alias,
    avatar: p.avatar || '🧙',
    avatar_url: p.avatarImg || null,
    gamemat_idx: p.gamematIdx ?? 3,
    gamemat_custom: p.gamematCustom || null,
    theme_id: p.themeId || 'arcane',
    sleeve_color: p.sleeveColor || '#c8a870',
    settings: p.settings || {},
  };
}

export async function getMyProfile() {
  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error) { console.warn('[getMyProfile]', error); return null; }
  return rowToProfile(data);
}

export async function getProfileByUserId(userId) {
  if (!userId) return null;
  const { data } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  return rowToProfile(data);
}

// v7.6.5.5: pre-validates alias; maps DB trigger errors to friendly text.
export async function upsertMyProfile(profile) {
  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) return { error: { message: 'not signed in' } };

  // If the alias is changing, run a fast availability check before round-trip.
  const current = await getMyProfile();
  if (!current || (current.alias || '').toLowerCase() !== (profile.alias || '').toLowerCase()) {
    const av = await isAliasAvailable(profile.alias);
    if (!av.available) {
      return {
        data: null,
        error: { message: aliasErrorToMessage(av.reason), reason: av.reason },
      };
    }
  }

  const row = profileToRow(profile, userId);
  const { data, error } = await supabase.from('profiles').upsert(row).select().maybeSingle();
  if (error) {
    return {
      data: null,
      error: { ...error, message: aliasErrorToMessage(error) },
    };
  }
  return { data: rowToProfile(data), error: null };
}
