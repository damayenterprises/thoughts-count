// Thoughts Count — deterministic name-equivalence for the dedup core (Spec A: TC-47 +
// TC-46 Fix 2). This is the shared intelligence behind "Are these the same people?":
// two records are a possible match when their SURNAMES match (sameSurname) AND their
// FIRST names are equivalent (firstNamesEquivalent). We never auto-merge on a name and
// never reject a row — a positive here only ever raises a one-tap review.
//
// STRICTLY DETERMINISTIC — a static diminutives dictionary + string edit-distance, NO
// LLM call. The import hot path must stay instant and can't fabricate a match.
//
// firstNamesEquivalent(a, b) is true when the first names are equivalent by ANY of:
//   1. Exact      — normalized (lowercased, letters-only): "Sam" = "Sam".
//   2. Nickname   — a bidirectional diminutives dictionary: "Bill"≡"William", "Sam"≡"Samuel".
//   3. Spelling   — normalized edit-distance ≤ 2 AND ≤ ~0.34·(longer length):
//                   "Sara/Sarah"(1), "Jon/John"(1), "Steven/Stephen"(2), "Micheal/Michael"(2).
// (UPDATED 2026-07-29, David: the spelling branch is edit-distance, NOT trigram ≥ 0.7 —
//  live pg_trgm scores those pairs 0.29–0.57, so trigram caught none of them.)
// Rejects: "Bill/Bob"(dist 3), "David/Daniel"(dist 3), and any different surname upstream.

// ---------- surname (moved here from _import.mjs) ----------

// Two names share a surname when their last token matches (case-insensitive, ≥2 chars —
// so single-initial "surnames" like "Chris P" / "Chris Q" don't count as a match).
export function sameSurname(a, b) {
  const last = (s) => { const t = String(s || "").trim().split(/\s+/); return t.length ? t[t.length - 1].toLowerCase() : ""; };
  const sa = last(a), sb = last(b);
  return sa.length >= 2 && sa === sb;
}

// ---------- first-name equivalence ----------

// First token, lowercased, letters-only (drops punctuation like "Jon." → "jon").
function firstToken(name) {
  const t = String(name || "").trim().split(/\s+/)[0] || "";
  return t.toLowerCase().replace(/[^a-z]/g, "");
}

// Diminutives / nicknames. Each group lists equivalent forms (formal + nicknames); any
// two tokens in the same group are equivalent, bidirectionally. Curated CONSERVATIVELY:
// a nickname that maps to more than one formal name (e.g. "Al" → Albert/Alexander/Alfred)
// is OMITTED so we never assert a wrong match — when in doubt it stays a separate name and,
// at worst, the surname net + edit-distance handles it or the user taps "no, keep both".
const DIMINUTIVE_GROUPS = [
  ["william", "will", "willy", "willie", "bill", "billy", "liam"],
  ["robert", "rob", "robbie", "bob", "bobby"],
  ["richard", "rich", "richie", "rick", "ricky", "dick"],
  ["charles", "charlie", "charly", "chuck", "chas"],
  ["elizabeth", "liz", "lizzie", "beth", "betsy", "betty", "eliza", "libby"],
  ["katherine", "kathryn", "catherine", "kate", "katie", "kathy", "cathy", "kat"],
  ["margaret", "maggie", "meg", "peggy", "marge", "greta"],
  ["samuel", "sam", "sammy"],
  ["matthew", "matt", "matty"],
  ["michael", "mike", "mikey", "mick", "micky"],
  ["james", "jim", "jimmy", "jamie", "jem"],
  ["thomas", "tom", "tommy", "thom"],
  ["joseph", "joe", "joey"],
  ["daniel", "dan", "danny"],
  ["christopher", "chris", "topher", "kit"],
  ["jonathan", "jon", "jonny", "jonnie"],
  ["nicholas", "nick", "nicky", "nico", "cole"],
  ["anthony", "tony", "ant"],
  ["edward", "ed", "eddie", "ted", "teddy", "ned"],
  ["jennifer", "jen", "jenny", "jenni"],
  // Common extras beyond the spec's minimum seed (all conservative, unambiguous):
  ["benjamin", "ben", "benny", "benji"],
  ["andrew", "andy", "drew"],
  ["joshua", "josh"],
  ["david", "dave", "davy", "davey"],
  ["timothy", "tim", "timmy"],
  ["kenneth", "ken", "kenny"],
  ["ronald", "ron", "ronnie"],
  ["donald", "don", "donnie"],
  ["stephen", "steven", "steve", "stevie"],
  ["patricia", "pat", "patty", "tricia", "trish"],
  ["deborah", "deb", "debbie"],
  ["susan", "sue", "susie", "suzy"],
  ["barbara", "barb", "barbie", "babs"],
  ["rebecca", "becca", "becky", "beck"],
  ["cynthia", "cindy"],
  ["theodore", "theo"],
  ["frederick", "fred", "freddy", "freddie"],
  ["gerald", "gerry", "jerry"],
  ["vincent", "vince", "vinny"],
  ["walter", "walt", "wally"],
];

// token → group index, for O(1) equivalence lookup. Curated so no token appears twice.
const NICKNAME_INDEX = (() => {
  const m = new Map();
  DIMINUTIVE_GROUPS.forEach((group, i) => group.forEach((tok) => { if (!m.has(tok)) m.set(tok, i); }));
  return m;
})();

// Classic Levenshtein edit-distance (insert/delete/substitute), iterative two-row DP.
export function levenshtein(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// The spelling-fuzzy gate: a small edit-distance relative to the name length. ≤2 absolute
// edits AND ≤ ~0.34 of the longer name keeps short-name noise down (rejects "Kim/Tim"-type
// coincidences) while catching real typo/spelling variants.
const MAX_EDITS = 2;
const MAX_EDIT_RATIO = 0.34;
function spellingClose(fa, fb) {
  const d = levenshtein(fa, fb);
  if (d === 0 || d > MAX_EDITS) return false;
  return d / Math.max(fa.length, fb.length) <= MAX_EDIT_RATIO;
}

// Are two people's FIRST names equivalent? Accepts full names OR bare first names (it
// only ever compares the first token). Exact ∪ nickname-dictionary ∪ spelling-close.
export function firstNamesEquivalent(a, b) {
  const fa = firstToken(a), fb = firstToken(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;                                   // 1. exact
  const ga = NICKNAME_INDEX.get(fa), gb = NICKNAME_INDEX.get(fb);
  if (ga !== undefined && ga === gb) return true;               // 2. nickname/diminutive
  return spellingClose(fa, fb);                                 // 3. spelling-close
}
