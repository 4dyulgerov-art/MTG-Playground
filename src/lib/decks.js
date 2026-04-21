import { supabase } from './supabase';

/*  src/lib/decks.js
    ─────────────────────────────────────────────────────────────────────────
    Cloud deck storage. Decks live in `user_decks` table as JSONB column,
    one row per user. On first login after this upgrade, we migrate any
    locally-stored decks (mtg_decks_v3) to the cloud, then keep them synced.
*/

const LOCAL_KEY = 'mtg_decks_v3';
const MIGRATED_FLAG = 'mtg_decks_cloud_migrated_v1';

async function uid() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

// Read decks array from cloud. Returns [] if empty / unauth.
export async function getMyDecksCloud() {
  const userId = await uid();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('user_decks')
    .select('decks')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) { console.warn('[getMyDecksCloud]', error); return []; }
  return Array.isArray(data?.decks) ? data.decks : [];
}

// Write decks array to cloud (upsert). Fire-and-forget logging.
export async function saveMyDecksCloud(decks) {
  const userId = await uid();
  if (!userId) return { error: { message: 'not signed in' } };
  const payload = Array.isArray(decks) ? decks : [];
  const { error } = await supabase
    .from('user_decks')
    .upsert({ user_id: userId, decks: payload, updated_at: new Date().toISOString() });
  if (error) console.warn('[saveMyDecksCloud]', error);
  return { error };
}

// One-time migration from localStorage → cloud, the first time this user
// logs in on a device that already has v6/v7 decks cached locally.
// Merges local + cloud by deck.id (cloud wins ties).
export async function migrateLocalDecksIfNeeded() {
  try {
    if (localStorage.getItem(MIGRATED_FLAG) === '1') return;
    const raw = localStorage.getItem(LOCAL_KEY);
    const local = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(local) || local.length === 0) {
      localStorage.setItem(MIGRATED_FLAG, '1');
      return;
    }
    const cloud = await getMyDecksCloud();
    const byId = new Map();
    local.forEach(d => d?.id && byId.set(d.id, d));
    cloud.forEach(d => d?.id && byId.set(d.id, d)); // cloud overwrites
    const merged = Array.from(byId.values());
    await saveMyDecksCloud(merged);
    localStorage.setItem(MIGRATED_FLAG, '1');
  } catch (e) {
    console.warn('[migrateLocalDecksIfNeeded]', e);
  }
}
