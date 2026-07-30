# Spec B — Partial Dates: preserve & show without nudging (TC-43)

**Author:** The Architect · **For:** The Builder · **Status:** Ready to build
**Independent of Spec A and Spec C — can be built in parallel with Spec A.**

---

## Goal
An imported partial date like "Client since 2021" or "June 2020" (no day) is **preserved and shown honestly** — "2021", "June 2020", never a fabricated day — and **never drives a nudge** until it has a full day.

---

## Background — the safe floor already shipped
`netlify/functions/_import.mjs → normalizeDate()` currently **refuses** partial dates (returns `null`), so they never become a fabricated-precision `key_date` and never nudge on a guessed anniversary (TC-38 UX finding #2). That removed the trust bug but also **drops** the partial — the user's "2021" is silently lost. This spec keeps the trust guarantee (no fake day, no false nudge) *and* preserves + displays the partial. `key_dates.event_date` is `date NOT NULL`, so we store a real date with a placeholder and mark its precision.

---

## Architecture

### Data model — precision marker
Add `key_dates.date_precision text not null default 'day' check (date_precision in ('day','month','year'))`.
Store partials as a real date with a placeholder, flagged by precision:
- Full date → `event_date = YYYY-MM-DD`, `precision = 'day'` (unchanged from today).
- Month + year ("June 2020") → `event_date = 2020-06-01`, `precision = 'month'`.
- Year only ("2021") → `event_date = 2021-01-01`, `precision = 'year'`.
The placeholder day/month is **never shown and never nudged** — precision governs both.

### Import path — capture instead of drop
`normalizeDate()` stays as-is for callers that want a plain string. Add a new export `normalizeDateParts(raw)` → `{ value: 'YYYY-MM-DD', precision: 'day'|'month'|'year' } | null`:
- Reuses the existing full-date parsing → `{value, precision:'day'}`.
- The four partial patterns currently returning `null` (year, `YYYY-MM`, `MM/YYYY`, "Mon YYYY") now return the placeholder date + `'month'`/`'year'` precision instead of null.
- Truly unparseable → still `null` (row loads without that date; never a hard failure).
`normalizeRow()` uses `normalizeDateParts` for each `key_dates[]` entry, carrying `precision` through. `upsertKeyDates()` writes `date_precision` and includes it in the dedup key (`kind|event_date|precision`) so a partial "2020" and a full "2020-01-01" don't collide.

### Nudge engine — skip anything not day-precise
Every query that selects `key_dates` for reminders must exclude non-day precision. Add `.eq('date_precision', 'day')` (or an equivalent filter) in:
- `netlify/functions/nudges-cron.mjs` (the roster/saved-date nudge — TC ticket names this one).
- `netlify/functions/reminders-cron.mjs` (the original follow-up reminder cron) — **audit it too**; if it reads `key_dates`, apply the same filter. If it only reads plan follow-ups (not `key_dates`), no change — confirm during build.
Legacy rows default to `'day'` (correct — everything imported so far is day-precise because partials were dropped).

### Display — honest rendering
Date rows must render partials with no invented day and sort sensibly:
- `precision='year'` → "2021".
- `precision='month'` → "June 2020" (month name + year).
- `precision='day'` → unchanged (existing formatting).
Apply in **both** surfaces that render key-date rows:
- `public/companion.js` (personal people date rows).
- `public/roster.js` (roster date rows).
Sorting: sort by the stored `event_date` (placeholder gives a sensible chronological position); label rendering keys off `date_precision`. A shared tiny formatter (e.g. `formatKeyDate(event_date, precision)`) used by both files is preferred over duplicating the logic.

### Migration (new file `supabase/migrations/004_date_precision.sql`)
```sql
-- TC-43: preserve imported partial dates honestly. Placeholder day/month is never shown
-- or nudged; date_precision governs display + reminder eligibility. Purely additive.
alter table key_dates add column if not exists date_precision text not null default 'day'
  check (date_precision in ('day','month','year'));
```
Apply via the Supabase Management API (PAT in `.env`).

---

## Tasks (in build order)
- [ ] **B1 — Migration 004: `date_precision` column.** Files: `supabase/migrations/004_date_precision.sql` (new); apply to live DB. Depends on: nothing.
- [ ] **B2 — Import: preserve partials.** Files: `netlify/functions/_import.mjs` (`normalizeDateParts`, `normalizeRow`, `upsertKeyDates`). Depends on: B1. Partials return placeholder + precision; `upsertKeyDates` writes `date_precision` and dedups on `kind|event_date|precision`. **Done when:** importing "2021" / "June 2020" creates a `key_date` with the right placeholder + precision; a full date is unchanged (`'day'`).
- [ ] **B3 — Nudge engine skips non-day.** Files: `netlify/functions/nudges-cron.mjs`, `netlify/functions/reminders-cron.mjs` (audit). Depends on: B1. **Done when:** a `month`/`year` key_date never produces a reminder; day-precise dates nudge exactly as before.
- [ ] **B4 — Honest display + sort.** Files: `public/companion.js`, `public/roster.js` (shared `formatKeyDate`). Depends on: B1. **Done when:** partials render as "2021" / "June 2020" with no fabricated day, in a sensible chronological position; full dates render unchanged.

---

## Acceptance criteria
- A partial date imports, is stored (not dropped), and shows honestly with no invented day.
- A partial date **never** triggers a nudge until/unless it's completed to a full day.
- Full dates: storage, display, and nudging all unchanged.
- One bad/unparseable date still never blocks the row or the batch.

---

## Edge Cases & Risks
- **Placeholder collisions:** a real Jan 1 date vs a year-only "2021" both store `2021-01-01`; the `date_precision` dedup key keeps them distinct. Verify a genuine Jan-1 birthday still nudges (it's `'day'`).
- **Sorting partials among full dates:** placeholder date gives chronological order; acceptable. Don't over-engineer "sort June-2020 relative to 2020-06-15".
- **Manual date entry stays full-precision** — out of scope (TC-43 is about *imported* partials). Don't add partial entry to the companion's manual add-date picker.
- **reminders-cron audit:** confirm whether it reads `key_dates` at all before editing; if it only sends plan follow-ups, leave it untouched and note that in the PR.

---

## Out of Scope
- Letting users *manually enter* partial dates.
- "Complete this date" prompts to upgrade a partial to a full day (nice future follow-up, not now).
- Any dedup/convergence behavior (Spec A).

---

## UX Phase: **RUN**
It changes what's on screen — how a date renders in two surfaces (companion + roster). Small but user-visible, so keep the UX gate on. Reviewer's focus: the exact partial-date wording/format and its chronological placement among full dates.
