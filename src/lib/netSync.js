/*  src/lib/netSync.js
    ─────────────────────────────────────────────────────────────────────────
    Game-state sync over Supabase Realtime.
    Designed to hook into v6's existing centralized `updatePlayer` /
    `updateGame` functions with MINIMAL intrusion.

    Model (Phase 1):
      - One row in `game_state` per room (upsert). Whole game state as JSON.
      - Any player in the room can write. Last-write-wins.
      - Every write increments `version` and sets `last_writer`.
      - Every client subscribes to UPDATEs and applies them if
        version > localVersion AND last_writer !== me.
      - Local writes are optimistic: apply to React state instantly,
        then broadcast. If a remote write lands first, we accept it.
      - Debounced at 80ms so rapid taps don't spam the server.

    Known limitations (Phase 2 targets):
      - True conflict resolution (two players touching the same card
        within 80ms window → last-write-wins truncates one action).
      - Selective per-zone authority (each player "owns" their own zones).
      - CRDT or OT for eventually-consistent merges.
    ─────────────────────────────────────────────────────────────────────────
*/

import { supabase } from './supabase';

export class NetSync {
  constructor({ roomId, userId, onRemoteState }) {
    this.roomId        = roomId;
    this.userId        = userId;
    this.onRemoteState = onRemoteState;
    this.version       = 0;
    this.channel       = null;
    this.pending       = null;
    this.flushTimer    = null;
    this.closed        = false;
  }

  // Call once after construction.
  async start() {
    // 1. Fetch initial state if any.
    const { data } = await supabase
      .from('game_state').select('*').eq('room_id', this.roomId).maybeSingle();
    if (data) {
      this.version = Number(data.version) || 0;
      this.onRemoteState(data.state, { initial: true });
    }

    // 2. Subscribe to UPDATEs.
    this.channel = supabase
      .channel(`gs:${this.roomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'game_state',
        filter: `room_id=eq.${this.roomId}`,
      }, (payload) => this.handleRemote(payload))
      .subscribe();
  }

  handleRemote(payload) {
    if (this.closed) return;
    const row = payload.new || payload.record;
    if (!row) return;
    const ver = Number(row.version) || 0;
    if (ver <= this.version) return;       // stale
    if (row.last_writer === this.userId) { // echo of our own write
      this.version = ver;
      return;
    }
    this.version = ver;
    this.onRemoteState(row.state, { initial: false });
  }

  // Call from v6's updatePlayer/updateGame after local state has updated.
  // `state` is the whole gameState object we want persisted.
  broadcast(state) {
    if (this.closed) return;
    this.pending = state;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 80);
  }

  async flush() {
    this.flushTimer = null;
    const state = this.pending;
    this.pending = null;
    if (!state || this.closed) return;
    const nextVer = this.version + 1;
    const { error } = await supabase.from('game_state').upsert({
      room_id:     this.roomId,
      state,
      version:     nextVer,
      last_writer: this.userId,
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'room_id' });
    if (!error) this.version = nextVer;
    else console.warn('[netSync.flush]', error);
  }

  // Append to the room event log (for chat and action log).
  async appendEvent(kind, payload) {
    if (this.closed) return;
    const { error } = await supabase.from('game_events').insert({
      room_id: this.roomId,
      user_id: this.userId,
      kind, payload,
    });
    if (error) console.warn('[netSync.appendEvent]', error);
  }

  subscribeEvents(onEvent) {
    const ch = supabase
      .channel(`ge:${this.roomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'game_events',
        filter: `room_id=eq.${this.roomId}`,
      }, (payload) => onEvent(payload.new))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }

  async stop() {
    this.closed = true;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.channel)    { await supabase.removeChannel(this.channel); this.channel = null; }
  }
}
