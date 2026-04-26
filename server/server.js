/*
 * MTG Playground — WebSocket relay (v7.6.3)
 *
 * A small Bun-native WebSocket server that fan-outs JSON messages between
 * peers in the same room. Stateless: zero persistence (Supabase keeps the
 * authoritative game_state row).
 *
 * Why this exists:
 *   Supabase Realtime caps at ~100 msg/sec on Free, 2,500 msg/sec on Pro.
 *   At 25-70 concurrent games (especially 4p Commander) we blow past those
 *   ceilings during drag bursts. Bun's native WebSocket happily handles
 *   10k+ concurrent connections on a €5 VPS — and there's no per-message
 *   billing.
 *
 * Protocol (one JSON object per message; same shapes as Supabase Realtime
 * broadcast events so the client adapter is minimal):
 *
 *   Client → Server:
 *     {type:"join", roomId}
 *     {type:"leave"}
 *     {type:"state",     payload:{state, seq, from, ts}}
 *     {type:"positions", payload:{seatIdx, positions, seq, from, ts}}
 *     {type:"ping",      ts}
 *
 *   Server → Client:
 *     {type:"welcome", userId}      // on connect
 *     {type:"joined",  roomId}      // ack of join
 *     {type:"pong",    ts}          // ack of ping
 *     <verbatim peer message>       // fan-out from another peer in room
 *
 * Auth:
 *   Supabase issues HS256 JWTs signed with the project's JWT secret. We
 *   accept the JWT in the `?jwt=...` query param on the WS upgrade. We
 *   verify locally against SUPABASE_JWT_SECRET (env var). On invalid/missing
 *   token we 401 the upgrade.
 */

import { jwtVerify } from 'jose';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const PORT                = Number(process.env.PORT) || 3001;
const ALLOWED_ORIGIN      = process.env.ALLOWED_ORIGIN || ''; // optional; '' = allow any

if (!SUPABASE_JWT_SECRET) {
  console.error('[boot] FATAL: SUPABASE_JWT_SECRET not set');
  process.exit(1);
}

const SECRET_KEY = new TextEncoder().encode(SUPABASE_JWT_SECRET);

// roomId → Set<ServerWebSocket>
const rooms = new Map();
// ws → {userId, roomId?}
const sockMeta = new WeakMap();
// roomId → Set<userId> (just for visibility / health metrics)
const roomUsers = new Map();

async function verifyJWT(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET_KEY, { algorithms: ['HS256'] });
    return payload?.sub || null;
  } catch (e) {
    return null;
  }
}

function broadcastToRoom(roomId, sender, raw) {
  const peers = rooms.get(roomId);
  if (!peers) return 0;
  let n = 0;
  for (const peer of peers) {
    if (peer === sender) continue;
    if (peer.readyState !== 1) continue;
    try { peer.send(raw); n++; } catch {}
  }
  return n;
}

function leaveRoom(ws) {
  const meta = sockMeta.get(ws);
  if (!meta || !meta.roomId) return;
  const peers = rooms.get(meta.roomId);
  if (peers) {
    peers.delete(ws);
    if (peers.size === 0) rooms.delete(meta.roomId);
  }
  const users = roomUsers.get(meta.roomId);
  if (users) {
    users.delete(meta.userId);
    if (users.size === 0) roomUsers.delete(meta.roomId);
  }
  meta.roomId = undefined;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);

    // Health endpoint — used by Fly.io / uptime monitors.
    if (url.pathname === '/health') {
      const body = JSON.stringify({
        ok: true,
        rooms: rooms.size,
        connections: Array.from(rooms.values()).reduce((a, s) => a + s.size, 0),
        uptime_s: Math.floor(process.uptime()),
      });
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    }

    if (url.pathname !== '/ws') {
      return new Response('mtg-relay: WS endpoint at /ws', { status: 404 });
    }

    if (ALLOWED_ORIGIN) {
      const origin = req.headers.get('origin') || '';
      if (origin !== ALLOWED_ORIGIN) {
        return new Response('forbidden origin', { status: 403 });
      }
    }

    const token  = url.searchParams.get('jwt');
    const userId = await verifyJWT(token);
    if (!userId) return new Response('invalid jwt', { status: 401 });

    if (srv.upgrade(req, { data: { userId } })) return;
    return new Response('upgrade failed', { status: 426 });
  },

  websocket: {
    open(ws) {
      sockMeta.set(ws, { userId: ws.data.userId });
      try { ws.send(JSON.stringify({ type: 'welcome', userId: ws.data.userId })); } catch {}
    },

    message(ws, raw) {
      const meta = sockMeta.get(ws);
      if (!meta) return;

      let msg;
      try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); }
      catch { return; }
      if (!msg || typeof msg !== 'object') return;

      // Control messages
      if (msg.type === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong', ts: msg.ts || Date.now() })); } catch {}
        return;
      }

      if (msg.type === 'join') {
        const roomId = String(msg.roomId || '').slice(0, 128);
        if (!roomId) return;
        // Leave previous room (if any) before joining a new one.
        if (meta.roomId && meta.roomId !== roomId) leaveRoom(ws);
        if (!rooms.has(roomId))     rooms.set(roomId, new Set());
        if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Set());
        rooms.get(roomId).add(ws);
        roomUsers.get(roomId).add(meta.userId);
        meta.roomId = roomId;
        try { ws.send(JSON.stringify({ type: 'joined', roomId })); } catch {}
        return;
      }

      if (msg.type === 'leave') {
        leaveRoom(ws);
        return;
      }

      // All other messages: fan out to room peers verbatim.
      if (!meta.roomId) return;
      // Stamp `from` defensively on payloads in case clients omit it.
      if (msg.payload && typeof msg.payload === 'object' && !msg.payload.from) {
        msg.payload.from = meta.userId;
      }
      // Re-serialize so it includes any stamped `from` value.
      const out = (typeof raw === 'string') ? raw : JSON.stringify(msg);
      broadcastToRoom(meta.roomId, ws, out);
    },

    close(ws) {
      leaveRoom(ws);
      sockMeta.delete(ws);
    },

    // Bun handles ping/pong frames natively; nothing to do here.
  },
});

console.log(`[mtg-relay] listening on :${PORT}  (allowed origin: ${ALLOWED_ORIGIN || '*'})`);
