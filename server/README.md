# MTG Playground — WebSocket Relay

A small Bun-native WebSocket server that fan-outs JSON messages between peers in the same room. Replaces Supabase Realtime as the hot game-loop transport. Stateless — Supabase keeps the authoritative `game_state` row.

**Why:** Supabase Realtime caps at 100 msg/sec (Free) / 2,500 msg/sec (Pro). Custom WS on a €5 VPS handles 10,000+ msg/sec with no per-message billing.

---

## What you need before deploying

1. **Your Supabase JWT secret.**
   - Supabase Dashboard → your project → **Settings → API → JWT Secret** (it's the one labelled **Project JWT secret**, *not* the anon/service keys).
   - Copy it — you'll paste it into the deploy command below.

2. **One of:**
   - A Fly.io account (recommended — easiest)
   - A Hetzner / DigitalOcean / Vultr VPS with SSH access
   - Any container host (the included Dockerfile works anywhere)

---

## Option A — Deploy to Fly.io (recommended)

**Cost:** ~$0–5/month at this scale (Fly's free allowance covers a single shared-cpu-1x).

### One-time setup

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Sign in
flyctl auth login
```

### Deploy

From the `server/` directory:

```bash
cd server

# Pick a unique app name (change in fly.toml first if you want)
flyctl launch --no-deploy --copy-config

# Set the JWT secret (paste yours)
flyctl secrets set SUPABASE_JWT_SECRET="<paste-supabase-jwt-secret>"

# Deploy
flyctl deploy
```

Your relay is now live at `wss://<your-app-name>.fly.dev/ws`.

### Verify it's up

```bash
curl https://<your-app-name>.fly.dev/health
# → {"ok":true,"rooms":0,"connections":0,"uptime_s":12}
```

### Add the URL to your Vercel project

In your Vercel dashboard → Project → Settings → Environment Variables, add:

```
VITE_WS_URL = wss://<your-app-name>.fly.dev
```

Then redeploy your client (push any commit to trigger Vercel). The client will switch to using the WS relay automatically.

### Lock the origin (optional but recommended)

After confirming everything works, edit `fly.toml`:

```toml
[env]
  PORT = "3001"
  ALLOWED_ORIGIN = "https://your-vercel-app.vercel.app"
```

Then `fly deploy` again. This rejects WS upgrade requests from any other origin.

---

## Option B — Deploy to a VPS (Hetzner / DigitalOcean / Vultr)

**Cost:** €4.50–€6/month (Hetzner CPX11 is the cheapest in EU; DO $6 droplet in US).

### On the VPS (Ubuntu 22.04 / Debian 12)

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Copy this server/ folder up to the VPS via scp/rsync, then:
cd /path/to/server
bun install --production

# Set the secret in the environment
export SUPABASE_JWT_SECRET="<paste-supabase-jwt-secret>"

# Run with PM2 (auto-restart on crash, survives reboots)
npm install -g pm2
pm2 start server.js --name mtg-relay --interpreter $(which bun)
pm2 startup    # follow the printed command to install boot script
pm2 save
```

**Then put Cloudflare in front** for free TLS + DDoS protection:

1. Add your domain to Cloudflare (free plan)
2. Create A record `relay.yourdomain.com` → VPS IP (proxied / orange cloud ON)
3. SSL/TLS mode: **Full**
4. Cloudflare → Network → enable **WebSockets**

In your client `.env`: `VITE_WS_URL = wss://relay.yourdomain.com`

### Important Cloudflare note

Cloudflare drops idle WebSockets after 100 seconds. The client (`netSync.js`) already sends a ping every 30 seconds to keep the connection alive — no further config needed.

---

## Local testing

```bash
cd server
bun install

# In one terminal:
SUPABASE_JWT_SECRET="<your-secret>" PORT=3001 bun run server.js

# In another, hit the health endpoint:
curl http://localhost:3001/health

# In your client repo, set VITE_WS_URL=ws://localhost:3001 and run `npm run dev`.
```

---

## How it works

```
Client A ──ws─┐                                              ┌─ws── Client B
              │                                              │
              ├─→ {type:"join", roomId:"abc"} ──→ relay ─────┤
              │                                              │
              ├─→ {type:"state", payload:{...}} ─→ relay ───→ {type:"state", payload:{...}}
              │                                              │
              └─→ {type:"positions", payload:{...}} → relay ─→ {type:"positions", payload:{...}}
```

- **Auth:** Supabase JWT in `?jwt=...` on the upgrade request. Verified via the project JWT secret. No Supabase round-trip per message.
- **Fan-out:** O(peers in room) per message. With ~4 players per room, that's 3 sends per receive.
- **Persistence:** none. The client also upserts to Supabase `game_state` every 3s for rejoin recovery.
- **State:** in-memory `Map<roomId, Set<ws>>`. On server restart, all clients reconnect, re-send `join`, re-hydrate from Supabase. ~5s outage to user.

## Capacity

A `shared-cpu-1x` VM on Fly.io (or a €5 Hetzner box) handles:

- ~600 concurrent WebSocket connections (≈150 active 4p games)
- ~5,000 messages/sec sustained

For more capacity, upsize to `shared-cpu-2x` or scale horizontally by hashing `roomId` across multiple instances (not currently implemented, but the architecture supports it).

## Cost notes

- Fly.io shared-cpu-1x: $0–5/mo depending on egress (the free allowance usually covers it at this scale)
- Hetzner CPX11: €4.50/mo flat
- DigitalOcean: $6/mo basic droplet

Combined with Supabase Pro ($25/mo) and Vercel Pro ($20/mo) you're at ~$50/mo total for the entire stack.
