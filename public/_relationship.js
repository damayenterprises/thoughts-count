// Thoughts Count — map a free-text relationship onto one of the intake's relationship chips
// (TC-49, UX fix #4 v2). Conservative and direction-aware: it only returns a chip when it's
// confident, and NEVER guesses on something ambiguous — free text still carries the
// relationship into the plan, so a miss costs nothing.
//
// Two passes:
//   1. Exact chip-label match (case-insensitive).
//   2. A keyword map, ordered so DIRECTION wins. Boss-indicators are checked before
//      report-indicators, so "my manager" resolves to "My boss" and can't be swallowed by the
//      "manage" in a report rule. Word-level matching (not raw substring) keeps "grandmother"
//      out of "Parent" and "manager" out of "Someone I manage".
//
// Reported case that must pass: "a teammate I manage" → "Someone I manage" (the manage-down
// direction beats the "teammate" coworker hint), with no false positive on "my manager".

// First matching rule wins. `words` match whole tokens; `phrases` match as substrings (so
// multi-word direction cues like "reports to me" work).
const RULES = [
  // Person is ABOVE the user — checked first so a "manager"/"boss" role can't be read as a report.
  { chip: "My boss", words: ["boss", "bosses", "manager", "managers", "supervisor", "supervisors", "superior", "superiors"], phrases: ["my boss", "i report to", "i work for"] },
  // Person reports TO the user (manage-down). "manage"/"manages" as whole words never match
  // "manager"/"managers"; the phrases catch the rest.
  { chip: "Someone I manage", words: ["manage", "manages"], phrases: ["reports to me", "report to me", "my report", "direct report", "i manage", "who reports to me"] },
  { chip: "Coworker", words: ["coworker", "coworkers", "colleague", "colleagues", "teammate", "teammates", "workmate", "workmates"], phrases: ["co-worker", "team mate", "i work with", "work together"] },
  { chip: "Partner / spouse", words: ["wife", "husband", "spouse", "partner", "fiance", "fiancee", "fiancé", "fiancée", "girlfriend", "boyfriend"], phrases: [] },
  { chip: "Parent", words: ["mom", "moms", "mother", "mothers", "dad", "dads", "father", "fathers", "parent", "parents"], phrases: [] },
  { chip: "Sibling", words: ["brother", "brothers", "sister", "sisters", "sibling", "siblings"], phrases: [] },
  // Close friend before Friend so "close friend" doesn't settle for the weaker chip.
  { chip: "Close friend", words: [], phrases: ["close friend", "best friend", "dear friend", "oldest friend"] },
  { chip: "Friend", words: ["friend", "friends"], phrases: [] },
  { chip: "Neighbor", words: ["neighbor", "neighbors", "neighbour", "neighbours"], phrases: [] },
  { chip: "Client", words: ["client", "clients", "customer", "customers"], phrases: [] },
  { chip: "Other family", words: ["cousin", "cousins", "aunt", "aunts", "uncle", "uncles", "niece", "nieces", "nephew", "nephews", "grandmother", "grandfather", "grandma", "grandpa", "grandparent", "grandparents"], phrases: ["in-law", "in law", "other family"] },
];

export function matchRelationshipChip(rel, picks) {
  const list = Array.isArray(picks) ? picks : [];
  const norm = String(rel || "").trim().toLowerCase();
  if (!norm) return null;

  // Pass 1 — exact chip label.
  const exact = list.find((p) => p.toLowerCase() === norm);
  if (exact) return exact;

  // Pass 2 — conservative, direction-aware keyword map.
  const words = new Set(norm.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
  for (const rule of RULES) {
    if (!list.includes(rule.chip)) continue; // only offer a chip the step actually has
    const wordHit = rule.words.some((w) => words.has(w));
    const phraseHit = rule.phrases.some((p) => norm.includes(p));
    if (wordHit || phraseHit) return rule.chip;
  }
  return null; // ambiguous → no chip; free text carries the relationship
}
