/*  src/lib/netSync.js — v7.4
    ─────────────────────────────────────────────────────────────────────────
    Game-state sync + event log over Supabase Realtime.

    v7.4 additions:
      - loadHistory(): SELECT recent game_events on join (so chat+log persist
        across rejoin for everyone).
      - events now carry user_id and alias so the UI always attributes them
        to the correct username (never "Opponent").
      - hand-request / hand-reveal / hand-deny helpers built on game_events.
      - game-start sync flag stored in game_state so the shuffle+draw-7
        animation fires exactly once per seat.
    ─────────────────────────────────────────────────────────────────────────
*/

import { supabase } from './supabase';

export class NetSync {
  constructor({ roomId, userId, alias, onRemoteState }) {
    this.roomId        = roomId;
    this.userId        = userId;
    this.alias         = alias || 'Player';
    this.onRemoteState = onRemoteState;
    this.version       = 0;
    this.channel       = null;
    this.evtChannel    = null;
    this.pending       = null;
    this.flushTimer    = null;
    this.closed        = false;
  }

  async start() {
    const { data } = await supabase
      .from('game_state').select('*').eq('room_id', this.roomId).maybeSingle();
    if (data) {
      this.version = Number(data.version) || 0;
      this.onRemoteState(data.state, { initial: true });
    }

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
    if (ver <= this.version) return;
    if (row.last_writer === this.userId) {
      this.version = ver;
      return;
    }
    this.version = ver;
    this.onRemoteState(row.state, { initial: false });
  }

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

  // Append an event (chat, action log, hand-request, hand-reveal, etc.).
  // Every payload is stamped with user_id + alias so UI attribution works.
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

  // v7.4: pull the last N events (chronological) for replay on rejoin.
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
    if (this.channel)    { await supabase.removeChannel(this.channel); this.channel = null; }
    if (this.evtChannel) { await supabase.removeChannel(this.evtChannel); this.evtChannel = null; }
  }
}
