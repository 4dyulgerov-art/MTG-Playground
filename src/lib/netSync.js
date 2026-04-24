/*  src/lib/netSync.js — v7.6.1
    ─────────────────────────────────────────────────────────────────────────
    Game-state sync + event log over Supabase Realtime.

    v7.6.1 rewrite — DUAL-PATH SYNC:
      - Fast path: Realtime *broadcast channel* delivers masked state to
        peers over pure WebSocket (no DB roundtrip). Typical latency ~50ms.
      - Durable path: Debounced `game_state` upsert persists the latest
        broadcast for rejoin recovery. Longer debounce (500ms) is fine —
        real-time sync is handled by the fast path.
      - Incoming merge: broadcast takes precedence when fresher (monotonic
        per-user seq); postgres_changes only closes gaps after reconnects.

    Why the change: v7.5 routed EVERY update through a Postgres upsert +
    `postgres_changes` replication event. Under load (drags, many cards on
    BF, free-tier instance) this produced 5-10 second delays that made
    live drag unusable. Broadcast channels bypass Postgres entirely.

    v7.4 additions preserved:
      - loadHistory(): SELECT recent game_events on join.
      - events stamped with user_id + alias for correct attribution.
      - appendEvent / subscribeEvents helpers.
    ─────────────────────────────────────────────────────────────────────────
*/

import { supabase } from './supabase';

export class NetSync {
  constructor({ roomId, userId, alias, onRemoteState }) {
    this.roomId        = roomId;
    this.userId        = userId;
    this.alias         = alias || 'Player';
    this.onRemoteState = onRemoteState;

    // Per-sender monotonic sequence for broadcast dedupe.
    this.outSeq         = 0;
    this.lastSeenByUser = {};  // userId -> highest seq we've applied

    this.channel      = null;
    this.evtChannel   = null;
    this.pending      = null;
    this.flushTimer   = null;
    this.subscribed   = false;
    this.closed       = false;

    // DB upsert debounce — longer than pre-v7.6.1 because broadcast carries
    // the real-time work. 500ms means ~2 persistent snapshots/sec maximum,
    // which is plenty for rejoin recovery and keeps DB writes modest.
    this.dbDebounceMs = 500;
  }

  async start() {
    // 1) Seed from DB (for rejoin / initial load).
    const { data } = await supabase
      .from('game_state').select('*').eq('room_id', this.roomId).maybeSingle();
    if (data) {
      this.onRemoteState(data.state, { initial: true });
    }

    // 2) Subscribe to broadcast channel (fast path) + postgres_changes
    //    (durable fallback, mainly useful when rejoining).
    this.channel = supabase
      .channel(`gs:${this.roomId}`, {
        config: {
          // Don't echo our own broadcasts back to us.
          broadcast: { self: false, ack: false },
          presence: { key: this.userId },
        },
      })
      .on('broadcast', { event: 'state' }, (msg) => this._handleBroadcast(msg))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'game_state',
        filter: `room_id=eq.${this.roomId}`,
      }, (payload) => this._handlePostgres(payload))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') this.subscribed = true;
      });
  }

  // ── Broadcast path ─────────────────────────────────────────────────────
  // Called by Playground on every local state change. Fire-and-forget via
  // the Realtime channel for instant delivery, AND schedule a debounced DB
  // upsert for persistence.

  broadcast(state) {
    if (this.closed) return;

    // 1) Instant broadcast via Realtime channel
    this.outSeq += 1;
    const seq = this.outSeq;
    if (this.channel) {
      try {
        // Fire-and-forget. Before `subscribed` is true this may no-op;
        // receivers catch up via the next postgres_changes event.
        this.channel.send({
          type: 'broadcast',
          event: 'state',
          payload: { state, seq, from: this.userId, ts: Date.now() },
        });
      } catch (e) { console.warn('[netSync.broadcast.send]', e); }
    }

    // 2) Schedule durable DB upsert
    this.pending = state;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), this.dbDebounceMs);
  }

  _handleBroadcast(msg) {
    if (this.closed) return;
    const data = msg?.payload;
    if (!data || data.from === this.userId) return;
    const prev = this.lastSeenByUser[data.from] || 0;
    if (typeof data.seq === 'number' && data.seq <= prev) return;
    this.lastSeenByUser[data.from] = data.seq || 0;
    try { this.onRemoteState(data.state, { initial: false, path: 'broadcast' }); }
    catch (e) { console.warn('[netSync.onRemoteState broadcast]', e); }
  }

  _handlePostgres(payload) {
    if (this.closed) return;
    const row = payload.new || payload.record;
    if (!row) return;
    if (row.last_writer === this.userId) return;  // our own upsert echo
    try { this.onRemoteState(row.state, { initial: false, path: 'postgres' }); }
    catch (e) { console.warn('[netSync.onRemoteState postgres]', e); }
  }

  async flush() {
    this.flushTimer = null;
    const state = this.pending;
    this.pending = null;
    if (!state || this.closed) return;
    try {
      const { data } = await supabase.from('game_state')
        .select('version').eq('room_id', this.roomId).maybeSingle();
      const curr = Number(data?.version) || 0;
      const nextVer = curr + 1;
      const { error } = await supabase.from('game_state').upsert({
        room_id:     this.roomId,
        state,
        version:     nextVer,
        last_writer: this.userId,
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'room_id' });
      if (error) console.warn('[netSync.flush]', error);
    } catch (e) { console.warn('[netSync.flush exception]', e); }
  }

  // ── Event log (chat, action attribution) — unchanged from v7.4 ────────

  async appendEvent(kind, payload) {
    if (this.closed) return;
    const stamped = { ...(payload || {}), user_id: this.userId, alias: this.alias };
    const { error } = await supabase.from('game_events').insert({
      room_id: this.roomId,
      user_id: this.userId,
      kind,
      payload: stamped,
    });
    if (error) console.warn('[netSync.appendEvent]', error);
  }

  async loadHistory({ limit = 200 } = {}) {
    if (this.closed) return [];
    const { data, error } = await supabase
      .from('game_events')
      .select('*')
      .eq('room_id', this.roomId)
      .order('id', { ascending: true })
      .limit(limit);
    if (error) { console.warn('[netSync.loadHistory]', error); return []; }
    return data || [];
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
    this.evtChannel = ch;
    return () => supabase.removeChannel(ch);
  }

  async stop() {
    this.closed = true;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    // Final flush so the DB reflects terminal state for rejoin recovery.
    if (this.pending) { try { await this.flush(); } catch {} }
    if (this.channel)    { await supabase.removeChannel(this.channel); this.channel = null; }
    if (this.evtChannel) { await supabase.removeChannel(this.evtChannel); this.evtChannel = null; }
  }
}
