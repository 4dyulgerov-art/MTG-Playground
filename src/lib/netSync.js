/*  src/lib/netSync.js — v7.6.2
    ─────────────────────────────────────────────────────────────────────────
    Game-state sync + event log over Supabase Realtime.

    v7.6.2 — Real-time perf overhaul:
      - channel.send() was firing on EVERY broadcast (60/sec during drag).
        Supabase free tier rate-limits at ~100 msg/sec; messages buffered
        server-side → 5-10 second visible lag. NOW: trailing-edge throttle
        at 50ms (20 Hz max).
      - Added broadcastPositions(seatIdx, positions) — tiny-payload delta
        channel for drag updates. Carries only {iid, x, y, tapped} per card.
        Receiver's onPositions callback patches local state without a full
        state replace. Keeps drag smooth without overwhelming the pipe.
      - Full-state broadcast still exists (for tap, zone moves, life changes,
        etc.) but throttled.
      - DB upsert debounce: 800ms (persistence backstop for rejoin).
      - postgres_changes fallback remains for cold-start state hydration.

    v7.4 additions preserved:
      - loadHistory(): SELECT recent game_events on join.
      - events stamped with user_id + alias.
      - appendEvent / subscribeEvents helpers.
    ─────────────────────────────────────────────────────────────────────────
*/

import { supabase } from './supabase';

export class NetSync {
  constructor({ roomId, userId, alias, onRemoteState, onPositions }) {
    this.roomId        = roomId;
    this.userId        = userId;
    this.alias         = alias || 'Player';
    this.onRemoteState = onRemoteState;
    this.onPositions   = onPositions || null;

    // Per-sender monotonic sequence for dedupe.
    this.outSeq         = 0;
    this.lastSeenByUser = {};  // userId -> highest state seq
    this.lastPosSeenByUser = {};  // userId -> highest position seq

    this.channel      = null;
    this.evtChannel   = null;

    // Full-state broadcast throttle (channel.send) — trailing edge.
    this.broadcastTimer   = null;
    this.pendingBroadcast = null;

    // Position-broadcast throttle — trailing edge, shorter interval.
    this.positionTimer   = null;
    this.pendingPositions = null;  // {seatIdx, positions}

    // DB upsert debounce (persistence only, not latency-critical).
    this.pendingDb   = null;
    this.flushTimer  = null;

    this.subscribed   = false;
    this.closed       = false;

    // Tunable timings. Throttle too low → rate limits; too high → visible jitter.
    // 50ms = 20Hz broadcasts, 40ms = 25Hz position updates, 800ms = durable DB writes.
    this.broadcastThrottleMs = 50;
    this.positionThrottleMs  = 40;
    this.dbDebounceMs        = 800;
  }

  async start() {
    // 1) Seed from DB (for rejoin / initial load).
    const { data } = await supabase
      .from('game_state').select('*').eq('room_id', this.roomId).maybeSingle();
    if (data) {
      this.onRemoteState(data.state, { initial: true });
    }

    // 2) Subscribe to broadcast channel (fast path: state + positions)
    //    + postgres_changes (durable fallback).
    this.channel = supabase
      .channel(`gs:${this.roomId}`)
      .on('broadcast', { event: 'state' },     (msg) => this._handleState(msg))
      .on('broadcast', { event: 'positions' }, (msg) => this._handlePositions(msg))
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

  // ── FULL STATE PATH ────────────────────────────────────────────────────
  // For non-drag updates (tap, life change, zone moves, etc.). Throttled
  // trailing-edge at 50ms.

  broadcast(state) {
    if (this.closed) return;
    this.pendingBroadcast = state;
    this.pendingDb = state;

    // Throttle channel send
    if (!this.broadcastTimer) {
      this.broadcastTimer = setTimeout(() => {
        this.broadcastTimer = null;
        this._sendState(this.pendingBroadcast);
        this.pendingBroadcast = null;
      }, this.broadcastThrottleMs);
    }
    // Debounce DB upsert (persistence)
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.dbDebounceMs);
    }
  }

  _sendState(state) {
    if (!state || this.closed || !this.channel) return;
    this.outSeq += 1;
    const seq = this.outSeq;
    try {
      this.channel.send({
        type: 'broadcast',
        event: 'state',
        payload: { state, seq, from: this.userId, ts: Date.now() },
      });
    } catch (e) { console.warn('[netSync._sendState]', e); }
  }

  _handleState(msg) {
    if (this.closed) return;
    const data = msg?.payload;
    if (!data || data.from === this.userId) return;
    const prev = this.lastSeenByUser[data.from] || 0;
    if (typeof data.seq === 'number' && data.seq <= prev) return;
    this.lastSeenByUser[data.from] = data.seq || 0;
    try { this.onRemoteState(data.state, { initial: false, path: 'broadcast' }); }
    catch (e) { console.warn('[netSync.onRemoteState broadcast]', e); }
  }

  // ── POSITION-ONLY DELTA PATH ───────────────────────────────────────────
  // For drag updates. Payload is tiny (few KB at most), throttled to ~25Hz.
  // This is what makes live drag appear real-time.

  broadcastPositions(seatIdx, positions) {
    if (this.closed) return;
    if (!Array.isArray(positions) || positions.length === 0) return;
    // Merge into pending — latest positions win for each iid
    if (!this.pendingPositions || this.pendingPositions.seatIdx !== seatIdx) {
      this.pendingPositions = { seatIdx, positions: [...positions] };
    } else {
      const map = new Map();
      for (const p of this.pendingPositions.positions) map.set(p.iid, p);
      for (const p of positions) map.set(p.iid, p);
      this.pendingPositions.positions = Array.from(map.values());
    }
    if (!this.positionTimer) {
      this.positionTimer = setTimeout(() => {
        this.positionTimer = null;
        this._sendPositions(this.pendingPositions);
        this.pendingPositions = null;
      }, this.positionThrottleMs);
    }
  }

  _sendPositions(pending) {
    if (!pending || this.closed || !this.channel) return;
    this.outSeq += 1;
    const seq = this.outSeq;
    try {
      this.channel.send({
        type: 'broadcast',
        event: 'positions',
        payload: {
          seatIdx: pending.seatIdx,
          positions: pending.positions,
          seq, from: this.userId, ts: Date.now(),
        },
      });
    } catch (e) { console.warn('[netSync._sendPositions]', e); }
  }

  _handlePositions(msg) {
    if (this.closed) return;
    const data = msg?.payload;
    if (!data || data.from === this.userId) return;
    const prev = this.lastPosSeenByUser[data.from] || 0;
    if (typeof data.seq === 'number' && data.seq <= prev) return;
    this.lastPosSeenByUser[data.from] = data.seq || 0;
    if (this.onPositions) {
      try { this.onPositions(data); }
      catch (e) { console.warn('[netSync.onPositions]', e); }
    }
  }

  // ── Durable persistence path ──────────────────────────────────────────

  _handlePostgres(payload) {
    if (this.closed) return;
    const row = payload.new || payload.record;
    if (!row) return;
    if (row.last_writer === this.userId) return;
    try { this.onRemoteState(row.state, { initial: false, path: 'postgres' }); }
    catch (e) { console.warn('[netSync.onRemoteState postgres]', e); }
  }

  async flush() {
    this.flushTimer = null;
    const state = this.pendingDb;
    this.pendingDb = null;
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

  // ── Event log (chat, action attribution) — unchanged ──────────────────

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
    if (this.broadcastTimer) { clearTimeout(this.broadcastTimer); this.broadcastTimer = null; }
    if (this.positionTimer)  { clearTimeout(this.positionTimer);  this.positionTimer  = null; }
    if (this.flushTimer)     { clearTimeout(this.flushTimer);     this.flushTimer     = null; }
    // Final flush so the DB reflects terminal state for rejoin recovery.
    if (this.pendingDb) { try { await this.flush(); } catch {} }
    if (this.channel)    { await supabase.removeChannel(this.channel); this.channel = null; }
    if (this.evtChannel) { await supabase.removeChannel(this.evtChannel); this.evtChannel = null; }
  }
}
