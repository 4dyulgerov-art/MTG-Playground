# MTG Playground — Backlog (v7.6.4 onwards)

**Last Updated:** April 27, 2026 (v7.6.4 code complete, pre-deploy)

---

## Tier 0 — Pending verification (blocks ship-confidence)

### V-001: 30-min real-traffic playtest
**Status:** Ready to run. Was blocked on hydration fix + relay (both done).
**Owner:** next session.
**What to watch:**
- `window.__MTG_V7__.debug.hydrationMisses.length` should stay 0
- `window.__MTG_V7__.debug.connHistory` should not log `reconnecting` during a 30-min session unless network drops genuinely happen
- Relay logs: no `[jwt] verify failed` spam, no growth in unbounded memory
- Browser memory: should stabilize, not climb (the prefetched Image() refs are GC'd after onload)

### V-002: 3p/4p sync verification
**Status:** Untested. Per-seat authority is the v7.6.4 fix that should make this finally work cleanly.
**Owner:** next session.

### V-003: Opp hand strip visual QA
**Status:** Untested in-browser. Geometry computed from `oppHandRef.getBoundingClientRect()` may need pixel-tweaking once visible.

---

## Tier 1 — New from v7.6.4 follow-up

### B-015: Audit and remove `window._deckSleeve` global
**Estimate:** 0.5 day
**Rationale:** v7.6.4 routes the opp HandOverlay around it via the new `sleeveUri` prop on `CardImg`. Other face-down render sites (opp library top, library deck stub, etc.) may still read `window._deckSleeve` and pick up the local player's sleeve incorrectly. Full audit: grep all callers of `CardImg` with `faceDown={true}` and confirm they pass the right `sleeveUri`. Then remove the `window._deckSleeve = ...` write entirely.

### B-016: Reconcile init-time iid skew
**Estimate:** 1 day
**Rationale:** `initPlayer` calls `mkCard` which rolls `uid()` for every library/command card. Host and joiner each run their own `initPlayer` with different `uid()` outputs, so for the first ~50–500ms before the first DB seed lands, the joiner's local view of the host's seat has joiner-generated iids while the host's actual broadcasts use host-generated iids. Harmless in practice (no game actions take effect in that startup window) but it's a latent footgun. Fix: derive iids deterministically from `(seat, card-index, scryfallId)` so all peers compute identical iids without needing to sync.

### B-017: Visual signal for hydration miss telemetry
**Estimate:** 0.5 day
**Rationale:** v7.6.4 logs `[hydrate] seat=N M/N cards fell through to slim` and feeds `window.__MTG_V7__.debug.hydrationMisses`. In production it'd be useful to surface a small toast or footer indicator when this is non-zero, so users notice and report rather than silently playing on with broken cards. Right now it's dev-tools-only.

---

## Tier 1 — From v7.6.3 (still deferred)

### B-001: Per-Zone Discrete Events
**Status:** Deferred (still). v7.6.4's per-seat authority makes the problem this was designed to solve much smaller — per-seat patches are already small and isolated. Implement only if profiling at >30 concurrent games shows per-message latency spikes.

### B-002: Cross-Player Heartbeat
**Status:** Partially addressed in v7.6.4 — the WS watchdog detects zombie connections from the local side. A real cross-player heartbeat (showing "X is idle" on remote players) is still deferred.

### B-003: Adaptive Throttle on Supabase fallback
**Status:** Deferred. Custom WS path is the live path; Supabase fallback rarely sees load.

### B-004: launchRoom() Wiring
**Status:** Deferred (still). Stub.

---

## Tier 2 — Lower priority (Phase 3+)

### B-005: gzip Compression
**Status:** Deferred. v7.6.4's slim payloads are already 8–15 KB. Gzip would reduce to 2–3 KB but WS bandwidth is dirt cheap. Implement only if relay starts hitting CPU/IO limits.

### B-006: Persistent Undo/Redo
**Status:** Deferred. Complex; post-beta.

### B-007: Spectator Mode
**Status:** Deferred. Post-beta.

### B-008: Replay Export
**Status:** Deferred. Nice-to-have.

### B-009: AI Opponent (Single Player)
**Status:** Long-term future. Out of scope for multiplayer-focused 7.x.

### B-010: Custom Card Editor UX Improvements
**Status:** Deferred. Not blocking gameplay.

---

## Tier 3 — Future / long-term

### B-011: Mobile App (React Native)
**Status:** Post-beta.

### B-012: Elo / Rating System
**Status:** Post-beta.

### B-013: Tournament Mode
**Status:** Post-beta.

### B-014: Deck Import from External URLs
**Status:** Deferred. Note: v7.6.4's batched import via `/cards/collection` already makes raw decklist paste fast (~0.5s for 100 cards). External URL import (parse Moxfield/Archidekt JSON, then batch fetch) would be a small extension.

---

## Completed in v7.6.4

- [x] Per-seat authoritative state replication (the hydration bug fix)
- [x] Removed dead pre-NetSync localStorage polling loop
- [x] Opponent hand strip: visible empty-state frame + per-side sleeve
- [x] Batched deck import via /cards/collection (~20× faster)
- [x] Image pre-cache at game start (own deck eager, opps progressive)
- [x] Debug instrumentation surface (window.__MTG_V7__.debug)
- [x] WS inbound watchdog (zombie connection detection)
- [x] Relay JWKS reachability probe at boot
- [x] Relay log-spam dampener for jwt failures
- [x] Server.js synced from production droplet → git source-of-truth restored
- [x] Server README rewritten (was actively misleading on JWT setup)

---

## Velocity notes

- v7.6.3 → v7.6.4: ~1 working session (code + docs)
- Most session time: diagnostic (per-seat authority isn't visible from symptoms) + infrastructure bookkeeping (JWKS sync)
- Next priorities (in order): V-001 (playtest), V-002 (3p/4p), V-003 (opp hand QA), then B-015 + B-016 (cleanup)

---

## Success metrics (carry over from v7.6.3 — still unverified)

- [ ] 2–4 player games: drag feels smooth (no visible jitter)
- [ ] Concurrent games scale to 25–30 without lag spikes
- [ ] Reconnect completes within 5 s
- [ ] No "Reconnecting…" banner during normal 30 min game
- [ ] Multi-player (3p/4p) BF sync stays in sync across all seats
- [ ] **(NEW v7.6.4)** `hydrationMisses.length === 0` after 30-min session
- [ ] **(NEW v7.6.4)** 100-card deck import completes in <2s
- [ ] **(NEW v7.6.4)** No card "pop-in" effect on first reveal mid-game
