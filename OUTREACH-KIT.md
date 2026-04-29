# TCG Playsim — Outreach Kit

Copy-paste posts for every channel. Send these once each — don't carpet-bomb. Spread across 2-3 weeks for best effect (Reddit's algorithm penalizes simultaneous cross-posting; HN flags it).

**Important on tone:** all of these are written as a single dev sharing a project. Don't add emojis, don't add marketing fluff, don't say "AI-powered" or "I built this with [LLM]". Tech communities sniff out vibe-coding instantly and the post will get buried. Talk about what the product does and what's interesting about how it's built.

---

## 1. Hacker News — Show HN

**WHEN:** Tuesday or Wednesday, 8:00–9:30 AM US Eastern (peak HN traffic). Avoid Mondays (catching up from weekend), Fridays (dead), weekends (tech-niche audience working on side projects = weak engagement).

**HOW:** One shot, walk away. Post, don't reply to comments unless someone asks a direct technical question and you have a precise answer. Don't be defensive, don't argue, don't market in the comments. If it dies, it dies — don't resubmit.

**Title:**
```
Show HN: TCG Playsim – free browser-based Magic: The Gathering playtester
```

**URL field:**
```
https://playsim.live
```

**Text field (leave blank if you can; HN prefers URL-only Show HN, but here's a paragraph if you want one):**
```
Manual rules engine (players resolve interactions themselves at the table — the app handles bookkeeping). Every card from Scryfall is available; no collection grind, no economy. Real-time multiplayer for 2–4 players over a custom WebSocket relay. Supabase for auth and persistence.

Free formats: Standard, Commander (EDH), Oathbreaker, Modern, Pioneer, Pauper, Legacy, and the shared-deck Dandân format. The Dandân support is the part I'm proudest of — there aren't many places online to play it.

No download, no account needed to start.
```

**Why this format works on HN:**
- Lead with the product, not the journey
- One concrete technical detail (custom WS relay + Supabase) — signals you understand your stack
- One specific differentiator (Dandân) — gives the curious somewhere to dig in
- No "I'd love feedback!" or "what do you think?" — those read as junior

**If someone DOES comment with a question:**
- Answer briefly and factually if you know the answer cold
- "Good catch, that's a known limitation, on my list" is fine
- "Will look into that" — fine
- DO NOT explain your roadmap, your motivations, your inspiration, or your AI tooling

---

## 2. Reddit — six community templates

**General Reddit rules to not get banned:**
- Read each subreddit's self-promotion rule before posting. Most enforce a 9:1 or 10:1 ratio (9 non-promotional comments for every 1 promotional post). If your account is brand new with no comment history, you'll be auto-removed in many subs.
- **Build comment karma first.** Spend a week commenting genuinely in r/magicTCG, r/EDH, etc. Be helpful. Then post.
- Use a personal-feeling username, not "TCGPlaysim_Official"
- Post once per subreddit, then wait 2-3 weeks before posting in another. Mods talk and notice cross-posting patterns.
- Don't link in the title. Don't put the URL until line 2-3 of the body.
- Respond to comments. Reddit rewards engagement; HN doesn't. Different platforms.

### 2.1 r/magicTCG (general MTG, ~3M subscribers)

**Title:**
```
I built a free browser-based MTG playtester (Commander, Oathbreaker, Pauper, Dandân, all the formats Arena and MTGO ignore)
```

**Body:**
```
Hey r/magicTCG. I've been working on this for the past year and figured it's at a state where I can share it.

It's a manual playtester (you and your opponent resolve the rules at the table — the app does the bookkeeping) that runs entirely in the browser. No download, no install. Every card is available because it pulls from Scryfall.

What's in it:
- Standard, Commander, Oathbreaker, Modern, Pioneer, Pauper, Legacy, Dandân
- 2-4 player rooms over WebSocket
- Scryfall-powered deckbuilder with full search
- Per-deck custom playmats and sleeves
- Hotkey-driven gameplay (D draw, U untap, F search any zone, etc.)
- Custom card forge for homebrew formats and cubes

Free. No account needed for solo / single-link rooms; account needed only for cloud-saved profiles and lobby chat.

It's a virtual tabletop. Closer to what Cockatrice does than what Arena does — manual rules, every card, every format, $0.

Link: https://playsim.live

Trying not to oversell — the rules engine is manual, you click your own permanents, the app doesn't know what your card text means. That's deliberate (lets you play homebrew formats, custom cards, weird interactions). If you want automatic rules, MTGA / MTGO / XMage are the right tools. If you want to playtest a brew with a friend in 30 seconds, this is for you.
```

**Why this works:**
- Acknowledges the limitation (manual rules) up front — defuses the standard r/magicTCG critique
- Compares to Cockatrice/MTGA/MTGO openly — they appreciate honesty about positioning
- Specific feature list, no marketing fluff
- "Hey r/magicTCG" — tone of a regular user, not a brand

### 2.2 r/EDH (Commander, ~700K)

**Title:**
```
Free browser-based Commander playtester — 2-4 player free-for-all, every card, no download
```

**Body:**
```
Built a browser playtester that has Commander as a first-class format. No download, no card collection grind, no economy. Open a room, share the link, your pod hops in.

What's there for EDH:
- 100-card singleton deckbuilder with color-identity warnings
- Command zone is a real zone (commander tax tracked, partner commanders supported)
- Commander damage tracked per source-player pair (so 21 from one source registers correctly)
- 2-4 player rooms; everyone sees everyone's battlefield with sane scaling

Manual rules engine, so you and your podmates resolve interactions yourselves — but life totals, the stack, mana pool, counters, tokens, copies are all handled. Hotkey-driven so a turn doesn't take 90 seconds.

https://playsim.live

For testing a new precon upgrade against a podmate's deck, or trying a weird brew without committing to sleeving 99 cards. Not a replacement for paper, just a fast way to iterate.
```

### 2.3 r/oathbreaker (small but loyal — easy win)

**Title:**
```
Free Oathbreaker playtester in the browser — first-class format support
```

**Body:**
```
The Oathbreaker tooling situation is rough — most clients treat it as "Commander but smaller" and you have to manually move the signature spell to the command zone every game.

I've been working on a browser playtester that has Oathbreaker as its own format: planeswalker slot + signature spell slot, both start in the command zone, deckbuilder validates 60-card singleton with color-identity matching the planeswalker.

https://playsim.live → New Deck → format: Oathbreaker

It's free, no download, manual rules engine. 2-4 player rooms over WebSocket. Honest disclaimer: the player base is small right now, so for matches you'll mostly want to invite a friend or share a room link. Hopefully that changes.

If anyone tries it and finds something missing for Oathbreaker specifically, mention here or email tcgplaysim@gmail.com — happy to fix.
```

**Note:** This sub is small enough that an honest "the player base is small right now" lands well. They appreciate that you noticed their format isn't well-served.

### 2.4 r/Pauper (~80K)

**Title:**
```
Browser MTG playtester with native Pauper support, free, no download
```

**Body:**
```
Built a browser playtester with Pauper as a first-class deckbuilder format. Set format to Pauper, the deckbuilder filters Scryfall to commons-only.

Manual rules engine, runs in the browser, no download. 2-4 player rooms. Every card from Scryfall available; for Pauper specifically that means the entire common pool back to Alpha is right there.

https://playsim.live

Useful for testing a brew before you sleeve it up, or playing a friend who's across the country. Not a replacement for the actual MTGO Pauper queues if you want competitive ladder, but for casual brewing it's quick.
```

### 2.5 r/BudgetBrews (~80K)

**Title:**
```
Free browser MTG playtester so you can try a brew before sleeving it
```

**Body:**
```
Built a free browser-based MTG playtester. No download, no card collection — every card is available because it pulls from Scryfall.

Specifically useful for budget brewers: sketch a list, goldfish it solo to see how it draws, share a room link with a friend to actually play it. Iterate the list and try again. The whole loop takes minutes.

https://playsim.live

Standard, Commander, Modern, Pioneer, Pauper, Legacy, Oathbreaker, Dandân. Manual rules engine — you click your own stuff and resolve interactions, like at a table. Hotkeys make it fast.

If you want automatic rules / ranked play / a card economy, MTGA and MTGO are still the right tools. This is for the part where you want to test something without spending money on cards you might shelve in a week.
```

### 2.6 r/ModernMagic / r/Pioneer / r/spikes (mid-competition formats, ~80-200K each)

Pick one or two — don't post in all of them in the same week.

**Title:**
```
Free browser MTG playtester for testing matchups — every card available, no download
```

**Body:**
```
Built a free browser-based playtester (manual rules engine, runs in any modern browser, no install). Every card from Scryfall is available so you can build any deck and test any matchup.

For competitive testing specifically: 2-4 player rooms over WebSocket, hotkey-driven gameplay, action log so you can review the play sequence. Build deck → play it → review → tweak → repeat.

https://playsim.live

Not a replacement for MTGO if you want the real competitive ladder, but for the testing-the-sideboard-plan-against-a-friend phase, it's fast and free.
```

### 2.7 What NOT to do on Reddit

- Don't post in r/MagicArena — the audience there wants Arena-specific content, your post will read as off-topic and get downvoted
- Don't post in r/freemagic — that sub is about free-to-play Arena, different audience
- Don't post the same body across multiple subs in one day
- Don't post a link without context (auto-removed in most MTG subs)
- Don't reply defensively to negative comments. "Fair point, will look into it" disarms; arguing escalates

---

## 3. Discord — server templates

**General Discord rules:**
- Each server has its own self-promo channel (often `#self-promo`, `#community-projects`, `#cool-stuff`). Post there, NOT in the general channel.
- Read pinned rules in `#rules` first. Some servers explicitly ban project promotion.
- Don't @-mention anyone unless the rules invite it.
- Discord posts disappear in the chat scroll — they're worth less per impression than Reddit, but the people who see them are highly engaged.

### 3.1 General MTG Discords (Commander Spellbook, EDHRec official, MTG Discord)

**Post:**
```
Hey, sharing a project. Built a free browser-based MTG playtester — runs without a download, every card from Scryfall, 2-4 player real-time rooms over websocket. Manual rules engine (players resolve interactions, app handles bookkeeping).

Formats: Standard, Commander, Oathbreaker, Modern, Pioneer, Pauper, Legacy, and Dandân.

https://playsim.live

If anyone wants to test the multiplayer, drop a room link in here and I'll join.
```

**Why offering to join games yourself:** signals authenticity, gives the post a hook beyond "look at my project." If even one person tries it with you, you've got a tester who'll talk about it.

### 3.2 Format-specific Discords (Pauper Discord, Oathbreaker Discord, etc.)

**Post (Oathbreaker):**
```
Built a browser playtester with first-class Oathbreaker support — planeswalker + signature spell in the command zone, deckbuilder validates singleton with color identity matching the oathbreaker. No download.

https://playsim.live

If any of you have time to test it for Oathbreaker specifically and tell me what's missing or broken, I'd appreciate it. Email's tcgplaysim@gmail.com for longer feedback.
```

---

## 4. Wikis — be cautious here

Wiki edits get reverted aggressively if they look promotional. The goal is NOT to add a "TCG Playsim" page about yourself — that will be deleted. The goal is to add references where TCG Playsim is genuinely a useful resource on existing pages.

### 4.1 Where to add references

| Wiki | Page | What to add |
|---|---|---|
| mtg.fandom.com | "Dandân (format)" or "Dandân" | A line in the External Links / See Also section: *"TCG Playsim — free browser playtester with built-in Dandân variants"* |
| mtg.fandom.com | "Oathbreaker" | Same — reference in External Links |
| mtg.fandom.com | "Cockatrice" or "List of unofficial MTG software" | Add TCG Playsim as a peer entry |
| Wikipedia | Magic: The Gathering rules — DO NOT add | Wikipedia is strict about non-notable third-party tools. You'll get reverted. Skip this one. |

### 4.2 Edit text (for fandom wikis)

**Add to the External Links section as a single line:**
```
* [https://playsim.live TCG Playsim] — free browser-based playtester with native support for Dandân format
```

**Edit summary (the box that asks why you made the edit):**
```
Added external link to free browser playtester that supports this format
```

**Important:** Use a real-looking username, edit a few unrelated typos in the same article first to look like a normal editor, then add your link. If you edit the article from a brand-new account whose only contribution is your own link, it'll be reverted as spam.

---

## 5. MTG content creators — outreach list

The sweet spot for outreach is **5K-50K subscribers**: small enough to read your email, big enough to give real exposure if they cover you. Massive channels (TCC, Command Zone) won't see your message. Brand-new channels won't move the needle.

### 5.1 Tier 1 — small/mid, format-focused (most likely to bite)

These tend to actively look for tools. Verify subscriber counts before reaching out.

- **Crim's the Word** — Commander/Pauper/budget focus. Active Twitch, smaller YouTube. Approachable.
- **The Mana Source** — Commander brewing, mid-size. Has covered third-party tools before.
- **Spice8Rack** — high-quality long-form Commander/draft videos. Niche but devoted audience.
- **MissTimmy** — newer, casual MTG, growing fast.
- **Wedge / Crispy Taco Studios** — Modern Horizons / brewing focus.
- **I Hate Your Deck** — Commander, mid-size.
- **MTG Deck Tech (various)** — channels like MTG Lion, Magic Aids, Old School MTG that focus on lists rather than gameplay. They sometimes mention build tools.

### 5.2 Tier 2 — bigger but might still bite

- **Tolarian Community College (Brian Lewis)** — huge but he covers free MTG tools regularly. Long shot but worth one well-crafted email.
- **MTGGoldfish (Saffron Olive, Crim, Tomer)** — owned channel; they cover decks more than tools but a Pauper feature is plausible.
- **The Command Zone** — massive Commander-focus podcast. Cold email very unlikely to land but if a listener tries it, it could come up organically.
- **LegenVD** — Commander gameplay, mid-large. Reviews tools occasionally.

### 5.3 Tier 3 — Twitch streamers (often more accessible than YouTube)

- **PleasantKenobi** — UK MTG streamer, larger
- **Crim** — already mentioned
- **Various smaller Twitch MTG streamers** — search Twitch directory for "Magic: The Gathering" streamers under 1K viewers; many will accept a code review or product test

### 5.4 The outreach email template

**Subject:**
```
Free browser MTG playtester — would you give it 10 minutes?
```

**Body:**
```
Hi [first name],

I'm the developer of a free browser-based MTG playtester at playsim.live. It runs without a download, every card from Scryfall is available, and it supports Standard, Commander, Oathbreaker, Modern, Pioneer, Pauper, Legacy, and Dandân.

I've been a viewer of [specific recent video title] — particularly liked [one specific thing — a deck choice, a brew, something concrete]. Figured you might find the playtester useful for testing brews on stream or comparing two builds in a video.

If you have ten minutes to take a look, I'd appreciate any feedback (or critique). And if you ever do cover it on the channel, no obligation, but I'd be happy to set up any specific deck or format you want before recording.

Site: https://playsim.live
Quick demo flow: New Deck → paste a list or build with Scryfall search → Play. Hotkey reference is on the ? key.

Thanks for reading,
[your name]
```

**Why this works:**
- Specific compliment about a specific video — shows you actually watch the channel
- Asks for 10 minutes, not a video — low ask
- Offers to set up a deck before they record — moves cost to you, lowers cost to them
- No "I'd love to be on your channel!" — that's a cold ask that creators delete

**Sending tip:** Use a personal-domain email if possible (`paul@playsim.live` not `tcgplaysim@gmail.com`). Send Tuesday-Thursday morning their timezone. Send 5-10 emails in a batch and expect 1-2 replies max — that's the realistic hit rate.

---

## 6. itch.io listing

itch.io is great for free browser games. Submission is straightforward.

### 6.1 Create the page

1. Go to https://itch.io → Upload new project
2. **Project type:** HTML
3. **Embed in page:** No — link out instead (your site has auth flows that won't work in an itch iframe). Click "This file will be played in browser" → No.
4. **Visibility:** Public

### 6.2 Listing content

**Title:**
```
TCG Playsim — Free Browser MTG Playtester
```

**Short description (in the form):**
```
Free browser-based Magic: The Gathering playtester. Every card from Scryfall, every format, 2-4 player multiplayer. No download, no account required.
```

**Long description:**
```
TCG Playsim is a free, browser-based playtester for Magic: The Gathering. No download, no install, no card collection grind.

Build decks with full Scryfall card search. Play solo to goldfish a brew, or share a room link with up to three friends for real-time multiplayer.

Supported formats:
- Standard
- Commander (EDH) — full command-zone support, partner commanders, commander damage tracking
- Oathbreaker — first-class format with planeswalker + signature spell slots
- Modern, Pioneer, Pauper, Legacy
- Dandân — the classic shared-deck format, with multiple variants ready to play

Features:
- Full Scryfall-powered card search
- Per-deck custom playmats and sleeves
- Custom card forge for homebrew and cube formats
- Hotkey-driven gameplay
- Real-time multiplayer over WebSocket
- Free, no ads, no microtransactions

Manual rules engine — you and your opponent resolve interactions at the table, the app handles bookkeeping. This is by design: it lets the app support every format including homebrew variants and custom cards.

Play here: https://playsim.live

Contact: tcgplaysim@gmail.com
```

**Tags (use the suggestions box):**
```
card-game, magic-the-gathering, mtg, multiplayer, free, browser, no-download, deck-building, card-game-simulator, tabletop
```

**Category:** Card Game
**Rating:** No content warnings needed
**Pricing:** Free (no donations to keep itch listing clean — direct supporters to your Patreon)
**Cover image:** Use the OG image (1200×630 — itch will crop)

### 6.3 After listing goes live

itch automatically crawls the URL you point to, so the SEO benefit lands immediately. Don't pay for itch's "featured" promotion — it's overpriced for our genre.

---

## 7. ProductHunt launch

ProductHunt traffic is mediocre per-visitor (low intent — they're product-tourists), but the launch generates 50-200 backlinks if it goes well, which IS valuable for SEO.

### 7.1 Pre-launch checklist (1-2 weeks before)

- [ ] Make a ProductHunt account, lurk for a week, upvote products in your category
- [ ] Follow 20-30 active PH users, leave thoughtful comments on their products
- [ ] Schedule launch for a **Tuesday or Wednesday**, midnight PST (= when launches go live)
- [ ] Prepare 5 screenshots: lobby chat, deckbuilder, in-game battlefield, multiplayer host setup, mobile view
- [ ] Prepare a 30-second silent GIF or video showing the deckbuild → host → play flow

### 7.2 Launch day post

**Tagline (60 chars max):**
```
Free browser MTG playtester for every format
```

**Description:**
```
TCG Playsim is a free browser-based playtester for Magic: The Gathering. No download, no install, no card collection grind — every card from Scryfall is available immediately.

Why I built it: existing tools either cost money (MTGO), gate cards behind a grind (MTG Arena), or require a download (Cockatrice, XMage). I wanted something I could open in a tab and use to test a brew with a friend in 30 seconds.

What's there:
✦ Standard, Commander (EDH), Oathbreaker, Modern, Pioneer, Pauper, Legacy, Dandân
✦ 2-4 player real-time multiplayer rooms
✦ Scryfall-powered deckbuilder
✦ Custom playmats and sleeves per deck
✦ Custom card forge for homebrew formats and cubes
✦ Hotkey-driven gameplay
✦ Free, no ads, no microtransactions

Built with React, Supabase, and a custom WebSocket relay. Single dev, year of work.

Live at https://playsim.live
```

**Topics to tag:**
- Card Games
- Tabletop Games
- Open Source (if your code is open — only if so)
- Browser Games
- Indie Games

### 7.3 Launch day routine (this is the part that matters)

- 0:01 PST — your launch goes live
- 0:01–6:00 PST — your immediate network upvotes (friends, family, anyone you've personally asked beforehand). You need ~20 upvotes in the first 6 hours to break into top-10 of the day.
- All day — reply to EVERY comment within 30 minutes. ProductHunt tracks "maker activity" and weights it.
- End of day — top 5 of the day = ~50-200 backlinks, top 10 = ~20-50, lower = single-digit. Don't sweat the rank; even bottom-half gets you the "On ProductHunt" badge for your site.

### 7.4 Things NOT to do on PH

- Don't buy upvotes (PH detects this, deletes your launch, bans the account)
- Don't @-tag random influencers
- Don't relaunch after a flop — wait 6 months minimum
- Don't reply to comments with marketing speak

---

## 8. Reddit Ads

Much cheaper than Google, much better targeting for niche audiences.

### 8.1 Setup

1. Go to https://ads.reddit.com → New campaign
2. **Objective:** Traffic
3. **Targeting:**
   - **Subreddits:** r/magicTCG, r/EDH, r/Pauper, r/oathbreaker, r/ModernMagic, r/Pioneer, r/budgetbrews, r/spikes, r/freemagic
   - **Geography:** US, UK, CA, AU, IE first; add Germany, France, Spain, Brazil, Japan once you have translated landing pages
   - **Devices:** All
4. **Bid:** CPC, $0.40-0.80 starting (you can lower this if traffic is good)
5. **Budget:** €15-25/day for first 7 days as a test

### 8.2 Ad creative

**Headline:**
```
Free Browser MTG Playtester — Commander, Oathbreaker, Dandân, every format
```

**Body:**
```
No download, no install, no card collection grind. Build any deck, play 2-4 player rooms in your browser. Free.
```

**Image:** Use the OG image (1200×630 gameplay screenshot)

**Destination URL:** Match the subreddit:
- r/magicTCG → https://playsim.live/play-magic-online-free
- r/EDH → https://playsim.live/commander
- r/oathbreaker → https://playsim.live/oathbreaker
- r/Pauper → https://playsim.live/free-mtg-playtester
- r/budgetbrews → https://playsim.live/free-mtg-playtester
- r/freemagic → https://playsim.live/mtg-arena-alternative

### 8.3 What to watch for

- After day 2, check CTR (click-through rate). Reddit's average is 0.1-0.4%. Below 0.1%, replace the creative. Above 0.5%, double the budget.
- After day 7, check **conversion** (people who actually played a game, not just visited). If your CPA (cost per actual user) is under €1.50, scale. Above €5, kill it and rethink.
- Disable any subreddit performing below average — Reddit Ads' platform-wide stats hide subreddit-level losers.

### 8.4 Don't bother with

- Reddit "promoted post" format (engagement-objective) — looks promotional, gets downvoted, hurts your karma
- Reddit's lookalike audiences — too small for your niche to be useful
- Reddit Premium native sponsorships — very expensive, bad targeting

---

## 9. Facebook (skip if you can)

Facebook's audience for MTG is older, less interested in tools, and Facebook Ads has poor targeting for niche tech products. ROI is bad. **My recommendation: skip Facebook. Spend that budget on Reddit Ads instead.**

If you must:

- Facebook Pages: create one named "TCG Playsim", post a few times a month, expect engagement near zero
- Facebook Groups: Magic: The Gathering groups exist (search "Magic: The Gathering Players") with 5K-50K members. They're tightly moderated. Reading group rules is mandatory; many forbid third-party tool posts entirely.
- Facebook Ads: at best, €1-2 per click for low-quality traffic. Not worth it unless you've exhausted Reddit and YouTube ads.

If you want a Facebook presence purely for the appearance of a brand:

**One-line description:** `Free browser-based Magic: The Gathering playtester. No download.`

**Cover photo:** Use the OG image.

**About:** Same as the noscript content from index.html.

That's enough — don't invest more time here.

---

## 10. Sequencing — what to do this month

**Week 1:**
- Monday: Verify Google Search Console + Bing Webmaster, submit sitemap.
- Tuesday: Hacker News Show HN (8:00 AM US Eastern).
- Wednesday: itch.io listing live.
- Thursday: r/magicTCG post.
- Friday: ProductHunt launch (Tuesday next week — schedule, don't post yet).

**Week 2:**
- Monday: Email outreach batch #1 (5 mid-size content creators, Tier 1).
- Tuesday: ProductHunt launch goes live at 00:01 PST.
- Wednesday: r/EDH post.
- Friday: Email outreach batch #2 (5 more creators).

**Week 3:**
- Monday: r/oathbreaker + r/Pauper posts (different days within the week).
- Tuesday: Reddit Ads campaign live (€20/day budget).
- Wednesday: Discord posts (3 servers, spread across the day).

**Week 4:**
- Monitor Search Console — by now, sitemap should be fully indexed, you should see impressions for some long-tail terms
- Adjust Reddit Ads based on first-week data
- Wiki edits (1 per week max, on different IPs/accounts if you have access to them)

After week 4, the ongoing routine is:
- One Reddit post per month in a community you haven't hit yet
- One creator outreach batch per month
- Monitor Search Console weekly, request indexing for any new content
- Renew the Reddit Ads campaign if ROI was positive

That's it. Don't burn yourself out on outreach — most of the SEO compounding happens passively once Google indexes your pages and you've earned a few backlinks.
