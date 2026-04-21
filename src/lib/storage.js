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
        return { value: JSON.stringify({
          profile: { alias: data.alias, avatar: data.avatar },
          deckId:  data.deck?.id || null,
          deck:    data.deck || null,
          ready:   data.ready,
          userId:  data.user_id,
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
        // Upsert room row
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
        const row = {
          room_id: id,
          user_id: me,
          seat,
          ready:  !!parsed.ready,
          deck:   parsed.deck || null,
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
        const { data } = await supabase
          .from('rooms').select('id').eq('status', 'waiting').order('created_at', { ascending: false }).limit(50);
        const keys = (data || []).map(r => `room_${r.id}_meta`);
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

export default storage;
