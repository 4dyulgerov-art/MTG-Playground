/*  src/lib/storage.js
    ─────────────────────────────────────────────────────────────────────────
    Drop-in replacement for the v6 inline `storage` shim.
    Same API (get/set/delete/list) so Playground.jsx works unchanged,
    but when called with shared=true it routes to Supabase instead of
    localStorage — making rooms actually work across computers.
    ─────────────────────────────────────────────────────────────────────────
    KEY CONVENTIONS (inherited from v6 RoomLobby):
      - `room_<id>_meta`        → rooms table row
      - `room_<id>_player_<n>`  → room_players row for seat n
      - (anything else shared)  → rooms.meta JSON or room_players.deck JSON
    The shim parses these naming patterns and dispatches to the right table.
*/

import { supabase } from './supabase';

// ─── Local (unshared) — direct localStorage ─────────────────────────────
const local = {
  async get(key) {
    try { const v = localStorage.getItem(key); return v ? { value: v } : null; }
    catch { return null; }
  },
  async set(key, value) {
    try { localStorage.setItem(key, value); return { value }; }
    catch { return null; }
  },
  async delete(key) {
    try { localStorage.removeItem(key); return { deleted: true }; }
    catch { return null; }
  },
  async list(prefix = '') {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
      return { keys };
    } catch { return { keys: [] }; }
  },
};

// ─── Shared (cross-computer) — Supabase ─────────────────────────────────
// We emulate the v6 shim semantics on top of the relational schema.

const ROOM_META_RE   = /^room_([^_]+)_meta$/;
const ROOM_PLAYER_RE = /^room_([^_]+)_player_(\d+)$/;

// Helper: serialize our own "current user id" without needing an auth context.
async function uid() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

const shared = {
  async get(key) {
    try {
      const m1 = key.match(ROOM_META_RE);
      if (m1) {
        const id = m1[1];
        const { data, error } = await supabase.from('rooms').select('*').eq('id', id).single();
        if (error || !data) return null;
        // Attach joined players so v6 RoomLobby sees .players array
        const { data: rps } = await supabase
          .from('room_players').select('*').eq('room_id', id).order('seat');
        const meta = {
          id: data.id, name: data.name,
          host: data.meta?.host || '',
          hostAvatar: data.meta?.hostAvatar || '🧙',
          maxPlayers: data.max_players,
          gamemode: data.gamemode,
          status: data.status,
          created: new Date(data.created_at).getTime(),
          players: (rps || []).map(p => ({ alias: p.alias, avatar: p.avatar, ready: p.ready, seat: p.seat })),
        };
        return { value: JSON.stringify(meta) };
      }
      const m2 = key.match(ROOM_PLAYER_RE);
      if (m2) {
        const id = m2[1]; const seat = +m2[2];
        const { data, error } = await supabase
          .from('room_players').select('*').eq('room_id', id).eq('seat', seat).maybeSingle();
        if (error || !data) return null;
        // v2 fix (bug #1): we now persist the FULL profile object and FULL deck
        // object, so each peer reconstructs opponents verbatim — with their real
        // alias, avatar, gamemat, and chosen deck.
        const profile = (data.profile && typeof data.profile === 'object' && data.profile.alias)
          ? data.profile
          : { alias: data.alias, avatar: data.avatar, avatarImg: '', gamematIdx: 3 };
        const deck = (data.deck && typeof data.deck === 'object' && Array.isArray(data.deck.cards))
          ? data.deck
          : null;
        return { value: JSON.stringify({
          profile,
          deckId: deck?.id || data.deck?.id || null,
          deck,
          ready:  data.ready,
          userId: data.user_id,
        })};
      }
      return null;
    } catch (e) {
      console.warn('[storage.get shared]', key, e);
      return null;
    }
  },

  async set(key, value) {
    try {
      const me = await uid();
      if (!me) return null;
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;

      const m1 = key.match(ROOM_META_RE);
      if (m1) {
        const id = m1[1];
        // v2 fix: joiners also call set('room_<id>_meta') in v6's flow, but
        // they shouldn't own the room row (RLS blocks non-hosts from updating).
        // Check if a row already exists — if yes and we're not the host, skip.
        const { data: existing } = await supabase.from('rooms').select('host_id').eq('id', id).maybeSingle();
        if (existing && existing.host_id !== me) {
          // Joiner — meta already owned by host. Their own row is written via room_players.
          return { value };
        }
        const row = {
          id,
          name: parsed.name,
          host_id: me,
          max_players: parsed.maxPlayers || 2,
          gamemode: parsed.gamemode || 'standard',
          status: parsed.status || 'waiting',
          meta: { host: parsed.host, hostAvatar: parsed.hostAvatar },
        };
        const { error } = await supabase.from('rooms').upsert(row);
        if (error) { console.warn('[rooms.upsert]', error); return null; }
        return { value };
      }

      const m2 = key.match(ROOM_PLAYER_RE);
      if (m2) {
        const id = m2[1]; const seat = +m2[2];
        // v2 fix (bug #1): if caller only passes deckId, look up the full deck
        // from their local decks in localStorage and include it verbatim.
        let fullDeck = parsed.deck || null;
        if (!fullDeck && parsed.deckId) {
          try {
            const decksRaw = localStorage.getItem('mtg_decks_v3');
            if (decksRaw) {
              const decks = JSON.parse(decksRaw);
              fullDeck = decks.find(d => d.id === parsed.deckId) || null;
            }
          } catch {}
        }
        const row = {
          room_id: id,
          user_id: me,
          seat,
          ready:  !!parsed.ready,
          deck:   fullDeck,
          profile: parsed.profile || null,   // full profile JSONB
          alias:  parsed.profile?.alias || '',
          avatar: parsed.profile?.avatar || '🧙',
        };
        const { error } = await supabase
          .from('room_players').upsert(row, { onConflict: 'room_id,user_id' });
        if (error) { console.warn('[room_players.upsert]', error); return null; }
        return { value };
      }
      return null;
    } catch (e) {
      console.warn('[storage.set shared]', key, e);
      return null;
    }
  },

  async delete(key) {
    try {
      const m1 = key.match(ROOM_META_RE);
      if (m1) {
        await supabase.from('rooms').delete().eq('id', m1[1]);
        return { deleted: true };
      }
      const m2 = key.match(ROOM_PLAYER_RE);
      if (m2) {
        const me = await uid(); if (!me) return null;
        await supabase.from('room_players').delete().eq('room_id', m2[1]).eq('user_id', me);
        return { deleted: true };
      }
      return null;
    } catch (e) { console.warn('[storage.delete shared]', key, e); return null; }
  },

  async list(prefix = '') {
    try {
      // v6 calls storage.list("room_", true) to enumerate waiting rooms
      if (prefix === 'room_' || prefix === '') {
        // v2 fix (bug #3): join room_players to count actual occupants, and
        // filter out rooms that are full or abandoned (0 players = host left).
        // We also auto-close rooms older than 2 hours to prevent dead rooms.
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from('rooms')
          .select('id, max_players, created_at, room_players(user_id)')
          .eq('status', 'waiting')
          .gte('created_at', twoHoursAgo)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) { console.warn('[rooms.list]', error); return { keys: [] }; }
        const keys = (data || [])
          .filter(r => {
            const n = (r.room_players || []).length;
            return n > 0 && n < r.max_players;
          })
          .map(r => `room_${r.id}_meta`);
        return { keys };
      }
      return { keys: [] };
    } catch (e) { console.warn('[storage.list shared]', e); return { keys: [] }; }
  },
};

// ─── Public dispatcher: exactly matches v6 shim API ─────────────────────
export const storage = {
  async get(key, isShared = false)          { return (isShared ? shared : local).get(key); },
  async set(key, value, isShared = false)   { return (isShared ? shared : local).set(key, value); },
  async delete(key, isShared = false)       { return (isShared ? shared : local).delete(key); },
  async list(prefix = '', isShared = false) { return (isShared ? shared : local).list(prefix); },
};

// v2 fix (bug #3): explicit leaveRoom — removes own row from room_players
// so the seat frees up. If the caller is the host, also closes the room
// so it disappears from the lobby list.
export async function leaveRoom(roomId) {
  try {
    const { data: u } = await supabase.auth.getUser();
    const me = u?.user?.id; if (!me || !roomId) return;
    // Get room to check if I'm host
    const { data: room } = await supabase.from('rooms').select('host_id, status').eq('id', roomId).maybeSingle();
    // Delete my seat
    await supabase.from('room_players').delete().eq('room_id', roomId).eq('user_id', me);
    // If host, close the room so it's removed from listings
    if (room && room.host_id === me) {
      await supabase.from('rooms').update({ status: 'closed' }).eq('id', roomId);
    } else if (room) {
      // If non-host left, check whether any players remain; if 0, close.
      const { count } = await supabase
        .from('room_players').select('*', { count: 'exact', head: true }).eq('room_id', roomId);
      if ((count || 0) === 0) {
        await supabase.from('rooms').update({ status: 'closed' }).eq('id', roomId);
      }
    }
  } catch (e) { console.warn('[leaveRoom]', e); }
}

export default storage;
