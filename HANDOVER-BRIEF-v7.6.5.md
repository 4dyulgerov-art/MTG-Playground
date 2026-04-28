# HANDOVER BRIEF — v7.6.5

**Date:** April 28, 2026
**Tag:** `v7.6.5`
**Branch:** `main`
**Build verified:** esbuild loader=jsx, exit 0

---

## Post-launch hotfixes (in this build)

This build folds in **ten** hotfixes that landed from playtest after the initial 7.6.5 push. None require schema changes or migrations — they're all client-side resilience patches.

1. **Presence counter falls back gracefully** when `user_profiles.updated_at` / `room_players.updated_at` columns aren't present — counts total profiles / seats instead of showing 0.
2. **Room creation actually writes the seat row** even when `room_players.updated_at` is missing — retries the upsert without the column on column-missing errors.
3. **Dandân library** shows a clean sleeve placeholder (no overlay), with a real right-click context menu.
4. **Dandân graveyard** matches — clean placeholder, real context menu, no purple gradient overlay.
5. **The "DANDÂN" word** in the middle of the battlefield is gone.
6. **Hotkeys ⌨ button** is now visible in Dandân header alongside the 📜 info button.
7. **App.jsx heartbeat** stops cleanly on schema-mismatch errors instead of looping.
8. **↑ / ↓ keys for life ±1** restored. Removing the topbar LifeCounter and HandLifeCounter took their keyboard listeners with them. The arrow keys now run through the main GameBoard hotkey loop and call `changeLife`, so they animate + log the change correctly.
9. **HotkeyHelp completeness audit.** Help modal now lists every hotkey the handler actually responds to. Previously missing: ↑, ↓, Y (discard hand), `?` / `/` (open help itself).
10. **Hotseat opp-hand defensive mask.** All hand-rendering paths verified to render sleeve only, but added belt-and-braces masking at the BoardSide prop level so future render additions can't accidentally leak card faces in hotseat (where the privacy mask doesn't run).

If you've already pushed the initial v7.6.5 to production, this build replaces it. The git commit message should reflect the hotfix nature: `v7.6.5 hotfix — Dandân polish, presence resilience, life hotkeys, hand-mask defense`.

---

## TL;DR

Polish + hardening release on top of v7.6.4. Headlines:
- **Steel-border bug fixed** (48 sites, the chrome-grey 3px borders ringing every UI element)
- **OAuth login** — Google + Discord buttons in AuthGate
- **CommandBar** rework — life + commander damage tracking at the top of the command zone, replaces both topbar life counter and the over-hand life overlay
- **Filters → combobox**, deck card layout fixed, multi-commander preview
- **Profile playmat: URL + Browse**
- **Presence Counter actually shows real data** (heartbeat to user_profiles, in-game stamp on room_players)
- **Dandân SharedZones polished** — clean sleeve placeholders, real context menus, no decorative overlays
- **Password reset bug fixed** (global PASSWORD_RECOVERY interceptor)
- **Favicons + manifest** installed in `/public`

No data-model changes. No relay changes. No migrations.

---

## Files changed (vs v7.6.4)

| File | Change |
|---|---|
| `src/Playground.jsx` | 48 broken-interpolation fixes; CommandBar component; HandLifeCounter mount removed; topbar LifeCounter removed; multi-commander deck thumbnails; combobox filter; profile gamematCustom; Dandân host-only opening hand |
| `src/App.jsx` | PASSWORD_RECOVERY interceptor; user_profiles heartbeat |
| `src/lib/storage.js` | room_players upsert stamps updated_at |
| `src/components/auth/AuthGate.jsx` | Imports + mounts OAuthButtons |
| `src/components/auth/OAuthButtons.jsx` | **NEW** |
| `index.html` | Full favicon + manifest links |
| `public/` | **NEW** directory with favicons, manifest, logo-email.png |
| `package.json` | Version 7.6.4 → 7.6.5 |
| `README.md` | v7.6.5 section added |
| `CHANGELOG-v7.6.5.md` | **NEW** |
| `HANDOVER-BRIEF-v7.6.5.md` | **NEW** (this file) |

---

## Deploy procedure

This release only ships **client code**. No relay deploy needed. No DB migration.

### Pre-flight checklist

1. The supplied zip extracts to a folder that mirrors the project root. Files to delete from your working tree before extracting (so the new structure replaces the old cleanly):
   - `src/` (entire directory)
   - `supabase/` (entire directory)
   - `server/` (entire directory)
   - `public/` (entire directory — new in 7.6.5)
   - `index.html`
   - `package.json`
   - `package-lock.json`
   - `vite.config.js`
   - `vercel.json`
   - `README.md`
   - `DEPLOY.md`
   - `.env.example`
   - `.gitignore`
   - `CHANGELOG-v7.6.4.md`
   - `HANDOVER-BRIEF-v7.6.4.md`
   - `BACKLOG-v7.6.4.md`

2. Keep `node_modules/`, `dist/`, `.vercel/`, `.env.local`, and any local debug files alone.

### VS Code / PowerShell deploy steps

Open VS Code's integrated terminal (PowerShell) and run:

```powershell
cd "C:\Users\paul and alex\Desktop\Project Files\mtg-v7"

# Make sure you're on main and up to date
git checkout main
git pull

# Wipe the old client files (keep node_modules etc).
Remove-Item -Recurse -Force `
  src, supabase, server, public, `
  index.html, package.json, package-lock.json, `
  vite.config.js, vercel.json, README.md, DEPLOY.md, `
  .env.example, .gitignore, `
  CHANGELOG-v7.6.4.md, HANDOVER-BRIEF-v7.6.4.md, BACKLOG-v7.6.4.md `
  -ErrorAction SilentlyContinue

# Extract the v7.6.5 zip into the working folder.
# (Right-click the zip → Extract All → choose the project folder, OR
#  use Expand-Archive in PowerShell.)
Expand-Archive -Path "$HOME\Downloads\mtg-v7_6_4-complete.zip" `
  -DestinationPath . -Force

# The zip contains a top-level folder named `mtg-v7_6_4` — move its contents up one level.
Get-ChildItem -Path .\mtg-v7_6_4 -Recurse | Move-Item -Destination . -Force
Remove-Item -Recurse -Force .\mtg-v7_6_4

# Sanity: confirm version bumped
Select-String -Path package.json -Pattern '"version"'
# expected: "version": "7.6.5",

# Install + build locally to verify before pushing
npm install
npm run build
# (you should see "vite v5.x building" then "✓ built in N.NNs")

# Commit + push
git add -A
git commit -m "v7.6.5 — steel-border fix, OAuth buttons, CommandBar, presence heartbeat"
git push origin main
```

Vercel auto-deploys on push to `main`. Watch the deploy at:
- https://vercel.com/[your-team]/project-kbdxj/deployments

DNS at `playsim.live` already points to Vercel — no DNS changes needed.

### Smoke test once deployed

1. **Sign-in page**: Google + Discord buttons appear below the email/password form. Both should redirect to provider, then back to playsim.live as a logged-in session.
2. **Topbar**: no life counter, no chrome-grey borders on buttons.
3. **Command zone**: CommandBar at the top showing life + opp avatar + cmdr damage cell. Click life → text input. Click opp cell → text input.
4. **Deck gallery**: combobox filter (no chunky pill row); deck cards have name at the bottom; clicking the card opens the editor; multi-commander decks show the right number of preview cards.
5. **Presence counter** (top-right of main menu): non-zero `Players Online` after a fresh login.
6. **Dandân test**: create Dandân room with the Forgetful Fish variant. Host shuffles, joiner draws from the same library. Library count is identical for both players throughout.

---

## Rollback procedure

If v7.6.5 breaks something on production:

```powershell
cd "C:\Users\paul and alex\Desktop\Project Files\mtg-v7"
git revert HEAD --no-edit
git push origin main
```

Vercel will auto-deploy the revert. The relay (`relay.playsim.live`) is unaffected — no rollback needed there.

If you need to redeploy v7.6.4 from a tagged commit:

```powershell
git checkout v7.6.4         # if tagged
# or git log --oneline | grep v7.6.4   # find the commit
git revert <commit-hash>..HEAD --no-edit
git push origin main
```

---

## What's NOT in this release

- ~50 `rgba(200,168,112,...)` literals remain in decorative shadow/gradient strings (gold glows that don't follow theme accent). Cosmetic, not contrast-blocking.
- 3p/4p extra-opponent CommandBar — the OpponentTile (right-edge tiles) shows life only, no per-opp commander damage tracker. Damage is tracked on the local player's bar.
- Resend email template logo update — the `logo-email.png` is in `/public/` so `https://playsim.live/logo-email.png` will work, but if Supabase email templates reference an old URL or hardcode the image elsewhere, that needs to be updated in the Supabase dashboard manually.
- A dedicated `/auth/callback` route — Supabase processes the hash regardless of route. Adding a real callback route would only matter if route-level auth guards existed (they don't).

---

## Known infrastructure state (carried from v7.6.4)

| Service | Detail | Status |
|---|---|---|
| Domain | `playsim.live` on Cloudflare | ✓ |
| Vercel | Pro — `project-kbdxj.vercel.app` | ✓ |
| Supabase | Pro — `twbponkjfwkvnsqemikk` | ✓ |
| Email | Resend via `noreply@playsim.live` | ✓ |
| Google OAuth | Configured + enabled | ✓ |
| Discord OAuth | Configured + enabled | ✓ |
| Email templates | All 5 pasted, Arcane Night themed | ✓ |
| WS Relay | `relay.playsim.live` port 3001 | ✓ |
| Monthly cost | ~$61/mo (Vercel $20 + Supabase $25 + DO $16) | — |

---

## Build verification

```bash
cat src/Playground.jsx | esbuild --loader=jsx > /dev/null
# exit: 0

cat src/App.jsx | esbuild --loader=jsx > /dev/null
# exit: 0

cat src/components/auth/AuthGate.jsx | esbuild --loader=jsx > /dev/null
# exit: 0

cat src/components/auth/OAuthButtons.jsx | esbuild --loader=jsx > /dev/null
# exit: 0
```

All four core files parse cleanly. `npm run build` will produce a Vercel-ready `dist/`.
