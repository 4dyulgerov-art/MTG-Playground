# CHANGELOG — v7.6.5

**Released:** April 28, 2026
**Type:** Polish + hardening release on top of v7.6.4. No data-model changes, no relay changes, no migrations.

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
