# Deploying MTG Playground v7.2

This gets you from nothing to a live shareable URL you can playtest with 4 friends on different computers. **Total time: ~10 minutes.** Free tier everywhere.

> **Already on v7 or v7.1?** Jump to the [upgrade section](#upgrading-from-v7-or-v71) at the bottom — no full redeploy needed.

---

## Part 1 — Supabase (5 min)

Supabase handles authentication, the rooms database, and the realtime WebSocket layer.

### 1.1 — Create a project

1. Go to https://supabase.com and sign in (GitHub login is fastest).
2. Click **New project**. Pick any organization, give the project a name (e.g. `mtg-playground`), choose a strong DB password (save it — you won't need it for this app, but do save it), and pick the region nearest you and your friends.
3. Wait ~2 min for the project to provision.

### 1.2 — Run the schema

1. In the Supabase dashboard left sidebar, click **SQL Editor**.
2. Click **+ New query**.
3. Open `supabase/schema.sql` from this repo, copy its entire contents, paste into the SQL editor.
4. Click **Run** (bottom-right, or `Ctrl/Cmd + Enter`).
5. You should see `Success. No rows returned.` This created 5 tables (`profiles`, `rooms`, `room_players`, `game_state`, `game_events`), set up Row-Level Security, and enabled realtime publications.

To verify, click **Table Editor** in the sidebar — you should see all 5 tables.

### 1.3 — Grab your API keys

1. In the sidebar, click the **⚙ Project Settings** gear icon (bottom left).
2. Click **API**.
3. Copy two values:
   - **Project URL** (looks like `https://abcdefg.supabase.co`)
   - **`anon` `public` key** (a long `eyJ…` JWT string — this one is safe to expose in the browser)

> **Do NOT use the `service_role` key.** That one must stay secret and never ship to the browser. We only use `anon`.

### 1.4 — Configure email auth

By default Supabase requires email confirmation for new signups. For a playtest, you can either:

- **Keep it on** (safer): users get a confirm link on first signup.
- **Turn it off** (faster testing): dashboard → **Authentication** → **Providers** → **Email** → toggle **Confirm email** off.

For your initial 4-person playtest I'd recommend turning it off so nobody gets stuck waiting for email.

---

## Part 2 — Local dev check (2 min)

Before deploying, verify the app runs locally with your Supabase credentials.

```bash
git clone <your-repo> mtg-v7  # or extract the zip
cd mtg-v7
npm install

cp .env.example .env.local
# Edit .env.local:
#   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
#   VITE_SUPABASE_ANON_KEY=eyJ...

npm run dev
```

Open http://localhost:5173. You should see the **AuthGate** screen. Sign up with any email, sign in, and you'll reach the v6 **ProfileSetup** screen. Fill it in, then you're at the main menu. Click **⇄ Multiplayer** — the room lobby loads.

### Smoke test the cloud sync

1. In one browser window: sign up as user A, create a deck, create a 2-player room.
2. In a **different browser** (or incognito window): sign up as user B, create a deck, join the same room by ID.
3. User A should see user B appear in the waiting room within ~2 seconds. Both clients auto-launch into the game once the room fills.

If this works, you're ready to deploy.

---

## Part 3 — GitHub (1 min)

Vercel deploys from a Git repo.

```bash
git init
git add .
git commit -m "MTG Playground v7 initial"

# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR-USER/mtg-v7.git
git branch -M main
git push -u origin main
```

---

## Part 4 — Vercel (3 min)

1. Go to https://vercel.com and sign in with GitHub.
2. Click **Add New → Project**.
3. Find your `mtg-v7` repo in the list, click **Import**.
4. **Framework preset**: Vercel auto-detects Vite. ✓
5. **Build & Output settings**: leave defaults (`npm run build`, output `dist`).
6. **Environment Variables** — this is the important bit. Click **Add** and enter:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Supabase Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your Supabase anon key |

7. Click **Deploy**.
8. ~1 minute later you'll have a live URL like `https://mtg-v7-abc123.vercel.app`.

### Add the Vercel URL to Supabase's allowed redirect URLs

Otherwise email confirmation / password reset links won't work in production.

1. Back in Supabase → **Authentication** → **URL Configuration**.
2. **Site URL**: set to your Vercel URL (e.g. `https://mtg-v7-abc123.vercel.app`).
3. **Redirect URLs**: add the same URL plus `/**` (e.g. `https://mtg-v7-abc123.vercel.app/**`).
4. Save.

---

## Part 5 — Playtest with 4 people

1. Share your Vercel URL with 3 friends.
2. Everyone creates an account and a deck.
3. Host creates a **4-player room**.
4. Host shares the **Room ID** (shown at top of the waiting room) in Discord / text.
5. Other 3 players paste it into the "Join by Room ID" field.
6. Waiting room fills up 1/4 → 2/4 → 3/4 → 4/4, then auto-launches.

---

## Troubleshooting

### "Supabase not configured" banner on the login screen
The env vars didn't load. Make sure:
- In local dev: `.env.local` exists at the repo root and has both keys, then restart `npm run dev`.
- On Vercel: env vars are set in **Project Settings → Environment Variables**, and you've redeployed since adding them.

### Signup succeeds but login fails with "Invalid login credentials"
Email confirmation is on and you haven't clicked the link yet. Either click the link in your inbox, or turn off email confirmation in Supabase (see 1.4).

### "Room not found" when joining by ID
The host closed the room, or you mistyped the ID. IDs are case-sensitive.

### Other player doesn't see me join the room
- Check browser console (`F12`) for errors.
- Verify both of you are signed in (not stuck on AuthGate).
- Verify your Supabase project shows rows appearing in the `room_players` table as people join (**Table Editor** → `room_players`).

### RLS policy errors in the console (`new row violates row-level security policy`)
The schema.sql didn't finish running. Re-run it — it's idempotent.

### Game state doesn't sync between players
- Open browser console. Look for `[netSync.flush]` or `[netSync.start]` warnings.
- Check that `game_state` row exists in Supabase Table Editor for your room ID.
- Verify realtime is enabled: Supabase dashboard → **Database → Replication** → the `supabase_realtime` publication should include `game_state`. If not, re-run the final `do $$ … $$` block from `schema.sql`.
- **Expected caveat** — net sync is Phase 1 and uses last-write-wins. Rapid simultaneous actions (two players tapping cards within 80ms) may drop one update. This is expected for now.

### Free-tier limits I should know about
- **Supabase Realtime**: 200 concurrent WebSocket connections, 2 messages/sec/client. Fine for 4-player play; enough headroom for spectators too.
- **Supabase DB**: 500 MB. This app writes ~1 row per game action; millions of games before you'd hit it.
- **Vercel**: 100 GB bandwidth/month. Fine unless you get popular.

---

## Updating the deployed app

Every `git push` to `main` triggers an automatic Vercel redeploy. No manual step.

For schema changes (new tables, new columns), you'll need to re-run the relevant SQL in Supabase's SQL Editor — there's no auto-migration in this setup. If you add columns, `schema.sql` is written to be re-runnable (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS`, etc.) so you can copy-paste it over and over.

---

## Rollback / reset

Your v6 file is untouched in the original location. If anything goes wrong with v7, you still have v6. The v7 project is additive — deleting the `mtg-v7/` folder removes it entirely.

To reset your Supabase data (e.g. to clear test rooms):

```sql
delete from public.game_events;
delete from public.game_state;
delete from public.room_players;
delete from public.rooms;
```

To nuke all user accounts too: Supabase dashboard → **Authentication → Users → delete**.

---

## Upgrading from v7 or v7.1

If you already deployed v7 and want to pull in Phase 2 (privacy, change-deck, 3p/4p tiles):

### 1. Database
If you're on v7 (pre v7.1), run `supabase/schema-patch-v7.1.sql` in the Supabase SQL editor — adds the `profile jsonb` column to `room_players`.

If you're already on v7.1, **no database changes are needed** for v7.2.

### 2. Code
```bash
# extract the v7.2 zip over your existing project
git add .
git commit -m "v7.2: Phase 2 — privacy, change-deck, 3p/4p tiles, 2p layout fix"
git push
```

Vercel auto-redeploys within ~60 seconds.

### 3. Clear stale rooms (recommended)
Data model for rooms is unchanged, but stale rooms from earlier versions may have mismatched player data. Clean slate:
```sql
delete from public.game_events;
delete from public.game_state;
delete from public.room_players;
delete from public.rooms;
```

### 4. Regression test
- 1p solo from main menu → unchanged
- 2p hotseat local → opponent strip now visible on top ✅ (previously broken)
- 2p online → opponent strip visible with their real alias + sleeve
- Right-click deck pile → "⇄ Change Deck…" item appears in the menu
- 3p/4p → opponent tiles appear on the right edge; click to swap primary
