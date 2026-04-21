import { supabase } from './supabase';

// Map DB row → v6 profile shape (preserve every field v6 expects).
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

export async function upsertMyProfile(profile) {
  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) return { error: { message: 'not signed in' } };
  const row = profileToRow(profile, userId);
  const { data, error } = await supabase.from('profiles').upsert(row).select().maybeSingle();
  return { data: rowToProfile(data), error };
}
