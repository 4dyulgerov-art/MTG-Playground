# MTG Playground — WebSocket Relay

A small Bun-native WebSocket server that fan-outs JSON messages between peers in the same room. Replaces Supabase Realtime as the hot game-loop transport. Stateless — Supabase keeps the authoritative `game_state` row.

**Why:** Supabase Realtime caps at 100 msg/sec (Free) / 2,500 msg/sec (Pro). Custom WS on a small VPS handles 10,000+ msg/sec with no per-message billing.

---

## ⚠️ Production source-of-truth notice

The currently-running production relay is at `wss://relay.playsim.live` on a DigitalOcean droplet at `/opt/mtg-relay/server.js`. **That file on the droplet is the authoritative source**, not git history. The version of `server.js` in this folder has been synced to match it as of v7.6.4 — keep it that way going forward.

**When you change this `server.js`, you must redeploy:**

```bash
# from this folder, on your dev machine:
scp server.js root@relay.playsim.live:/opt/mtg-relay/server.js

# then on the droplet:
pm2 restart mtg-relay --update-env
curl https://relay.playsim.live/health
pm2 logs mtg-relay --lines 30 --nostream
```

The `--update-env` flag is required if env vars changed. Without it PM2 keeps the old env in the running process.

---

## Required env vars (relay-side)

These are set in PM2's environment on the droplet (`pm2 set` / `pm2 save`), **not** in any local `.env` file.

| Var | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | **YES** | Used to build the JWKS endpoint (`/auth/v1/.well-known/jwks.json`) for ES256/RS256 token verification. Supabase migrated to ES256 signing — without this, the relay can only verify legacy HS256 tokens, which Supabase no longer issues. |
| `SUPABASE_JWT_SECRET` | recommended | HS256 fallback. Kept for backwards compat with any legacy tokens still in flight and as a defensive cushion if Supabase rolls back signing algorithms. Do NOT remove. |
| `PORT` | no (default 3001) | Local listen port. Nginx proxies to this. |
| `ALLOWED_ORIGIN` | no | If set, only WS upgrades from this origin are accepted. Empty = allow any. |

If neither `SUPABASE_URL` nor `SUPABASE_JWT_SECRET` is set, the relay refuses to boot.

If `SUPABASE_URL` is missing but `SUPABASE_JWT_SECRET` is set, the relay boots but rejects every modern Supabase token — every WS upgrade returns 401 `invalid jwt`. Symptoms: relay /health is fine, port is open, Nginx works, but no client connects. Look for `[jwt] verify failed` lines in `pm2 logs mtg-relay`.

---

## Production deployment — DigitalOcean + Nginx + Let's Encrypt (current path)

This is what's running at `relay.playsim.live`.

```
Client (Vercel) ──wss──→ Cloudflare DNS (grey cloud, NO proxy)
                            │
                            ▼
                  Nginx on droplet (TLS termination, Let's Encrypt)
                            │
                            └──→ Bun + PM2 on 127.0.0.1:3001
```

Cloudflare is **DNS-only** (grey cloud) for the relay — TLS terminates at Nginx via Let's Encrypt, not at Cloudflare. Don't switch to proxied (orange cloud) without first reading the Cloudflare WebSocket caveats.

### Set/update relay env via PM2

```bash
pm2 set mtg-relay:SUPABASE_URL "https://YOUR-PROJECT.supabase.co"
pm2 set mtg-relay:SUPABASE_JWT_SECRET "<paste-supabase-jwt-secret>"
pm2 restart mtg-relay --update-env
pm2 save                        # persist across reboots
```

### Verify

```bash
curl https://relay.playsim.live/health
# → {"ok":true,"rooms":N,"connections":M,"uptime_s":...}

pm2 logs mtg-relay --lines 30 --nostream
# expect: "[boot] JWKS endpoint: https://...supabase.co/auth/v1/.well-known/jwks.json"
# expect: "[boot] HS256 fallback secret loaded"
# NO "[jwt] verify failed" spam in steady state
```

### Cert auto-renewal

Let's Encrypt cert is on auto-renew. Verify with:

```bash
certbot certificates
systemctl list-timers | grep certbot
```

---

## Alternative: Fly.io (legacy path, kept for reference)

The original deploy target. Still works but isn't what's in production now.

```bash
cd server
flyctl launch --no-deploy --copy-config
flyctl secrets set \
  SUPABASE_URL="https://YOUR-PROJECT.supabase.co" \
  SUPABASE_JWT_SECRET="<paste-supabase-jwt-secret>"
flyctl deploy
```

Then add `VITE_WS_URL=wss://<your-app>.fly.dev` to your Vercel env and redeploy the client.

---

## Local testing

```bash
cd server
bun install

# In one terminal:
SUPABASE_URL="https://YOUR-PROJECT.supabase.co" \
SUPABASE_JWT_SECRET="<your-secret>" \
PORT=3001 \
bun run server.js

# In another:
curl http://localhost:3001/health
```

In the client `.env.local`: `VITE_WS_URL=ws://localhost:3001`, then `npm run dev`.

---

## Protocol

```
Client A ──ws─┐                                              ┌─ws── Client B
              │                                              │
              ├─→ {type:"join", roomId:"abc"} ──→ relay ─────┤
              │                                              │
              ├─→ {type:"state", payload:{...}} ─→ relay ───→ {type:"state", payload:{...}}
              │                                              │
              └─→ {type:"positions", payload:{...}} → relay ─→ {type:"positions", payload:{...}}
```

- **Auth:** Supabase JWT in `?jwt=...` on the upgrade. Verified locally via JWKS (ES256/RS256, cached 10min) or HS256 fallback. First verify per `kid` does a single round-trip to Supabase's JWKS endpoint; subsequent verifies hit the cache.
- **Fan-out:** O(peers in room) per message. With ~4 players per room, that's 3 sends per receive.
- **Persistence:** none. The client also upserts to Supabase `game_state` every 3s for rejoin recovery.
- **State:** in-memory `Map<roomId, Set<ws>>`. On server restart, all clients reconnect, re-send `join`, re-hydrate from Supabase. ~5s outage to user.

## Cloudflare WebSocket caveat

If you ever proxy this through Cloudflare (orange cloud), Cloudflare drops idle WebSockets after 100 seconds. The client (`netSync.js`) sends a ping every 30 seconds, so the connection stays alive. With direct Nginx (current setup) this isn't an issue but the keepalive is harmless.

## Capacity

A small droplet/VM handles roughly:

- ~600 concurrent WebSocket connections (≈150 active 4p games)
- ~5,000 messages/sec sustained

For more capacity, upsize the droplet or scale horizontally by hashing `roomId` across multiple instances (not currently implemented, but the architecture supports it).

## Cost notes

- DigitalOcean basic droplet (current): $6/mo
- Hetzner CPX11: €4.50/mo flat
- Fly.io shared-cpu-1x: $0–5/mo

Combined with Supabase Pro ($25/mo) and Vercel Pro ($20/mo) you're at ~$50/mo total.
