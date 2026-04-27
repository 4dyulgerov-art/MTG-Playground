/*  src/lib/netSync.js — v7.6.4
    ─────────────────────────────────────────────────────────────────────────
    Game-state sync + event log.

    DUAL TRANSPORT:
      - If import.meta.env.VITE_WS_URL is set → use custom WebSocket relay
        (Bun server in /server). Removes Supabase Realtime as a bottleneck.
      - Otherwise → falls back to Supabase Realtime broadcast channel.
      - In BOTH paths, full state still upserts to Supabase 'game_state' table
        every ~3s for rejoin recovery (durable backstop).

    v7.6.4 changes (THE HYDRATION BUG FIX):
      - onRemoteState now receives info.from (userId), info.fromSeat (number|null),
        info.initial (bool), info.path ('seed'|'broadcast'|'postgres'|'rehydrate').
        This lets the receiver implement per-seat authority: a peer's broadcast
        only authoritatively updates THAT peer's seat, not the entire state.
      - broadcast() accepts a senderSeat option:
          netSync.broadcast(slim, full, { senderSeat })
        which is included in the wire payload as `fromSeat`.
      - Removed verbose console.log noise from broadcast/_sendState. Behind a
        DEBUG flag now (set NetSync.DEBUG = true to re-enable).
      - Initial DB seed flagged via info.path='seed'+info.initial=true so the
        receiver can do a one-time full replace instead of a per-seat patch.
      - setMySeat() helper for late-binding the broadcaster's seat index.

    v7.6.3 changes preserved:
      - Throttle: 70/70ms (~14Hz). Combined with CSS transitions
        on the receiver, motion remains smooth while message rate drops.
      - DB upsert debounce: 3000ms (rejoin only, not gameplay path).
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

// v7.6.4 anti-fragile: if no inbound message arrives within this window
// while the WS is "open", treat the connection as zombie and force a
// reconnect. Catches the case where an intermediate proxy silently drops
// outbound traffic (Cloudflare/CGNAT/etc.) without sending FIN.
//
// We send a ping every 30s; the server echoes pong immediately. If 90s
// elapse with zero inbound traffic (3 missed pongs), the connection is
// dead in a way readyState can't detect. Force-close it.
const WS_INBOUND_WATCHDOG_MS = 90000;

// Set to true to re-enable verbose broadcast/send logs (or flip
// NetSync.DEBUG = true at runtime).
const DEBUG_DEFAULT = false;
const dlog = (...args) => { if (NetSync.DEBUG) console.log(...args); };

export class NetSync {
  constructor({ roomId, userId, alias, mySeat, onRemoteState, onPositions, onConnState }) {
    this.roomId        = roomId;
    this.userId        = userId;
    this.alias         = alias || 'Player';
    // v7.6.4: own seat index. Used to stamp outgoing broadcasts. Optional —
    // setMySeat() can update it after construction.
    this.mySeat        = (typeof mySeat === 'number') ? mySeat : null;
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
    this.pendingSenderSeat = null;  // seat index of broadcaster

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

  // v7.6.4: allow late assignment if mySeat wasn't known at construction.
  setMySeat(seatIdx) {
    if (typeof seatIdx === 'number') this.mySeat = seatIdx;
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
      if (data) {
        // v7.6.4: stamp initial=true so the receiver knows this is the
        // authoritative full snapshot (do a full replace, not a per-seat patch).
        // last_writer is the userId of the last broadcaster.
        this.onRemoteState(data.state, {
          initial: true,
          path: 'seed',
          from: data.last_writer || null,
          fromSeat: null,
        });
      }
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
      // v7.6.4 anti-fragile: start the inbound-watchdog the moment we open.
      this._lastInboundTs = Date.now();
      this._startWatchdog();
      // Re-hydrate state from DB on every (re)connect — defense in depth.
      this._rehydrateFromDb();
      // PG fallback for missed broadcasts (low rate, harmless overlap).
      this._subscribePgFallback();
    };

    ws.onmessage = (e) => {
      // v7.6.4: any inbound traffic (incl. welcome/joined/pong) keeps the
      // watchdog happy. The check fires elsewhere if we're starving.
      this._lastInboundTs = Date.now();
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
      this._stopWatchdog();
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
        try { this.ws.send(JSON.stringify({ type: 'ping' })); }
        catch (e) { console.warn('[netSync.ping]', e); }
      }
    }, PING_INTERVAL_MS);
  }
  _stopPingLoop() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  // v7.6.4 anti-fragile zombie-WS detector. The WebSocket spec only signals
  // close on a clean teardown — a silently-dropped TCP connection (CGNAT
  // timeout, mobile network handoff, Cloudflare proxy reset) leaves
  // readyState=1 forever while no traffic flows in either direction. We
  // poll: if readyState is OPEN but no inbound message in WATCHDOG_MS,
  // force-close, which triggers onclose → reconnect path.
  _startWatchdog() {
    this._stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return;
      const since = Date.now() - (this._lastInboundTs || Date.now());
      if (since > WS_INBOUND_WATCHDOG_MS) {
        console.warn(`[netSync.watchdog] no inbound traffic for ${since}ms — forcing reconnect`);
        try { this.ws.close(4002, 'watchdog stale'); } catch {}
        // onclose handler picks up from here.
      }
    }, 15000); // check every 15s
  }
  _stopWatchdog() {
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
  }

  async _rehydrateFromDb() {
    try {
      const { data } = await supabase
        .from('game_state').select('*').eq('room_id', this.roomId).maybeSingle();
      if (data && data.state) {
        // v7.6.4: rehydrate-from-db on reconnect is treated like a seed —
        // it's the latest authoritative full snapshot. Receiver merges
        // it as a full state (other seats accepted; own seat preserved).
        this.onRemoteState(data.state, {
          initial: false,
          path: 'rehydrate',
          from: data.last_writer || null,
          fromSeat: null,
        });
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

  /**
   * @param {object} stateForTransport  slim state (for WS/Supabase Realtime)
   * @param {object} stateForDb         full state (for game_state DB upsert)
   * @param {object} [opts]             { senderSeat?: number }
   */
  broadcast(stateForTransport, stateForDb, opts) {
    if (this.closed) return;
    this.pendingBroadcast = stateForTransport;
    this.pendingFull      = stateForDb || stateForTransport;
    // v7.6.4: capture sender seat, falling back to the instance value.
    const senderSeat = (opts && typeof opts.senderSeat === 'number')
      ? opts.senderSeat
      : this.mySeat;
    this.pendingSenderSeat = (typeof senderSeat === 'number') ? senderSeat : null;

    dlog('[netSync.broadcast]', {
      slimSize: JSON.stringify(stateForTransport).length,
      fullSize: JSON.stringify(stateForDb || stateForTransport).length,
      senderSeat: this.pendingSenderSeat,
      transport: this.transport,
    });

    if (!this.broadcastTimer) {
      this.broadcastTimer = setTimeout(() => {
        this.broadcastTimer = null;
        this._sendState(this.pendingBroadcast, this.pendingSenderSeat);
        this.pendingBroadcast = null;
        this.pendingSenderSeat = null;
      }, this.broadcastThrottleMs);
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.dbDebounceMs);
    }
  }

  _sendState(state, senderSeat) {
    if (!state || this.closed) return;
    this.outSeq += 1;
    const seq = this.outSeq;
    const payload = {
      state,
      seq,
      from: this.userId,
      fromSeat: (typeof senderSeat === 'number') ? senderSeat : (this.mySeat ?? null),
      ts: Date.now(),
    };
    dlog('[netSync._sendState]', { seq, fromSeat: payload.fromSeat });
    try {
      if (this.transport === 'ws' && this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'state', payload }));
      } else if (this.channel) {
        this.channel.send({ type: 'broadcast', event: 'state', payload });
      }
    } catch (e) { console.warn('[netSync._sendState]', e); }
  }

  _handleStateMsg(data) {
    if (this.closed || !data) return;
    if (data.from === this.userId) return;
    const prev = this.lastSeenByUser[data.from] || 0;
    if (typeof data.seq === 'number' && data.seq <= prev) return;
    this.lastSeenByUser[data.from] = data.seq || 0;
    try {
      this.onRemoteState(data.state, {
        initial: false,
        path: 'broadcast',
        from: data.from,
        fromSeat: (typeof data.fromSeat === 'number') ? data.fromSeat : null,
      });
    } catch (e) { console.warn('[netSync.onRemoteState broadcast]', e); }
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
    try {
      this.onRemoteState(row.state, {
        initial: false,
        path: 'postgres',
        from: row.last_writer || null,
        fromSeat: null,
      });
    } catch (e) { console.warn('[netSync.onRemoteState postgres]', e); }
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
    this._stopWatchdog(); // v7.6.4
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

// Runtime debug toggle: window.__MTG_V7__?.netSync && (NetSync.DEBUG = true)
NetSync.DEBUG = DEBUG_DEFAULT;
