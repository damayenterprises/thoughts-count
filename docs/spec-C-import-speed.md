# Spec C — Import speed: make imports feel instant (TC-45)

**Author:** The Architect · **For:** The Builder · **Status:** ✅ UNBLOCKED — ready to build (Spec A + TC-46 merged 2026-07-30, commit `4b55a98`; Spec B / TC-43 also merged).
**Architect re-verification 2026-07-30:** confirmed the spec still matches the merged dedup core exactly — `runImport` (L224) → `upsertPerson` (L268) per-row 4-step order (natural-key → identifier → unified fuzzy step-3 incl. Spec A cross-kind/placement → insert), `insertPerson` (L364) preserved as the keep-both single-row path, `maybeFlagPlacement` (L391) placement queue, migration `003_crosskind_fuzzy.sql` applied. No drift; build as written.

---

## Goal
A 150–200 contact import completes in a few seconds (feels instant), with **every** TC-38 + Spec A dedup/idempotency/placement behavior unchanged.

---

## Background — why it's slow
`runImport()` calls `upsertPerson()` **once per row**, and each `upsertPerson` does several **sequential** Supabase round-trips (contact_sources lookup, identifier match, fuzzy RPC, insert person, insert identifiers, insert source, insert key_dates, maybe placement). At ~0.3–0.6s/row that's ~60–90s for 150 rows — functional (background + progress bar, inline threshold lowered to 25 in TC-38 V7) but not instant. The fix is to cut per-row I/O: resolve most rows in memory against prefetched maps, and write in bulk.

---

## Architecture

### The rewrite, in one line
Replace per-row round-trips with: **prefetch once → dedup in memory → fuzzy-RPC only the rare identifier-poor remainder → bulk insert.** Same decisions, same outcomes — just batched.

### Step 1 — Prefetch (one query each, per user)
- `contact_sources`: `(source, natural_key) → person_id` map.
- `identifiers`: `(type, value) → person_id` map.
- `people`: `id → { name, contact_kind, primary_email, primary_phone, kind_locked, relationship, notes, location }` (fields `mergeIntoPerson` needs, so field-fill happens in memory).
- Existing `key_dates` per person: `person_id → Set('kind|event_date|precision')` for in-memory de-dup of dates.

### Step 2 — Resolve each row in memory (mirror `upsertPerson`'s ordered logic exactly)
For each normalized row, in the SAME priority order the row path uses:
1. **Natural-key hit** → field-fill target in memory (queue a `people` update if any field changes), queue identifiers + key_dates + source touch. Cross-kind? queue placement (Spec A / TC-44 rule).
2. **Identifier hit** → converge: same as above, plus queue new identifiers. Cross-kind → queue placement.
3. **Fuzzy/name step — IN-MEMORY surname index, NO per-row RPC (resolved 2026-07-30, supersedes the earlier "keep the RPC" wording).** Every row that reaches step 3 (no natural-key, no identifier hit) runs the name step — that's *every brand-new distinct contact*, not a "rare remainder," so a per-row `tc38_fuzzy_person_match` call here is most of today's slowness AND can't see in-batch new people. **Replace it with a surname index built from the prefetched `people` map (plus in-batch new people, kept live as rows resolve).** This is provably decision-equivalent to the RPC — see the proof + the four mandatory parity guards in **Fuzzy-step resolution** below. Then apply the **Spec A** step-3 unified rules **byte-identically** (branches a/b/c: cross-kind propose, exact-name near-dup, within-kind id-poor surname) → queue a review candidate. The ONLY change is the candidate *source* (surname index, not RPC); the decision code is untouched.
4. **No match** → queue a NEW person (with a provisional local id) + its identifiers/source/key_dates.
**Intra-batch de-dup is mandatory:** as rows resolve, update the in-memory maps **and the surname index** so row N sees the person that row M (earlier in the same file) just created/updated. This replicates today's row-path behavior (each row commits before the next runs, so the RPC sees prior in-batch inserts) — and is the one thing the per-row RPC could never do in a batch, which is a second, independent reason the RPC can't stay.

### Step 3 — Bulk write (batched, order matters for FKs)
1. Bulk-insert new `people` (returning ids); resolve provisional ids → real ids.
2. Bulk-insert `identifiers`, `contact_sources`, `key_dates` for the new people (use the returned ids).
3. Bulk-apply queued `people` field-fill updates for converged existing people.
4. Bulk-insert `review_candidates` (dedup + placement), honoring the "don't re-propose the same pair" and "one placement per person" guards **in memory** (dedupe the queue before insert).
Batch sizes chosen to stay within Supabase/PostgREST payload limits (e.g. 500 rows/insert); chunk if larger.

### Idempotency & guards preserved
- Re-upload = every row hits natural-key/identifier in the prefetched maps → 0 inserts, 0 new candidates.
- `ON CONFLICT`/upsert semantics for `identifiers` (`user_id,type,value`) and `contact_sources` (`user_id,source,natural_key`) still apply on bulk insert (`ignoreDuplicates`).
- `kind_locked` still suppresses re-asking placement.

### Progress reporting
Keep the existing background+poll (`import-commit-background.mjs` → `import-status.mjs`). With bulk writes the phases are few (prefetch → resolve → bulk write), so report coarse progress (e.g. 3–4 checkpoints) rather than per-row. The visible progress bar surface is unchanged.

### No schema changes
Spec C is pure code. It relies on Spec A's migration 003 (cross-kind fuzzy RPC) already being applied. **The RPC `tc38_fuzzy_person_match` is NOT dropped** — migration 003 stays, and the RPC remains available for any residual single-row path (`upsertPerson`, kept for keep-both resolution). Spec C only stops the *bulk* path from calling it.

---

### Fuzzy-step resolution — in-memory surname index (the one real deviation from the original draft)

**Why this changed.** The original draft said "keep the per-row RPC; only the rare name-only remainder calls it." That was wrong on two counts: (1) *every* brand-new distinct contact reaches step 3 (no natural-key, no identifier hit) and the row path calls `fuzzyMatch` there **unconditionally** — even for rows carrying an email — so an all-new 200-row import = 200 RPC round-trips, i.e. most of today's slowness; it can't hit the single-digit-seconds bar. (2) The RPC reads the *live* `people` table, so it structurally cannot see in-batch new people — which directly contradicts this spec's own mandatory intra-batch-convergence requirement. Both point to the same fix.

**Why the swap is safe (decision-equivalence proof, verified against migration 003 + the merged `upsertPerson`):**
- The RPC (`003_crosskind_fuzzy.sql`, lines 55–67) returns a candidate when `similarity(name) >= 0.4` **OR** the surname (lowercased last whitespace token) matches — capped `limit 25`, `order by score desc`.
- The JS decision layer (`_import.mjs` step 3, branches a/b/c) accepts a candidate **only if `sameSurname` holds** — (a)/(b) via `nameEquiv = sameSurname && firstNamesEquivalent`, (c) via an explicit `sameSurname`. So **every trigram-only, different-surname candidate the RPC returns is always discarded** — it is provably inert.
- The RPC's `OR same surname` branch already surfaces *every* same-surname person. So `{RPC candidates that can affect a decision}` == `{same-surname people}` == `{what a surname index over the prefetched map returns}`. The surname index is neither narrower **nor broader** than the RPC's decision-relevant set.

**Four MANDATORY parity guards (this is how "byte-for-byte" is honored):**
1. **Identical surname rule.** Surname = lowercased LAST token after splitting on a whitespace *run* — the exact rule used in both SQL (`regexp_split_to_array(trim(name),'[[:space:]]+')`, last element) and JS `sameSurname`. The index key must match it exactly, or convergence diverges.
2. **Preserve which pair is surfaced (ordering).** The RPC returns `order by score desc` and the JS uses `.find()` — so when one incoming row has ≥2 qualifying same-surname existing people, the *closest* one is chosen. Order the in-memory same-surname bucket by descending name-similarity (exact full-name match first) and cap at 25 to mirror the RPC, so `.find()` picks the same `existing_person_id`. (Note: no case in the C5 test matrix has competing same-surname candidates for one row, so this is belt-and-suspenders — but it removes the only place in-memory could pick a different pair than the RPC.)
3. **Compute `has_identifier` in memory** from the prefetched `primary_email`/`primary_phone` — identical to the RPC's `(primary_email is not null or primary_phone is not null)`. Branch (c) depends on it. (Guard C1's prefetch must include those two fields — it already does.)
4. **Keep the decision code byte-identical.** Only the candidate *source* changes (surname index instead of `fuzzyMatch`'s RPC result). Do NOT touch `nameEquiv`, `firstNamesEquivalent`, `sameSurname`, branch order (a→b→c), the re-propose idempotency guard, or the placement logic. The swap is a feeder swap, nothing more.

**`score` on in-batch matches:** for a review candidate raised against an in-batch-created person there is no trigram score → store `score: null`. Verified non-behavioral: `score` is never read by a decision and never displayed. (Optional: populate a cheap JS similarity if trivial; not required for parity.)

**Intra-batch ⇒ id remapping extends to review candidates.** A row can converge (by surname) onto a person *created earlier in the same batch* that still holds a provisional id. So the C3 provisional→real id resolution must also rewrite `review_candidates.existing_person_id` (not just `people`/`identifiers`/`contact_sources`/`key_dates`). Miss this and cross-in-batch review candidates point at a dead provisional id.

---

## Tasks (in build order)
- [ ] **C1 — Prefetch layer.** Files: `netlify/functions/_import.mjs`. Depends on: Spec A merged. Add a `prefetch(supa, userId)` returning the four maps.
- [ ] **C2 — In-memory resolver.** Files: `netlify/functions/_import.mjs`. Depends on: C1. Port `upsertPerson`'s ordered logic (including Spec A step-3 unification + placement) to operate against the maps, queuing writes; keep `upsertPerson` available as the single-row path (reused by review "keep both" resolution — see risks). Handle intra-batch convergence. **Step 3 uses the in-memory surname index, NOT the per-row RPC — build it per the four parity guards in "Fuzzy-step resolution" above; keep the decision code (branches a/b/c) byte-identical.**
- [ ] **C3 — Bulk writer.** Files: `netlify/functions/_import.mjs`. Depends on: C2. Batched inserts/updates in FK-safe order; provisional→real id resolution; de-duped candidate queue.
- [ ] **C4 — Wire `runImport` to the bulk path.** Files: `netlify/functions/_import.mjs`, `netlify/functions/import-commit-background.mjs` (progress checkpoints), possibly `import-commit.mjs` (inline path — can keep row-path for tiny inline imports ≤25, or share the bulk path). Depends on: C3.
- [ ] **C5 — Full re-verification (the whole matrix, live + suite).** Depends on: C1–C4. Must explicitly cover the surname-index parity: (i) an all-new 200-row import produces the SAME added/updated/review counts and the SAME review pairs as the row path (diff the two paths on a fixture); (ii) an intra-file fuzzy pair (row M new person, row N same-surname near-dup) raises a review candidate that resolves to the real id after bulk write; (iii) a same-surname / different-first-name id-rich pair that trigram would have surfaced still lands in review via the surname branch (branch b), and a different-surname trigram-only pair does NOT (proving the inert-candidate claim); (iv) timing: 200 rows in single-digit seconds.

---

## Acceptance criteria
- 200-contact import completes in a few seconds (target: single-digit seconds).
- **Byte-for-byte behavior parity** with the row path on the full matrix: idempotent re-upload (0 added / 0 asks), identifier-first (200 distinct-email → 200/0), within-kind fuzzy review-only, exact-name near-dup review (Spec A / TC-46 Fix 2), cross-kind convergence + placement (Spec A / TC-47 / TC-44), comma-in-email safe match, intra-file duplicates collapse, one bad row never blocks the batch.
- RLS-scoped, keys server-side, vanilla-JS frontend, unchanged progress UI.

---

## Edge Cases & Risks
- **Highest-risk ticket in the cluster** — it rewrites the verified dedup core. Treat the TC-38 + Spec A test matrix as a golden set; parity is the bar, speed is secondary.
- **Keep the single-row path alive:** `resolveCandidate`'s `keep_both` calls `insertPerson` and must NOT re-run dedup. Don't delete `upsertPerson`/`insertPerson`; the bulk path is additive for the batch case.
- **Provisional id bookkeeping** is the subtle part — a new person created mid-batch that a later row converges onto must map correctly through the bulk insert's returned ids.
- **Payload limits / chunking:** very large files must chunk bulk inserts; don't assume one insert call.
- **Fuzzy step is in-memory, not per-row RPC** (resolved 2026-07-30 — see "Fuzzy-step resolution"). The original "keep the RPC for the rare remainder" line was wrong: the step is hit by *every* new contact, not a rare remainder, and the RPC can't see in-batch rows. The surname-index swap is provably decision-equivalent under the four parity guards; those guards ARE the parity work — verify them explicitly in C5.
- **Prefetch cost on huge rosters:** prefetching all identifiers/people for a user with tens of thousands of contacts could be large; fine for the realtor beachhead (hundreds–low thousands). Note as a future concern, don't solve now.

---

## Out of Scope
- Any behavior change — this is pure performance parity.
- Schema changes.
- FUB sync performance (separate path).

---

## UX Phase: **SKIP**
Backend/performance rewrite with no new user-facing surface — the existing progress bar simply completes faster. **David confirms the skip.** (If the Builder finds the progress UI needs to change materially, flip to RUN.)
