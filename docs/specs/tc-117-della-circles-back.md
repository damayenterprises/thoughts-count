## Feature: TC-117 — Della circles back "how did that go?" (spec v2)

## Goal: In a later, memory-aware conversation, Della sometimes — at the right moment, never as her opener, and only if the conversation has room — circles back to a past situation she helped with, in a way that reads as CARE (she remembers *the person*, not the gift), closing the follow-up loop and yielding an invisible outcome-learning signal that compounds into the NEXT plan for that person.

> **v2 revision.** This spec folds in David's decisions plus a Council pass and a UX design-stage review. The headline changes from v1: (1) TWO sibling mechanisms with separate roles, not one; (2) an ORDERED current-intent-first rule (blocking UX finding) — the check-back is never the opener and is abandoned, not deferred, when the user brings a live need; (3) a per-SESSION global throttle so she can't quiz down the roster; (4) a care-only grief path that emits ZERO outcome signal; (5) conservative cadence (0.2–0.3, not 0.5); (6) the compounding loop is now IN Phase 1 (an acceptance criterion), not deferred; (7) `saved_plans.valence` promoted to a real proposed migration and used as a safety control; (8) migration numbers corrected to 008/009 (006/007 already exist). A full change log from v1 is at the end.

---

## 0. Grounding — what already exists (verified in code, this session)

- `netlify/functions/converse.mjs` — the advisor mind. `memoryBlock(ctx)` (line 109) injects a person's `facts` + `priorPlans` into the cached system prompt. `rosterBlock(ctx)` (146). `systemPrompt(ctx)` (162) assembles persona + memory + roster + conversing rules. Typed (`anthropicCall`) and voice (`streamTurn`) paths share `buildTurn` → `systemForCache(ctx)`, so any prompt addition fires on BOTH surfaces with no drift (`feedback_tc_one_voice`).
- `public/index.html` — `cvBuildCtx()` (~2498-2506) assembles the ctx sent to `/api/converse`: `{ name, relationship, location, facts, priorPlans }`. `priorPlansDigest(person)` (~1936) builds the digest from the already-loaded `saved_plans[]`. `openConverseForPerson` (~1987) is the launch. `cvOpener()` generates Della's first line.
- `public/companion.js` — the person/plan data layer. `loadPeople()` (484) selects `people` with nested `saved_plans(id,plan_title,occasion,created_at,plan)`. `savePlan(personId, plan, occasion)` (536) is the single plan-save write. `rememberFromConversation(personId, rawText)` (106) runs post-conversation and writes the user's own turns through `/api/capture/extract` locked to the person. **This is our outcome-MEMORY write path — it already exists and already runs.**
- `netlify/functions/_capture.mjs` — `extract()` + `writeFactsToPerson()` durable-memory write (Level-A auto-save, `insertFact` dedup/supersession).
- `netlify/functions/_memory.mjs` — `insertFact()`: bi-temporal, `fact_class`, `source`, `provenance`, `surface_until`.
- `supabase/schema.sql` — `saved_plans(id, user_id, person_id, plan_title, occasion, plan jsonb, created_at)` (line 35). RLS `own_saved_plans` (67). This is our record of WHAT she helped with and WHEN.
- `netlify/functions/feedback.mjs` — TC-58 ingest. Accepts exactly `plan_feedback` and `plan_feedback_reason`; whitelists the bucket via `sanitizeBucket`; logs via `logEvent`. No names, no free text.
- `netlify/functions/_analytics.mjs` — `classifyValence()` (236) → `celebration | hard_time | gratitude | other | unspecified` (knows the grief keyword set `HARD`, line 233). `bucketOf()` (311). `sanitizeBucket()` (333). `computeSummary()` (67) rolls up `plan_feedback`. `VALID_VALENCE` (324), `FEEDBACK_REASONS` (329) are the guard sets we mirror.
- `netlify/functions/generate-background.mjs` — `buildUserMessage(a)` (218) assembles the plan prompt: injects `facts` (line 241) and `priorPlans` (247) into the model message. **This is the compounding-loop insertion point** — an outcome fact here is what makes the next plan smarter.
- Existing migrations: `002`–`007` present. **Next free numbers are 008 and 009** (v1 wrongly said 006).

**Capability limit that raises the stakes (state to Builder + UX):** Della currently receives TRANSCRIBED TEXT only (`transcribe.mjs`), not voice affect. She cannot hear crying, a shaking voice, or inflection — she can miss someone quietly breaking down while the words read neutral. This is precisely why the grief path below must be the lightest possible touch and why the two-layer grief guard is non-negotiable.

**Key architectural consequence (unchanged from v1):** both write paths TC-117 needs — durable memory and the analytics outcome signal — already exist and already fire post-conversation. TC-117 is overwhelmingly a **prompt + trigger-selection + bookkeeping + one-context-injection** feature. The v2 additions (two mechanisms, ordered opener rule, throttles, grief care-only path, compounding feed) are almost entirely *prompt rules and selection logic*, not new plumbing.

---

## 1. The two mechanisms (sibling tools, separate roles)

TC-117 ships TWO distinct check-back mechanisms. They are designed as siblings, selected by one selector, and share ONE combined throttle. Only ONE of them (or neither) may ever fire in a given conversation.

### Mechanism A — situational check-back (PRIMARY)
- **What it asks:** "how did that go for THEM?" — about the *person / the relationship / how it landed for the other person*. E.g. warmly, in her own words, how the birthday turned out, how the friend is doing since the tough stretch.
- **NEVER rates the gesture.** Never "did they like the gift?", never "was the plan good?". Always the person's wellbeing / how it went for them. (This is the whole point of escaping TC-58's rate-the-plan framing.)
- **Cadence:** fires on ~**0.2–0.3** of *eligible* conversations (see §4), with a **~30-day per-person cooldown** and **max once per plan**.
- **Role:** the on-brand relationship-memory moat — care-first, re-centers on the person, yields a soft outcome signal as a pure byproduct.
- **Emits an outcome signal** (§6b) — EXCEPT in the grief case, which emits none (§3).

### Mechanism B — direct impact check (SECONDARY, RARE)
- **What it asks:** a warm, honest, transparent meta-question about Della's *own* help — "has the way I've helped been useful to you?" / "have my ideas actually made a positive impact for you?"
- **Used only OCCASIONALLY**, in caring/human moments. Explicitly **NOT frequent.** Overuse reverts Della to a chatbot begging for a rating — the exact thing TC-117 exists to escape (TC-58). Treat B as a rare, deliberate instrument, not a default.
- **It is the PREFERRED instrument in sensitive / grief cases**, because it centers on the USER's experience of Della's support and never asks the bereaved to rate or relive the loss. In a grief-adjacent conversation, if any impact-type reflection happens at all, it is B ("has any of this helped you carry it?"), never A.
- **Signal:** B does not produce a per-plan `plan_outcome` (it's not about a plan's outcome in the world). If we ever want a B signal it is a separate, coarse `impact_ack` event — **out of scope for Phase 1**; Phase 1 B is prompt-only, emits nothing.

**Shared selector, shared throttle.** A single selection step (§4) decides, for a given conversation, whether to offer A, offer B, or offer nothing. The per-session throttle (§4.3) applies to **A and B combined** — at most one check-back of either kind per session/day.

**Future note (do NOT build):** Mechanism A's *occasion* check-back is deliberately the "training wheels" for a harder future capability — the RELATIONSHIP-SITUATION check-back ("how are things with your daughter since she didn't make the team?"), which is product-3 Relationship-Coaching territory. Architect A cleanly enough that the later work can widen the "what she circles back on" set without re-plumbing.

---

## 2. Architecture

**Phase-1 surface = the IN-conversation callback**, on the natural "Talk it through" path. The proactive post-date email is Phase 2 and does NOT inherit this approval (§9).

**Components**
1. **Trigger selection — `pickCheckback(person, opts)` (client, `public/companion.js`).** Given a person and their loaded `saved_plans[]`, plus the session/cooldown state, returns AT MOST ONE of `{ mechanism:"A", plan_id, occasion, valence, when_phrase }` | `{ mechanism:"B" }` | `null`. Enforces every restraint rule in §4. Lives in companion.js because that's where the plan data and the Supabase reads already are.
2. **ctx wiring (client, `public/index.html`).** `cvBuildCtx()` (~2498) calls `pickCheckback(...)` and, if non-null, sets `ctx.checkback`. Absent → ctx byte-identical to today.
3. **Prompt instruction block — `checkbackBlock(ctx)` (server, `converse.mjs`).** Appended into `systemPrompt` (162), active ONLY when `ctx.checkback` is present. Emits mechanism-A prose or mechanism-B prose, valence-shaped, with the ordered current-intent-first rule and the grief clause. Byte-identical prompt when absent.
4. **"Already asked" bookkeeping — `plan_checkins` table + `/api/plan-checkin`.** Cross-device authoritative record so an outcome is never re-asked and the per-person cooldown survives a device switch.
5. **Outcome signal — `plan_outcome` event (reuse `/api/feedback` + `_analytics.mjs`).** Coarse, bucketed, non-identifying. Mechanism A only; grief-A emits NONE.
6. **Compounding feed — `generate-background.mjs`.** The captured outcome fact/flag flows into the NEXT plan for that person (§7). **Phase-1 acceptance criterion.**

**Data flow (Phase 1) — note the ORDER; the callback is a moment she may find, never the opener**
```
User taps "Talk it through" on a saved person
  → cvBuildCtx() assembles ctx (name/rel/loc/facts/priorPlans)
  → pickCheckback(person, {session, cooldowns}) → {mechanism, ...} | null   (usually null by design)
  → ctx.checkback = that (or omitted)
  → POST /api/converse (typed + voice both send ctx)
      → systemPrompt(ctx): cvOpener + memoryBlock OWN the greeting
      → checkbackBlock(ctx) is present but is explicitly NOT the opener:
          • Della greets normally (memory-aware) FIRST.
          • ORDERED RULE: if the user opens with ANY live need / distress / new topic,
            she addresses THAT fully and ABANDONS the check-back for this conversation.
          • Only if there is room does she make ONE warm check-back attempt, later in the flow.
  → user answers in their own words
  → conversation proceeds normally → plan builds (if one is being built)
  → post-conversation (existing) rememberFromConversation() writes user turns as durable facts
  → IF a Mechanism-A check-back actually fired AND valence != grief-care-only:
        POST /api/feedback   { event:"plan_outcome", outcome, bucket, sid }   ← signal (byproduct)
        POST /api/plan-checkin { saved_plan_id, mechanism, outcome? }         ← bookkeeping
  → IF a Mechanism-B or a grief-care-only-A check-back fired:
        POST /api/plan-checkin { saved_plan_id?, mechanism }                  ← bookkeeping ONLY, no signal
```

**API contracts**
- `POST /api/converse` — unchanged shape; `context` gains an OPTIONAL `checkback`:
  ```
  checkback: {
    mechanism: "A" | "B",
    // A only:
    occasion?: string,       // "his 40th birthday" — from saved_plans.occasion/plan_title
    valence?: "celebration"|"hard_time"|"gratitude"|"other",
    grief_care_only?: boolean,// A + aged hard_time → wellbeing-only, NO outcome probe, NO signal
    when_phrase?: string,    // "a couple weeks ago", "last month" — coarse, human
  }
  ```
  Server treats it as advisory prompt content only; never trusts it for a write.
- `POST /api/feedback` — REUSE. Add ONE accepted event `plan_outcome`:
  ```
  { event:"plan_outcome", outcome:"went_well"|"fell_flat"|"unclear", bucket:{occasion,valence,relationship,budget_band}, sid, test? }
  ```
  Guarded exactly like `plan_feedback`: `outcome` validated against a new `OUTCOME_VALUES` set in `_analytics.mjs`; `bucket` runs through `sanitizeBucket`. No names, no free text. **A grief-care-only check-back NEVER posts this event.**
- `POST /api/plan-checkin` (NEW tiny endpoint) — `{ saved_plan_id?, mechanism, outcome? }`, authenticated (`requireUser` + service client). Inserts one `plan_checkins` row. Idempotent on its unique constraint. `outcome` nullable; for grief-care-only and Mechanism B it is always null.

---

## 3. Grief / death / illness — the care-only path

This is the Council's hard line, softened only to the exact degree David approved.

- **Fresh grief → SILENCE.** A `hard_time` plan within `GRIEF_FRESH_DAYS` (proposed **21 days**) gets NO check-back of any kind. `pickCheckback` refuses to surface it. Not A, not B.
- **AGED hard-time / grief → a gentle, RARE, wellbeing-only ask.** Past the fresh window, an occasional Mechanism-A check-back may surface, but ONLY in `grief_care_only` shape: "how are you both holding up?", "how's your dad doing?" — about the person and the user, never "did it go well?", never "did they like it?". This is CARE-ONLY.
- **Grief-care-only emits ZERO outcome signal.** No `plan_outcome` event, ever. No `went_well` derivation. The `plan_checkin` row is written with `outcome = null` purely so we don't re-ask. There is NO learning signal extracted from grief. (Council G-line satisfied; David's "occasional human touch" allowed.)
- **In grief-adjacent moments, Mechanism B is the preferred instrument over A** (§1) — it centers on the user's own experience of being supported.
- **Two-layer guard.** Layer 1: `pickCheckback` (client) uses the STORED `saved_plans.valence` (§8, the safety control) — not a lossy re-derivation from an occasion string — to decide fresh-silence vs. aged-care-only vs. eligible. Layer 2: `checkbackBlock` (prompt) carries an explicit grief clause that bans "did they like it?" and permits dropping the question entirely. Even if a mislabeled plan slips the client guard, the prompt clause governs tone.
- **Transcription blind spot (§0):** because Della reads text only and can miss a quiet breakdown, the grief clause instructs her, on ANY signal of rawness or if in doubt, to not force the question and let the conversation lead. Lightest possible touch.

---

## 4. Restraint mechanics (the concrete, ordered rules)

Named constants at the top of the `pickCheckback` module in companion.js so David can tune without a code hunt: `MIN_ELAPSED_DAYS`, `MAX_ELAPSED_DAYS`, `GRIEF_FRESH_DAYS`, `PER_PERSON_COOLDOWN_DAYS`, `CHECKBACK_RATE_A`, `MECH_B_RATE`.

### 4.1 Eligibility (Mechanism A)
1. **Minimum elapsed:** plan ≥ `MIN_ELAPSED_DAYS` old (proposed **10**) — an outcome must be able to exist.
2. **Maximum elapsed:** plan ≤ `MAX_ELAPSED_DAYS` old (proposed **120**) — don't resurrect ancient history.
3. **Not already asked:** plan_id absent from this user's `plan_checkins`.
4. **Per-person cooldown:** this person has NOT been checked-back-on within `PER_PERSON_COOLDOWN_DAYS` (proposed **30**), derived from the max `plan_checkins.asked_at` for the person. Cross-device authoritative.
5. **Grief gate (uses stored `valence`):** `hard_time` + within `GRIEF_FRESH_DAYS` → NOT eligible (silence). `hard_time` + aged → eligible only as `grief_care_only`.
6. **Pick ONE:** most-recent eligible plan. One question, one plan, never a stack.

### 4.2 Fire rate (conservative — failure is asymmetric)
- Even with an eligible plan, Mechanism A fires with probability `CHECKBACK_RATE_A` (proposed **0.2–0.3**, START at the low end, NOT 0.5). You can tune UP later from real reactions; you cannot un-creep someone.
- Mechanism B is rarer still: only considered when A did not fire, and then only with a small `MECH_B_RATE`, and only in a spot the prompt judges caring/human. Prefer B in grief-adjacent moments.

### 4.3 Per-SESSION global throttle (UX blocking finding)
- **At most ONE check-back — Mechanism A or B, combined — across a whole session/day**, regardless of how many people the user talks about. This prevents "quizzing down the roster" (open person 1 → "how did X go?", open person 2 → "how did Y go?", …). Enforced by a session/day flag (localStorage, keyed by date) that `pickCheckback` reads and sets; the authoritative per-person cooldown still lives in `plan_checkins`.

### 4.4 One attempt, follow the user (prompt-enforced)
- One warm attempt only. If the user brushes past it or opens a new topic, drop it immediately (see §5 ordered rule). Never re-push. Never a stack.

### 4.5 Signal is a pure byproduct (Council G3 — written rule)
- **Fire-rate and eligibility are NEVER tuned to increase outcome-signal volume.** They are tuned ONLY for how the check-back FEELS to the user. Any future change to `CHECKBACK_RATE_A`/eligibility must be justified by user-experience quality, never by "we need more `plan_outcome` data." State this in a code comment at the constants block and in the analytics doc.

---

## 5. Current-intent-first (UX BLOCKING — ordered rule, not an aside)

This is a hard requirement, elevated from a v1 "edge case" to a first-class ordered rule.

- **The check-back is NEVER Della's opener / first breath.** `cvOpener()` + `memoryBlock` own the greeting. `checkbackBlock` must state this explicitly and defer to them.
- **Ordered rule in the prompt:**
  1. Greet normally (memory-aware).
  2. **Read what the user brings first.** If they open with ANY live need, distress, question, or new topic → address THAT fully. The check-back is **ABANDONED for this conversation** — not deferred to the end, not wedged in later.
  3. Only if the conversation genuinely has room (the user is not carrying something live) → ONE warm check-back attempt, naturally, later in the flow.
- The v1 data-flow and Task 3 language "open by warmly asking how {occasion} went" is REPLACED by "a moment she may find if there's room." The callback is a *possible grace note*, never the entry point.

---

## 6. Capturing the answer (memory + outcome signal)

**(a) Durable MEMORY fact — REUSE, zero new code.** `rememberFromConversation()` (companion.js:106) already writes the user's turns through `/api/capture/extract` locked to the person. The answer to "how did his birthday go?" ("he cried, he loved the letter") becomes durable facts on the person (source `conversation`). No change. Verify in UX/Validator that a check-back answer lands as a fact. **This is the memory half of the compounding loop (§7).**

**(b) OUTCOME signal — small new event (Mechanism A, non-grief only).** After a Mechanism-A check-back conversation, the client emits ONE `plan_outcome` event to `/api/feedback`:
- `outcome ∈ {went_well, fell_flat, unclear}` — **Phase 1: coarse client-side keyword read** (positive words → `went_well`; "didn't"/"never"/"awkward"/"fell through" → `fell_flat`; else `unclear`). Phase 2 may replace with a model-emitted field. Never the words themselves.
- **This coarse read is a SILENT aggregate ONLY.** It MUST NEVER produce a user-visible artifact — no "Looks like that went well!", no toast, no UI echo. It exists solely as an anonymous bucketed signal. State this explicitly to the Builder.
- `bucket` = the plan's stored bucket. Read `saved_plans.valence` (§8) directly; re-derive occasion/relationship/budget from stored fields as `feedback.mjs` already does.
- Server: `feedback.mjs` accepts `plan_outcome` guarded by a new `OUTCOME_VALUES` set; `computeSummary` gains an `outcomes` roll-up (by occasion/valence) — the honest upgrade of TC-58: not "did the user thumbs-up the plan" but "did the gesture actually land in the world."
- **Grief-care-only A and Mechanism B emit NO `plan_outcome`.** (§3)

**Transparency posture (state to Builder + UX):**
- The **existing visible, undoable toast** shown when a memory fact is saved STAYS (trust posture). The user always sees when Della remembers something.
- The outcome signal is coarse, bucketed, non-identifying, in the SAME analytics store as TC-58 — no raw story text, no per-person profiling in the analytics path.
- Durable facts live on the user's OWN person record, visible/editable/deletable in "Things you've noticed" and exportable. Nothing about the hardest moments is silently harvested; it's the user's own memory plus an anonymous aggregate — the TC-34/58 contract, honored (`feedback_della_optin_never_extractive`).

---

## 7. The compounding loop (Phase-1 ACCEPTANCE CRITERION — not deferred)

TC-117 is only worth building if the captured outcome makes the NEXT plan better. If it doesn't, this is "clever once," not compounding. So Phase 1 MUST close the loop:

- **Path (mostly reuse):** the outcome answer is already written as a durable fact on the person by `rememberFromConversation` (§6a). On the next plan generation, `loadPeople()` already carries the person's facts, and `buildUserMessage(a)` (generate-background.mjs:241) already injects `facts` into the plan prompt. So an outcome fact ("the handwritten letter landed better than any gift") ALREADY flows into the next plan via the facts channel.
- **Explicit hook to make it reliable (small NEW):** add a compact "HOW MY LAST GESTURE(S) LANDED" line to `buildUserMessage` when an outcome is known for this person. Source it from either (i) the `plan_checkins.outcome` for that person's prior plan(s), surfaced into ctx alongside `priorPlans`, or (ii) an outcome-tagged fact. Recommended (i): extend `priorPlansDigest(person)` (index.html ~1936) to annotate a prior plan with its known outcome ("suggested a letter for his 40th — landed well") and let the existing `priorPlans` injection (generate-background.mjs:247) carry it. This keeps ONE injection channel and requires no new prompt scaffolding — just richer digest text.
- **Acceptance criterion:** with a seeded prior plan that has a recorded `went_well`/`fell_flat` outcome, the NEXT generated plan for that person demonstrably references/builds on that outcome (Validator asserts the outcome text reaches `buildUserMessage`'s output and UX confirms the plan reads like it remembers what worked).

---

## 8. `saved_plans.valence` — the grief safety control

Deriving valence from an occasion string at check-back time is lossy ("Dad's 60th" reads celebration even if the situation was somber) and, for the GRIEF guard, lossy-is-dangerous. So valence is stored on the plan at save time and used as the safety control that gates §3/§4.

- **Set at save time:** `savePlan(personId, plan, occasion)` (companion.js:536) classifies valence once — call the existing `classifyValence(occasion || plan.plan_title)` (via a tiny client mirror or a server round-trip; recommend a small client mirror of the `HARD`/`CELEBRATION`/`GRATITUDE` keyword sets to avoid a round-trip, kept in sync with `_analytics.mjs` by a shared comment) — and writes `valence` into the insert.
- **Back-fill existing rows:** a one-time back-fill (part of the proposed migration 009, as a commented `UPDATE` the Builder runs only on David's go) sets `valence` from `classifyValence(coalesce(occasion, plan_title))` for existing plans. Ambiguous/empty → `unspecified`; treated conservatively (a `hard_time` re-derivation is honored for the grief guard; anything not clearly celebratory is NOT treated as safe-to-probe if the occasion contains any `HARD` keyword).
- **Consumed by:** `pickCheckback`'s grief gate (§4.1.5) reads the stored column, not a re-derivation. This is the single most important safety input.

---

## 9. Proposed migrations (PROPOSED — write the SQL, do NOT apply)

Per `feedback_agent_infra_guardrail`: write these as files, commit to branch, flag **"proposed, not applied."** Do NOT run any live migration. The Builder wires the endpoints against them only after David's explicit go; the Validator confirms applied == committed (no drift).

### `supabase/migrations/008_plan_checkins.sql`
```sql
-- TC-117 (PROPOSED — NOT APPLIED). One row per (person-plan) Della has circled back on,
-- so an outcome is never re-asked and the per-person cooldown survives a device switch.
-- Purely additive. Apply only on David's explicit go.
create table if not exists plan_checkins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  saved_plan_id uuid references saved_plans(id) on delete cascade, -- nullable: a Mechanism-B check-back may not be tied to one plan
  mechanism     text not null check (mechanism in ('A','B')),
  asked_at      timestamptz not null default now(),
  outcome       text check (outcome in ('went_well','fell_flat','unclear')), -- nullable; ALWAYS null for grief-care-only + Mechanism B
  unique (user_id, saved_plan_id, mechanism)  -- idempotent per plan+mechanism; a reload can't double-ask
);
create index if not exists idx_plan_checkins_user on plan_checkins(user_id);
create index if not exists idx_plan_checkins_person_asked on plan_checkins(user_id, saved_plan_id, asked_at);
alter table plan_checkins enable row level security;
-- Owner-only. The /api/plan-checkin endpoint uses the service client under requireUser,
-- so a service-role write also satisfies RLS; this policy covers any direct user reads.
create policy own_plan_checkins on plan_checkins for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `supabase/migrations/009_saved_plans_valence.sql`
```sql
-- TC-117 (PROPOSED — NOT APPLIED). Store each plan's valence at save time so the grief
-- guard is a stored SAFETY control, not a lossy re-derivation from an occasion string.
-- Apply only on David's explicit go.
alter table saved_plans
  add column if not exists valence text
  check (valence in ('celebration','hard_time','gratitude','other','unspecified'));

-- One-time back-fill for existing rows. Conservative: any HARD keyword => hard_time so the
-- grief guard errs safe. Runs ONLY on David's go (Builder executes after approval, not now).
-- (Illustrative; the Builder may instead back-fill via a script that reuses classifyValence
--  from _analytics.mjs so the keyword set can't drift. Do NOT run automatically.)
-- update saved_plans set valence = '<classifyValence(coalesce(occasion, plan_title))>'
--   where valence is null;
```

---

## 10. Tasks (in build order) — Builder-ready, with file:line targets

- [ ] **Task 1 — Proposed migrations (no apply).** Write `supabase/migrations/008_plan_checkins.sql` and `009_saved_plans_valence.sql` exactly as §9. Commit to branch; PR description states "PROPOSED, NOT APPLIED — apply on David's explicit go." Do NOT run against any DB. — Files: `supabase/migrations/008_plan_checkins.sql`, `supabase/migrations/009_saved_plans_valence.sql` — Depends on: nothing.

- [ ] **Task 2 — Store valence at save + client valence mirror.** In `savePlan` (companion.js:536) classify valence once (client mirror of `_analytics.mjs`'s `HARD`/`CELEBRATION`/`GRATITUDE` sets, kept in sync by a shared comment) and add `valence` to the insert. Add the client `classifyValenceLite(text)` helper near `pickCheckback`. Guard for the not-yet-applied column: writing `valence` before migration 009 is applied will error — the Builder must gate this write (feature-flag or try/catch that tolerates the column's absence) so it is DORMANT until David applies 009. — Files: `public/companion.js` (536; new helper) — Depends on: Task 1 (schema exists as a proposal; write path dormant until applied).

- [ ] **Task 3 — `pickCheckback(person, opts)` selector + constants.** New in `public/companion.js`. Named constants (`MIN_ELAPSED_DAYS=10`, `MAX_ELAPSED_DAYS=120`, `GRIEF_FRESH_DAYS=21`, `PER_PERSON_COOLDOWN_DAYS=30`, `CHECKBACK_RATE_A=0.25`, `MECH_B_RATE` small). Implements ALL of §4 eligibility, §4.2 fire rates, §4.3 per-session throttle (localStorage date-keyed flag), §3 grief gate (reads stored `valence`, falls back to `classifyValenceLite` when the column is absent pre-migration). Reads the user's `plan_checkins` (bulk, one read on home load) for already-asked + per-person cooldown; degrade gracefully (return null) if `plan_checkins` doesn't exist yet (pre-migration). Returns `{mechanism:"A", plan_id, occasion, valence, grief_care_only, when_phrase}` | `{mechanism:"B"}` | `null`. Add the Council G3 comment: "fire rate is tuned for user experience ONLY, never to increase signal volume." — Files: `public/companion.js` — Depends on: Task 1, Task 2.

- [ ] **Task 4 — Wire `ctx.checkback` in `cvBuildCtx()`.** In `public/index.html` (~2498-2506) call `pickCheckback(person, {session, cooldowns})` and set `ctx.checkback` when non-null; omit otherwise (ctx byte-identical to today when null). Also extend `priorPlansDigest(person)` (~1936) to annotate a prior plan with its known outcome for the compounding feed (Task 8). — Files: `public/index.html` — Depends on: Task 3.

- [ ] **Task 5 — `checkbackBlock(ctx)` prompt block.** New function in `netlify/functions/converse.mjs`, appended into `systemPrompt` (162), active only when `ctx.checkback` present; byte-identical prompt when absent. Must encode: the §5 ordered current-intent-first rule (NEVER the opener; abandon on any live need; one attempt only); Mechanism A prose (how it went for THEM, never rate the gesture) vs Mechanism B prose (honest impact check, rare); the §3 grief clause (care-only, ban "did they like it?", permit dropping the question, lightest touch given text-only transcription). Add unit tests asserting: absent when no `ctx.checkback`; A-prose present + no grief clause fired for a `celebration`; grief clause present + no outcome-probe language for a `grief_care_only` A; B-prose for mechanism B; opener-rule sentence always present when block active. — Files: `netlify/functions/converse.mjs`, `netlify/functions/*.test.mjs` (existing systemPrompt test file) — Depends on: nothing (can run parallel to 2–4); integrates via Task 4's ctx.

- [ ] **Task 6 — `plan_outcome` event ingest.** In `netlify/functions/_analytics.mjs` add `export const OUTCOME_VALUES = new Set(["went_well","fell_flat","unclear"]);` and extend `computeSummary` (67) with an `outcomes` roll-up (by occasion/valence), mirroring the `helpfulness` block. In `netlify/functions/feedback.mjs` accept `event === "plan_outcome"`: validate `outcome ∈ OUTCOME_VALUES`, `sanitizeBucket` the bucket, `logEvent("plan_outcome", props)`. No names/free text. — Files: `netlify/functions/_analytics.mjs`, `netlify/functions/feedback.mjs`, tests — Depends on: nothing (parallel).

- [ ] **Task 7 — `/api/plan-checkin` endpoint.** New `netlify/functions/plan-checkin.mjs`: POST `{ saved_plan_id?, mechanism, outcome? }`, `requireUser` + service client, insert one `plan_checkins` row, idempotent via the unique constraint (upsert-on-conflict-do-nothing, or catch the dup). `outcome` accepted only for Mechanism A non-grief; forced null otherwise. Degrade gracefully (200, no-op) if the table doesn't exist yet (pre-migration). — Files: `netlify/functions/plan-checkin.mjs` — Depends on: Task 1 (table proposal). Endpoint is inert until 008 is applied.

- [ ] **Task 8 — Client post-conversation emit + compounding feed.** In `public/companion.js` / index.html, after a check-back conversation: if Mechanism A non-grief, coarse-read the user's answer → `outcome`, POST `plan_outcome` to `/api/feedback` (SILENT — no UI artifact, §6b) AND POST `/api/plan-checkin { saved_plan_id, mechanism:"A", outcome }`. If grief-care-only A or Mechanism B, POST `/api/plan-checkin` with `outcome:null` and NO `plan_outcome`. Compounding half: ensure the recorded outcome reaches the next plan — via the `priorPlansDigest` annotation (Task 4) which rides the existing `priorPlans` injection in `buildUserMessage` (generate-background.mjs:247). — Files: `public/companion.js`, `public/index.html` — Depends on: Tasks 3, 4, 6, 7.

- [ ] **Task 9 — Compounding-loop acceptance wiring (generate-background).** Confirm/lightly extend `buildUserMessage(a)` (generate-background.mjs:218) so a known prior-plan outcome (carried in the enriched `priorPlans` digest, or as an outcome-tagged fact) is present in the plan prompt. No new injection channel — reuse `facts` (241) / `priorPlans` (247). Add a test asserting a seeded outcome string reaches `buildUserMessage`'s output. — Files: `netlify/functions/generate-background.mjs`, tests — Depends on: Task 8.

**Build order / parallelism:** Task 1 first (schema proposals). Tasks 5 and 6 can run in parallel with 2–4 (pure server prompt/analytics). Tasks 3→4→8→9 are the client critical path. Task 7 depends only on Task 1. Everything that touches the two new tables must degrade gracefully so the branch is deployable BEFORE David applies the migrations (feature stays dormant until 008/009 are live).

---

## 11. Edge Cases & Risks

- **Creepiness / timing knife-edge (Council).** 0.2–0.3 + 30-day per-person cooldown + one-per-session is the conservative start; tune UP only on real reactions, never for signal volume (§4.5). Failure is asymmetric. **David tunes from real data.**
- **Grief tone with text-only transcription (§0).** Della can't hear a breaking voice. Mitigated by fresh-silence + aged-care-only + zero-signal + prompt "drop it if in any doubt." The 21-day window and the very existence of an aged grief touch remain a values call. **David/Council own the window.**
- **Valence mislabel.** Stored `valence` (§8) is the safety control; back-fill errs toward `hard_time` on any HARD keyword. Residual risk on a somber occasion phrased cheerfully → the prompt grief clause is the backstop.
- **Coarse client outcome read is crude** ("he loved it but the party fell through" → ?). Acceptable for a Phase-1 aggregate; Phase 2 model-emitted outcome fixes it. Never surfaced to the user (§6b), so a wrong label has no user-facing cost.
- **Opener collision (now the ordered rule §5).** Elevated from risk to hard rule. UX must confirm the callback never reads as the entry point and is abandoned when the user brings a live need.
- **Pre-migration deploy.** Branch must be shippable before 008/009 apply — all new-table paths degrade to no-op. Validator confirms dormancy + no drift.
- **Anonymous users** have no saved plans → `pickCheckback` → null → byte-identical to today. Correct by construction.

## 12. Out of Scope
- The proactive post-date email/notification nudge (Phase 2) — **does NOT inherit this approval; needs its own Council pass** (an unsolicited email has no "standing" to ask the way an in-conversation return does).
- Model-emitted outcome classification (Phase 2).
- A Mechanism-B `impact_ack` signal event (Phase 1 B is prompt-only, emits nothing).
- The future RELATIONSHIP-SITUATION check-back (product-3 coaching) — architected toward, not built.
- Cross-person / multi-plan "how did everything go" digests.
- Applying any migration live.

## 13. UX Phase: RUN
This changes what Della SAYS on the natural "Talk it through" path, and the grief/tone + never-the-opener knife-edges are exactly UX judgment. **UX Reviewer must:** start at People home; seed a prior plan of each valence (celebration, aged hard-time, fresh grief) with the outcome/valence seeded; walk the real signed-in conversation on the natural path (not a diff read) per `feedback_ux_reviewer_real_user_path`; confirm (1) the callback is NEVER the opener and is abandoned when the user opens with a live need; (2) a celebration shapes a warm "how did it land," an aged hard-time shapes care-only, a fresh-grief plan produces NO check-back at all and NO signal; (3) no user-visible outcome artifact ever appears; (4) the memory toast still fires; (5) the per-session throttle prevents a second check-back across two people in one session; (6) the compounding loop — a seeded outcome visibly informs the next plan. **UX runs BEFORE Validator** (`feedback_pipeline_gate_order`); David tests only after BOTH pass.

**Validator re-gate (after Builder, after UX):** assert `checkbackBlock` absent/present + grief-clause behavior by unit test; `plan_outcome` guard + roll-up; `/api/plan-checkin` idempotence + RLS; grief-care-only + Mechanism B emit NO `plan_outcome`; migrations are committed-but-not-applied (no live DB drift, `applied == committed`); the branch is deployable pre-migration (dormant); the compounding acceptance criterion (§7) — a seeded outcome reaches `buildUserMessage`.

---

## Change log — v1 → v2
1. **One mechanism → TWO sibling mechanisms** (A situational "how did it go for them," PRIMARY; B "has my help been useful," SECONDARY/RARE, preferred in grief). One selector, one combined throttle.
2. **Fire rate 0.5 → 0.2–0.3** (start conservative; asymmetric failure).
3. **Added a per-SESSION global throttle** (one check-back total per session across all people) — UX blocking finding.
4. **Added a ~30-day per-person cooldown** (was "never back-to-back"), authoritative via `plan_checkins`.
5. **Current-intent-first promoted from edge case to an ORDERED, blocking rule** (§5): never the opener; abandoned (not deferred) on any live need; one attempt.
6. **Grief reworked into an explicit care-only path** (§3): fresh → silence; aged → rare wellbeing-only ask emitting ZERO outcome signal; B preferred; text-only-transcription constraint stated.
7. **Compounding loop moved INTO Phase 1** as an acceptance criterion (§7), with a concrete reuse path through `buildUserMessage`.
8. **`saved_plans.valence` promoted to a real proposed migration** (009) and made the grief SAFETY control, with a back-fill (was a v1 "flag/maybe").
9. **Migration numbers corrected 006 → 008 (plan_checkins) and new 009 (valence)** — 006/007 already exist. `plan_checkins` gained `mechanism` and a nullable `saved_plan_id`.
10. **Transparency rules made explicit:** the coarse outcome read is a SILENT aggregate (never a user-visible "went well!" artifact); the memory-save toast stays; example phrasings are range-of-register, never verbatim.
11. **Signal-as-byproduct written rule added** (Council G3): eligibility/rate never tuned for signal volume.
12. **Phase-2 proactive email explicitly does NOT inherit approval** — needs its own Council pass. Mechanism A framed as "training wheels" for a future relationship-situation check-back.
13. File:line targets corrected: `pickCheckback` lives in `companion.js` (plan data), wired via `cvBuildCtx` in `index.html`; `savePlan` at companion.js:536; compounding hook at generate-background.mjs:241/247.
