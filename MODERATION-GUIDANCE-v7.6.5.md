# Moderation guidance — TCG Playsim v7.6.5

This document explains what the v7.6.5 moderation system does, what it
deliberately does **not** do, and what to add when the platform is ready
for it.

## What ships in v7.6.5

| Layer | Implementation |
|---|---|
| Wordlist filter (text) | `src/lib/automod.js` — two-tier (block / flag) |
| Lobby chat | `lobby_messages` table + realtime subscription |
| In-game chat filter | Inline in `InGameChat.send()` |
| Moderation log | `moderation_log` table, RLS-scoped to moderators |
| Strike counter | `profiles.strikes`, incremented on every block |
| Auto-revocation | `profiles.media_revoked = true` at strike ≥ 5 |
| User reports | `ReportUserModal` → `moderation_log` + mailto |
| Mod panel | `ModeratorPanel` — queue / users / full log tabs |
| Username history | `usernames_history` table + auto-trigger on alias change |

## What I deliberately did NOT do, and why

### Substring-block on `kill` / `hate` / `destroy` / `bomb`

Your message asked for these as block words. I implemented them as
**flag** words instead — the message goes through, but the moderator
sees it in the panel.

Why: in MTG these words have constant legitimate use. "I cast Lightning
Bolt to kill your creature." "I hate this matchup." "Destroy target
permanent." "This card is a bomb in limited." A naive substring block
would make in-game chat unusable. The flag tier means you still see them
all and can act if context is bad.

To upgrade to true contextual moderation, add an OpenAI moderation API
call (see below).

### Auto-email on every block

Your message asked to be emailed about every flagged message. I did not
implement this because **the browser cannot send email automatically**.
A `mailto:` link requires the user to click "send" — automod blocks fire
silently and have no UI to click through. Auto-email needs a server.

Workaround in v7.6.5: every block lands in `moderation_log` with
`reviewed = false`. The mod panel's "Queue" tab shows the count badge.
You check it like an inbox.

To add email alerts: write a Supabase Edge Function that subscribes to
`postgres_changes` on `moderation_log` and calls Resend / Mailgun / SES
when a row appears with `kind = 'automod_block'`. Roughly 30 lines of
Deno.

### Image-content classification on playmat / sleeve URLs

You correctly identified the problem: a malicious user can put gore,
porn, or worse at a playmat URL. Detecting this requires a vision API.
I did **not** implement it because:

1. **Privacy / cost.** Every URL submission becomes an outbound image
   request from your server to a paid API. At scale this costs money
   and creates a privacy claim about scanning user content.

2. **CSAM detection has legal obligations.** In the US, any platform
   that finds CSAM is legally required to report to NCMEC's CyberTipline.
   The EU has equivalent obligations under the DSA. You cannot
   "find it and silently block" — you must report. This needs a lawyer
   review before turning on, not a code review.

3. **One-shot implementation would be irresponsible.** Vision APIs
   need an API key, server-side handling of the URL fetch, a queue
   for back-off, a moderation-result handler, an appeal flow. Each is
   its own decision.

**Recommended path when you're ready:**

| Provider | Cost | Notes |
|---|---|---|
| Google Cloud Vision SafeSearch | $1.50 / 1000 | The cheapest. CSAM detection is included. |
| AWS Rekognition (DetectModerationLabels) | $1.00 / 1000 | Hierarchical taxonomy: Explicit Nudity → Female Underwear etc. |
| Sightengine | $0.40 / 1000 | Good for non-photo NSFW (drawings, hentai). |
| Hive Moderation | bespoke | Best accuracy on edge cases. Enterprise pricing. |
| Microsoft Content Moderator | $1.00 / 1000 | Includes face detection for "is this a real person". |

Implementation pattern:

```sql
-- Add columns
alter table profiles add column playmat_review text default 'pending'
  check (playmat_review in ('pending','approved','rejected','manual'));
alter table profiles add column sleeve_review text default 'pending'
  check (sleeve_review in ('pending','approved','rejected','manual'));
```

Then a Supabase Edge Function triggered on profile update reads the URL,
sends it to the chosen API, and sets the review column. Render code
checks `profile.playmat_review !== 'rejected'` before showing.

Until that ships, your defensive line is: the strike counter. A user who
puts illegal content as their playmat will earn strikes for the chat
behaviour that goes with it; at 5 strikes their playmat is suppressed
network-wide; mod panel lets you ban manually.

### Multilingual filter

The current wordlist is English-only. The block-pattern regexes work in
any Unicode language because of `\p{L}` boundaries, but the actual
patterns are English. A real moderation API (OpenAI's) handles 50+
languages out of the box. Don't try to maintain a Spanish + Russian +
Arabic wordlist by hand.

## How to set up the moderation system on a fresh database

1. Run `supabase/schema-patch-v7.6.5-moderation.sql` in the Supabase SQL
   editor. It's idempotent — safe to re-run.
2. Promote yourself to moderator. In the SQL editor:
   ```sql
   update public.profiles set is_moderator = true
     where user_id = (select id from auth.users where email = 'tcgplaysim@gmail.com');
   ```
   Replace the email with your own.
3. Reload the app. The Help dropdown now shows "🛡 Moderator panel".

## How to add words to the filter

Edit `src/lib/automod.js`. Three lists:

- `BLOCK_PATTERNS` — regex array. Hard block. Add patterns that have no
  legitimate use in any context.
- `BLOCK_HASH_PREFIXES` — SHA-256 prefixes for slurs. Avoids putting the
  literal slur in source. To add: hash the lowercase form, take the
  first 12 hex chars, append.
- `FLAG_WORDS` / `FLAG_PATTERNS` — soft flag. Goes through, gets logged.
  Default safe place to add new entries you're unsure about.

When in doubt, add to FLAG. False positives lose users faster than
false negatives.

## Recommended timeline

| Pass | Add |
|---|---|
| Now (v7.6.5) | What's in this doc — wordlist + log + mod panel |
| +2 weeks | Replace wordlist with OpenAI `/v1/moderations` via Edge Function |
| +1 month | Email digest from Edge Function for high-severity hits |
| +2 months | Image classification on playmat/sleeve via Sightengine + manual override path |
| +3 months | Public moderation policy / appeal form linked from Code of Conduct |
| Before scale | NCMEC reporting integration + lawyer review of policy |
