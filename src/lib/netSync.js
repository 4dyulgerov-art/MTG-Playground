/*  src/lib/netSync.js — v7.6.3
    ─────────────────────────────────────────────────────────────────────────
    Game-state sync + event log.

    DUAL TRANSPORT:
      - If import.meta.env.VITE_WS_URL is set → use custom WebSocket relay
        (Bun server in /server). Removes Supabase Realtime as a bottleneck.
      - Otherwise → falls back to Supabase Realtime broadcast channel.
      - In BOTH paths, full state still upserts to Supabase 'game_state' table
        every ~3s for rejoin recovery (durable backstop).

    v7.6.3 changes:
      - Throttle: 50/40ms → 70/70ms (~14Hz). Combined with CSS transitions
        on the receiver, motion remains smooth while message rate drops 40-65%.
      - DB upsert debounce: 800ms → 3000ms (rejoin only, not gameplay path).
      - Optional WS transport with reconnect, exponential backoff, JWT refresh.
      - onConnState callback for UI banner ("Reconnecting…", "Disconnected").
      - broadcast() accepts (slimForTransport, fullForDb) — DB always full.

    v7.6.2 changes preserved:
      - Position-delta channel (broadcastPositions) for drag updates.
      - Full-state broadcast still exists for non-drag updates.
      - postgres_changes fallback for cold-start state hydration.

    v7.4 additions preserved:
      - loadHistory, appendEvent, subscribeEvents.
    ─────────────────────────────────────────────────────────────────────────
*/

import { supabase } from './supabase';

const WS_URL = (typeof import.meta !== 'undefined' && import.meta.env)
  ? (import.meta.env.VITE_WS_URL || '').replace(/\/+$/, '')
  : '';

// Reconnect timing. Exponential backoff capped at 30s.
const RECONNECT_BASE_MS  = 250;
const RECONNECT_MAX_MS   = 30000;
const PING_INTERVAL_MS   = 30000;  // Cloudflare drops idle WS at 100s

export class NetSync {
  constructor({ roomId, userId, alias, onRemoteState, onPositions, onConnState }) {
    this.roomId        = roomId;
    this.userId        = userId;
    this.alias         = alias || 'Player';
    this.onRemoteState = onRemoteState;
    this.onPositions   = onPositions || null;
    this.onConnState   = onConnState || null;

    // Per-sender monotonic sequence for dedupe.
    this.outSeq         = 0;
    this.lastSeenByUser = {};
    this.lastPosSeenByUser = {};

    // Transport state — either Supabase channel OR custom WS.
    this.transport    = WS_URL ? 'ws' : 'supabase';
    this.channel      = null;
    this.evtChannel   = null;
    this.ws           = null;
    this.wsJoined     = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer   = null;
    this.pingTimer        = null;
    this.authSub          = null;

    // Full-state throttle (trailing edge).
    this.broadcastTimer    = null;
    this.pendingBroadcast  = null;  // slim form for transport
    this.pendingFull       = null;  // full form for db

    // Position throttle (trailing edge, shorter interval).
    this.positionTimer    = null;
    this.pendingPositions = null;

    // DB upsert debounce.
    this.flushTimer  = null;

    this.subscribed   = false;
    this.closed       = false;

    this.broadcastThrottleMs = 70;
    this.positionThrottleMs  = 70;
    this.dbDebounceMs        = 3000;
  }

  _emitConnState(state, detail) {
    if (this.onConnState) {
      try { this.onConnState({ state, detail }); }
      catch (e) { console.warn('[netSync.onConnState]', e); }
    }
  }

  async start() {
    // 1) Always seed from DB (initial state for joiners).
    try {
      const { data } = await supabase
        .from('game_state').select('*').eq('room_id', this.roomId).maybeSingle();
      if (data) this.onRemoteState(data.state, { initial: true });
    } catch (e) { console.warn('[netSync.start seed]', e); }

    // 2) Open the realtime transport.
    if (this.transport === 'ws') {
      this._connectWS();
      // Reconnect on auth refresh with the new JWT.
      try {
        this.authSub = supabase.auth.onAuthStateChange((event) => {
          if (event === 'TOKEN_REFRESHED' && this.ws && this.ws.readyState === 1) {
            try { this.ws.close(4001, 'token refresh'); } catch {}
          }
        });
      } catch (e) { console.warn('[netSync.authSub]', e); }
    } else {
      this._connectSupabase();
    }
  }

  // ── SUPABASE TRANSPORT (legacy / fallback) ────────────────────────────

  _connectSupabase() {
    this.channel = supabase
      .channel(`gs:${this.roomId}`)
      .on('broadcast', { event: 'state' },     (msg) => this._handleStateMsg(msg?.payload))
      .on('broadcast', { event: 'positions' }, (msg) => this._handlePositionsMsg(msg?.payload))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'game_state',
        filter: `room_id=eq.${this.roomId}`,
      }, (payload) => this._handlePostgres(payload))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.subscribed = true;
          this._emitConnState('connected', { transport: 'supabase' });
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          this.subscribed = false;
          this._emitConnState('reconnecting', { transport: 'supabase', status });
        }
      });
  }

  // ── WS TRANSPORT (preferred when VITE_WS_URL set) ─────────────────────

  async _connectWS() {
    if (this.closed) return;

    let jwt = '';
    try {
      const { data } = await supabase.auth.getSession();
      jwt = data?.session?.access_token || '';
    } catch (e) { console.warn('[netSync.getSession]', e); }

    if (!jwt) {
      console.warn('[netSync] no JWT — deferring WS connect');
      this._scheduleReconnect();
      return;
    }

    const url = `${WS_URL}/ws?jwt=${encodeURIComponent(jwt)}`;
    let ws;
    try { ws = new WebSocket(url); }
    catch (e) {
      console.warn('[netSync.WS construct]', e);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.wsJoined = false;

    ws.onopen = () => {
      this.subscribed = true;
      this.reconnectAttempt = 0;
      try {
        ws.send(JSON.stringify({ type: 'join', roomId: this.roomId }));
        this.wsJoined = true;
      } catch (e) { console.warn('[netSync.WS join]', e); }
      this._emitConnState('connected', { transport: 'ws' });
      this._startPingLoop();
      // Re-hydrate state from DB on every (re)connect — defense in depth.
      this._rehydrateFromDb();
      // PG fallback for missed broadcasts (low rate, harmless overlap).
      this._subscribePgFallback();
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'welcome' || msg.type === 'joined') return;
      if (msg.type === 'pong')    return;
      if (msg.type === 'state')      return this._handleStateMsg(msg.payload || msg);
      if (msg.type === 'positions')  return this._handlePositionsMsg(msg.payload || msg);
    };

    ws.onclose = (ev) => {
      this.subscribed = false;
      this.wsJoined = false;
      this._stopPingLoop();
      if (this.closed) return;
      this._emitConnState('reconnecting', { transport: 'ws', code: ev.code });
      this._scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.warn('[netSync.WS error]', e?.message || e);
    };
  }

  _scheduleReconnect() {
    if (this.closed) return;
    if (this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** (this.reconnectAttempt - 1)));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.transport === 'ws') this._connectWS();
    }, delay);
  }

  _startPingLoop() {
    this._stopPingLoop();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        try { this.ws.send(JSON.stringify({ type: 'ping', ts: Date.now() })); } catch {}
      }
    }, PING_INTERVAL_MS);
  }

  _stopPingLoop() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  async _rehydrateFromDb() {
    try {
      const { data } = await supabase
        .from('game_state').select('*').eq('room_id', this.roomId).maybeSingle();
      if (data && data.state) {
        this.onRemoteState(data.state, { initial: false, path: 'rehydrate' });
      }
    } catch (e) { console.warn('[netSync.rehydrate]', e); }
  }

  _subscribePgFallback() {
    if (this.channel) return;
    try {
      this.channel = supabase
        .channel(`gs:${this.roomId}:pgfb`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'game_state',
          filter: `room_id=eq.${this.roomId}`,
        }, (payload) => this._handlePostgres(payload))
        .subscribe();
    } catch (e) { console.warn('[netSync._subscribePgFallback]', e); }
  }

  // ── FULL STATE PATH ────────────────────────────────────────────────────

  broadcast(stateForTransport, stateForDb) {
    if (this.closed) return;
    this.pendingBroadcast = stateForTransport;
    this.pendingFull      = stateForDb || stateForTransport;

    console.log('[netSync.broadcast]', {
      slimPayloadSize: JSON.stringify(stateForTransport).length,
      slimHasPlayers: stateForTransport?.players?.length || 0,
      fullPayloadSize: JSON.stringify(stateForDb || stateForTransport).length,
      throttleMs: this.broadcastThrottleMs,
      transport: this.transport,
    });

    if (!this.broadcastTimer) {
      this.broadcastTimer = setTimeout(() => {
        this.broadcastTimer = null;
        this._sendState(this.pendingBroadcast);
        this.pendingBroadcast = null;
      }, this.broadcastThrottleMs);
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.dbDebounceMs);
    }
  }

  _sendState(state) {
    if (!state || this.closed) return;
    this.outSeq += 1;
    const seq = this.outSeq;
    const payload = { state, seq, from: this.userId, ts: Date.now() };
    console.log('[netSync._sendState] seq:', seq, 'stateSize:', JSON.stringify(state).length);
    try {
      if (this.transport === 'ws' && this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'state', payload }));
        console.log('[netSync._sendState] WS sent');
      } else if (this.channel) {
        this.channel.send({ type: 'broadcast', event: 'state', payload });
        console.log('[netSync._sendState] Supabase sent');
      } else {
        console.log('[netSync._sendState] no transport ready');
      }
    } catch (e) { console.warn('[netSync._sendState]', e); }
  }

  _handleStateMsg(data) {
    if (this.closed || !data) return;
    if (data.from === this.userId) return;
    const prev = this.lastSeenByUser[data.from] || 0;
    if (typeof data.seq === 'number' && data.seq <= prev) return;
    this.lastSeenByUser[data.from] = data.seq || 0;
    try { this.onRemoteState(data.state, { initial: false, path: 'broadcast' }); }
    catch (e) { console.warn('[netSync.onRemoteState broadcast]', e); }
  }

  // ── POSITION-DELTA PATH ────────────────────────────────────────────────

  broadcastPositions(seatIdx, positions) {
    if (this.closed) return;
    if (!Array.isArray(positions) || positions.length === 0) return;
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
    if (!pending || this.closed) return;
    this.outSeq += 1;
    const seq = this.outSeq;
    const payload = {
      seatIdx: pending.seatIdx,
      positions: pending.positions,
      seq, from: this.userId, ts: Date.now(),
    };
    try {
      if (this.transport === 'ws' && this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'positions', payload }));
      } else if (this.channel) {
        this.channel.send({ type: 'broadcast', event: 'positions', payload });
      }
    } catch (e) { console.warn('[netSync._sendPositions]', e); }
  }

  _handlePositionsMsg(data) {
    if (this.closed || !data) return;
    if (data.from === this.userId) return;
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
    const state = this.pendingFull;
    this.pendingFull = null;
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
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this._stopPingLoop();
    if (this.pendingFull) { try { await this.flush(); } catch {} }
    if (this.ws) {
      try { this.ws.close(1000, 'stop'); } catch {}
      this.ws = null;
    }
    if (this.authSub && typeof this.authSub.data?.subscription?.unsubscribe === 'function') {
      try { this.authSub.data.subscription.unsubscribe(); } catch {}
    }
    if (this.channel)    { await supabase.removeChannel(this.channel); this.channel = null; }
    if (this.evtChannel) { await supabase.removeChannel(this.evtChannel); this.evtChannel = null; }
  }
}
