# MTG Playground v7

Browser-based Magic: The Gathering playtester. Built on top of the v6 single-file prototype with **zero gameplay regressions** — every feature from v6 (weather, planechase, dandan, custom cards, themes, hotkeys, sound studio, mat crop editor) is preserved intact. What's new in v7:

- **Real accounts** — email/password via Supabase Auth
- **Cross-computer rooms** — 2, 3, or 4 players gather from anywhere
- **Game-state sync** — actions broadcast to other players via Supabase Realtime
- **Vite build** — ships to Vercel with a single `git push`

---

## Quick start (local dev)

```bash
# 1. install
npm install

# 2. set up Supabase (one-time, see DEPLOY.md)
cp .env.example .env.local
# edit .env.local with your Supabase URL + anon key

# 3. run the dev server
npm run dev
```

Open `http://localhost:5173`.

---

## Project structure

```
mtg-v7/
├── supabase/schema.sql          ← run this once in Supabase SQL editor
├── index.html                   ← Vite entry
├── vercel.json                  ← SPA routing + security headers
├── src/
│   ├── main.jsx                 ← React root
│   ├── App.jsx                  ← auth gate → profile load → Playground
│   ├── Playground.jsx           ← v6 monolith, surgically patched
│   ├── hooks/useAuth.js
│   └── lib/
│       ├── supabase.js          ← client init
│       ├── auth.js              ← signUp / signIn / signOut / reset
│       ├── profiles.js          ← profile CRUD
│       ├── storage.js           ← THE key module: drop-in shim that
│       │                          routes shared=true to Supabase and
│       │                          shared=false to localStorage
│       ├── roomsRealtime.js     ← live room subscriptions
│       └── netSync.js           ← game state broadcast/subscribe
└── components/auth/
    └── AuthGate.jsx             ← login/signup UI
```

---

## How the surgical patch works

v6 was a single 7,879-line file that used a `localStorage`-backed `storage` shim for **everything** — including rooms, which is why rooms never worked across computers in v6 (each user had their own private localStorage).

v7 replaces **only** that shim with one that accepts a `shared` flag:

```js
await storage.get("room_abc_meta", true)   // → Supabase
await storage.get("mtg_decks_v3", false)   // → localStorage (unchanged)
```

v6's `RoomLobby` already passes `shared=true` for every room call, so the cross-computer behavior happens **automatically** with zero changes to `RoomLobby.jsx`. All other v6 features (decks, sound prefs, custom cards, themes) keep using localStorage exactly as before.

Six targeted edits were applied to `Playground.jsx`:

1. Replaced inline storage shim with `import { storage } from './lib/storage'`
2. `MTGPlayground` accepts `{ authUser, initialProfile, onProfileSaved, onSignOut }` props
3. Profile load prefers `initialProfile` (Supabase) over localStorage
4. `saveProfile` pushes changes back to Supabase via the callback
5. `updatePlayer` / `updateGame` broadcast via `NetSync` when `isOnline`
6. `startGame` accepts up to 4 seats + spins up `NetSync`; `switchPlayer` cycles through all seats; `resetGame` handles N players

---

## Hotkeys (inherited from v6, unchanged)

| Key | Action |
|---|---|
| `C` | Draw a card |
| `X` | Untap all |
| `V` | Shuffle library |
| `Shift+V` | Mill 1 |
| `M` | Mulligan |
| `Shift+M` | Mill X prompt |
| `N` | Next phase |
| `E` | End turn |
| `Y` | Discard hand |
| `F` | Search library |
| `G` | Scry |
| `B` | Chat |
| `W` | Create token |
| `A` | Priority: yes |
| `Q` | Priority: pass |
| `` ` `` | Roll d6 |
| `Shift+` ` | Roll d20 |
| `?` | Show full hotkey reference |
| `Ctrl/Cmd+A` | Select all permanents |
| `Esc` | Close modal / clear selection |

Plus hover-card hotkeys (act on whatever card your mouse is over) — see in-game `?` menu.

---

## Known limitations (Phase 2 backlog)

- **Game-state conflicts**: last-write-wins. If two players touch the same card within an 80 ms window, one action is truncated. Phase 2 will add per-zone authority or CRDT-style merges.
- **Multi-opponent UI**: in 4-player online, each player sees themselves vs the "next seat" opponent. The other two players' boards aren't yet rendered on a sidebar (their state still syncs correctly — it's a UI-only gap). Turn order and life totals for all 4 players ARE tracked.
- **Direct cross-player card actions** (milling an opponent, stealing their creature) work for the primary opponent but aren't wired up for the 3rd/4th player. Phase 2.
- **Supabase free tier throughput**: 2 messages/sec per client by default. Enough for normal play; a frantic four-person stack war could hit the cap. Upgrade to Pro (or self-host Supabase) if you play a lot.
- **Mobile**: v6 was desktop-first. Phase 3.

---

## Tech stack

- **React 18** + **Vite 5** — build/dev
- **@supabase/supabase-js 2** — auth, DB, realtime WebSockets
- **Vercel** — static hosting + automatic deploys from Git
- **Supabase Postgres** (free tier: 500 MB DB, 50 K monthly auth users, 200 concurrent realtime connections)

---

## Deploy to production

See [`DEPLOY.md`](./DEPLOY.md) for step-by-step Vercel + Supabase setup (~10 minutes).

---

## License

Your project — do whatever you want with it.
