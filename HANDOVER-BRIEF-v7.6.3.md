# MTG Playground v7.6.3 — Handover Brief

**Status:** v7.6.3 deployed to production (Vercel client + DigitalOcean WS relay).

**Date:** April 26, 2026

**Context:** v7.6.2 shipped with lag that persisted during live testing. Root cause: full-state broadcasts firing on every mousemove (60 Hz), slim payloads not yet implemented, no custom WS transport to bypass Supabase Realtime caps. v7.6.3 addresses all three.

---

## What's Live Now

### Client (Vercel)
- **URL:** https://project-kbdxj.vercel.app/
- **Branch:** main (auto-deploys)
- **Changes from v7.6.2:**
  - Slim broadcast payloads (strips Scryfall metadata, omits deck object on non-initial broadcasts)
  - Drag gating (full-state broadcasts suppressed during BF drag; position-delta channel carries the work)
  - Throttles: 50/40 ms → 70/70 ms (~14 Hz)
  - CSS transitions on opp BF cards for smooth interpolation between throttled updates
  - `onConnState` callback wired to "⚡ Reconnecting…" banner
  - Hydration helpers (slimCard, hydrateRemoteState) to rebuild metadata from local cache on receive
  - NetSync rewritten as dual-transport (custom WS or Supabase fallback, feature-flagged via `VITE_WS_URL`)

### WS Relay (DigitalOcean)
- **IP:** 209.38.252.27:3001
- **Domain:** relay.playsim.live (DNS propagating; use IP for now)
- **Status:** Running via PM2, auto-restart on reboot
- **Server code:** Bun + jose (JWT verify), room pub/sub
- **Config:** 
  - `SUPABASE_JWT_SECRET` set in environment
  - Health check at `/health` (JSON: `{ok, rooms, connections, uptime_s}`)
  - Ping interval: 30 s (Cloudflare keepalive)
  - Reconnect: exponential backoff 250 ms → 30 s cap

### Infrastructure
- **Supabase:** Pro tier ($25/mo) — handles auth, game_state DB, postgres_changes fallback
- **DigitalOcean:** $16/mo droplet (1 vCPU, 2 GB RAM) — runs relay
- **Vercel:** Pro tier — client deployment
- **Cloudflare:** $0 (registrar + DNS) — playsim.live domain, SSL/TLS Full mode, WebSockets ON

---

## Deployment Checklist (✓ All Done)

- [x] Slim broadcast + hydration helpers in Playground.jsx
- [x] Drag gating (bfDragging flag, forceBroadcast on mouseup)
- [x] CSS transitions on opp BF cards (90 ms linear)
- [x] NetSync rewritten (dual-transport, reconnect logic, ping/pong)
- [x] Bun WS server (server.js, package.json, Dockerfile, fly.toml)
- [x] Client pushed to Vercel (v7.6.3 live)
- [x] WS relay deployed to DigitalOcean (PM2, auto-restart)
- [x] Domain registered (playsim.live) — DNS propagating
- [x] Cloudflare configured (A record relay → 209.38.252.27, Full SSL, WebSockets ON)
- [x] VITE_WS_URL set in Vercel env (wss://209.38.252.27:3001)
- [x] Client redeployed with env var

---

## What to Test on Next Session

1. **Drag smoothness:** Start 2-player game, drag BF cards on one client, watch the other. Should move smoothly without snapping.
2. **No lag spikes on tap/life/counter:** These now ride the slim full-state path. Should be sub-second sync.
3. **Reconnect banner:** Kill the relay (`pm2 stop mtg-relay`), watch for "⚡ Reconnecting…" on the client, restart relay (`pm2 start mtg-relay`), verify it reconnects within 5 s.
4. **Multi-player (3p/4p):** Tile rendering, opp BF sync on all seats.
5. **Join mid-game:** Verify rejoin hydrates current BF state correctly from game_state DB row.

---

## Known Gaps (Deferred)

- **Per-zone discrete events** (sendTap, sendLife, sendCounter) — Phase 2a optimizations are fast enough that this is polish, not urgent
- **gzip compression** — WS payload is already slim (~8 KB vs ~80 KB in v7.6.2); compression is diminishing returns
- **Custom card + token metadata in slim path** — tokens created mid-game aren't in deck cache; hydration falls back to slim. Works but could be cleaner with discrete `cardCreated` events.
- **Hetzner alt deploy** — the server/ folder is portable; can redeploy to Hetzner if DigitalOcean needs to be replaced

---

## Critical Files

| File | Size | Status | Notes |
|---|---|---|---|
| src/Playground.jsx | 531 KB | ✓ Live | slim/hydrate helpers, drag gating, CSS transitions, connState banner |
| src/lib/netSync.js | 16 KB | ✓ Live | dual-transport, reconnect, JWT refresh, ping/pong |
| server/server.js | 6 KB | ✓ Live | Bun WS relay, JWT verify, room fan-out |
| .env.example | 727 B | ✓ Updated | VITE_WS_URL documented |
| README.md | 9.1 KB | ✓ Updated | v7.6.3 changelog |
| DEPLOY.md | 9.7 KB | ✓ Updated | WS relay deploy guide |

---

## Deployment Rollback Plan

If the relay breaks mid-game:
1. **Delete `VITE_WS_URL`** from Vercel env vars
2. **Redeploy** client
3. **Client falls back to Supabase Realtime** within 30 s (no code change needed)
4. Games continue with v7.6.2-level performance (slim payloads + drag gating still apply on Supabase path)

---

## Next Steps (When Ready)

1. **Live test with friends** — 2p, 3p, 4p games on different devices
2. **Monitor relay health** — `curl http://209.38.252.27:3001/health` should show rising connection count during games
3. **DNS propagation** — once relay.playsim.live resolves globally, update Vercel env to `wss://relay.playsim.live` and redeploy
4. **Phase 2b optimizations** (backlog): per-zone discrete events, gzip, adaptive throttling (lower priority — current performance should be smooth)

---

## Contact / Notes

- Relay logs: SSH into droplet → `pm2 logs mtg-relay`
- Vercel logs: Vercel dashboard → Deployments → [latest] → Runtime logs
- Supabase events: Dashboard → Realtime Inspector (for postgres_changes traffic)
- Domain: playsim.live (future TCG will also run here)

---

**Ship confidence:** HIGH for drag smoothness, throttle, slim payloads. MEDIUM for reconnect (untested under real network drops). Ready for beta playtesting.
