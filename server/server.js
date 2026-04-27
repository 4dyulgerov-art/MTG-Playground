/*
 * MTG Playground — WebSocket relay (v7.6.4)
 *
 * ───────────────────────────────────────────────────────────────────────────
 * AUTHORITATIVE SOURCE NOTICE
 *
 * This file is synced FROM the running production droplet at
 * /opt/mtg-relay/server.js (DigitalOcean, behind relay.playsim.live).
 * It is the canonical baseline. Any older copy in git history is stale.
 *
 * Deploy procedure when this file changes:
 *   1. scp this file to the droplet:
 *        scp server/server.js root@relay.playsim.live:/opt/mtg-relay/server.js
 *      OR paste it via:  cat > /opt/mtg-relay/server.js << 'EOF' ... EOF
 *   2. pm2 restart mtg-relay --update-env
 *   3. Verify:
 *        curl https://relay.playsim.live/health
 *        pm2 logs mtg-relay --lines 30 --nostream
 *
 * Required env on droplet (set via PM2, persisted with `pm2 save`):
 *   SUPABASE_URL=https://<project>.supabase.co     (required for JWKS)
 *   SUPABASE_JWT_SECRET=<legacy HS256 secret>      (kept as fallback only)
 *   PORT=3001                                      (Nginx proxies to here)
 *   ALLOWED_ORIGIN=<optional>                      ('' allows any origin)
 *
 * DO NOT remove the HS256 fallback branch. DO NOT remove SUPABASE_URL from
 * env. Either of those will silently break the relay (HS256 alone rejects
 * every modern Supabase token; missing SUPABASE_URL silently no-ops JWKS).
 * ───────────────────────────────────────────────────────────────────────────
 *
 * A small Bun-native WebSocket server that fan-outs JSON messages between
 * peers in the same room. Stateless: zero persistence (Supabase keeps the
 * authoritative game_state row).
 *
 * v7.6.4 changes:
 *   - JWT verify supports asymmetric ES256/RS256 via Supabase's JWKS
 *     endpoint (createRemoteJWKSet, 10min cache, 30s cooldown). Supabase
 *     migrated to ES256 signing — the old HS256-only verify rejected every
 *     real client token. HS256 fallback retained for backwards compat.
 *
 * Protocol (one JSON object per message):
 *
 *   Client → Server:
 *     {type:"join", roomId}
 *     {type:"leave"}
 *     {type:"state",     payload:{state, seq, from, fromSeat, ts}}
 *     {type:"positions", payload:{seatIdx, positions, seq, from, ts}}
 *     {type:"ping",      ts}
 *
 *   Server → Client:
 *     {type:"welcome", userId}      // on connect
 *     {type:"joined",  roomId}      // ack of join
 *     {type:"pong",    ts}          // ack of ping
 *     <verbatim peer message>       // fan-out from another peer in room
 */

import { jwtVerify, createRemoteJWKSet, decodeJwt, decodeProtectedHeader } from 'jose';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const SUPABASE_URL        = process.env.SUPABASE_URL || '';
const PORT                = Number(process.env.PORT) || 3001;
const ALLOWED_ORIGIN      = process.env.ALLOWED_ORIGIN || '';

let JWKS = null;
let SECRET_KEY = null;

if (SUPABASE_URL) {
  try {
    const jwksUrl = new URL('/auth/v1/.well-known/jwks.json', SUPABASE_URL);
    JWKS = createRemoteJWKSet(jwksUrl, { cooldownDuration: 30000, cacheMaxAge: 600000 });
    console.log(`[boot] JWKS endpoint: ${jwksUrl.toString()}`);
    // v7.6.4 anti-fragile: actively probe the JWKS endpoint at boot. The
    // jose lib lazy-loads keys on first verify, so a misconfigured URL or
    // network block stays silent until the first real client connects —
    // and then every connection 401s. Surface the failure now.
    fetch(jwksUrl.toString()).then(r => {
      if (!r.ok) {
        console.error(`[boot] WARNING: JWKS probe returned ${r.status} ${r.statusText}. Real clients may 401. Verify SUPABASE_URL.`);
      } else {
        console.log('[boot] JWKS probe OK');
      }
    }).catch(e => {
      console.error('[boot] WARNING: JWKS probe failed:', e?.message || e, '— real clients may 401. Verify network + SUPABASE_URL.');
    });
  } catch (e) {
    console.error('[boot] Failed to init JWKS:', e?.message);
  }
}

if (SUPABASE_JWT_SECRET) {
  SECRET_KEY = new TextEncoder().encode(SUPABASE_JWT_SECRET);
  console.log('[boot] HS256 fallback secret loaded');
}

if (!JWKS && !SECRET_KEY) {
  console.error('[boot] FATAL: need SUPABASE_URL (for JWKS) or SUPABASE_JWT_SECRET (HS256 fallback)');
  process.exit(1);
}

const rooms = new Map();
const sockMeta = new WeakMap();
const roomUsers = new Map();

async function verifyJWT(token) {
  if (!token) return null;
  try {
    const header = decodeProtectedHeader(token);
    const alg = header?.alg;

    if (alg === 'HS256') {
      if (!SECRET_KEY) return null;
      const { payload } = await jwtVerify(token, SECRET_KEY, { algorithms: ['HS256'] });
      return payload?.sub || null;
    }

    // ES256 / RS256 / etc — use JWKS
    if (!JWKS) return null;
    const { payload } = await jwtVerify(token, JWKS, { algorithms: ['ES256', 'RS256'] });
    return payload?.sub || null;
  } catch (e) {
    // v7.6.4: rate-limited so a flood of bad tokens (DoS, key rotation,
    // misconfigured client) doesn't fill the disk. Log first hit, then once
    // every 60s with a count summary. Reset window when steady-state.
    _jwtFailLog(e?.code || e?.message);
    return null;
  }
}

// v7.6.4: dampened logger for repetitive jwt verify failures.
let _jwtFailWindowStart = 0;
let _jwtFailCount = 0;
let _jwtFailLastReason = '';
function _jwtFailLog(reason) {
  const now = Date.now();
  _jwtFailCount += 1;
  _jwtFailLastReason = reason || 'unknown';
  if (_jwtFailWindowStart === 0 || now - _jwtFailWindowStart > 60000) {
    if (_jwtFailWindowStart !== 0 && _jwtFailCount > 1) {
      console.warn(`[jwt] verify failed ×${_jwtFailCount} in last window (last reason: ${_jwtFailLastReason})`);
    } else {
      console.warn('[jwt] verify failed:', _jwtFailLastReason);
    }
    _jwtFailWindowStart = now;
    _jwtFailCount = 0;
    _jwtFailLastReason = '';
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

      if (msg.type === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong', ts: msg.ts || Date.now() })); } catch {}
        return;
      }

      if (msg.type === 'join') {
        const roomId = String(msg.roomId || '').slice(0, 128);
        if (!roomId) return;
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

      if (!meta.roomId) return;
      if (msg.payload && typeof msg.payload === 'object' && !msg.payload.from) {
        msg.payload.from = meta.userId;
      }
      const out = (typeof raw === 'string') ? raw : JSON.stringify(msg);
      broadcastToRoom(meta.roomId, ws, out);
    },

    close(ws) {
      leaveRoom(ws);
      sockMeta.delete(ws);
    },
  },
});

console.log(`[mtg-relay] listening on :${PORT}  (allowed origin: ${ALLOWED_ORIGIN || '*'})`);
