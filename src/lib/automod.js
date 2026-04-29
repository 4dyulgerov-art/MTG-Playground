// ════════════════════════════════════════════════════════════════════════════
// TCG Playsim v7.6.5 — Client-side content moderation
// ════════════════════════════════════════════════════════════════════════════
//
// SCOPE & DESIGN PHILOSOPHY
// ─────────────────────────
// Wordlist-based moderation is INADEQUATE. False positives are inevitable, real
// bad actors routinely circumvent substring matching, and the maintenance
// burden is permanent. This module exists as a deliberately-simple stopgap so
// the platform isn't open-mic on day one.
//
// It MUST be replaced by a real moderation API before scale. Recommended:
//   • OpenAI's /v1/moderations endpoint (free, multilingual, 11 categories)
//   • Google Perspective API (free, focused on toxicity scoring)
//   • Both can run server-side from a Supabase Edge Function so the API key
//     never reaches the browser.
//
// TWO-TIER FILTER
// ───────────────
// Tier 1 — BLOCK: message is dropped, an automod_block log entry is written,
//   strike counter is incremented. Use only for content that is unambiguously
//   bad in every context: explicit slurs, explicit suicide encouragement,
//   explicit threats of violence to a named target.
//
// Tier 2 — FLAG: message goes through unchanged, an automod_flag log entry is
//   written, strike counter is NOT incremented. Use for words that have
//   legitimate gameplay meaning: "kill", "destroy", "bomb" (a bomb is a strong
//   card), "hate" ("hate-bears" is a real archetype). Moderator reviews the
//   log and only takes action if context warrants it.
//
// THIS LIST IS DELIBERATELY SHORT
// ───────────────────────────────
// We start with a small core. False positives drive users away faster than
// false negatives. Every entry below should answer "does this word, in any
// reasonable MTG context, ever mean something benign?" — if the answer is
// yes, it goes in TIER_FLAG, not TIER_BLOCK.
//
// ADDING TERMS
// ────────────
// Open the moderation panel → "Wordlist" tab (NOT IMPLEMENTED yet — for now,
// edit this file). Strings here are matched as case-insensitive whole-word
// patterns (Unicode-aware via \\p{L}), so "kill" matches "kill" but not
// "Killian" or "skill". Patterns containing non-letter characters are
// matched as raw substrings.
// ════════════════════════════════════════════════════════════════════════════

// ── TIER 1: hard block ─────────────────────────────────────────────────────
// Slurs are intentionally NOT enumerated in this source file — listing them
// inline creates discoverable strings in the bundle that grep-scrapers index.
// Instead, we store SHA-256-prefix hashes of canonical lower-case forms,
// computed at build time. Adding a new slur means hashing it and pushing
// the prefix here. The matcher hashes every input word and checks for hits.
//
// HOW TO COMPUTE A PREFIX (in Node):
//   const c = require('crypto');
//   const h = c.createHash('sha256').update('your_slur_here').digest('hex');
//   console.log(h.slice(0, 12));
//
// Then add the 12-char prefix to BLOCK_HASH_PREFIXES below.
//
// The starter list is empty on purpose — moderators populate it for their
// community's languages. A maintainer-curated public default list can be
// added once we have a moderation panel UI for editing.
const BLOCK_HASH_PREFIXES = new Set([
  // intentionally empty — populate via the moderation panel.
  // Example shape (this is a hash of a benign placeholder, not a real slur):
  // "fcde2b2edba5",
]);

// Plaintext block patterns — for things that ARE okay to have in source.
// These are short, unambiguous, and have no MTG-gameplay collision.
//
// HARD SLURS — added in v7.6.5.1 emergency patch.
// Built from character classes rather than literal slur strings:
//   • Resists common leetspeak substitutions (1=l/i, 3=e, 4=@=a, 0=o, etc.)
//   • Doesn't ship a discoverable slur wordlist in the bundle
//   • Word-boundary anchored to avoid false positives on legitimate words
// Order: most-common slurs first (regex engine short-circuits on first match).
const BLOCK_PATTERNS = [
  // ── Hard slurs (universally agreed; no benign use) ─────────────────────
  // n-word + variants ("er", "a", plurals). Character classes catch
  // substitutions like n1gger, n!gga, niggur. Doubled g enforced (>=2).
  /\bn[il1!|]+[gq]{2,}[a@4eo0u]+(r|rs|z)?\b/i,
  // f-slur + variants. {1,3} on g lets it match "fag", "fagg", "faggot".
  // The trailing group is optional so it catches the bare 3-letter form.
  /\bf[a@4]+[gq]{1,3}([eo03][tsz]+)?\b/i,
  // r-slur — disability slur, common harassment vector.
  /\br+[e3]+t[a@4]+r+d+(ed|s)?\b/i,
  // anti-Asian slur (the one starting with ch-)
  /\bch[il1!|]+n+k+[sz]?\b/i,
  // anti-Hispanic slur (the one starting with sp-)
  /\bsp[il1!|]+[ckq]+(s)?\b/i,
  // anti-Jewish slur (the one starting with k-)
  /\bk[il1!|]+k[e3]+[sz]?\b/i,
  // anti-Roma slur
  /\bgyp+[sz][il1!|]+[e3]?[sz]?\b/i,
  // ── Suicide encouragement ──────────────────────────────────────────────
  /\bk[\W_]*y[\W_]*s\b/i,                        // "kys"
  /\bkill\s+(?:yo?u?r?|ur)\s*self\b/i,            // "kill yourself" / "kill urself" / "kill ur self"
  /\bgo\s+(?:and\s+)?die\b/i,                    // "go die" / "go and die"
  /\bcommit\s+(?:suicide|sudoku)\b/i,            // includes the common 4chan misspelling
  // ── Personalised violent threat ────────────────────────────────────────
  /\bi(?:'m| am| will| ?ll)\s+going\s+to\s+(?:kill|murder|rape)\s+you\b/i,
  /\bi(?:'ll| will)\s+(?:kill|murder|rape)\s+you\b/i,
  // ── CSAM allusions — substring is enough; this is a permanent ban ──────
  /\bcp\b.{0,15}\b(?:link|url|share|post|trade)\b/i,
  /\bchild(?:ren)?\s+(?:porn|sex|nude)/i,
  // ── 14/88 dogwhistle (often paired) ────────────────────────────────────
  /\b14[\s\-_/]*88\b/,
  /\b88[\s\-_/]*14\b/,
];

// ── TIER 2: flag (don't block) ─────────────────────────────────────────────
// Words that are gameplay-legitimate but worth surfacing to a mod for
// out-of-context use. Whole-word matching via the regex builder below.
const FLAG_WORDS = [
  // Violence verbs — common in MTG chat about removal
  "kill", "destroy", "murder", "execute",
  // Threat/explosion language — common in MTG ("a board wipe", "this card is a bomb")
  "bomb", "nuke", "annihilate",
  // Hate / strong emotion
  "hate", "despise",
  // Add via mod panel.
];

// Common dogwhistle patterns. Conservative starter set, English-only.
// These are FLAG, not BLOCK — they're often used non-maliciously, and a
// moderator should review before action.
const FLAG_PATTERNS = [
  /\b14\W*88\b/,                   // 1488
  /\b((?:totally\s+)?legitimate)\s+(?:concerns|questions)\b/i,   // ironic wink
  /\bglow(?:ie|y)?s?\b/i,          // "glowies" — federal-agent dogwhistle
];

// ── Build whole-word regex from a flat string list ─────────────────────────
function _wordRe(words){
  if(!words.length) return null;
  // \p{L} = any Unicode letter; word boundaries via lookaround so we don't
  // match "kill" inside "Killian".
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|");
  return new RegExp(`(?<!\\p{L})(${escaped})(?!\\p{L})`, "iu");
}
const _flagWordRe = _wordRe(FLAG_WORDS);

// ── SHA-256 of a string, hex (browser-native) ──────────────────────────────
async function _sha256Hex(str){
  if(typeof window === "undefined" || !window.crypto?.subtle){
    return ""; // server-side stub; never blocks
  }
  const enc = new TextEncoder().encode(str);
  const buf = await window.crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2,"0"))
    .join("");
}

// ── Public API ─────────────────────────────────────────────────────────────
//
// inspect(text) → Promise<{ verdict, matched, normalised }>
//   verdict:  "block" | "flag" | "ok"
//   matched:  array of strings/patterns that triggered (for the log)
//   normalised: lowercased+trimmed text
//
// "block" means the message must be dropped at the call site and a
// moderation_log row written with kind='automod_block'.
// "flag" means let it through; write moderation_log with kind='automod_flag'.
// "ok" means do nothing.
export async function inspect(rawText){
  const text = String(rawText || "").trim();
  const norm = text.toLowerCase();
  const matched = [];

  if(!text) return { verdict:"ok", matched, normalised: norm };

  // 1. Plaintext block patterns
  for(const pat of BLOCK_PATTERNS){
    if(pat.test(text)){
      matched.push(`pattern:${pat.source}`);
      return { verdict:"block", matched, normalised: norm };
    }
  }

  // 2. Hashed slur check — split on whitespace/punctuation, hash each token
  if(BLOCK_HASH_PREFIXES.size){
    const tokens = norm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for(const tok of tokens){
      const hex = await _sha256Hex(tok);
      const prefix = hex.slice(0, 12);
      if(BLOCK_HASH_PREFIXES.has(prefix)){
        matched.push(`hash:${prefix}`);
        return { verdict:"block", matched, normalised: norm };
      }
    }
  }

  // 3. Flag patterns
  for(const pat of FLAG_PATTERNS){
    if(pat.test(text)){
      matched.push(`pattern:${pat.source}`);
    }
  }

  // 4. Flag words
  if(_flagWordRe){
    const m = text.match(_flagWordRe);
    if(m) matched.push(`word:${m[1].toLowerCase()}`);
  }

  return {
    verdict: matched.length ? "flag" : "ok",
    matched,
    normalised: norm,
  };
}

// Synchronous version that skips the hashed-slur check. Useful in render
// paths where you can't await (e.g. live input previews); call inspect()
// for the canonical decision before actually sending a message.
export function inspectSync(rawText){
  const text = String(rawText || "").trim();
  const norm = text.toLowerCase();
  const matched = [];
  if(!text) return { verdict:"ok", matched, normalised: norm };

  for(const pat of BLOCK_PATTERNS){
    if(pat.test(text)){
      matched.push(`pattern:${pat.source}`);
      return { verdict:"block", matched, normalised: norm };
    }
  }
  for(const pat of FLAG_PATTERNS){
    if(pat.test(text)) matched.push(`pattern:${pat.source}`);
  }
  if(_flagWordRe){
    const m = text.match(_flagWordRe);
    if(m) matched.push(`word:${m[1].toLowerCase()}`);
  }
  return {
    verdict: matched.length ? "flag" : "ok",
    matched,
    normalised: norm,
  };
}

// Strike threshold at which we auto-revoke playmat / sleeve URLs.
export const STRIKE_THRESHOLD = 5;
