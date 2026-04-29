# CHANGELOG — v7.6.5

**Released:** April 28, 2026
**Type:** Polish + hardening release on top of v7.6.4. No data-model changes, no relay changes, no migrations.

---

## Third-round hotfixes (in this build)

This build addresses ten bugs reported from the latest playtest:

1. **Clicking an already-on-BF card moved it back to the hand.** `handleBFMouseUp` was treating a plain click as a "drop into hand zone" because the hand strip overlaps the bottom of the battlefield. Now requires ≥6 px of cursor movement before treating mouseup as a drop. Click without drag = no-op (selection only, as intended).

2. **Clicking the graveyard or exile pile crashed the game** (`TypeError: can't access property "iid", i is undefined`). Stale `graveIdx` / `exileIdx` indexed past array length when cards left the zone. Now falls back to `arr[length-1]` and clamps the index in a `useEffect` whenever the array shrinks. Same fix applied to exile.

3. **Rejoin after crash didn't recover state — empty hand, empty board.** Root cause: `broadcastIfOnline` was sending the **masked** state to BOTH realtime AND the DB. The DB row had stub hand cards, so any rejoin (or refresh) loaded those stubs and the local hand was permanently lost. Now the realtime channel still carries masked state (private zones stay private) but the DB row stores **full** state. On rejoin, the seed read pulls real hand + library cards back. The room itself sticks around longer too via the global TTL cleanup (see #10 below).

4. **Scry / Surveil / Look modal was tiny and illegible.** Modal max-width 600 → 1280, padding 22 → 32, card size sm → lg, button font 8 → 12 px, headers 14 → 22 px. Buttons get full word labels (`⬆ Top`, `⬇ Bot`, `☠ Grave`, `✦ Exile`) instead of compressed `⬆Top`. Fully usable now.

5. **Hover preview lingered after mousing off a card** in gallery / search-library / zone-viewer / deck-viewer. Every hover-emitting card row now wires `onMouseLeave={()=>onHover(null)}` to clear the hovered state. Affected: SearchLibModal, ZonePanel, ZoneViewerModal, DeckViewer, SearchCardRow, DeckCardRow.

6. **Hover preview was too small** to actually read. CardPreview width 190 → 260 px, internal font sizes bumped (13 → 15 for name, 10 → 12 for type line, 11 → 13 for oracle text, 12 → 14 for P/T), counter badges scaled to match. Bigger but still tucked into the bottom-left so it doesn't block the board.

7. **Online Dandân — local hand was stubbed and invisible.** Same root cause as #3 (DB had masked state). Plus a defensive `(opp.hand || []).map(c => ({...c, faceDown:true, _hotseatMasked:true}))` that I'd added in the previous round was REMOVED — that mask was contaminating BoardSide rendering. Opp hand visibility now relies on the existing `OppHandStrip` (always renders sleeves) and the `readOnly` HandOverlay suppression.

8. **Dandân deck-reselect + dual-deck regression.** Two fixes:
   - **Hide the "Your Deck" picker entirely when `gamemode === "dandan"`.** The variant IS the deck — neither host nor joiner picks anything personal. Showing this section was tricking joiners into picking their own deck, which then mounted a second library at game start.
   - **Deterministic seeded shuffle for the shared library.** Previously each peer ran `shuffleArr(...)` independently, then mirrored their own shuffle to other seats — so host and joiner had different shared libraries until the first broadcast. Now we use a `seededShuffleArr(cards, roomId)` that generates an identical order on every peer, and stable iids of the form `dandan_{seed}_{idx}`. Host and joiner converge on the SAME library before any broadcast.

9. **Cards getting stuck behind the hand strip.** The BF zone visually extends down to the viewport bottom, but the hand strip is overlaid on top of the lower `HAND_H` px. Cards dropped or dragged into that lower band became unreachable. Now both the float-drag drop logic and the BF re-position drag clamp `maxY = bfHeight - CH - HAND_H/2`, so cards always stay above the upper half of the hand strip and can always be re-grabbed.

10. **Big batch of cosmetic + UX requests:**
   - **Presence counter — "anyone on playsim.live counts as online".** App.jsx now subscribes every visitor (logged in or not) to a Supabase Realtime presence channel `playsim:lobby`. PresenceCounter prefers that count for the "Players Online" number. Falls back to user_profiles updated-in-last-10min, then total profiles.
   - **Stuck "in game" counter.** Lobby mount now also runs `cleanupGloballyStaleSeats(30)` — deletes any `room_players` row whose `updated_at` is > 30 minutes old. Fixes the "stuck on 2 in game" you saw after a crash.
   - **CommandBar cosmetic rework.** Life slightly smaller (16 → 13 px so the graveyard pile below isn't clipped). Commander damage cells now use the SAME font (`Cinzel Decorative, serif`), SAME size (13 px), SAME color tier (green at low → yellow → red at lethal), SAME styling as the life counter. Format: `⚔N` (was `avatar N/21`). The dim avatar emoji that looked out of place is gone.
   - **Topdeck context menu rewrite.** Dropped: Mill 1, Mill 3, Scry 1, Look at top 3, Look at top 5, Surveil 1, Surveil 2 (the fixed-N variants). Replaced with single "X…" prompts. Added: "Draw a card (C)", "Draw 7 cards (Shift+C)", "Draw X…". Each kept item has its hotkey label in parens: "Shuffle (V)", "Scry X… (G)", "Mill X… → Graveyard (Shift+M)", "Mill X… → Exile (Ctrl+Shift+M)".
   - **Hand context menu** items got hotkey labels: `→ Battlefield (Space)`, `Discard (D)`, `→ Exile (S)`, `→ Library Top (T)`, `→ Library Bottom (.)`. Added `Discard Hand (Y)` at the bottom.
   - **Battlefield context menu** items got hotkey labels: `Tap/Untap (Space)`, `→ Hand (R)`, `→ Graveyard (D)`, `→ Exile (S)`, `→ Library Top (T)`, `→ Library Bottom (.)`, `Clone (K)`, `Show Front (L)` / `Transform (L)`, `Target (O)`, `Invert (I)`, `Shake (H)`, `Add +1/+1 (U)`. Target/Invert/Shake/+1+1-counter were previously hotkey-only — now exposed as menu items too.
   - **Shift+C draws 7 cards** (new hotkey, listed in HotkeyHelp).
   - **Topdeck shrinks slightly when 4+ commanders** are in play (height 101 → 78, width 72 → 56). Avoids clipping by the larger command zone.

---

## Post-launch hotfixes (in this build)

After the initial v7.6.5 ship, six bugs landed from playtest. All addressed here, build verified clean.

1. **Presence counter showed 0.** Both queries assumed an `updated_at` column that may not exist on the deployed schema. PresenceCounter now tries `updated_at` first, falls back to total `user_profiles` count + total `room_players` count if the column is missing. App.jsx heartbeat aborts cleanly on the same error instead of looping.
2. **Creating a room kicked the host out of their seat.** `room_players.upsert` was hard-requiring `updated_at` — if the column was missing the upsert failed silently and the seat row never got written. Now retries without `updated_at` on column-missing errors, so seats actually get written and the opp can see the room.
3. **Dandân library showed top-card image instead of sleeve.** SharedZones library now always renders the deck sleeve (or `CARD_BACK` fallback) at full opacity. The `opacity:.65 + tinted purple gradient` overlay that made it look "weird" is gone.
4. **Dandân graveyard had a translucent overlay.** Same fix: removed the gradient overlay. Graveyard pile now shows a clean sleeve placeholder (with grayscale tint when empty). The viewer modal still shows real card faces when opened.
5. **Dandân library + graveyard had no real right-click menus.** Both now wire `handleCtx` with a synthetic top-of-zone card, exposing the full ContextMenu (draw N, mill N, view, shuffle, look at top, etc.) — same as the menu in other formats.
6. **"DANDÂN" word in the middle of the battlefield.** Removed. The format is already obvious from the shared piles + the 📜 button in the header.
7. **Hotkeys ⌨ button was hidden in Dandân.** Now always visible alongside the Dandân-only 📜 info button.

## Second-round hotfixes (also in this build)

8. **↑ / ↓ keys for life ±1 restored.** When the topbar `LifeCounter` and `HandLifeCounter` were removed in favor of CommandBar (which has no +/- buttons by design), the keyboard listener that lived in HandLifeCounter went with it. The arrow-key handler now lives in the main GameBoard hotkey loop and modifies `player.life` via `changeLife` (so it logs and triggers the life-change animation correctly).
9. **HotkeyHelp completeness audit.** Cross-referenced the help modal against the actual hotkey handler. The help was missing: ↑, ↓, Y (discard hand), `?` / `/` (open help). Added all four. Now every hotkey active in the handler is documented.
10. **Hotseat opp-hand defense.** Investigation: `OppHandStrip` always renders the deck sleeve regardless of card data, `BoardSide` mounted `readOnly` suppresses its `HandOverlay`, and `OpponentTile` (3p/4p side tiles) renders sleeves only. So opp hand cards CANNOT structurally render face-up. Defensive belt-and-braces fix anyway: the hand prop passed to opp BoardSide now has every card's `faceDown` forced to `true` and tagged `_hotseatMasked: true`. If any future render path tries to display them, they render as sleeves.

### Note on "I see opp's hand in hotseat 2p"

If the user is still seeing card faces in the opp position after this build, it's likely the **switch-player UX** rather than a privacy leak: when you click "Switch Player" in hotseat, the new active player's hand fans face-up at the bottom (their own hand for their turn). That hand belongs to the now-active player, not the opp — but visually you just saw it move from the top (sleeve) position to the bottom (face-up) position. That's existing v6 behavior. A future "hand reveal prompt before turn start" UX is out of scope here.

---

## Headline fixes

### 1. The "steel border" bug

v7.6.4 introduced a regex error during the theme audit. **48 sites** had a pattern like:

```jsx
border: `1px solid ${cond ? T.accent : "${T.border}30"}`
```

The inner `"${T.border}30"` is a *plain JS string* (double-quoted), not interpolation. CSS receives the literal text `1px solid ${T.border}30` → invalid → browser falls back to its default `medium` border (~3px solid grey). The result: chunky chrome borders ringing every theme-aware UI element across the app.

Fix: rewrote each broken site to use a nested backtick template literal:

```jsx
border: `1px solid ${cond ? T.accent : `${T.border}30`}`
```

Same fix applied to 17 `rgba(...)` calls that wrapped `${T.accentRgb}` inside a double-quoted string.

### 2. OAuth login

`src/components/auth/OAuthButtons.jsx` — new component. Drops in below the email/password form on AuthGate (sign-in and sign-up modes only; reset-password mode hides it). Calls `supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })`.

Both providers are already configured on the Supabase project (see `AUTH-HANDOVER-BRIEF-v2.md`):
- **Google** — client ID + secret enrolled, callback registered
- **Discord** — app + secret enrolled, callback registered

`redirectTo` uses `window.location.origin + '/auth/callback'` so local dev (`localhost:5173`) and production (`playsim.live`) both work.

### 3. CommandBar — life + commander damage rework

Replaces:
- The "COMMAND ZONE" label text at the top of the command zone
- The old `LifeCounter` component on the in-game topbar
- The `HandLifeCounter` overlay component (positioned over the player's hand)

The new bar carries:
- Life total (click to type a new value — no +/- buttons)
- Per-opponent commander damage cells (`{avatar} dmg/21`)
  - 1 cell in 2p, 2 in 3p, 3 in 4p
  - Hover the cell to see the opp's full alias
  - Click to set the value (any integer 0–21)
  - ≥ 21 turns the cell red (lethal indicator)
  - Each change emits a log line: `T#:⚔ Cmdr dmg from {alias}: {prev} → {new}`

State persists on `player.commanderDamage` (already part of the player schema since the v7 cutover; previously unused).

The bar always renders on the local BoardSide. On opponent BoardSides, the bar renders read-only with no commander-damage cells (they track damage on their own side).

### 4. Filters → combobox

Deck gallery's filter row was a strip of 7 chunky pill buttons. Replaced with one `<select>` dropdown. Dandân omitted from the format options — you don't build Dandân decks (they're premade variants).

### 5. Deck card layout

The previous card layout left dead space at the bottom where Edit/Play buttons used to live. Now:
- Deck name + meta drop down to where Edit/Play used to be
- Entire card is the click target for "edit"
- Delete X (bottom-right) uses `data-deck-action` to stop click propagation
- Commander preview: when a deck has multiple commanders, show all of them
  - 1 commander → full-bleed art
  - 2 → side by side
  - 3 → three columns
  - 4 → 2×2 grid

`thumbImg` helper renamed to `thumbImgs` (plural) — returns up to 4 commander images. Backwards-compat shim retained.

### 6. Profile Settings — custom playmat

ProfileSettings modal now has:
- A URL input for a custom playmat
- A "Browse" button that opens the in-game `GamematPicker` (Scryfall art search + custom URL tab)
- Live preview thumbnail of the chosen URL with an X to clear

When set, the custom URL takes priority over the preset gradient selection. Profile playmat is itself overridden by any deck-specific playmat (per the v7.6.4 priority order).

### 7. Presence Counter actually shows real data

v7.6.4 added a presence counter that read `user_profiles.updated_at >= 10 minutes ago`. Issue: signing in doesn't bump that field. Result: counter showed 0 even with active users.

Fix:
- `App.jsx`: 60-second heartbeat to `user_profiles.updated_at` while signed in (also fires on `visibilitychange`)
- `storage.js`: `room_players` upserts now stamp `updated_at` explicitly so the In Game count works

### 8. Dandân room single-deck mode

User report: "we go from singledeck to normal behaviour within seconds of loading into the game."

Root cause: the `useEffect` that runs the opening-hand animation (shuffle + draw 7) fires on every client. With shared library/graveyard arrays, two clients shuffling and drawing independently produce divergent state — and the next broadcast pushes one client's view onto the other, looking like the single-deck mode "switched off".

Fix: opening-hand routine is now host-only (`gamemode === "dandan" && playerIdx !== 0` skips the shuffle and waits 1.2s before drawing 7 from the now-host-shuffled shared library).

### 9. Password reset

User report: "the reset link logs me in instead of letting me set a new password."

Root cause: the recovery email landed at `/?reset=1`, but Supabase emits `PASSWORD_RECOVERY` exactly once on load. If the top-level auth listener processed `SIGNED_IN` first and the React tree rendered Playground before `PasswordReset`, the user proceeded to the lobby.

Fix: `App.jsx` now installs a global `onAuthStateChange` listener inside `useResetFlag` that flips `resetMode = true` when `PASSWORD_RECOVERY` fires. Also catches the `#type=recovery` hash form some recovery emails carry.

### 10. Favicons + manifest

Full icon set installed in `/public`:
- `favicon.ico`, `favicon.svg`
- `favicon-16.png`, `favicon-32.png`, `favicon-192.png`, `favicon-512.png`
- `apple-touch-icon.png`
- `manifest.json` (PWA manifest)
- `logo-email.png` (for Supabase email templates)

`index.html` now links the full set.

---

## Misc

- `package.json` version → `7.6.5`
- README updated with the v7.6.5 section
- This changelog
- New handover brief: `HANDOVER-BRIEF-v7.6.5.md`

---

## Honest known gaps

- **Theme color audit is not 100% complete.** The 48 broken interpolations are fixed, but ~50 `rgba(200,168,112,...)` literals still remain in compound shadow/gradient strings (decorative glows that don't auto-translate cleanly). They'll look gold across all themes; not a contrast issue but won't follow accent color.
- **Custom-playmat URL** is stored on the profile as `gamematCustom`. The `gamemat` field stays in sync via the `url(URL) center/cover no-repeat` form. If the URL is invalid, you get a broken image background — there's no validation step.
- **3p/4p extra-opponent CommandBar.** The per-opp commander-damage tracker is local-only. The opp BoardSides for extra players (3p, 4p) show the existing OpponentTile with `♥ life` — no per-opp commander damage tracker on their board side. Local player tracks via the bar on their own side.
- **OAuth callback route.** The OAuthButtons set `redirectTo` to `${origin}/auth/callback`. The app currently doesn't have a dedicated `/auth/callback` route — supabase processes the hash on whatever URL it lands on, which works because `App.jsx` is the entry point and the auth listener fires on every URL. The dedicated route would only matter if there were route-level auth guards, which there aren't.

---

## Pass-1 hotfixes (Dandân + Commander regression hunt)

After v7.6.5 shipped, two regressions surfaced. Both fixed surgically without touching other modes.

### Dandân — host/joiner deck-pick prompts and blank cardback art

**Symptoms reported:**
1. After clicking "Create Room" in Dandân, the host was prompted to pick a deck from their library.
2. After clicking "Join", the joiner was shown the per-player deck picker too.
3. Cards drawn in Dandân rendered as the cardback / "topdeck" image. Pressing F to search the library showed every card as a blank tile.

**Root cause #1 — host popup.** `createRoom` writes the player_row with `deckId: dandanDeck.id` for Dandân, but never calls `setSelDeckId(...)`. The popup at the bottom of `RoomLobby` is gated on `myRoomId && !selDeckId`. After create, `myRoomId` was truthy and `selDeckId` was still the empty initial state → popup opened. **Fix:** stamp `setSelDeckId(dandanDeck.id)` after the create succeeds.

**Root cause #2 — joiner picker block visible.** The block is wrapped in `{gamemode!=="dandan" && (...)}`, but `gamemode` is local React state. The joiner's local `gamemode` defaults to `"standard"` and never updates when they Join a Dandân room — only the meta is Dandân, and the block doesn't read meta. **Fix:** in the Dandân branch of `joinRoom`, also `setGamemode("dandan")` and `setDandanVariantId(dvId)` so local state mirrors the room. As a defense-in-depth belt, the popup condition now also checks `(waitingMeta?.gamemode || gamemode) !== "dandan"`.

**Root cause #3 — blank cards.** `_dandanResolvedCache` is populated by `resolveDandanVariant(variantId)` (Scryfall batch fetch). For the host this fires from the `useEffect` triggered when they pick the variant. For the joiner it never fires — their `useEffect` is gated on local `gamemode === "dandan"`, which never flips. So when `startGame` runs, the joiner's `_resolveDandan(deck)` returns the unresolved stub deck (cards have `_pending:true, imageUri:null`). Every `mkCard()` call then produces a card whose renderer falls back to `CARD_BACK`. F-search shows the same stubs because they're literally what's in `player.library`. **Fix:**
- `joinRoom` Dandân branch now calls `resolveDandanVariant(dvId)` directly (fire-and-forget) the moment the joiner clicks Join.
- The room-fill polling effect that calls `onJoinGame` now `await resolveDandanVariant(dvId)` for Dandân rooms before fanning out, guaranteeing the cache is populated before any peer's `startGame` runs.
- The `gamemode` value passed to `onJoinGame` is now sourced from `meta.gamemode` first (with local `gamemode` as fallback), so race-y local state can't mislabel the game.

### Commander — single commander squeezed left of the command zone

`gridTemplateColumns: player.command.length<=2 ? "1fr 1fr" : "1fr 1fr"` — both branches were 2-column, so a single commander always sat in the first cell of a 2-cell row. Now `length<=1 ? "1fr" : "1fr 1fr"` — single commander gets its own full-width column and centers properly.

### Commander — topdeck reveal hover preview

The topdeck portrait (rotated 90° image inside the side library widget) was a bare `<img>` with no hover wiring. The shared `setHovered` (which drives the GameBoard-level `<CardPreview>` overlay) was never called from this element. **Fix:** wrap the portrait container with `onMouseEnter`/`onMouseLeave` that call `setHovered(player.library[0])` only when the top is currently revealed (`revealTop` on, or per-iid `revealTopOnce` match). When face-down, hover is a no-op so the preview doesn't leak the card identity.

### Commander — Scry / Surveil / Look at top X hover preview

`ScryModal` rendered each tile with `<CardImg ... noHover/>` and never received an `onHover` prop, so the GameBoard-level preview overlay had no way to know which card was being hovered. **Fix:** `ScryModal` now accepts `onHover` and threads it both to the wrapping `<div>` (so empty-tile hover still registers) and to the `<CardImg>` itself (`noHover` removed). The mount site passes `setHovered`. Works for `mode="scry"`, `mode="surveil"`, and `mode="look"` — i.e. all three context-menu actions (Scry N, Surveil N, Look at Top N) get the larger preview on hover.

### Topdeck context menu — redundant "Draw This Card" removed

The right-click menu on the topdeck portrait listed both "Draw This Card" (without hotkey label) and "Draw a card (C)" (with hotkey label). On the topdeck both items pulled the same card to the hand — only the labelling differed, so the unlabelled one was clutter. Removed the unlabelled entry; "Draw a card (C)" remains.

### Files touched

- `src/Playground.jsx` — RoomLobby (createRoom, joinRoom, polling, popup gate), BoardSide command-zone grid, BoardSide topdeck portrait hover, ScryModal signature/render, GameBoard ScryModal mount, `buildCtx` library branch (redundant draw item dropped).

No DB schema changes. No relay changes. No config changes. Other gamemodes untouched.

