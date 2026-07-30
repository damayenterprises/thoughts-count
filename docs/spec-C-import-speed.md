# Spec C — Import speed: make imports feel instant (TC-45)

**Author:** The Architect · **For:** The Builder · **Status:** Ready to build — **but sequence LAST**
**⚠️ Do NOT start until Spec A (convergence & placement) is merged.** This spec rewrites the exact dedup core Spec A modifies. Building it against the pre-Spec-A core guarantees a rework.

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
3. **Fuzzy remainder (identifier-poor only):** most rows short-circuit above; only name-only rows call `tc38_fuzzy_person_match`. Apply the **Spec A** step-3 unified rules (cross-kind propose, exact-name near-dup, within-kind surname) → queue a review candidate.
4. **No match** → queue a NEW person (with a provisional local id) + its identifiers/source/key_dates.
**Intra-batch de-dup is mandatory:** as rows resolve, update the in-memory maps so row N sees the person that row M (earlier in the same file) just created/updated. This replicates today's behavior where row 2 finds the person row 1 inserted.

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
Spec C is pure code. It relies on Spec A's migration 003 (cross-kind fuzzy RPC) already being applied.

---

## Tasks (in build order)
- [ ] **C1 — Prefetch layer.** Files: `netlify/functions/_import.mjs`. Depends on: Spec A merged. Add a `prefetch(supa, userId)` returning the four maps.
- [ ] **C2 — In-memory resolver.** Files: `netlify/functions/_import.mjs`. Depends on: C1. Port `upsertPerson`'s ordered logic (including Spec A step-3 unification + placement) to operate against the maps, queuing writes; keep `upsertPerson` available as the single-row path (reused by review "keep both" resolution — see risks). Handle intra-batch convergence.
- [ ] **C3 — Bulk writer.** Files: `netlify/functions/_import.mjs`. Depends on: C2. Batched inserts/updates in FK-safe order; provisional→real id resolution; de-duped candidate queue.
- [ ] **C4 — Wire `runImport` to the bulk path.** Files: `netlify/functions/_import.mjs`, `netlify/functions/import-commit-background.mjs` (progress checkpoints), possibly `import-commit.mjs` (inline path — can keep row-path for tiny inline imports ≤25, or share the bulk path). Depends on: C3.
- [ ] **C5 — Full re-verification (the whole matrix, live + suite).** Depends on: C1–C4.

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
- **Fuzzy still per-row for the remainder** — acceptable because it's rare (identifier-poor rows). Do not try to batch the trigram RPC in v1.
- **Prefetch cost on huge rosters:** prefetching all identifiers/people for a user with tens of thousands of contacts could be large; fine for the realtor beachhead (hundreds–low thousands). Note as a future concern, don't solve now.

---

## Out of Scope
- Any behavior change — this is pure performance parity.
- Schema changes.
- FUB sync performance (separate path).

---

## UX Phase: **SKIP**
Backend/performance rewrite with no new user-facing surface — the existing progress bar simply completes faster. **David confirms the skip.** (If the Builder finds the progress UI needs to change materially, flip to RUN.)
