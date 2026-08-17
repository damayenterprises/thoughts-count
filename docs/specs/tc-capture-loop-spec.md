# TC — "Tell Della, she remembers": the capture-first companion loop

**Author:** The Architect (Agent 1) · **Status:** Proposed (no code written, no migration applied)
**Deliverable of:** capture-for-later as Della's primary loop, plan-on-demand as the second mode.

---

## 0. The problem in one paragraph

Today Della's conversation engine (`netlify/functions/converse.mjs`) has exactly two moves: `reply` (keep talking) and `ready` (hand the whole conversation to the plan engine). There is **no way to just deposit a fact about a person and ask to be nudged about it later.** A user who says *"Sarah's having a baby in April"* or *"Marcus's next chemo is in 3 weeks"* can only be pushed into a full gift/action plan. We are making **CAPTURE-FOR-LATER the primary loop**: talk or type a note → Della (a) resolves WHICH person, (b) remembers the fact/situation, (c) lets the user set WHEN and HOW MANY TIMES to be nudged — multiple custom-timed reminders per situation — **without generating a plan**, unless the user actually wants help now.

## 1. What already exists that we REUSE (do not rebuild)

Verified against the code (Aug 2026):

| Capability | Where | Reuse as |
| --- | --- | --- |
| Extract structured facts from an utterance | `_capture.mjs → extract()` + `capture-extract.mjs` | The fact reader for the situation's context. Unchanged. |
| Resolve WHICH person (Level A confident / Level B ambiguous-or-new), bias-to-split, never guess | `_capture.mjs → resolve()`, `resolvePerson()`, `resolveNameShaped()` | Person resolution for capture. Unchanged. |
| Write facts + supersession + seed a key_date | `_memory.mjs → insertFact()`, `writeFactsToPerson()`, `maybeSeedKeyDate()` | Extend `maybeSeedKeyDate` to also mint reminders. |
| Pending "hold, confirm before write" capture lifecycle | `captures` table + `capture-extract.mjs` (preview) + `capture-resolve.mjs` | The confirm-before-save spine for the capture flow. Extended, not replaced. |
| Voice conversation with a bounded tool set + `resolve_person` precise-checker | `converse.mjs` | Add ONE new tool (`note_and_remind`). |
| The fact read/add/edit/delete UI (the gold-standard client pattern) | `public/_memory.js → mountNoticed()` (~l.144-259) | The template the reminders editor mirrors exactly. |
| Person card + "Add a date" | `public/companion.js` `personCard()` (~l.796), `openAddDate()` (~l.1401), `addKeyDate()` (~l.674) | Where the situation + reminders render and where the add flow slots in. |
| Daily nudge cron | `nudges-cron.mjs` | Extended to fire N reminders per date (see §5). |
| Della's one voice | `_persona.mjs` (`HER_NAME`, `herIdentity()`, `HER_CHARACTER`) | Source of nudge-copy voice. Never hardcode "Della". |

**Key existing facts confirmed by recon:**
- `key_dates` has ONE `lead_days` per row (client UI offers 0/2/7/14 only). `nudges-cron.mjs` fires exactly one nudge per key_date at its single `lead_days`, deduped by `nudge_log (key_date_id, occurrence)`.
- The browser writes `key_dates` **directly via RLS** (`sb.from("key_dates").insert(...)` in `companion.js`) — there is no key_dates server endpoint today.
- `facts` write path goes through `memory.mjs` ops (`create_fact`/`update_fact`/`delete_fact`/`delete_person`), all server-side with service-role + verified `userId`.
- `reminders-cron.mjs` is a **separate, unrelated** Netlify-Blobs one-off follow-up sender tied to the *plan* flow. We do NOT touch it and we do NOT name our new table after it (naming below is `situation_reminders` to avoid any collision of concept).

---

## 2. Chosen data model (recommendation — validated)

**Decision: extend what works. Do NOT build a parallel "situations" subsystem.**

A "situation" is modeled as a **rich `key_date`** (new `kind = 'situation'`) whose scheduling context lives in the linked memory `fact` (already the `source_fact_id` link), plus a NEW child table `situation_reminders` that holds **many reminders per key_date**, each with its own lead offset and per-occurrence dedup. This is strictly additive and backward-compatible.

Why this over a fresh `situations` + `situation_reminders` pair (the recon's alt sketch):
- **Reuse the whole seeding + cascade chain.** `maybeSeedKeyDate()`, `deleteFact()`'s cascade (`key_dates ON DELETE CASCADE` from `source_fact_id`), and the client's nested `key_dates(...)` select all already exist. A parallel `situations` table would duplicate person-scoping, RLS, delete-cascade, and the "coming up" read, and would need a second seeding path from facts.
- **One schedule layer.** `nudges-cron.mjs` already walks `key_dates`. Making a situation a `key_date` means the cron change is "fire N reminders instead of 1" — not "walk a second entity."
- **The fact already carries the context.** The situation's meaning ("Marcus's next chemo") is a `fact` (`raw_text`, `object`, `fact_class`). Linking the key_date to it (existing `source_fact_id`) means the situation entity is *free* — no new context column to keep in sync.

**The one thing genuinely new is: many reminders per date.** That is exactly one child table.

### 2.1 Migration DDL — PROPOSED, DO NOT APPLY

New file: `supabase/migrations/010_situation_reminders.sql`. Apply pattern is the repo standard (Supabase Management API `POST /v1/projects/ntnlzfezdlbwxbrphknn/database/query`, PAT in `.env` as `SUPABASE_ACCESS_TOKEN`) — **but only after David approves** (Agent Infra Guardrail: propose, never auto-apply).

```sql
-- TC — "Tell Della, she remembers": multiple custom-timed reminders per date/situation.
-- Purely additive. Nothing existing is altered destructively.
--   • Every current key_date keeps working: its single lead_days still fires exactly as today
--     (nudges-cron treats a key_date with NO situation_reminders rows as one implicit reminder
--     at its own lead_days — see spec §5). No backfill required.
--   • A "situation" is just a key_date with kind='situation', linked (via source_fact_id) to the
--     fact that carries its context, with N situation_reminders children.
--
-- Apply via the Supabase Management API (PAT in .env SUPABASE_ACCESS_TOKEN) — AFTER approval.

-- 1) Allow the new kind. key_dates.kind is a plain text column with no CHECK constraint today
--    (schema.sql line 27 is a DEFAULT only), so no constraint change is needed. Documented here:
--    kind ∈ birthday | work_anniversary | moment | custom | situation.

-- 2) The reminders child table: many per key_date, each its own offset + per-occurrence dedup.
create table if not exists situation_reminders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,   -- denormalized for clean RLS (mirrors household_member/identifiers)
  key_date_id  uuid not null references key_dates(id) on delete cascade,     -- the situation/date this fires around
  lead_days    integer not null default 0,        -- days BEFORE the occurrence to nudge (0 = on the day; negatives allowed = after)
  label        text,                              -- optional per-reminder note ("first check-in", "day of"); nudge copy falls back to the key_date label
  active       boolean not null default true,     -- soft on/off without deleting history
  created_at   timestamptz not null default now()
);

create index if not exists idx_situation_reminders_kd
  on situation_reminders(key_date_id) where active;
create index if not exists idx_situation_reminders_user
  on situation_reminders(user_id);

-- 3) Dedup: nudge_log dedups per date+occurrence today (unique (key_date_id, occurrence)). With
--    several reminders on one date we must dedup per (reminder, occurrence). Add a nullable column
--    and widen the unique key so legacy single-reminder rows (reminder_id IS NULL) are untouched.
alter table nudge_log add column if not exists reminder_id uuid references situation_reminders(id) on delete cascade;

-- Replace the (key_date_id, occurrence) unique with one that includes the reminder. A NULL
-- reminder_id represents the legacy "the key_date's own single lead_days" occurrence, so old rows
-- keep deduping exactly as before, and each new reminder dedups independently.
--   Postgres treats NULLs as distinct in a UNIQUE, which is the behavior we want:
--   (kd, occ, NULL) stays a single legacy slot; (kd, occ, r1), (kd, occ, r2) are independent.
alter table nudge_log drop constraint if exists nudge_log_key_date_id_occurrence_key;
create unique index if not exists nudge_log_kd_occ_reminder_uniq
  on nudge_log(key_date_id, occurrence, reminder_id);

-- 4) RLS — owner-only, identical contract to every other table (auth.uid() = user_id).
alter table situation_reminders enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='situation_reminders' and policyname='own_situation_reminders') then
    create policy own_situation_reminders on situation_reminders
      for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
  end if;
end $$;
-- nudge_log has NO policy by design (service-role/server only) — unchanged.
```

**Backward-compat contract (load-bearing, restate in the migration PR):**
- A `key_date` with **zero** `situation_reminders` rows = today's behavior: one implicit reminder at `key_dates.lead_days`, deduped as `nudge_log(kd, occ, NULL)`.
- A `key_date` with **≥1** `situation_reminders` rows = fire each active reminder at its `lead_days`, deduped as `nudge_log(kd, occ, reminder_id)`; the key_date's own `lead_days` is IGNORED (the explicit reminders are authoritative). This rule lives in the cron (§5), not the schema.

---

## 3. Intent routing — capture vs plan (BOTH doors)

Principle anchors: **verify-on-doubt** (ask WHICH person, never guess) and **della-situational-no-formula** (reminder timing is user-set or situationally smart — NEVER a reflexive "in 2 weeks" default cadence). See `feedback_della_situational_no_formula`.

### 3.1 Voice conversation (`converse.mjs`) — add a third tool `note_and_remind`

Della gets a **third** tool alongside `reply` and `ready`. She chooses it when the user's intent is *"remember this / remind me,"* not *"help me do something now."*

```js
// new, added to TOOLS (offered on every turn, anon and signed-in)
{
  name: "note_and_remind",
  description:
    "Call this when the user wants you to REMEMBER something about a person and (optionally) NUDGE " +
    "them about it later — NOT when they want a plan or ideas right now. Examples: \"Sarah's having a " +
    "baby in April,\" \"remind me to check on Marcus around his chemo,\" \"don't let me forget Dad's " +
    "scan is the 20th.\" Capture the fact in the user's own words and, ONLY IF the user asked to be " +
    "reminded, the reminder timing THEY specified. Never invent a reminder cadence they didn't ask for.",
  input_schema: {
    type: "object",
    properties: {
      person_hint: { type: "string", description: "The named person this is about, spelled as the user said it. Empty if a person is already in focus (context.name)." },
      note:        { type: "string", description: "What to remember, in the user's own words (\"having a baby in April\", \"next chemo is in 3 weeks\"). This becomes the memory." },
      event_date:  { type: "string", description: "YYYY-MM-DD ONLY if a full, unambiguous date (incl. year) is stated or clearly derivable. Otherwise omit — never invent a day or year." },
      reminders:   {
        type: "array",
        description:
          "The reminders the user EXPLICITLY asked for, each an offset relative to the event. EMPTY if they " +
          "only asked you to remember (no nudge) OR gave no timing — do NOT default to a cadence.",
        items: {
          type: "object",
          properties: {
            lead_days: { type: "integer", description: "Days BEFORE the event to nudge (0 = on the day; negative = after, e.g. -3 = three days after)." },
            phrase:    { type: "string", description: "How the user phrased this timing (\"a week before\", \"the day of\", \"a few days after\") — for the confirm card only." }
          },
          required: ["lead_days"]
        }
      },
      say: { type: "string", description: "Your warm one-line confirmation to speak back — situational, in your own voice, e.g. \"Got it — I'll remember that about Sarah.\" or, if reminders were set, \"I've got it, and I'll nudge you the week before.\" 1-2 short sentences." }
    },
    required: ["note", "say"]
  }
}
```

**Routing rules in the system prompt (add a section to `systemPrompt()` in `converse.mjs`):**
- If the user is **depositing a fact / asking to be reminded** → `note_and_remind`. If they want **ideas or a plan** → the existing `reply`/`ready` flow. When genuinely mixed ("she's having a baby in April — what should I get her?"), **capture the fact AND continue toward a plan**: call `note_and_remind` to store it, then the next turn proceeds normally (Della may `reply` to gather plan inputs). The capture is never lost.
- **Person resolution reuses the EXISTING machinery.** On a bare first name, Della still must **confirm WHO first** (the roster/`resolve_person` rules already in the prompt, §"Recognizing who they mean"). `note_and_remind` does NOT bypass that: the server runs the captured note through `resolve()` and, on Level B / ambiguity, returns a confirm-WHO the client renders — identical to typed capture. Della never silently attaches a note to a guessed person.
- **Timing is user-set only.** The prompt must say explicitly: *"Never propose a reminder schedule the user didn't ask for. If they say 'remind me' with no timing, ask ONE short question about when, or offer a single situational suggestion tied to the event ('want me to nudge you the week before?') — never a reflexive default."* This is the `della-situational-no-formula` guardrail in prompt form.

**Server handling of `note_and_remind` (in `converse.mjs`'s tool dispatch, both stream and non-stream paths):**
- For a **signed-in** user: POST-equivalent internal call into the capture chain — `extract()` is unnecessary because Della already structured it, so the server builds a `parsed`-shaped object `{ facts: [{ person_hint, subject:"self", relation:"note", object: note, fact_class, event_date }], location_hint:"" }` and runs `resolve()` (reuse). Then:
  - Level A (confident person) → write the fact via `writeFactsToPerson()` and, if there is an `event_date` + reminders, seed a situation key_date + `situation_reminders` (see §4.3). Return `{ action:"noted", say, personName, reminders }` so the client speaks `say` and can show an undoable confirm chip.
  - Level B / ambiguous / new person → **write nothing**; create a **pending capture** (existing `captures` insert, `source:"conversation"`) carrying the facts + proposed reminders in `parsed`, and return `{ action:"confirm_who", ... }` so the client renders the same confirm-WHO card the typed door uses.
- For an **anonymous** user: there is no person store to write to. Della still speaks the warm `say` (the memory feeling), and the client surfaces the standard "sign in to have me remember this" value-first prompt (matches TC's value-first anon pattern). No silent data.

**Bounded latency:** `note_and_remind` is terminal like `ready` — no extra model hop. If it also needs `resolve_person` (tricky name), that reuses the SAME existing one-hop bound already in `converse.mjs`.

### 3.2 Typed door (`capture-extract.mjs` / `capture-resolve.mjs`)

The typed door **already captures facts**. What it lacks is (a) an explicit "and remind me" and (b) multi-reminder timing. Extend it, don't fork it:
- `capture-extract.mjs`: when `extract()` returns a fact with an `event_date` and the raw text carried reminder intent, the extractor schema gains an OPTIONAL per-fact `reminders: [{ lead_days, phrase }]` (mirrors the tool above). No reminder intent → empty → today's behavior exactly.
- The confirm card (preview mode) shows the proposed reminders as editable chips (§6). On confirm, `capture-resolve.mjs` writes the fact AND the situation key_date + reminders (§4.3).
- **Confirm-before-act on ambiguity is unchanged**: Level B still holds a pending capture and forces the user to pick WHO before anything (fact or reminder) is written.

---

## 4. Capture-without-plan flow, end to end

```
utterance (voice or typed)
  │
  ├─ voice → converse.mjs → Della picks note_and_remind {person_hint, note, event_date?, reminders[]}
  │           │
  │           └─ server builds parsed → resolve() ─┐
  │                                                │
  ├─ typed → capture-extract.mjs → extract() ──────┤ (reuse resolve())
  │                                                │
  ▼                                                ▼
                                        Level A (confident person)          Level B (ambiguous / new)
                                                │                                   │
                          writeFactsToPerson() → fact                    insert pending capture
                                                │                          (facts + proposed reminders
                          if event_date + reminders:                       in parsed) → confirm-WHO card
                            seedSituation(fact, reminders)  ◄── §4.3               │
                                                │                          user picks WHO →
                          key_date(kind='situation') +                     capture-resolve.mjs →
                          N situation_reminders                            same seedSituation()
                                                │
                                     nudges-cron fires each reminder (§5)
```

### 4.1 "Set when + how many times" — voice
Della gathers it conversationally, never as form fields:
- User: *"Marcus's next chemo is in 3 weeks — check on me a few days before and again the day after."* → `note_and_remind { note:"next chemo in ~3 weeks", event_date:"2026-09-07", reminders:[{lead_days:3,phrase:"a few days before"},{lead_days:-1,phrase:"the day after"}] }`.
- If timing is vague, ONE short question ("want me to nudge you the week before, or closer in?") — situational, not a default.
- Confirmation is the tool's `say`, spoken back, naming what she'll do so the user hears the contract.

### 4.2 "Set when + how many times" — typed
The confirm card (§6) renders the extracted event + a **reminders editor**: each reminder is a chip (`+7d` = "a week before", `0` = "day of", `-3d` = "3 days after") with add/remove and an "add another" affordance. Default state = whatever the extractor read; **empty if the user gave no timing** (no auto-cadence). The user edits and taps Save.

### 4.3 `seedSituation()` — the one new server helper (in `_memory.mjs`)
Extends `maybeSeedKeyDate()` rather than duplicating it:
```
seedSituation(supa, userId, fact, { reminders, label, recurs }):
  1. kd = maybeSeedKeyDate(...)  // existing: idempotent on source_fact_id; kind='situation' when reminders present
  2. for each reminder r in reminders (deduped by lead_days):
       insert situation_reminders { user_id, key_date_id: kd.id, lead_days: r.lead_days, label: r.label, active:true }
     (idempotent: skip a (key_date_id, lead_days) that already exists so re-confirm never dupes)
  3. return { keyDateId: kd.id, reminderIds: [...] }
```
- A fact with an `event_date` but **no** reminders seeds a normal key_date exactly as today (kind stays `moment`/`custom`), so nothing regresses.
- Undo (existing `capture-resolve` undo path) already deletes the written fact; the `key_dates ON DELETE CASCADE (source_fact_id)` plus `situation_reminders ON DELETE CASCADE (key_date_id)` mean the reminders vanish with it — **no new undo code needed** as long as `deleteFact()` continues to delete the seeded key_date (it does, `_memory.mjs` l.211-220).

---

## 5. Nudge engine v2 (`nudges-cron.mjs`)

Change the per-date loop from "fire one nudge at `lead_days`" to "fire each due reminder." Reuse the existing day-precision occurrence math (`nextOccurrence`, `daysBetween`, `todayInZone`) verbatim — do NOT rewrite the timezone/occurrence logic.

Per key_date `kd` with occurrence `occ = nextOccurrence(...)`:
```
reminders = select from situation_reminders where key_date_id = kd.id and active = true
if reminders is empty:
    // legacy path — unchanged behavior
    if daysBetween(today, occ) == kd.lead_days and not logged(kd.id, occ, NULL):
        send nudge; insert nudge_log(kd.id, occ, NULL)
else:
    for r in reminders:
        if daysBetween(today, occ) == r.lead_days and not logged(kd.id, occ, r.id):
            send nudge (copy keyed to r.label or kd.label); insert nudge_log(kd.id, occ, r.id)
```
- **Dedup per (reminder, occurrence)** via the widened `nudge_log` unique (§2.1). Legacy rows use `reminder_id = NULL`.
- **Della-voiced copy.** The email currently uses a flat subject/body (`peopleNudgeEmailHtml`). v2 composes the nudge line from `_persona.mjs` voice + the fact's `object`/`raw_text` and the reminder's relationship to the event ("a few days before", "the day after"). Keep it a template with situational phrasing (reuse `leadPhrase()`), NOT an LLM call in the cron hot path (cost + latency + flakiness). If richer per-nudge copy is wanted, that's a fast-follow that calls Anthropic with a strict token cap.
- **Negative `lead_days` (after the event).** `daysBetween(today, occ)` is negative once `occ` has passed for a non-recurring one-off; the check `== r.lead_days` with a negative `r.lead_days` handles "3 days after." Guard: a non-recurring `occ` that is already in the past returns `null` from `nextOccurrence` today — **v2 must not skip a past one-off if it still has an unfired "after" reminder within window.** Handle by computing the occurrence even when slightly past (clamp: keep evaluating a one-off for `max(after-offsets)` days beyond `event_date`). Spell this out for the Builder; it is the subtlest correctness point.

**Salience / self-snooze (TC-56):** IN SCOPE as a **fast-follow, not this package.** A `touches` row (already in schema, `kind='reached_out'`) recorded when the user acts on a person should suppress imminent reminders for that person for a short window. Clear line: **ship multi-reminder firing first; wire self-snooze as TC-56 immediately after, reading `touches` in the cron before sending.** Do not block this initiative on it.

---

## 6. UI (signed-in People experience)

Mirror `public/_memory.js → mountNoticed()` (the read/add/inline-edit/two-step-delete gold pattern). All person data already loads with a nested `key_dates(...)` select in `companion.js` (l.626) and `roster.js`; add `situation_reminders(...)` to that nested select so no extra round-trip.

- **Where it renders:** inside `personCard()` (`companion.js` ~l.796) and the roster detail (`roster.js` `toggleDetail`), the existing `tc-dates` block. A key_date with `kind='situation'` renders as a **situation row** with its reminders listed beneath ("Marcus's chemo · Sep 7 — nudges: 3 days before, day after"). Non-situation dates render exactly as today.
- **View + edit reminders:** a new `mountReminders(container, sb, keyDate)` module (sibling of `mountNoticed`), reusing its inline-edit + two-step-confirm-delete affordances:
  - Add a reminder (offset picker: day-of / N-days-before / N-days-after, plus a free integer).
  - Remove a reminder (two-step confirm).
  - Retime a reminder (inline edit of `lead_days`).
  - All writes go **directly to `situation_reminders` via RLS** (matching how `companion.js` already writes `key_dates` client-side, l.674). No new endpoint needed for the editor — RLS is the safety story. (If David prefers server-mediated writes for consistency with the `memory.mjs` fact ops, add a `situation_reminder` op to `memory.mjs`; call it out as an option, default to the lighter RLS write to match the existing `addKeyDate` pattern.)
- **The capture confirm card** (typed door, `_capture.js` `renderImportConfirm`/preview render): add the reminders-editor chips described in §4.2 to the existing confirm card so the user sets timing at confirm time. On confirm it posts through `capture-resolve.mjs` (which calls `seedSituation`).
- **Add-a-situation from scratch:** extend `openAddDate()` (`companion.js` l.1401) so its form, when the user adds reminders, writes the key_date `kind='situation'` + child `situation_reminders`. The existing single `lead_days` select stays for a plain date.

---

## 7. Build decomposition — 3 parallel work-packages

Run each in its own `git worktree` (Shared Working Copy guardrail). Interfaces below are the contract so they don't collide.

### WP-A — Schema + Nudge engine (backend/data)
- Write `supabase/migrations/010_situation_reminders.sql` (§2.1) — **propose only, do not apply.**
- Add `seedSituation()` to `_memory.mjs` and wire it into `writeFactsToPerson()`/`capture-resolve.mjs` seeding (§4.3).
- Rewrite the `nudges-cron.mjs` per-date loop to v2 (§5), including negative-lead handling and the widened `nudge_log` dedup.
- **Owns:** `010_*.sql`, `_memory.mjs` (seed path only), `nudges-cron.mjs`.
- **Exposes to others (contract):** `seedSituation(supa, userId, fact, { reminders:[{lead_days,label?}], label?, recurs? }) → { keyDateId, reminderIds }`; the `situation_reminders` row shape; the `note_and_remind`/extract `reminders` array shape `[{ lead_days:int, phrase?:string, label?:string }]`.

### WP-B — Intent routing (Della's brain)
- Add the `note_and_remind` tool + system-prompt routing section to `converse.mjs` (§3.1), both stream and non-stream dispatch.
- Add the optional per-fact `reminders` to the extractor schema in `_capture.mjs`/`capture-extract.mjs` (§3.2).
- Server handling: build the `parsed` shape and call **WP-A's `seedSituation`** on Level A; create the pending capture on Level B.
- **Owns:** `converse.mjs`, `_capture.mjs` (extract schema + the note→parsed adapter), `capture-extract.mjs`.
- **Depends on:** WP-A's `seedSituation` signature + reminders array shape (agree it first; stub locally until WP-A lands).
- **Does NOT touch** the cron or the migration.

### WP-C — UI (People experience)
- `mountReminders()` module + render situation rows in `personCard()` and roster detail; add `situation_reminders(...)` to the nested people select (§6).
- Reminders editor chips in the typed confirm card (`_capture.js`) and the voice confirm chip.
- Extend `openAddDate()` for add-a-situation.
- **Owns:** `public/_memory.js` (or a new `public/_reminders.js`), `public/companion.js`, `public/roster.js`, `public/_capture.js`.
- **Depends on:** WP-A's `situation_reminders` row shape (read) + `kind='situation'` convention; WP-B's confirm-card response shape (the `reminders` it echoes back).

**Collision avoidance:** A touches `_memory.mjs` seed-path + cron; B touches `converse.mjs` + `_capture.mjs` extract path; C touches `public/*`. The only shared file risk is `_capture.mjs` — WP-A does not touch it (its seed call lives in `_memory.mjs` and `capture-resolve.mjs`); confirm WP-B owns the `_capture.mjs` extract schema and WP-A owns the `capture-resolve.mjs` seeding call, splitting that file's concerns cleanly. Agree the three shared shapes (reminders array, `seedSituation` signature, confirm-card response) in a 10-minute contract note before spawning.

---

## 8. Risks & test plan

| # | Risk | Mitigation / test |
| --- | --- | --- |
| 1 | **Intent misclassification** — Della builds a plan when the user just wanted to deposit a note (or vice-versa). | Prompt clearly separates the three tools with examples. Test a suite of utterances (pure-note, note+plan, pure-plan, "remind me" with/without timing) asserting the right tool fires. Because tools are forced (`tool_choice`), a wrong pick is observable in a unit test with a mocked Anthropic response. |
| 2 | **Reflexive reminder cadence** (violates della-situational-no-formula). | Server NEVER injects a default reminder; `reminders` empty ⇒ no reminders seeded. Test: a note with no timing yields zero `situation_reminders`. |
| 3 | **Wrong-person attach** on ambiguity. | Capture path reuses `resolve()` unchanged; Level B writes nothing and forces confirm-WHO. Test: bare first name with two saved people → pending capture, no fact/reminder written. |
| 4 | **Timezone / occurrence math** for multi + "after" reminders. | Reuse `nextOccurrence`/`daysBetween`/`todayInZone` verbatim. New unit tests: recurring date with reminders at +7/0/-1 fire on the right CT days across a year boundary; a one-off with a -3 "after" reminder still fires 3 days past `event_date`; DST boundary day. **Use the injectable-clock pattern** (pass `today` in) so tests aren't time-of-day flaky — see MOS CI test gate note. `nudges-cron.mjs` already computes `today` internally; refactor to accept an optional injected `today` for tests (keep default = `todayInZone("America/Chicago")`). |
| 5 | **Dedup regression** — widening `nudge_log` unique double-sends or blocks legacy nudges. | Legacy rows use `reminder_id=NULL`; NULLs are distinct in the unique index so a legacy date still logs one slot. Test: legacy key_date (no reminders) fires exactly once; a 2-reminder date logs two independent rows for the same occurrence. |
| 6 | **RLS** — a user seeing/writing another's reminders. | `situation_reminders` policy is the standard `auth.uid()=user_id`; client editor writes are RLS-guarded (denormalized `user_id`). Test: a second user's token cannot read/insert a reminder on another's key_date. `nudge_log` stays server-only (no policy). |
| 7 | **Migration not applied / drift** (Agent Infra Guardrail). | Migration is committed but flagged "proposed, not applied." Validator confirms applied == committed before David tests. Cron/UI must degrade gracefully if `situation_reminders` doesn't exist yet (a missing table ⇒ empty reminders ⇒ legacy behavior), so the branch is safe to preview pre-migration. |
| 8 | **npm test stays green.** | Add tests, don't loosen existing ones. The cron clock injection keeps the suite deterministic. |

---

## 9. Explicit non-goals (this initiative)
- No new "situations" top-level entity or navigation — a situation is a `key_date`.
- No LLM call inside the nudge cron (template copy now; richer copy is a bounded fast-follow).
- Self-snooze / salience (TC-56) is a named fast-follow, not this package.
- `reminders-cron.mjs` (the plan-flow Blobs sender) is untouched.
