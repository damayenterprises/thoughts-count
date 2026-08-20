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

// The spelling-fuzzy gate: a small edit-distance relative to the name length. A match needs
// ALL of: ≤2 absolute edits, ≤~0.34 of the longer name, AND the longer name ≥4 chars. The
// length floor is what actually kills 3-letter coincidences ("Kim"/"Tim", "Jan"/"Jon" —
// distance 1, ratio 0.33) that the ratio alone lets through, while still catching real
// variants (Jon/John len 4, Sara/Sarah, Sofia/Sophia len 6).
const MAX_EDITS = 2;
const MAX_EDIT_RATIO = 0.34;
const MIN_LEN = 4; // longer name must reach this, or a 1-edit 3-letter pair falsely matches
function spellingClose(fa, fb) {
  const d = levenshtein(fa, fb);
  if (d === 0 || d > MAX_EDITS) return false;
  const longer = Math.max(fa.length, fb.length);
  if (longer < MIN_LEN) return false;
  return d / longer <= MAX_EDIT_RATIO;
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

// ---------- relationship-descriptor split (TC capture-loop, FIX 1) ----------
//
// The extractor sometimes carries a RELATIONSHIP DESCRIPTOR into the person NAME: the user says
// "my neighbor Tom is having surgery" and person_hint comes back as "Tom, neighbor" (or "neighbor
// Tom"), so a new person is created named "Tom, neighbor" with a null relationship. This helper
// splits a CLEAR descriptor off the name so people.name is the proper name and people.relationship
// picks up the descriptor.
//
// STRICTLY CONSERVATIVE (this area is sensitive — TC-89). We ONLY split two unambiguous shapes:
//   1. Leading  "my/the <relationship> <Name…>"   → name "<Name…>", rel "<relationship>"
//   2. Trailing "<Name…>, <relationship>"         → name "<Name…>", rel "<relationship>"
// We do NOT touch a bare "Uncle Bob" (no "my"/"the", no comma) — that leading word could be part of
// the name/how they're addressed, so it is left exactly as-is. When we're not confident, we return
// the name unchanged and no relationship (current behavior preserved).

// The relationship vocabulary we recognize as a descriptor. Multi-word forms ("co-worker",
// "in-law", "mother in law") are matched as phrases. Kept in one place so callers don't duplicate.
// EXPORTED (TC-136 follow-up) so the extractor/tool prompt can teach Della the SAME vocabulary the
// deterministic split recognizes, and normalizeRelationshipWord() can validate a model-supplied
// person_relationship against it (we never trust a free-form invented relationship).
export const RELATIONSHIP_WORDS = [
  "neighbor", "friend", "best friend", "coworker", "co-worker", "colleague", "boss", "manager",
  "sister", "brother", "sibling", "mom", "mother", "dad", "father", "aunt", "uncle", "cousin",
  "niece", "nephew", "partner", "wife", "husband", "spouse", "girlfriend", "boyfriend",
  "son", "daughter", "kid", "child",
  "grandmother", "grandma", "grandfather", "grandpa", "granddaughter", "grandson",
  "mother-in-law", "father-in-law", "sister-in-law", "brother-in-law", "son-in-law",
  "daughter-in-law", "in-law", "roommate", "teammate", "mentor", "mentee", "assistant", "client",
];
// Longest-first so "best friend" / "co-worker" / "mother-in-law" win over a shorter prefix.
const RELATIONSHIP_SET = new Set(RELATIONSHIP_WORDS.map((w) => w.toLowerCase()));
const RELATIONSHIP_BY_LEN = [...RELATIONSHIP_WORDS].sort((a, b) => b.length - a.length);
// A relationship word may be spoken with a possessive/plural tail we normalize off when comparing
// ("my neighbor's Tom" is not a thing, but "coworkers" / trailing punctuation can appear).
const normRel = (s) => String(s || "").trim().toLowerCase().replace(/[.,;:!?]+$/, "");

function isRelationshipWord(s) { return RELATIONSHIP_SET.has(normRel(s)); }

// Returns { name, relationship } — relationship "" when nothing was split. Pure + deterministic.
// name always non-empty when the input was (we never strip a name down to nothing).
export function splitNameRelationship(raw) {
  const original = String(raw || "").trim();
  if (!original) return { name: original, relationship: "" };

  // 2. Trailing "<Name…>, <relationship>" — a comma-separated descriptor after the name.
  //    Split on the LAST comma; the tail must be a single recognized relationship phrase.
  const ci = original.lastIndexOf(",");
  if (ci > 0) {
    const head = original.slice(0, ci).trim();
    const tail = normRel(original.slice(ci + 1));
    if (head && isRelationshipWord(tail)) {
      return { name: head, relationship: canonicalRel(tail) };
    }
  }

  // 1. Leading "my/the <relationship> <Name…>" — an explicit possessive/article marks the descriptor,
  //    so we can safely peel it. WITHOUT "my"/"the" we leave it alone (so "Uncle Bob" is untouched).
  const lead = /^(?:my|our|the)\s+(.+)$/i.exec(original);
  if (lead) {
    const rest = lead[1].trim();
    // Try the longest relationship phrase that prefixes `rest`, leaving a non-empty name after it.
    for (const rel of RELATIONSHIP_BY_LEN) {
      const re = new RegExp(`^${escapeRe(rel)}\\b[\\s'’]*`, "i");
      const m = re.exec(rest);
      if (m) {
        const name = rest.slice(m[0].length).replace(/^[\s,'’]+/, "").trim();
        if (name) return { name, relationship: canonicalRel(rel) };
        // "my neighbor" with no name after → not a name we can split; leave original untouched.
      }
    }
    // "my <something-not-a-relationship> <Name>" → don't guess; keep the original as the name.
  }

  return { name: original, relationship: "" };
}

// Light canonicalization so stored relationships read consistently (co-worker → coworker). We keep
// the user's word otherwise (mom stays mom, not "mother") — Della's copy is warm, not clinical.
function canonicalRel(rel) {
  const r = normRel(rel);
  const canon = { "co-worker": "coworker" };
  return canon[r] || r;
}

// TC-136 follow-up — validate + canonicalize a MODEL-SUPPLIED relationship (the extractor's new
// per-person `relationship`/`person_relationship` field). CONSERVATIVE by design: we only accept a
// value that is in our known RELATIONSHIP_WORDS vocabulary (after stripping a leading possessive/
// article "my/our/the" and a trailing possessive/plural tail), so the model can never invent an
// arbitrary descriptor or smuggle a name in here. Returns the canonical relationship word, or ""
// when the value isn't a recognized relationship (the caller then leaves relationship empty). Pure.
export function normalizeRelationshipWord(raw) {
  let r = normRel(raw);
  if (!r) return "";
  // Peel a leading possessive/article the model may echo ("my neighbor" → "neighbor").
  r = r.replace(/^(?:my|our|the)\s+/i, "").trim();
  // Tolerate a simple trailing plural ("coworkers" → "coworker") only when the singular is known.
  if (!RELATIONSHIP_SET.has(r) && r.endsWith("s") && RELATIONSHIP_SET.has(r.slice(0, -1))) {
    r = r.slice(0, -1);
  }
  if (!RELATIONSHIP_SET.has(r)) return "";
  return canonicalRel(r);
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
