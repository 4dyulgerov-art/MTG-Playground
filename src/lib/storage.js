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
        const baseRow = {
          room_id: id,
          user_id: me,
          seat,
          ready:  !!parsed.ready,
          deck:   fullDeck,
          profile: parsed.profile || null,   // full profile JSONB
          alias:  parsed.profile?.alias || '',
          avatar: parsed.profile?.avatar || '🧙',
        };
        // v7.6.5: try with `updated_at` first (so PresenceCounter "in-game"
        // tab works). If the DB doesn't have that column, silently retry
        // without it. v7.6.4 hard-required the column and broke seat writes
        // on installs where the column was missing → host immediately
        // appeared to leave the room they just created.
        let { error } = await supabase
          .from('room_players').upsert({ ...baseRow, updated_at: new Date().toISOString() }, { onConflict: 'room_id,user_id' });
        if (error && /updated_at/i.test(error.message || '')) {
          // Column missing — retry without it. Don't log a warning.
          const retry = await supabase
            .from('room_players').upsert(baseRow, { onConflict: 'room_id,user_id' });
          error = retry.error;
        }
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
        // v7.6.1: SHOW rooms regardless of whether they're "full" by seat count
        // — a dropped player's stale row occupies their seat, so a 2/2 room may
        // actually have a free slot for rejoin. Callers (joinRoom) detect rejoins
        // by matching user_id against room_players. Still filter to status=waiting
        // and auto-hide abandoned rooms (0 players) and dead rooms (2+ hours old).
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
          .filter(r => (r.room_players || []).length > 0)
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

// v7.6.1 fix (bug #3): explicit leaveRoom — removes own row from room_players
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

// v7.6.2: sweep all my stale room_players rows. Call on app mount and before
// creating/joining a new room. Prevents the "3 rooms stuck at 2/2" bug when a
// user force-closes the browser without explicit leave. Optionally keep one
// room if we're currently joined to it (rejoin-in-progress flow).
export async function cleanupMyStaleRooms(keepRoomId = null) {
  try {
    const { data: u } = await supabase.auth.getUser();
    const me = u?.user?.id;
    if (!me) return;
    // Find all rooms I still have rows in
    const { data: myRows } = await supabase
      .from('room_players')
      .select('room_id')
      .eq('user_id', me);
    if (!Array.isArray(myRows) || myRows.length === 0) return;
    const roomIds = [...new Set(myRows.map(r => r.room_id))].filter(id => id !== keepRoomId);
    if (roomIds.length === 0) return;
    // Delete my rows in all those rooms
    await supabase.from('room_players').delete()
      .eq('user_id', me)
      .in('room_id', roomIds);
    // For rooms where I was host AND now empty, mark closed
    for (const rid of roomIds) {
      try {
        const { data: room } = await supabase.from('rooms')
          .select('host_id, status').eq('id', rid).maybeSingle();
        if (!room) continue;
        const { count } = await supabase.from('room_players')
          .select('*', { count: 'exact', head: true }).eq('room_id', rid);
        if (room.host_id === me || (count || 0) === 0) {
          await supabase.from('rooms').update({ status: 'closed' }).eq('id', rid);
        }
      } catch {}
    }
  } catch (e) { console.warn('[cleanupMyStaleRooms]', e); }
}

export default storage;
