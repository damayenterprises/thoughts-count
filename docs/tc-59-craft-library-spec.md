# TC-59 — Retrieval-augmented craft library (Loop 2b, the quality flywheel)

**Architect spec.** Builder's only input — execute without further context.
Loop 2b of TC-34. Depends on shipped TC-58 (the 👍/👎 sensor + `helpfulness.by_occasion` in `_analytics.mjs`).

---

## Feature: Curated, bucket-keyed craft library injected as few-shot guidance at plan generation
## Goal: Make each plan sharper on the situations people actually bring — by feeding the generator a few vetted, PII-free "phrasings that land" for that kind of moment — without ever pooling a user's story.

---

## The core architecture decision (read first — it's what keeps this safe)

TC-34's non-negotiable guardrail: **raw personal stories are NEVER pooled.** Even a plan's *output* fields carry names/specifics ("Tell Sarah…"), so pooling users' generated plans as a shared cross-user library — even sanitized — risks leaking an identifier. **Rejected.**

Instead: a **curated craft library** — nothing personal is stored or retrieved, only a non-identifying **bucket** label + **curator/AI-authored, synthetic** model phrasings and gesture patterns per bucket. PII-free *by construction*.

**Storage = a version-controlled module, `netlify/functions/_exemplars.mjs`** — NOT Netlify Blobs, NOT Supabase. Rationale (Architect's call; the ticket left it open):
- **PII-free by construction + auditable:** the entire library lives in git, is human-reviewed on every change, and can be grepped to prove no user text ever entered it. This is the strongest possible form of the "no user-authored text in the shared library" guarantee.
- **Zero latency on the hot path:** it's bundled with the function (a plain `import`), so retrieval is an in-memory object lookup — no network read added to the ~30s generation.
- **Zero added cost, zero new dependency** (no Blobs store, no DB table, no RLS surface).
- **Curation = reviewed commits.** Editing exemplars is a git edit, which is exactly the human-in-the-loop review the flywheel wants. (If David later wants edit-without-deploy, Netlify Blobs is the fallback — but do NOT build that now.)

Direction note (from `project_tc_learning_engine_direction`): TC-59 exemplars are **MIX authoring — Claude drafts, David edits tone** — a step toward a self-learning loop, not permanent hand-curation. Build it so the *content* can evolve (and later be assisted/automated) without changing the *plumbing*.

---

## Architecture

### Components
- **`netlify/functions/_exemplars.mjs`** (NEW) — the library data + retrieval + block-builder. The only file that holds exemplar content.
- **`netlify/functions/generate-background.mjs`** (MODIFIED) — classify the intake to its bucket *before* the Claude call (the bucket is already computed today, just after the call — move it up), retrieve exemplars, inject a few-shot block into the `system` prompt.
- **`scripts/exemplar-gaps.mjs`** (NEW) — read-only curation report: ranks which buckets to author next (high volume × low 👍 × no exemplars yet), using the existing `_analytics.mjs` aggregation. Never writes exemplars.

### Data flow
```
intake answers ──> bucketOf(a) = {occasion, valence, relationship, budget_band}   [already exists, _analytics.mjs]
                      │
                      ▼
        getExemplars(bucket)  [_exemplars.mjs]
          → EXEMPLARS[occasion]  (miss → null → today's behavior, no regression)
          → merge in .by_relationship[relationship] if present (prefer relationship-specific)
          → cap to a few snippets per field (token guard)
                      │
                      ▼
        buildExemplarBlock(exemplars)  → "" when null, else a delimited few-shot text
                      │
                      ▼
   system = SYSTEM_PROMPT + buildExemplarBlock(...)   ──> existing tool-forced Claude call (unchanged otherwise)
```

### Retrieval keying (deliberately coarse — matches the sensor, keeps authoring tractable)
- **Primary key = `occasion`.** The full `occasion × valence × relationship × budget` cross-product is ~260 cells — impossible to author well. `occasion` (13 real labels) is the strongest craft signal AND is exactly what TC-58's `helpfulness.by_occasion` measures, so the sensor and the library share a key.
- **Optional refinement = `relationship`.** Within an occasion, some snippets differ by relationship (a bereavement note to a *coworker* vs a *partner*). Support an optional `by_relationship` sub-map per occasion; when the plan's relationship matches, prefer/append those snippets. Never required.
- Ignore `valence`/`budget_band` for keying (occasion already implies valence; budget is handled by the existing prompt).

### The exemplar data shape (`_exemplars.mjs`)
```js
// PII-FREE BY CONSTRUCTION. Curator/AI-authored synthetic craft snippets only.
// NEVER paste user text, names, or generated-plan output here. Generic patterns only.
export const EXEMPLARS = {
  bereavement: {
    what_to_say: [ /* 2-3 strong, specific, non-cliche openers (generic — no names) */ ],
    what_not_to_say: [ /* 2-3 well-meaning traps + a brief why */ ],
    gestures: [ /* 2-3 NON-PURCHASE gesture patterns that land */ ],
    by_relationship: {                       // optional
      coworker: { what_to_say: [ /* … */ ], gestures: [ /* … */ ] },
    },
  },
  new_baby: { what_to_say:[…], what_not_to_say:[…], gestures:[…] },
  new_job_promotion: { … },
  illness_diagnosis: { … },
  // …seed the priority buckets; every other occasion is simply absent → falls back to today.
};
```

### The injected block (`buildExemplarBlock`) — framing is load-bearing
Return `""` when there are no exemplars. Otherwise render a clearly-delimited section appended AFTER the principles in `SYSTEM_PROMPT`, framed so it guides craft/tone only and can never override the meet-the-weight principle or push gifting:

```
---
CRAFT REFERENCES for this kind of moment (for inspiration on tone and craft only):
These are examples of phrasings and non-gift gestures that tend to land for moments like
this one. Adapt them to the specific person and details — do NOT copy them verbatim, do
NOT let them override the principles above (especially "meet the real emotional weight"
and "a gift is only one option among many"), and do NOT let them push spending or gifting.

Phrasings that land:
- …
Well-meaning things to avoid:
- …
Gestures that land (not purchases):
- …
```

### API / DB changes
- **None.** No new endpoints, no schema, no store. One in-memory import. `MAX_OUTPUT_TOKENS` unchanged (exemplars are a small INPUT-token addition, ~200-400 tokens; no latency/cost concern, no effect on the 1800 output cap).

### Prompt discipline
TC has **no `prompts/` directory** — its prompt is the inline `SYSTEM_PROMPT` const in `generate-background.mjs`. Follow that existing convention: the exemplar block is composed onto that inline system string. (Rule 6's `prompts/*.md` requirement applies only to projects that have a `prompts/` dir, e.g. MarketplaceIQ; N/A here.) Keep the injection clearly delimited and commented.

---

## Tasks (in build order)

- [ ] **Task 1 — `_exemplars.mjs`: library + retrieval + block-builder.** Create `netlify/functions/_exemplars.mjs` exporting:
  - `EXEMPLARS` (the keyed data above) with SEED content for the four priority buckets from TC-58's likely low-👍/high-volume set: **`bereavement`, `new_baby`, `new_job_promotion`, `illness_diagnosis`** (add `job_loss` and `encouragement` if quick — they're hard moments too). Content must be generic, brand-voice (warm, specific, non-saccharine, gives better words than "sorry for your loss"), PII-free, and must NOT push gifting. **This copy is MIX-authored: Builder drafts it; flag in the hand-off that David tone-edits before merge** (see UX Phase).
  - `getExemplars(bucket)` → returns a capped, merged exemplar object for the bucket, or `null` if `EXEMPLARS[bucket.occasion]` is absent. Cap each field to ≤3 snippets. Merge `by_relationship[bucket.relationship]` when present (prefer relationship-specific, then fill from base, respecting the cap).
  - `buildExemplarBlock(exemplars)` → `""` when falsy, else the delimited few-shot string with the exact guardrail framing above.
  Files: `netlify/functions/_exemplars.mjs` — Depends on: nothing.

- [ ] **Task 2 — Wire retrieval into generation.** In `generate-background.mjs`: import `getExemplars, buildExemplarBlock` from `./_exemplars.mjs`; import `bucketOf` (already imported). Move the `const bucket = bucketOf(a)` computation to BEFORE the `fetch` to Anthropic (it currently sits at ~line 170, after the call — it must run before so retrieval can use it; keep the same `a`/`answers` source). Compose `const system = SYSTEM_PROMPT + buildExemplarBlock(getExemplars(bucket));` and pass `system` in the request body instead of the bare `SYSTEM_PROMPT`. Add one PII-free field to the existing `plan_generated` analytics event: `exemplars_used: !!getExemplars(bucket)` (or reuse the retrieved value) so coverage is measurable. **No-exemplar path must be byte-identical to today** (empty block → same system string). Files: `netlify/functions/generate-background.mjs` — Depends on: Task 1.

- [ ] **Task 3 — Curation gap report (read-only).** Create `scripts/exemplar-gaps.mjs`: load analytics events (reuse `loadAllEvents` + `computeSummary` from `_analytics.mjs`, or hit `/api/analytics?token=…`), and print a ranked table of occasions by **volume** (`what_people_need.occasion`) and **👍 rate** (`helpfulness.by_occasion`), flagging which occasions currently have NO exemplars in `EXEMPLARS` (import it and diff keys). Output: "author exemplars here next" list = high volume + low/absent 👍 rate + no exemplars yet. It must NEVER write exemplars or read raw stories (only the already-bucketed aggregates). Files: `scripts/exemplar-gaps.mjs` — Depends on: Task 1.

- [ ] **Task 4 — Tests.** `test/tc59-exemplars.test.mjs`: assert `getExemplars` returns merged/capped exemplars for a seeded occasion, applies `by_relationship` refinement, returns `null` for an unseeded occasion, and respects the ≤3 cap; assert `buildExemplarBlock(null)===""` and that a non-empty block contains the guardrail framing ("do NOT copy", "one option among many"/anti-gift-push language) and never contains a name/PII token. Follow the existing `test/*.test.mjs` node-test style. Files: `test/tc59-exemplars.test.mjs` — Depends on: Task 1.

---

## Edge Cases & Risks

- **Exemplars overriding the meet-the-weight principle or pushing gifts** — the single biggest quality risk. Mitigated by: placing the block AFTER the principles, explicit "do not override / do not push gifting" framing, capping snippet counts, and authoring gestures as NON-purchase. **The Validator must spot-check that a `bereavement` (and `illness_diagnosis`) plan with exemplars is at least as good as today and is NOT pushier about gifts.**
- **No-regression for un-authored buckets** — the empty-block path must produce a system string identical to today's. This is a hard acceptance criterion; Task 4 asserts it and the Validator should diff a plan for an unseeded occasion.
- **Verbatim echo** — framing says "adapt, don't copy"; and because exemplars are generic (no names), even a verbatim echo carries no PII. Acceptable.
- **Bucket misclassification** (the keyword classifier is coarse) — worst case: wrong or no exemplars injected; the plan still generates normally. Low severity.
- **Token/latency** — exemplars are a few hundred input tokens; negligible vs the existing call. No change to `MAX_OUTPUT_TOKENS`.
- **"No user text ever enters the library" guarantee** — held by construction: the library is a git file authored by a curator, and the curation script is READ-ONLY (reports gaps, never writes exemplars). State this explicitly in the PR.

## Out of Scope

- **Loop 3 (per-user memory / RLS-locked tailoring)** — separate ticket under TC-34.
- **RAG over users' past plans** — explicitly rejected by the ticket (PII risk).
- **Admin UI for editing exemplars** — curation is file-edit + git + the read-only gap report; no UI.
- **Auto-generating exemplars from user data** — never. (Future self-learning may AI-*draft* candidates for human review, but that's not this ticket.)
- **Re-keying on valence/budget** — occasion (+optional relationship) only.

## UX Phase: RUN (David's call)
No new screen/layout/flow, BUT the seed exemplar **copy is user-facing brand voice** and is MIX-authored, so the review is about **content quality**, not layout. Routing David confirmed:
1. **Builder drafts** the seed exemplars for the priority buckets.
2. **Both the Design Lead AND the UX Reviewer weigh in and edit** the exemplar copy (brand voice + how it lands in a real generated plan) — this is the gate between Builder and Validator.
3. **David** does the final tone pass before merge (MIX authoring — the voice stays his).
4. **Validator** spot-checks plan quality on seeded buckets (esp. that grief/illness plans don't regress or turn pushy about gifts).

---

## ADDENDUM (2026-08-04) — rotation for variety (David's anti-repetition fear)

Concern: injecting the *same* few snippets every time risks a strong line recurring across many users' plans (homogenization). Fix = rotate.

- **Rotation semantics.** When a bucket's field pool exceeds `CAP` (3), `getExemplars` selects a **random** `CAP`-sized subset per generation (`Math.random`, fine in the function runtime) instead of always the first 3. Relationship-specific snippets stay **preferred** (included first, up to CAP), then remaining slots are random-filled from the base pool. Applies to all three fields; a no-op where a pool ≤ 3, so it degrades gracefully.
- **Pool depth policy.** To give rotation real teeth on day one, deepen the **`what_to_say`** pool (the most-seen, most-repetition-sensitive field) to ~5 per bucket now. `what_not_to_say`/`gestures` deepen over time via the librarian (TC-65); rotation kicks in automatically once any pool exceeds 3.
- **No change** to the no-exemplar path (unseeded → `null` → empty block → no regression) or the guardrail framing.
- **Tests** assert membership, cap, and relationship-preference — not fixed order — so randomness is compatible.
- This is the **cross-user** anti-repetition layer. The **same-person** no-repeat layer is per-user memory (TC-66, Loop 3) — out of scope here.
