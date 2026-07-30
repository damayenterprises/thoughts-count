# Builder Handoff — Spec A: Convergence & Placement

**From:** The Architect · **To:** The Builder · **Date:** 2026-07-29
**Full spec (your primary input, read it in full):** `docs/spec-A-convergence-placement.md`
**Tickets:** TC-47 (convergence trigger) · TC-44 (placement — *mechanics already built*) · TC-46 Fix 2 (nickname-aware near-dup review)
**When done → hand back to the Validator** (do not self-validate).

---

## 1. One-paragraph orientation

Thoughts Count's Pro import runs every contact through one dedup core (`netlify/functions/_import.mjs → upsertPerson`). Three related bugs remain after TC-38: (a) a book-of-business import that's the same human as someone in the user's *personal* circle silently creates a duplicate (TC-47); (b) once they converge we should ask "business or personal?" (TC-44 — already built, but unreachable); (c) two records with the same-ish name but different emails silently duplicate instead of asking "are these the same people?" (TC-46 Fix 2). You're fixing all three in one build because they edit the same step-3 logic. **The whole job is: when two records might be the same person, converge them and ask ONE gentle question — never silently duplicate, never reject, never lose anyone.**

---

## 2. Start state — do this first (there's a rebase gotcha)

- `main` already has TC-38 (Done) **and** TC-46 Fix 1 (merged, commit `a112c7c`).
- The placement machinery you'll build on lives on branch **`tc-44-cross-kind-placement`**, which is **2 commits behind `main`** (missing Fix 1).

**Setup:**
```bash
git checkout tc-44-cross-kind-placement
git rebase main            # bring in TC-38 + Fix 1; resolve any trivial conflicts
git checkout -b spec-a-convergence   # build here
```
`tc-44-cross-kind-placement`'s 2 commits (`d4d5985`, `4a1462f`) already implement the placement prompt — `maybeFlagPlacement()`, the `kind_locked` column in migration 002, the `move_to_roster`/`keep_personal` resolve actions, and the `public/import.js` UI. **Reuse them. Do not rebuild placement.**

---

## 3. Decisions already locked (do not re-litigate — David signed off 2026-07-29)

1. **Near-dup / cross-kind matching is name-equivalence, and always a gentle "Are these the same people?" yes/no.** Never auto-merge on a name, never reject a row, never silently duplicate.
2. **Name-equivalence = surname must match AND first names equivalent by ANY of:** exact · first-name **edit-distance ≤2 & ≤~0.34·len** (UPDATED 2026-07-29, was trigram ≥ 0.7 — trigram catches none of Sara/Sarah, Jon/John, Steven/Stephen, Micheal/Michael; verified live) · nickname/diminutive dictionary (Samuel/Sam, Matt/Matthew, William/Bill). This fires **even when both sides carry different email/phone identifiers** (that's the TC-46 Fix 2 re-opening).
3. **Deterministic only — NO LLM call in the import path.** Nickname matching is a static dictionary + pg_trgm. (Keeps imports instant and can't fabricate a match.)
4. **A4 (email field on the personal add-person form) is HELD OUT of this build.** David is wary it feels invasive. Ship A1–A3 only; the UX Reviewer will decide later whether/how any personal-side contact field belongs.

---

## 4. Build order (tasks — full detail in the spec)

- [ ] **A1 — Migration 003** (`supabase/migrations/003_crosskind_fuzzy.sql`, new). Rewrite `tc38_fuzzy_person_match` to (1) drop the hard `contact_kind='contact'` filter and return `contact_kind`, and (2) surface **same-surname** candidates in addition to trigram matches (nickname pairs like Bill/William score ~0 on trigram, so they'd never appear otherwise). Apply to the live DB (ref `ntnlzfezdlbwxbrphknn`) via the Supabase Management API — PAT in `.env`, same POST pattern as migration 002 (documented at the top of `002_pro_contacts.sql`).
- [ ] **A1b — Name helper** (`netlify/functions/_names.mjs`, new). Export `firstNamesEquivalent(a, b)` (exact ∪ first-name trigram ≥ 0.7 ∪ diminutives dictionary, bidirectional) and move `sameSurname` here from `_import.mjs`. Seed the dictionary from a maintained diminutives list; spec lists the minimum names to cover.
- [ ] **A2 — Unify `upsertPerson` step 3** (`netlify/functions/_import.mjs`, ~L240–277). Replace the single `ambiguous` computation with the three prioritized review triggers (cross-kind → near-dup → existing identifier-poor rule); one row raises at most one review candidate; keep the existing "don't re-propose the same pair" idempotency guard.
- [ ] **A3 — Cross-kind merge → placement** (`_import.mjs`, `resolveCandidate` merge branch). After a `merge` converges across kinds, call the existing `maybeFlagPlacement(...)` so the user then gets the one-tap "business or personal?" prompt. Skip if `kind_locked`.
- [ ] **A5 — Full re-verification** (see §5). A2 edits the verified core, so this is mandatory before handing to the Validator.
- [ ] ~~A4~~ — **held out this build** (see decision 4).

---

## 5. Verification matrix (must all pass — live + any test harness)

Re-prove every prior TC-38 behavior is unchanged, PLUS the new cases:
- Idempotent re-upload: same file twice → 0 added, 0 new asks.
- Identifier-first: 200 rows, 200 distinct emails → 200 people, 0 reviews.
- Within-kind fuzzy still propose-only; "David May" vs "David Kay" (different surname) never prompts.
- **TC-47:** personal "Jordan Rivera" (name only) + book import "Jordan Rivera" → one "same people?" prompt → merge → ONE person + "business or personal?" prompt → choice sticks → re-upload asks nothing. "Keep both" → two people, no re-ask.
- **TC-46 Fix 2 (different emails on both sides):** each prompts exactly one "same people?" review — "Sam Rivera"/"Sam Rivera" (exact), "Sara Johnson"/"Sarah Johnson" (spelling), "Sam Rivera"/"Samuel Rivera" and "Bill Hayes"/"William Hayes" (nickname). Merge → one person carrying both emails. "Bill"/"Bob" (same surname, unrelated) → NO prompt.
- **Prompt-volume sanity:** run a realistic ~200-row import and confirm the nickname net doesn't flood with prompts. If a common surname over-asks, apply the spec's fallback (require the spelling-fuzzy branch to also clear a full-name trigram floor) and note it for David.
- RLS-scoped to owner; keys server-side; frontend stays vanilla JS.

---

## 6. Guardrails
- Vanilla-JS frontend, no framework. All new tables/queries RLS-scoped to `auth.uid()`. Keys server-side only; `.env` gitignored.
- Trust/manifesto first: we ask, we never reject a row, we never silently duplicate, we never lose a contact.
- Branch off the rebased base; do not commit to `main`. Keep the migration additive (no destructive alters).

---

## 7. If you hit a blocker or something's ambiguous
Hand back to David to route — don't design around it or pull in another role. The spec is your complete input; if it contradicts the code you find, stop and flag it.
