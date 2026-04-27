# MTG Playground v7.6.4 — Changelog

**Status:** Code complete in this working tree. Pending: real-traffic 30-min playtest; deploy.

**Date:** April 27, 2026

---

## TL;DR

v7.6.4 fixes the joiner-divergence bug from the v7.6.3 hydration debrief, ships a visible opponent hand strip with the correct sleeve, makes deck import ~20× faster, pre-caches deck images so cards never pop in mid-game, adds debug instrumentation for future audits, and hardens the transport layer against zombie WebSockets and silent JWKS misconfig.

---

## Critical fixes

### Per-seat authoritative state replication (the hydration bug)

**Was:** Every peer's broadcast carried the entire game state, including stale views of seats they don't own. When two clients broadcast simultaneously, peer A's outdated view of peer B's seat would clobber B's authoritative data on the merge — joiner divergence reported in `HYDRATION-BUG-DEBRIEF.md`.

**Now:** Each broadcast is stamped with `fromSeat` (the broadcaster's seat index). Receivers do per-seat patching: a realtime broadcast only updates `players[fromSeat]` plus shared top-level fields (turn/phase/activePlayer/stack/etc.). Other seats are preserved untouched and are updated only by their own peer's broadcasts. Initial DB seeds and rehydrate-from-db paths still do a full multi-seat replace because they're authoritative full snapshots.

**Implementation:**
- `netSync.js` — `broadcast(slim, full, {senderSeat})` adds the seat stamp; `onRemoteState(state, info)` now passes `{from, fromSeat, initial, path}` so the receiver can branch.
- `Playground.jsx` — split hydration into `hydratePlayer` (one seat), `applyRemoteStateFull` (seed/rehydrate), `applyRemoteStateBySeat` (realtime). Spread-then-override pattern for top-level fields preserves unknown shared fields like `oppAccessRequest`, `startedSeats`, etc.

### Dead localStorage polling loop removed

**Was:** Pre-NetSync legacy code at `Playground.jsx:7247` ran every 1.5s, writing the OPPONENT's seat from local-storage cache via `onUpdatePlayer(1-playerIdx, ...)`. Mostly dormant (reads returned null in steady state) but a latent state-corruption footgun under specific conditions.

**Now:** Removed entirely. NetSync is the only source of cross-seat state.

---

## UX

### Visible opponent hand strip with correct sleeve

**Was:**
- `CardImg` looked up the face-down sleeve via `window._deckSleeve`, a global set once-per-render to the LOCAL player's sleeve. Opp face-down cards rendered with the local player's sleeve.
- When the opponent's hand was empty, `HandOverlay` returned `null` — the strip was invisible, with no visual anchor for "this is where opp hand lives."

**Now:**
- `CardImg` accepts an optional `sleeveUri` prop (preferred over the global). `HandOverlay` accepts and passes `sleeveUri`. `BoardSide` reads `player.deck.sleeveUri` and threads it through. Each side now renders face-down cards with its own sleeve.
- In `readOnly` mode (opp render path), `HandOverlay` renders a faint dashed frame with "✋ HAND · 0" when the hand is empty, instead of returning null.

### Deck import is ~20× faster

**Was:** Serial `/cards/named` lookup, one card per request, ~9 req/sec. A 100-card deck took ~11s+ with the user blocked watching the progress bar.

**Now:** Batched via `/cards/collection` (75 identifiers per request). 100-card deck → 2 requests, ~0.5s. Per-name `/cards/named` retained as a fallback for anything in `not_found` (typos, basic-land variants, custom names). Both `handleImport` and `retryFailed` use the batched path.

### Card images pre-cached at game start

**Was:** Card images loaded lazily (`<img loading="lazy">`). The first time a card was revealed mid-game, the player saw a blank frame for 100–500ms while the image fetched.

**Now:** New `prefetchDeckImages(deck, {priority})` helper:
- Own deck → `'high'`: kicks off `Image()` fetches for every card immediately at game start. HTTP/2 multiplexing handles parallelism.
- Opponent decks → `'low'`: queued, throttled (10 concurrent), starts after a 1.5s delay so it doesn't compete with above-the-fold paint.
- De-duped via a global Set so the same URL is never fetched twice.

---

## Anti-fragility

### WebSocket inbound watchdog

**Was:** When an intermediate proxy (CGNAT, mobile network handoff, Cloudflare) silently dropped TCP, the WebSocket stayed in `readyState === 1` (OPEN) forever with no traffic flowing. The reconnect logic only fired on a clean `onclose`. Symptom: client appears connected but is dead.

**Now:** `_startWatchdog()` polls every 15s. If no inbound traffic for >90s while WS is open (3 missed pings × 30s ping interval), force-close with code `4002 'watchdog stale'`. The `onclose` handler then triggers the existing reconnect path.

### Relay JWKS reachability probe at boot

**Was:** `createRemoteJWKSet` lazy-loads keys on first verify. If `SUPABASE_URL` was misconfigured or the network blocked the JWKS endpoint, the relay would boot fine and then 401 every real client. Took a session to debug last time.

**Now:** At boot, after JWKS init, the relay does an active `fetch()` against the JWKS URL. Logs `[boot] JWKS probe OK` on success or `[boot] WARNING: JWKS probe failed: ...` on failure. Loud at startup, not silent under traffic.

### Log-spam dampener for jwt failures

**Was:** Every failed JWT verify logged `[jwt] verify failed: <code>`. A flood of bad tokens (DoS, key rotation period, misconfigured client) would spam the disk.

**Now:** First failure logs immediately; subsequent failures within a 60s window are coalesced into a single `[jwt] verify failed ×N in last window (last reason: ...)` summary at window-end.

---

## Debug instrumentation

New surface at `window.__MTG_V7__.debug` for next session's load-test audit. None of this is load-bearing — purely observability.

| Method/property | What it does |
|---|---|
| `debug.snapshot()` | Returns a JSON-cloned current `gameState`. Compare host vs joiner snapshots to spot divergence. |
| `debug.summary()` | Returns `{mySeat, netTransport, wsReadyState, outSeq, lastSeenByUser, hydrationMissCount, broadcastCount, connHistoryLast}`. |
| `debug.hydrationMisses` | Ring buffer (cap 200) of `{seat, miss, total, ts}` — every time hydration fell through to slim case-3 for any seat. |
| `debug.broadcastLog` | Ring buffer (cap 200) of `{dir:'in'/'out', path, from, fromSeat, ts}` — every broadcast in/out. |
| `debug.connHistory` | Ring buffer (cap 100) of `{state, detail, ts}` — every connection-state change. |
| `debug.reset()` | Clear all three ring buffers. |

Verbose net logging is still gated behind `NetSync.DEBUG` (toggle via `window.__MTG_V7__.setNetSyncDebug(true)`).

---

## Non-changes (unchanged from v7.6.3)

- Slim broadcast payloads (~13% of full size) — unchanged.
- 70/70ms throttle (~14Hz) + CSS interpolation on opp BF — unchanged.
- Drag gating — unchanged.
- Reconnect with exponential backoff (250ms → 30s cap) — unchanged.
- DB upsert debounce 3s — unchanged.
- JWT refresh on `TOKEN_REFRESHED` — unchanged.
- Custom WS relay (`relay.playsim.live`) — unchanged transport, but server.js was patched in production for ES256/JWKS (now synced into git as the canonical source).

---

## Files changed

| File | Change |
|---|---|
| `src/Playground.jsx` | Hydration helpers, per-seat apply, opp hand strip + sleeve, batched import, image prefetch, debug surface, dead-loop removal |
| `src/lib/netSync.js` | `senderSeat` stamp, `info.path/fromSeat` propagation, watchdog, debug-gated logs, `setMySeat` helper |
| `server/server.js` | (synced from production droplet — JWKS + HS256 fallback, JWKS probe at boot, log-spam dampener) |
| `server/README.md` | Rewritten — was actively misleading on JWT setup |
| `server/fly.toml` | Updated secrets-set example to include SUPABASE_URL |
| `package.json` | 7.6.2 → 7.6.4 |

---

## Migration / deploy

**Client (Vercel):** push the updated tree, no env changes required.

**Relay:** `server.js` in this repo is now the authoritative source. To redeploy:

```bash
scp server/server.js root@relay.playsim.live:/opt/mtg-relay/server.js
ssh root@relay.playsim.live 'pm2 restart mtg-relay --update-env'
curl https://relay.playsim.live/health
```

No env changes needed if `SUPABASE_URL` and `SUPABASE_JWT_SECRET` are already set on the droplet (they were as of session end).

---

## Outstanding from v7.6.3 (carried forward)

- **30-min gameplay test under load** — was blocked on the hydration fix (now done) + relay (already done). Now ready. Watch `window.__MTG_V7__.debug.hydrationMisses.length` after a session — should be 0 in a healthy game.
- **Concurrent scaling** — 25–30 games target.
- **3p/4p BF sync verification** — should benefit most from per-seat authority.
- **B-001 through B-014** — backlog items unchanged.

## Outstanding from v7.6.4 (new)

- **Latent iid skew between host's and joiner's `initPlayer`** — each side independently rolls `uid()` for library/command on its own copy of the deck. DB seed reconciles the joiner's view of the host's seat on the first broadcast, but there's a tiny startup window where the joiner has joiner-generated iids for the host's library/command. Probably benign in practice (no actions take effect during that window), but worth a follow-up.
- **`window._deckSleeve` global** — still set on every render to the LOCAL player's sleeve. v7.6.4 routes around it for known opp render paths (HandOverlay readOnly), but other call sites that read it (opp library stub, other face-down displays) may still pick the wrong sleeve. Audit + remove the global in a follow-up.
