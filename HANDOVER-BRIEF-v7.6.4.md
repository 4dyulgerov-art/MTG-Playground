# MTG Playground v7.6.4 — Handover Brief

**Status:** Code complete. Not yet deployed. Pending: real-traffic playtest, deploy, monitor.

**Date:** April 27, 2026

**Context:** v7.6.3 left two open issues — joiner state divergence (the hydration bug) and a relay JWKS migration that was hand-patched on the droplet but not in git. v7.6.4 closes both, ships the requested opp-hand strip, makes deck import responsive, pre-caches images, adds debug instrumentation, and hardens the transport against zombie WebSockets.

For the full per-feature breakdown see `CHANGELOG-v7.6.4.md`. This document covers ship-readiness, deploy, and what to test.

---

## Ship-readiness

### What's verified
- All JS files pass `node --check` (modules + CommonJS).
- Diff against v7.6.3 is 19 hunks, all in expected regions.
- Cross-seat-action audit passed: only call site for `onUpdatePlayer(N, ...)` with `N != playerIdx` was the dead localStorage loop, now removed. Per-seat patch model is sound — no game logic anywhere writes to a non-self seat.
- `applyRemoteStateBySeat` preserves unknown shared top-level fields via spread-then-override, so flows like `oppAccessRequest` / `startedSeats` keep working.

### What's NOT verified
- Real `vite build` has not been run (no network in this session for `npm install`).
- Real-traffic 30-min playtest has not been run.
- Multi-player (3p/4p) sync verification has not been run.
- The opp hand strip cosmetics have not been visually QA'd — geometry is computed from `oppHandRef.getBoundingClientRect()` which depends on layout, so the empty-state frame might need positioning tweaks once you see it on screen.

---

## Authoritative-source reminder (for next session)

The relay code at `/opt/mtg-relay/server.js` on the DigitalOcean droplet is the canonical production version. As of v7.6.4 the local `server/server.js` in this tree has been synced to match it, plus two v7.6.4 additions (boot-time JWKS probe, log-spam dampener). When you deploy this, that local file becomes the new authoritative version on the droplet. Going forward: edit locally, scp up, restart with `--update-env`. See `server/README.md`.

---

## Deploy procedure

### Client (Vercel)
1. Commit + push the v7.6.4 tree.
2. Vercel auto-deploys from `main`.
3. No env var changes needed. `VITE_WS_URL=wss://relay.playsim.live` is already set.
4. Verify in browser console after page load:
   ```js
   window.__MTG_V7__.netSync?.transport // → "ws"
   window.__MTG_V7__.netSync?.ws?.readyState // → 1
   ```

### Relay (DigitalOcean)
1. From this tree:
   ```bash
   scp server/server.js root@relay.playsim.live:/opt/mtg-relay/server.js
   ```
2. On the droplet:
   ```bash
   pm2 restart mtg-relay --update-env
   pm2 logs mtg-relay --lines 30 --nostream
   ```
3. Verify the boot logs show:
   ```
   [boot] JWKS endpoint: https://twbponkjfwkvnsqemikk.supabase.co/auth/v1/.well-known/jwks.json
   [boot] HS256 fallback secret loaded
   [boot] JWKS probe OK
   [mtg-relay] listening on :3001  (allowed origin: ...)
   ```
4. Health check:
   ```bash
   curl https://relay.playsim.live/health
   # → {"ok":true,"rooms":N,"connections":M,"uptime_s":...}
   ```

### Rollback (if anything breaks)
- **Client:** Vercel → previous deployment → "Promote to production". Or remove `VITE_WS_URL` env var to fall back to Supabase Realtime path with the old hydration logic. (Hydration fix only ships on the new client; old client + new relay = old behavior, still works.)
- **Relay:** `cp /opt/mtg-relay/server.js.bak /opt/mtg-relay/server.js && pm2 restart mtg-relay --update-env` — there's a v7.6.3 backup on the droplet from the original ES256 patch session.

---

## What to test (in order)

### 1. Smoke test — relay still answering
```bash
curl https://relay.playsim.live/health
```
Should return JSON with `ok:true`. Failure here = relay is down, do not proceed.

### 2. Single-player offline → confirm nothing regressed
Start a local 2-player game (no online). Drag cards, tap, draw, change life. Should be indistinguishable from v7.6.3.

### 3. Deck import speed
Paste a 100-card decklist into Batch Import. Should complete in **~0.5–1.5s** (was ~11s in v7.6.3). Watch the network tab — should see 2 POSTs to `/cards/collection`, not 100 GETs to `/cards/named`.

### 4. Two-player session — primary acceptance test
Open two browsers signed in as different users. Host creates a room, joiner joins. Both enter game.
- **Hand strip:** Joiner should see a faint "✋ HAND · 0" frame at the top of the screen even when host's hand is empty. Host draws a few cards — joiner should see face-down sleeves at the top, using the **host's** sleeve URL (not the joiner's local sleeve).
- **Sync sanity:** Host plays a land, taps it. Joiner sees it appear and tap. Joiner plays a land. Host sees it appear and tap. Repeat for 5+ moves on each side.
- **Divergence check:** After 30+ alternating moves, run on both clients:
  ```js
  JSON.stringify(window.__MTG_V7__.debug.snapshot().players, null, 2)
  ```
  The two snapshots should agree on every seat's battlefield/graveyard/exile/command (ignore `library`, `hand` — those are masked stubs).
- **Hydration health:**
  ```js
  window.__MTG_V7__.debug.hydrationMisses.length
  ```
  Should be **0** in a healthy session. Anything > 0 means cards are falling through to slim case-3 — paste the array and investigate.

### 5. Image pre-cache
Open DevTools → Network → filter by "img". On game start you should see ~80–200 image requests fire in the first 1–3 seconds (own deck eager, then opp deck after the 1.5s delay). Subsequent reveals during gameplay should hit the browser cache (status `(disk cache)` or `(memory cache)`).

### 6. Watchdog (optional, harder to trigger)
Open the relay logs (`pm2 logs mtg-relay`). On the client, in DevTools → Network → right-click the WebSocket → "Block request domain". Wait 90+ seconds. The client console should log `[netSync.watchdog] no inbound traffic for ...ms — forcing reconnect`. Unblock the domain — the client should reconnect within a few seconds.

### 7. 3p/4p (when ready)
Same as #4 but with three or four players. The per-seat authority fix is most valuable here — every additional seat compounded the divergence problem in v7.6.3.

---

## Debug commands cheatsheet

In browser console during a live session:

```js
// What's the network state?
window.__MTG_V7__.debug.summary()

// Snapshot the current gameState (returns a JSON-clonable object)
window.__MTG_V7__.debug.snapshot()

// How many hydration failures so far? Should be 0.
window.__MTG_V7__.debug.hydrationMisses

// Last 5 connection-state transitions
window.__MTG_V7__.debug.connHistory.slice(-5)

// Last 20 broadcasts in/out
window.__MTG_V7__.debug.broadcastLog.slice(-20)

// Reset all ring buffers (clean slate for a focused experiment)
window.__MTG_V7__.debug.reset()

// Turn ON verbose net logging (off by default in v7.6.4)
window.__MTG_V7__.setNetSyncDebug(true)
```

---

## Known gaps (deferred to next version)

- **Latent iid skew** at game-start. Each peer's `initPlayer` rolls independent `uid()` values for library/command. DB seed reconciles after first broadcast (~50–500ms). Probably benign — no actions can take effect in that window — but worth confirming.
- **`window._deckSleeve` global** still exists. v7.6.4 routes opp HandOverlay around it, but other face-down render call sites may still pick up the wrong sleeve. Full audit + removal is a follow-up.
- **Per-zone discrete events** (B-001) — backlog, not urgent now that slim broadcasts + per-seat authority work.
- **gzip on transport** (B-005) — diminishing returns at current payload size.

---

## Velocity note

v7.6.3 → v7.6.4 was ~1 working session of code + this writeup. Most of the work was diagnostic (per-seat authority isn't obvious from the symptoms) and infrastructure cleanup (the JWKS migration bookkeeping, dead-loop excavation). The actual scope of code change is moderate — 19 hunks in Playground.jsx, surgical edits to netSync.js and server.js.

---

## Contact / notes

- Relay logs: `ssh root@relay.playsim.live 'pm2 logs mtg-relay'`
- Vercel logs: dashboard → Deployments → [latest] → Runtime logs
- Supabase Realtime inspector: dashboard → Realtime
- Domain registrar / DNS: Cloudflare (DNS-only / grey cloud for `relay.playsim.live`)

**Ship confidence:** HIGH for hydration fix correctness (per-seat authority is the canonical pattern, code is small and reviewable). MEDIUM for opp hand cosmetics (geometry may need tweaking). HIGH for deck import (well-documented Scryfall endpoint). MEDIUM for image pre-cache (depends on browser HTTP/2 multiplexing performing as expected). HIGH for watchdog (passive detector, no-op unless TCP genuinely dead).
