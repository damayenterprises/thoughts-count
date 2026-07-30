# Spec A — Convergence & Placement (TC-47 + TC-44 + TC-46 Fix 2)

**Author:** The Architect · **For:** The Builder · **Status:** Ready to build
**Tickets folded in:** TC-47 (cross-kind convergence trigger), TC-44 (placement prompt — *mechanics already built*), TC-46 Fix 2 (same-name/different-email near-duplicate review)
**Related but NOT in this spec:** TC-46 Fix 1 (personal-list leak) — already coded on branch `tc-46-dedup-separation`; ships independently as a prerequisite (see §Build order).

---

## Goal
When two records are the same human — whether that's a book-of-business import landing on someone already in the user's personal circle (TC-47/TC-44), or two business rows with the same name but different emails (TC-46 Fix 2) — the app converges them to ONE person and, when their "home" is ambiguous, asks a single one-tap question instead of silently guessing or silently duplicating.

---

## Background — what already exists (read before building)

The dedup core is `netlify/functions/_import.mjs`. Every ingested row runs through `upsertPerson()` in four ordered steps:
1. **Natural-key idempotency** (same source, same key already imported) → no-op field-merge.
2. **Deterministic identifier match** (email / E.164 phone in the `identifiers` table) → auto-converge (field-merge). **Not scoped by `contact_kind`** — this already converges across personal↔business.
3. **Fuzzy name match** → *propose only* (a `review_candidates` row), never auto-merge. Currently fires only when `(incoming is identifier-poor OR candidate is identifier-poor) AND surnames match`.
4. **No match** → insert new person.

**TC-44 is already implemented** on branch `tc-44-cross-kind-placement` and passed validation. It adds:
- Migration 002 gains `people.kind_locked boolean not null default false`.
- `maybeFlagPlacement(supa, userId, personId, intendedKind, batchId)` — after a **deterministic** cross-kind convergence (steps 1 & 2), if the merged person's `contact_kind !== intendedKind` and `!kind_locked`, it inserts a placement prompt (`review_candidates` row with `incoming._placement = true`), once per person.
- `resolveCandidate` handles `move_to_roster` / `keep_personal` → sets `contact_kind` + `kind_locked = true`, clears the prompt.
- `review-resolve.mjs` accepts the two new actions; `public/import.js` renders the placement prompt.

**Why TC-44 is currently unreachable (this is the bug TC-47 fixes):** personal people created in the companion (`public/companion.js → addPerson`) store only name/relationship/notes/location — **no email/phone, no `identifiers` row**. And the fuzzy RPC `tc38_fuzzy_person_match` (migration 002) hard-filters `contact_kind = 'contact'`. So a book import can never converge onto a personal person by *either* path → `maybeFlagPlacement` never fires → **silent duplicate** (proved live in TC-47: personal "Jordan Rivera" + book "Jordan Rivera" = two rows).

---

## Architecture

### The unifying idea
All three tickets are one question — *"is this the same person, and where do they live?"* — so step 3 of `upsertPerson` becomes the single place that raises the right review. Three trigger reasons, one review pipeline, resolved through the existing `review_candidates` + `resolveCandidate` machinery:

| Reason | Condition | Prompt raised | Ticket |
|---|---|---|---|
| Cross-kind name match | Incoming (a `contact`) matches a **personal** person by name-equivalence, no shared identifier | "Are these the same people?" (yes → merge / no → keep both) → on merge, then placement | TC-47 |
| Deterministic cross-kind | Identifier/natural-key match lands on a different-kind person | Placement prompt (business / personal) — **already built** | TC-44 |
| Same-name near-dup | Incoming matches an existing person by **name-equivalence** (exact, spelling-fuzzy, OR nickname) but both carry **different** identifiers | "Are these the same people?" (yes → merge / no → keep both) | TC-46 Fix 2 |

**Name-equivalence is the shared intelligence (David's direction 2026-07-29).** We never reject and never silently duplicate — when two names *could* be the same human we ask one gentle "Are these the same people?" with a yes/no. Two people count as a possible match when **surnames match** AND their first names are equivalent by any of:
1. **Exact** (normalized, case/whitespace-insensitive): "Sam Rivera" = "Sam Rivera".
2. **Spelling-fuzzy** — **UPDATED 2026-07-29 (David):** normalized **edit-distance** on the first name (≤2 edits AND ≤~0.34 of the longer name's length), NOT trigram. Verified against the live DB: first-name trigram ≥ 0.7 catches *none* of these (Sara/Sarah=0.571, Jon/John=0.286, Steven/Stephen=0.364, Micheal/Michael=0.333), so it can't meet the acceptance examples. Edit-distance catches them (Sara/Sarah=1, Jon/John=1, Steven/Stephen=2, Micheal/Michael=2) while rejecting Bill/Bob=3 and David/Daniel=3. Deterministic, no LLM. Cases: "Sara/Sarah", "Jon/John", "Steven/Stephen", "Micheal/Michael".
3. **Nickname/diminutive** (a deterministic bidirectional dictionary): "Samuel/Sam", "Matthew/Matt", "William/Bill/Will", "Robert/Bob/Rob", "Katherine/Kate/Katie", "Elizabeth/Liz/Beth".
Nickname pairs (Bill/William) score ~0 on trigram, so the dictionary is required — trigram alone misses them. **This is deterministic (a name table + pg_trgm), NOT an LLM call** — the import hot path must never depend on a model (keeps imports instant per Spec C, and avoids fabricated matches). Ship it as a small helper `netlify/functions/_names.mjs` exporting `firstNamesEquivalent(a, b)` (backed by a maintained diminutives list) and `sameSurname` (moved from `_import.mjs`).

### Data flow
- No new tables. Reuse `review_candidates` (holds both duplicate prompts and, via `_placement`, placement prompts).
- One migration (**003**) replaces the fuzzy RPC so it can see personal people and reports each candidate's `contact_kind`.

### API / function contracts (unchanged signatures)
- `tc38_fuzzy_person_match(p_user_id, p_name, p_threshold)` → now also returns `contact_kind`; **drops** the hard `contact_kind='contact'` filter. Return shape: `{ person_id, name, score, has_identifier, contact_kind }`.
- `upsertPerson(...)` — same signature/return; step 3 logic extended.
- `resolveCandidate(...)` — same signature; the `merge` branch, when it converges across kinds, additionally raises a placement prompt (reuse `maybeFlagPlacement`).
- `review-resolve.mjs`, `public/import.js` — no contract change; the "same person?" review reuses the existing merge/keep-both UI already shipped in TC-38.

### Candidate retrieval — must catch nickname matches
The current RPC returns the top-5 by **full-name** trigram similarity. Nickname pairs (Bill/William) score ~0 there and would never appear, so full-name trigram alone can't feed the nickname check. Broaden retrieval so the JS `firstNamesEquivalent` step has the right candidates: return anyone who **shares the surname** OR clears the full-name trigram floor. Surname sets are bounded per user (realtor beachhead = hundreds–low thousands of contacts); acceptable.

### Migration 003 (new file `supabase/migrations/003_crosskind_fuzzy.sql`)
```sql
-- TC-47 + TC-46 Fix 2: let the matcher see the personal circle too (report contact_kind
-- so cross-kind matches PROPOSE, never auto-merge), AND surface same-surname candidates
-- so the JS nickname/diminutive check (firstNamesEquivalent) can catch Bill/William etc.
-- that score ~0 on trigram. surname = lowercased last whitespace token.
drop function if exists tc38_fuzzy_person_match(uuid, text, real);
create or replace function tc38_fuzzy_person_match(
  p_user_id uuid, p_name text, p_threshold real default 0.4
) returns table(person_id uuid, name text, score real, has_identifier boolean, contact_kind text)
language sql stable as $$
  select id, name, similarity(name, p_name) as score,
         (primary_email is not null or primary_phone is not null) as has_identifier,
         contact_kind
  from people
  where user_id = p_user_id
    and p_name is not null and length(trim(p_name)) > 0
    and (
      similarity(name, p_name) >= p_threshold
      or lower(split_part(name, ' ', array_length(regexp_split_to_array(trim(name), '\s+'), 1)))
         = lower(split_part(p_name, ' ', array_length(regexp_split_to_array(trim(p_name), '\s+'), 1)))
    )
  order by score desc
  limit 25;  -- surname net can return several; JS applies firstNamesEquivalent + guards
$$;
```
Apply via the Supabase Management API (PAT in `.env`), same pattern as 002. *(Builder: if the inline surname SQL is awkward, an equivalent is fine — the contract is "returns trigram matches UNION same-surname people, each with contact_kind + has_identifier"; the JS layer does the final name-equivalence decision.)*

---

## Tasks (in build order)

- [ ] **A1 — Migration 003: broadened cross-kind fuzzy RPC.** Files: `supabase/migrations/003_crosskind_fuzzy.sql` (new). Apply to the live DB (ref `ntnlzfezdlbwxbrphknn`). Depends on: nothing. **Done when:** the RPC returns personal + contact candidates (trigram matches UNION same-surname people), each with `contact_kind` + `has_identifier`.

- [ ] **A1b — Name-equivalence helper.** Files: `netlify/functions/_names.mjs` (new). Depends on: nothing. Export `firstNamesEquivalent(a, b)` (exact ∪ first-name **edit-distance** ≤2 & ≤~0.34·len [UPDATED 2026-07-29, was trigram ≥ 0.7 — see Architecture note] ∪ nickname/diminutive dictionary) and move `sameSurname` here from `_import.mjs`. Use a maintained diminutives list (e.g. the standard "nicknames"/"diminutives" dataset) — seed at least: William, Robert, Richard, Charles, Elizabeth, Katherine, Margaret, Samuel, Matthew, Michael, James, Thomas, Joseph, Daniel, Christopher, Jonathan, Nicholas, Anthony, Edward, Jennifer. Bidirectional (Bill→William AND William→Bill). **Done when:** `firstNamesEquivalent("Bill","William")`, `("Sam","Samuel")`, `("Matt","Matthew")`, `("Sara","Sarah")` all true; `("David","Daniel")`, `("Bill","Bob")` false.

- [ ] **A2 — Rewrite `upsertPerson` step 3 to unify the triggers.** Files: `netlify/functions/_import.mjs`. Depends on: A1 + A1b. Replace the single `ambiguous` computation with, in priority order (one row → **at most one** review candidate, first reason wins):
  1. **Cross-kind (TC-47):** the best candidate with `contact_kind !== 'contact'` (a personal person) that shares no identifier with the incoming row AND passes `sameSurname` + `firstNamesEquivalent` → review candidate (`incoming = {...n, source}`). *(A "same people?" proposal; placement follows on merge — see A3.)*
  2. **Near-dup (TC-46 Fix 2):** a `contact_kind === 'contact'` candidate that passes `sameSurname` + `firstNamesEquivalent` (exact ∪ spelling-fuzzy ∪ nickname), **even when both carry different identifiers** → review candidate.
  3. **Existing within-kind rule (kept, now via the helper):** `(!incomingHasId || !c.has_identifier) && sameSurname(...)` → review candidate. (Reasons 2 and 3 overlap; keep both so the identifier-poor case still fires even when first names aren't nickname-equivalent, e.g. "Jane Doe" / "Jane Ann Doe".)
  Preserve the idempotency guard (don't re-propose the same `existing_person_id` + `incoming.natural_key`). **Done when:** each trigger raises exactly one gentle "same people?" review; none auto-merges; none rejects; re-upload re-proposes nothing.

- [ ] **A3 — Cross-kind merge raises the placement prompt.** Files: `netlify/functions/_import.mjs` (`resolveCandidate` merge branch). Depends on: A2 + the TC-44 base. When a `merge` resolves a candidate whose matched person is a **different kind** than the incoming intended kind (`'contact'`), after converging call `maybeFlagPlacement(supa, userId, personId, 'contact', batchId)` so the user then gets the one-tap "business or personal?" prompt. Skip if `kind_locked`. **Done when:** merging a cross-kind "same people?" review yields ONE person and then a placement prompt; answering it sets + locks the kind; re-upload asks nothing.

- [ ] **A4 — (OPTIONAL, UX-gated — David has reservations) Capture contact info on personal add for deterministic convergence.** Files: `public/companion.js` (`addPerson` + add-person form) + the personal-add write path. Depends on: nothing (independent of A1–A3). Rationale: an email/phone stored on a personal person lets a later book import converge **deterministically** (zero-tap) instead of via an A2 name proposal. **David's concern (2026-07-29):** an email field on the *personal* side risks feeling invasive or like data-collection — "we're not emailing that person." So this is NOT a plain "email" field. If included at all: make it clearly optional, frame it around the user's own context (not data capture), and **the UX Reviewer owns the framing/placement decision** — David explicitly wants UX input before this ships. **Default: hold A4 out of the first build; ship A1–A3, and let the UX Reviewer propose if/how it belongs.** **Done when (if built):** a personal person with stored contact info converges silently with a same-identifier import and triggers only the placement prompt, and the field reads as helpful, not invasive.

- [ ] **A5 — Full re-verification pass.** Files: none (test/verify). Depends on: A1–A3 (A4 if included). Re-run the entire TC-38 dedup matrix PLUS the new cases (see Acceptance). This is a Validator mandate because A2 edits the verified core.

---

## Acceptance criteria
Re-verify **every** prior TC-38 behavior is unchanged, plus the new ones:
- **Idempotent re-upload:** same file twice → 0 added, 0 new asks.
- **Identifier-first:** 200 rows with 200 distinct emails → 200 people, 0 reviews.
- **Within-kind fuzzy still propose-only** (never auto-merge); `sameSurname` guard still kills "David May" vs "David Kay".
- **TC-47:** a personal person (name-only) + a book import of the same name → ONE "are these the same person?" prompt; on merge → ONE person + a "business or personal?" prompt; the choice sticks; re-upload re-asks nothing; on "keep both" → two people, no re-ask.
- **TC-44 (now reachable):** deterministic cross-kind match (personal person WITH a matching email, e.g. via A4) auto-converges and prompts placement only.
- **TC-46 Fix 2 (name-equivalence):** each of these, with *different* emails, raises exactly one gentle "Are these the same people?" review (NOT a silent duplicate, NOT a rejection): "Sam Rivera"/"Sam Rivera" (exact), "Sara Johnson"/"Sarah Johnson" (spelling), "Sam Rivera"/"Samuel Rivera" and "Bill Hayes"/"William Hayes" (nickname). Merge → one person carrying both emails as identifiers; "no/keep both" → two people, no re-ask. Different surnames ("David May"/"David Kay") and unrelated first names ("Bill"/"Bob" same surname) do NOT prompt.
- All rows RLS-scoped to owner; keys server-side; frontend stays vanilla JS.

---

## Edge Cases & Risks
- **TC-46 Fix 2 threshold — DECIDED (David, 2026-07-29):** go beyond exact match — catch spelling variants AND nicknames (Samuel/Sam, Matt/Matthew, Bill/William), always as a gentle yes/no "Are these the same people?", never a rejection, never a silent duplicate ("we don't want a duplicate and we don't want to lose anyone"). Implemented via `firstNamesEquivalent` (exact ∪ **edit-distance** ≤2 & ≤~0.34·len [UPDATED 2026-07-29, was trigram ≥ 0.7] ∪ diminutives dictionary), gated by `sameSurname` to hold down false positives. Deterministic, no LLM.
- **Review-volume watch:** the nickname net is wider than exact-match, so re-verify prompt volume on a large realistic import (e.g. 200 rows). The surname gate + "different identifier" condition should keep it sane; if a common surname (e.g. many "Smith" clients) over-prompts, consider requiring the trigram-fuzzy OR nickname match to also clear a full-name similarity floor. Flag to David if volume looks noisy.
- **Nickname false-positive edges:** some diminutives are ambiguous (Al→Albert/Alexander/Alfred; Lee as given name). The dictionary should map conservatively; when in doubt it's still only a one-tap "no, keep both" — acceptable per David's "just want to check" framing.
- **Review flood from A1 widening the RPC:** including personal people could add candidates on common names. Mitigated because cross-kind only proposes when there's **no shared identifier** and it's capped at the single best cross-kind candidate per row. Watch review volume in the verification pass.
- **Two prompts in a row (TC-47 path):** "same person?" then "where do they live?" is two taps. Acceptable and honest. **UX Reviewer decides** whether to collapse into a single 3-way prompt ("keep both / merge → personal / merge → roster"); if collapsed, that's a new prompt type — flag as follow-up, don't jam into this build.
- **Ordering vs within-kind rule:** cross-kind and exact-name branches must not change the *existing* within-kind outcomes. Keep them as additional branches evaluated in the stated priority; do not alter the existing branch's condition.
- **A4 scope tension:** adding fields to the personal add flow risks cluttering the intimate surface. That's why A4 is optional and UX-gated.

---

## Out of Scope
- TC-46 Fix 1 (personal-list leak) — separate, already coded.
- Import speed / bulk rewrite — Spec C (must come after this merges).
- Partial dates — Spec B.
- FUB write-back, billing/paywall (TC-40), roster daily-ops loop (TC-41).
- Merging a book contact onto a personal person via *fuzzy across kinds with auto-merge* — cross-kind is always propose-only here.

---

## Build order (with the non-Architect prerequisites)
1. **Ship TC-46 Fix 1 first, independently** (branch `tc-46-dedup-separation`, already coded) → Validator → merge to main. Not part of this spec's build.
2. **Rebase `tc-44-cross-kind-placement` onto main** — it is the BASE for this spec (its placement mechanics are reused, not rebuilt).
3. Build A1 → A2 → A3 on that base. A4 only if David/UX green-light it.
4. A5 verification, then Validator.

---

## UX Phase: **RUN**
Touches user-facing flow: a new "are these the same person?" review case, the now-reachable placement prompt, and (if included) the A4 personal add-form field. The UX Reviewer gates this between Builder and Validator — key call for them: whether to collapse the two-step cross-kind prompt into one, and whether A4 belongs in the personal flow.
