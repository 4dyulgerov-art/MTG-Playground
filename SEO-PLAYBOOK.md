# TCG Playsim — SEO Action Plan

## What's now in the repo (v7.6.5.4)

### 1. Index page expansion
`index.html` got a heavy rewrite:
- Title rewritten to lead with the high-volume search query *"Play Magic: The Gathering Free Online in Your Browser"* rather than the brand name first.
- Keywords meta expanded from ~12 terms to **45+ terms** covering every variant of *play mtg free*, *free mtg playtester*, *play arena for free*, *mtg arena alternative*, *play mtgo in browser*, plus *commander*, *EDH*, *oathbreaker*, *dandan*, format names, and *playtester* variants.
- New **FAQPage schema** with 7 Q&A pairs — these can show as rich results in Google with the question expandable.
- **hreflang** tags signaling we serve all English-speaking markets (US, UK, CA, AU, IE) plus `x-default`.
- Hidden semantic content block (`.seo-content`) with H2-tagged paragraphs that Google indexes — covers *free MTG online*, *MTG Arena alternative*, *MTGO alternative*, *Commander/EDH*, *Dandân* in natural-language prose.
- Expanded `<noscript>` content (also indexed) reiterating the same.

### 2. Seven dedicated landing pages

Each is a fully-rendered static HTML page (10-11 KB each) with its own H1, schema, canonical, meta description, target keyword cluster, and internal links to siblings. They live at clean URLs (`vercel.json` has `cleanUrls: true`):

| URL | Targets |
|---|---|
| `/play-magic-online-free` | "play magic the gathering free", "play mtg free", "play magic free online" |
| `/free-mtg-playtester` | "free mtg playtester", "mtg playtester online", "browser mtg playtester" |
| `/playtest-mtg` | "playtest magic the gathering", "playtest mtg free", "mtg playtest online" |
| `/mtg-arena-alternative` | "mtg arena alternative", "free mtg arena alternative", "play arena for free" |
| `/commander` | "play commander online free", "edh online free", "free edh playtester" |
| `/oathbreaker` | "play oathbreaker online", "oathbreaker playtester", "oathbreaker mtg" |
| `/dandan` | "dandan format", "dandân magic", "play dandan online", "shared deck mtg" |

Each page has:
- A nav bar back to the app + sibling pages (improves crawl depth and dwell time)
- An H1 that exactly matches Google's expected query phrasing
- 3-4 H2 sections of substantive content (~600-1000 words each, real prose)
- An `Article` schema declaration
- A big CTA button to "Open the App" (links to `/`)
- A "Related" box at the bottom internal-linking all sibling landing pages

### 3. Sitemap, robots, vercel config

- `sitemap.xml` lists all 8 URLs with priorities. The home page is 1.0; landing pages are 0.85-0.9.
- `robots.txt` allows everything, points to the sitemap.
- `vercel.json` uses `cleanUrls: true` so `public/commander.html` serves at `/commander`. The SPA rewrite rule explicitly excludes the seven landing-page paths so Vercel serves them as static files instead of falling through to the SPA. Cache headers set sensibly (1h for HTML, longer for assets).

---

## What ONLY YOU can do (and these are bigger ranking factors than any tag)

The single biggest ranking signal is **backlinks** — other reputable sites pointing to yours. No amount of on-page optimization replaces this. New domains start with zero authority and have to earn it. Here's how, in priority order.

### Tier 1 — Free, high-leverage (do this week)

1. **Google Search Console** — verify `playsim.live`, submit `https://playsim.live/sitemap.xml`. This is how Google learns about your URLs and how you see what queries you're ranking for. Without this you're flying blind. https://search.google.com/search-console
2. **Bing Webmaster Tools** — same idea. Bing powers DuckDuckGo too. https://www.bing.com/webmasters
3. **Reddit** — post in:
   - **r/magicTCG** (3M subscribers) — DON'T spam. Post a *Show & Tell* thread with screenshots, asking for feedback. The goal is genuine community engagement; the SEO benefit is incidental.
   - **r/EDH** (650K) — focus on the Commander angle. Title: *"I built a free browser-based Commander playtester — feedback wanted"*.
   - **r/BudgetBrews**, **r/spikes**, **r/ModernMagic**, **r/Pauper** — similar pattern.
   - **r/oathbreaker** (small but loyal) — easy win, you genuinely solve their tooling problem.
   - **r/Dandan** does not exist but many MTG history communities discuss the format — search for old threads, gently mention TCG Playsim in replies *if* it's actually helpful.
   
   **Reddit is brutal about self-promotion.** Don't post the same thing across many subs in one day. Don't post links in titles. Engage in comments first. Post once every 2-3 weeks.
4. **Discord** — join MTG Discord servers (Commander Spellbook, EDHRec, Pauper, the various format Discords). DON'T cold-spam — participate, then mention the tool when relevant. Server admins often dislike unsolicited links; ask first.
5. **Hacker News** — Show HN: *"I built a free browser-based Magic: The Gathering playtester"*. Submit Tuesday or Wednesday morning US time. HN is technical, so emphasize the engineering: realtime multiplayer with Supabase, no download, ~14k LOC monolith. One shot — if it doesn't take off, don't resubmit.

### Tier 2 — Free, medium-leverage (this month)

6. **YouTube demo video** — a 60-90 second screen recording showing: deckbuilder → host room → join → play one turn. Upload, title with target keywords (*"Play Magic: The Gathering Free in Your Browser — TCG Playsim Demo"*), description with link to playsim.live. YouTube videos rank in Google. Embed this video on the homepage too.
7. **MTG content creators** — email small/mid YouTubers (subscribers 5k-50k, sweet spot) with a friendly note: *"I built a free MTG playtester, would you be interested in trying it for your next brew video? Happy to set up a deck for you."* Hit-rate is low but each that bites is a high-quality backlink.
8. **MTG Wiki** — there are unofficial MTG wikis (Wikipedia, mtg.fandom.com, MTG Salvation Wiki) with pages for various formats. Where appropriate (*and only where appropriate*), add a reference to TCG Playsim alongside Cockatrice / XMage / Untap.in. Don't be the third unsolicited "best free MTG simulator" link — be the one that's actually useful.
9. **Itch.io** — list TCG Playsim as a free browser game on Itch.io (https://itch.io). This is a live audience of indie game players, gives a backlink, and is dead simple to set up.
10. **Producthunt** launch — schedule a launch day. ProductHunt has a small but active audience and launches generate hundreds of backlinks if they go well.

### Tier 3 — Paid, fast (if you want traffic THIS WEEK)

11. **Google Ads** — bid on your target keywords. *"play mtg free"* costs ~$0.50-2 per click in the US. €50/day = 25-100 visits/day. This won't help SEO directly but it'll put real users in front of the product immediately. Use it to validate which keywords actually convert before investing in their SEO.
12. **Reddit Ads** — much cheaper than Google, can target r/magicTCG specifically. €20/day buys decent reach in MTG-niche subreddits.
13. **YouTube ads** — pre-roll ads on MTG channels. Niche but effective if your demo video is good.

### Tier 4 — Translation (Pass D, when you're ready)

You listed 30+ countries. Realistic priority for translation, by market size and effort:

| Priority | Language | Markets | Effort |
|---|---|---|---|
| 1 | Japanese | Japan (huge MTG market) | High |
| 2 | French | France, Belgium, Canada | Medium |
| 3 | German | Germany, Austria | Medium |
| 4 | Spanish | Spain, Argentina, Mexico, Latin America | Medium |
| 5 | Portuguese | Brazil, Portugal | Medium |
| 6 | Italian | Italy | Low |
| 7 | Polish | Poland | Low |
| 8 | Russian | Russia | Low |

**Don't translate the whole app first.** Translate the seven landing pages first (they're static, cheap to translate, and they're what Google indexes). Use a real translator for the top 3-4 languages, ChatGPT for the rest. Add `hreflang` tags pointing to translated URLs (e.g. `/ja/play-magic-online-free`, `/fr/dandan`). Translating the in-app UI is the biggest job — defer it until you see meaningful traffic from a non-English market.

### Realistic timeline

| Time | Expected outcome |
|---|---|
| Day 1-3 (post-deploy) | Google indexes the new pages. Starts to crawl. You'll see this in Search Console once verified. |
| Week 2-4 | Long-tail phrases (very specific queries like *"free oathbreaker playtester browser"*) start ranking on page 2-3. |
| Month 2-3 | If you've done some Reddit/HN posts, you should pick up your first organic backlinks. Long-tail rankings move to page 1. |
| Month 4-6 | Mid-competition keywords (*"free mtg playtester"*, *"play oathbreaker online"*) start ranking on page 1 if backlink profile is clean. |
| Month 6-12 | High-competition keywords (*"play magic the gathering free"*, *"free mtg arena alternative"*) become reachable IF the content is genuinely good and backlinks have accumulated. |

**Anyone promising "top 10 in 30 days" for high-competition keywords is selling you snake oil.** The math doesn't work — Wizards.com, MTG Arena's site, MTGO's site, and Cockatrice all have years of backlinks and brand searches. You out-rank them only on (a) niche queries they don't optimize for (you already crush *"dandan format"*) and (b) over time, by being demonstrably useful to a community that talks about you.

---

## After deploy

1. Run `npm run build` and push.
2. Verify in browser: `https://playsim.live/dandan` should serve the static landing page (not the SPA). Same for the other six.
3. Visit Google Search Console and request indexing of each new URL once. Don't request more than that — repeated requests get flagged.
4. Hit "Submit" on the sitemap in Search Console. Within 24-48h Google will show you which URLs it's discovered.
5. Set up your Reddit / HN / YouTube launch plan.

---

## Files touched in this SEO pass

- `index.html` — title, description, keywords, hreflang, FAQ schema, semantic content block
- `vercel.json` — `cleanUrls: true`, landing-page paths excluded from SPA rewrite
- `public/sitemap.xml` — 8 URLs with priorities
- `public/robots.txt` — clean allow-all + sitemap pointer
- `public/play-magic-online-free.html` — new
- `public/free-mtg-playtester.html` — new
- `public/playtest-mtg.html` — new
- `public/mtg-arena-alternative.html` — new
- `public/commander.html` — new
- `public/oathbreaker.html` — new
- `public/dandan.html` — new
