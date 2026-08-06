# Spec — TC-66 / TC-82 Phase 3a: memory-aware conversation (READ)

**Author:** Architect · 2026-08-05
**Ticket:** TC-66 (home for TC-82 Phase 3). Builds on Phase 1 (`/api/converse`, live).
**Slice:** 3a = READ only. Write-back (persisting facts learned in conversation) is 3b, a separate build.

## Goal
When a signed-in user starts a conversation **about a saved person**, she opens already knowing them — their remembered facts and what's been suggested before — so she never re-asks what she already knows, and picks the relationship up where it left off. This is the tangible "she remembers you" moment.

## Why this is low-risk (the key architectural decision)
The codebase pattern: **writes** go through an authenticated server endpoint; **reads are client-side, RLS-scoped anon selects** (`memory.mjs`: "Reads stay client-side… no read endpoint needed"). Everything 3a needs is ALREADY loaded client-side, RLS-locked to the user:
- `companion.js` loads each person with `saved_plans(...,plan)` and `person.noticed` (facts via `loadPersonFacts`).
- The JWT is already available (`authToken()`), but **3a does not need it** — the client already holds the user's own RLS-scoped data and passes it as `context`.
- Phase 1's `converse` already accepts `context: {name, location, facts}`.

So **no new server auth, no service-role reads, no cross-user server path** in 3a. Isolation is enforced by Supabase RLS on the user's own session (the client physically cannot read another user's people/facts/plans). Server-auth threading belongs to 3b (WRITE), where it's genuinely required.

## The gap 3a closes
Today `converse` uses `context` ONLY to backfill the final `ready` answers — it does **not** use it to shape the conversation. So she does not currently "know" the person while talking. 3a makes her conversationally memory-aware.

## Scope — what to build

### 1. Client: launch the conversation about a saved person
- Add an entry from the People home / roster (`companion.js` / `roster.js`) — a **"Talk it through"** action on a person that opens the conversation already scoped to them (mirrors the existing `openFlowForPerson(p)` entry that launches the stepped flow).
- New `openConverseForPerson(person)` (or extend `openConverse` to accept a person): sets `flowPerson = person` and opens the chat. Phase 1's `cvTurn` already sends `context` from `flowPerson` — so wiring `flowPerson` is most of the work.
- **Assemble the context** the client sends to `/api/converse`:
  - `name`, `relationship`, `location` (from the person)
  - `facts`: `person.noticed` (already loaded via `loadPersonFacts` → `noticedList`)
  - `priorPlans`: a compact, token-bounded digest from `person.saved_plans` — for each prior plan, a short line like `"{occasion}: suggested {1-2 gesture/gift gists}"`. Cap to the most recent ~3 plans; keep the whole digest under ~150 words. Build this client-side from the already-loaded `saved_plans[].plan` (reuse the plan shape: `thoughtful_actions[].action`, `gift_ideas[].title`, `what_to_say[0]`).
- Keep the existing home ("Talk it through" from the hero) EXACTLY as-is: anonymous, no context → Phase 1 behavior, zero regression.

### 2. Server: `converse.mjs` uses context to shape the conversation
- Extend the accepted `context` to include optional `relationship` and `priorPlans` (string) alongside the existing `name/location/facts`.
- When context carries real memory (facts and/or priorPlans and/or name), inject a **MEMORY block** into `systemPrompt()`:
  ```
  WHAT YOU ALREADY REMEMBER about {name} ({relationship}):
  - {fact}
  - {fact}
  What you've helped them do for {name} before (do NOT repeat these; build on them, go somewhere new):
  {priorPlans digest}
  Use this naturally: open by showing you remember (do not re-ask what you already know here), and let it make your guidance specific. Never recite the list back like a database; weave it in like a friend who remembers. If something material is missing, still ask.
  ```
- This block is **system context only** — never inject it as a user message, never put words in the user's mouth.
- Keep the existing `ready`-answers backfill from context (Phase 1) unchanged — `facts`, `name`, `location` still flow into the distilled answers, and now `priorPlans` should also reach `generate-background` so the PLAN itself avoids repeats (pass it through the distilled answers as an extra field the plan prompt can read, OR fold into `about`; Builder's call — but the no-repeat signal must reach the plan, not just the chat).
- No context (anonymous/home path) → prompt is byte-identical to Phase 1. This is the critical no-regression guarantee.

### 3. Guardrails (Validator will check these hard)
- **Isolation:** client reads are RLS-scoped to the user's own session — verify a user cannot obtain another user's person/facts/plans (RLS on `people`, `facts`, `saved_plans`). No server-side service-role read is introduced in 3a.
- **No PII in logs/analytics:** the memory block and context must never be logged or sent to analytics. (Phase 1 analytics logs buckets only — keep it that way.)
- **Fail-open to Phase 1:** if context is malformed/empty, converse behaves exactly as anonymous Phase 1. Never error the conversation because memory failed to load.
- **Token bound:** the priorPlans digest and facts must be capped (facts already short; cap plan digest to ~3 plans / ~150 words) so the system prompt stays lean.
- **Her voice:** she must not recite memory like a database ("Your facts: 1, 2, 3"). The prompt instructs weaving it in. UX will judge the feel.

## Explicitly OUT of scope (later slices)
- 3b: persisting facts learned during the conversation back to memory (needs server auth via `requireUser` + service role — the `memory.mjs`/`insertFact` pattern).
- Open-ended recall: starting from the anonymous home and recognizing mid-conversation that the named person is a saved person. (Requires name→person matching; separate slice.)
- Voice (Phase 2 / TC-51).

## Files likely touched
- `netlify/functions/converse.mjs` — MEMORY block in `systemPrompt()`; accept `relationship`/`priorPlans` in context; pass `priorPlans` into the distilled answers.
- `public/companion.js` and/or `public/roster.js` — the "Talk it through" per-person entry + `openConverseForPerson` + context assembly (facts + priorPlans digest).
- `public/index.html` — `openConverse`/`cvTurn` may need a small tweak to accept a person and send the extended context.
- Test: extend `test/spec-tc82-converse.test.mjs` — assert the MEMORY block appears when context is present and is ABSENT (prompt unchanged) when it isn't. (systemPrompt is currently module-private; Builder may export it for testing.)

## Definition of done
- From "Your People," tapping a person → "Talk it through" opens a conversation where she opens acknowledging what she remembers about them and does not re-ask known facts.
- The resulting plan avoids repeating prior suggestions for that person.
- Anonymous home conversation is byte-identical to Phase 1 (no regression).
- RLS isolation verified; no PII logged; digest token-bounded.
- Passes UX (feel: she remembers like a friend, not a database) and an INDEPENDENT Validator (isolation + no-regression), per Mode-1 pipeline.
