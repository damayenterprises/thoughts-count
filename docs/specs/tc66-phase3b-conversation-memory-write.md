# Spec — TC-66 / TC-82 Phase 3b: conversation memory (WRITE-BACK)

**Author:** Architect · 2026-08-05
**Ticket:** TC-66. Follows Phase 3a (READ, deployed).
**Slice:** 3b = WRITE only. When a conversation about a KNOWN saved person wraps up, the durable facts the user shared persist back to that person's memory, so continuity compounds.

## Goal
Today (3a) she opens *knowing* a saved person, but nothing she learns in the conversation is kept. 3b closes the loop: what you tell her about Maya today, she remembers next time. This is what makes memory *compound* instead of being a static profile.

## The key architectural decision: reuse the TC-50 capture pipeline (no new write surface)
The authenticated capture pipeline already does everything 3b needs. Do NOT build a new write path.
- `POST /api/capture/extract { rawText, lockedPersonId, source }` (`capture-extract.mjs`): `requireUser`-authenticated; with `lockedPersonId` identity is certain, so it **verifies the person belongs to the user** (404 if foreign), extracts durable facts, and **auto-saves them (Level A) with a glanceable, undoable confirm**. Writes go through `_memory.mjs insertFact`, which does **deterministic dedup + supersession** for free (re-learning "she's a nurse" won't duplicate; "moved to Denver" retires the old location).
- Client helper already exists: `captureExtract(sb, { rawText, lockedPersonId, source })` in `public/_capture.js`.

So 3b is **mostly client wiring**: after a known-person conversation, route the user's turns into this existing authenticated pipeline. Extraction, the write, dedup, auth (`requireUser` + service role), RLS, and ownership-check are all reused.

## Save behavior (product decision — DECIDED)
**Auto-save (undoable).** Use the default `lockedPersonId` path (Level A auto-save with the existing undoable confirmation). Do NOT use `preview`/confirm-before-save. Rationale: consistent with how typed notes on a person's card already save; lowest friction; the undoable confirm keeps it visible-not-silent.

## Scope — what to build

### 1. Trigger + what to send (client, `public/index.html`)
- In `cvTurn`'s **`ready`** branch (where the conversation distills and hands off to `generate()`), AFTER kicking off the plan: if `flowPerson` is set (a known saved person) AND the user is signed in, fire a memory write. **Non-blocking** — never delay or block the plan on it.
- `rawText` = the user's own turns from `__cv.messages` (role === 'user'), joined into one note. Her replies are guidance, not facts about the person — send the user's words (the source of truth about the person). Extract-and-discard: we don't keep the transcript beyond what the capture pipeline already stores.
- Call via a bridge (below) with `lockedPersonId = flowPerson.id`, `source: 'conversation'`.
- **Fail-open:** wrap in try/catch; an extraction failure must never break the conversation or the plan. Fire-and-forget.
- **Guards:** no `flowPerson` (anonymous/home conversation) → write nothing. Not signed in → write nothing.

### 2. Bridge (client, `public/companion.js`)
- `companion.js` owns the authenticated Supabase client `sb`. Expose a small bridge the conversation code can call, e.g.:
  `window.tcRememberFromConversation = async (personId, rawText) => captureExtract(sb, { rawText, lockedPersonId: personId, source: 'conversation' })`
  Returns the capture result so the conversation can show a confirmation. Guard: if not signed in (`sb`/session missing), no-op.

### 3. The undoable confirmation (client)
- After the auto-save returns, surface a **subtle, undoable** confirmation so it's visible-not-silent (reuse the existing capture confirm / `flashCard` / toast pattern — see `_capture.js` / companion). The user is looking at their plan, so keep it quiet and non-intrusive (e.g. a small "Saved to what you remember about Maya · Undo" toast). Do NOT clutter the plan view.

### 4. Server (small, `netlify/functions/capture-extract.mjs`)
- Add `"conversation"` to the allowed `source` enum (`["voice","scan","email","typed","import"]` → add `"conversation"`) so conversation-sourced captures are tagged distinctly. No other server change.

## Guardrails (independent Validator will hammer these — this slice WRITES data)
- **Auth:** every write goes through `/api/capture/extract` = `requireUser` + service-role + `_memory.mjs insertFact`, scoped to the JWT-verified user. `converse.mjs` stays anonymous and gains NO write path.
- **Ownership:** `lockedPersonId` is ownership-verified server-side (`getPerson(supa, userId, id)` → 404 if foreign). A client cannot write to another user's person. Verify a foreign `personId` is rejected.
- **Isolation:** facts land RLS-locked to the user (`facts` table `own_facts` policy, verified in 3a).
- **No write when it shouldn't:** anonymous conversation, home/hero conversation (no `flowPerson`), or signed-out → zero writes.
- **Non-blocking + fail-open:** the plan renders regardless; a memory-write error is swallowed (logged server-side without PII), never surfaced as a conversation error.
- **Dedup/supersession:** confirmed reused from `insertFact` (no duplicate facts; single-valued relations supersede).
- **Storage note (for Validator awareness):** the capture pipeline stores `raw_text` in its RLS-locked `captures` row, same as a typed note — this is existing TC-50 behavior, consistent, not a new exposure. Stricter transcript-discard would be a separate cross-cutting change, OUT of scope here.

## Explicitly OUT of scope
- Anonymous/unknown-person write, open-ended recall, voice (Phase 2), confirm-before-save (decided against), and any change to the capture pipeline's own storage/retention.

## Files likely touched
- `public/index.html` — `cvTurn` ready branch: fire the non-blocking write when `flowPerson` set; show the undoable confirm.
- `public/companion.js` — expose `window.tcRememberFromConversation` bridge.
- `netlify/functions/capture-extract.mjs` — add `"conversation"` to the `source` enum.
- Tests: server — `source: "conversation"` accepted (extend/`spec-tc50` or `spec-tc82`); assert the guard (no bridge call when no person / signed out) where unit-testable.

## Definition of done
- After a conversation about a saved person, durable facts the user shared appear in that person's "things you've noticed" (memory), saved with an undoable confirmation, no extra taps.
- Re-stating a known fact does not duplicate it; a changed single-valued fact (location/job/health) supersedes the old one.
- Anonymous/home conversation and signed-out conversation write NOTHING.
- Writes go only through the authenticated, ownership-checked capture pipeline; a foreign `personId` is rejected.
- Non-blocking (plan unaffected) and fail-open.
- Passes independent UX (the confirm feels calm, not intrusive; nothing silent) and an INDEPENDENT Validator (write-path auth + ownership + isolation + no-write-when-anonymous), per Mode 1.
