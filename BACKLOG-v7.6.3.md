# MTG Playground — Backlog (v7.6.3 onwards)

**Last Updated:** April 26, 2026 (v7.6.3 shipped)

**Priority Tier:** Items below are PHASE 2b+ (polish + long-term scale). v7.6.3 addresses the critical lag issue (Phase 2a complete).

---

## Tier 1 — Medium Priority (Next 1–2 sprints)

### B-001: Per-Zone Discrete Events
**Status:** Deferred (not in v7.6.3)
**Estimate:** 2–3 days
**Rationale:** v7.6.3's slim full-state path is already fast (~14 Hz, ~8 KB payloads). Discrete events would reduce this to single-digit bytes per action, but gains are marginal now that drag is gated and payloads are slim. Implement when we hit >30 concurrent games or see per-message latency spikes.

**Design outline:**
- New NetSync methods: `broadcastTap(seatIdx, iid)`, `broadcastLife(seatIdx, delta)`, `broadcastCounter(seatIdx, iid, counterKey, delta)`
- Each fires immediately (no throttle; these are low-frequency)
- Receiver patches only the changed field (no full-state merge)
- Falls back to full-state if 2+ events arrive in same tick

---

### B-002: Cross-Player Heartbeat
**Status:** Deferred
**Estimate:** 1 day
**Rationale:** Track "last seen" per player. Helps detect afk/disconnects before they become a problem. Low-priority for beta.

**Design outline:**
- NetSync emits `heartbeat` every 5 s (separate from game state)
- Receiver updates `players[i].lastHeartbeat = now()`
- Stale threshold: >30 s → show "⏱ idle" indicator on player tile
- Not a forced kick; just UI feedback

---

### B-003: Adaptive Throttle
**Status:** Deferred
**Estimate:** 1–2 days
**Rationale:** Supabase Realtime path still uses fixed 70 ms throttle. Could adapt based on room player count / message rate. v7.6.3's custom WS removes the need for this on the WS path, but Supabase fallback could be smarter.

**Design outline:**
- Track 60 s rolling window of broadcast count
- If >80 msg/min (Supabase ceiling is ~100): increase throttle to 100 ms
- If <20 msg/min: decrease to 50 ms (snappier feel)
- Only applies to Supabase fallback path

---

### B-004: launchRoom() Wiring
**Status:** Deferred
**Estimate:** 1 day
**Rationale:** RoomLobby calls `launchRoom(roomId, playerIndices)` but it's a stub that does nothing. Currently games start via hardcoded seat selection. Implement to unlock "auto-assign empty seats" feature.

---

## Tier 2 — Lower Priority (Phase 3+ or when scale demands)

### B-005: gzip Compression
**Status:** Deferred (diminishing returns)
**Estimate:** 1–2 days
**Rationale:** v7.6.3's slim payloads are already 8–15 KB. gzip would reduce to ~2–3 KB, but WS bandwidth is dirt cheap. Implement only if relay starts hitting CPU/IO limits at >100 concurrent games.

---

### B-006: Persistent Undo/Redo
**Status:** Deferred
**Estimate:** 3–5 days
**Rationale:** Players request the ability to undo the last action (discard, tap, etc.) without rolling back the entire game. Requires per-action snapshots + history navigation. Complex; deferred until post-beta.

---

### B-007: Spectator Mode
**Status:** Deferred
**Estimate:** 2–3 days
**Rationale:** Allow a non-player to join a room and watch the game without controlling a seat. Requires separate role in room_players + read-only state subscription. Deferred until post-beta.

---

### B-008: Replay Export
**Status:** Deferred
**Estimate:** 2 days
**Rationale:** Save game log as JSON and allow download / replay. Requires recording every action + replay UI. Nice-to-have for later.

---

### B-009: AI Opponent (Single Player)
**Status:** Long-term future
**Estimate:** 1–2 weeks
**Rationale:** Implement a basic bot that takes turns, plays creatures, attacks. Out of scope for multiplayer-focused v7.x.

---

### B-010: Custom Card Editor UX Improvements
**Status:** Deferred
**Estimate:** 1–2 days
**Rationale:** Current custom card UI is minimal. Could add image upload, more Scryfall field presets, templates. Not blocking gameplay.

---

## Tier 3 — Future / Long-Term

### B-011: Mobile App (React Native)
**Status:** Post-beta
**Estimate:** 3–4 weeks
**Rationale:** Wrap current web UI in React Native for iOS/Android. Deferred until v7.x is stable on web.

---

### B-012: Elo / Rating System
**Status:** Post-beta
**Estimate:** 1 week
**Rationale:** Track win/loss per player, display rating. Requires DB schema change. Deferred.

---

### B-013: Tournament Mode
**Status:** Post-beta
**Estimate:** 2–3 weeks
**Rationale:** Swiss-system or elimination bracket for organized play. Deferred.

---

### B-014: Deck Import from External Sources
**Status:** Deferred
**Estimate:** 2–3 days
**Rationale:** Parse Archidekt, Moxfield, Scryfall list URLs and auto-populate deck. Nice-to-have.

---

## Completed in v7.6.3

- [x] Slim broadcast payloads
- [x] Drag gating (suppress full-state during drag)
- [x] Throttle optimization (70 ms = ~14 Hz)
- [x] CSS transition interpolation on opp BF
- [x] Custom WS relay (dual-transport)
- [x] Reconnect logic + JWT refresh
- [x] Connection-state UI banner
- [x] onConnState callback

---

## Velocity Notes

- v7.6.2 → v7.6.3: ~2 days elapsed time (architectural refactor + server build + deploy)
- Next item (B-001 discrete events): ~2–3 days, but lower ROI given current perf
- Estimated time to "Beta Ready" (B-001 + B-002 + basic B-004): 1 week

---

## Success Metrics (v7.6.3)

- [ ] 2–4 player games: drag feels smooth (no visible jitter)
- [ ] Concurrent games scale to 25–30 without lag spikes
- [ ] Reconnect completes within 5 s
- [ ] No "Reconnecting…" banner during normal 30 min game
- [ ] Multi-player (3p/4p) BF sync stays in sync across all seats

