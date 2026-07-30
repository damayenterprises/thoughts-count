# Builder Handoff — Spec B: Partial Dates (preserve & show without nudging)

**From:** The Architect · **To:** The Builder · **Date:** 2026-07-29
**Full spec (your primary input, read it in full):** `docs/spec-B-partial-dates.md`
**Ticket:** TC-43
**When done → UX Reviewer (date rendering is user-visible), then the Validator.**

---

## 1. One-paragraph orientation

When a Pro import brings in a partial date — "Client since 2021", "June 2020" (no day) — today's code (`_import.mjs → normalizeDate`) **refuses** it (returns null) so it can't fabricate a fake day and fire a bogus anniversary nudge. That was the right safety floor, but it also **silently drops** the user's info. This build keeps the safety guarantee *and* preserves the partial: store it with a real placeholder date, mark its precision, show it honestly ("2021" / "June 2020" — never an invented day), and make sure the nudge engine skips anything that isn't a full day. **The whole job: preserve and honestly display partial dates; never nudge on one until it has a real day.**

---

## 2. Start state

- Branch off current `main` (it already has TC-38, TC-46 Fix 1, and **Spec A** merged — `4b55a98`). Migrations 002 + 003 are present, so **your migration is 004**.
- Spec B is fully independent of Spec A — different code (dates + display), no overlap with the dedup core. Safe to build now.

```bash
git checkout main && git pull
git checkout -b spec-b-partial-dates
```

---

## 3. Two things already resolved for you (don't re-investigate)

1. **`reminders-cron.mjs` does NOT read `key_dates`** (confirmed: 0 references) — it sends plan follow-ups, not key-date nudges. **Leave it untouched.** The spec's "audit reminders-cron" note is now closed: no change there.
2. **`nudges-cron.mjs` is the only key-date nudge path.** Its query is at **line 44–45**:
   ```js
   .from("key_dates")
   .select("id, user_id, person_id, label, event_date, recurs, lead_days, people(name)");
   ```
   Add `.eq("date_precision", "day")` to that query so month/year-precision dates never nudge. Legacy rows default to `'day'` (correct — every date imported so far is day-precise, because partials were dropped).

---

## 4. Build order (tasks — full detail in the spec)

- [ ] **B1 — Migration 004** (`supabase/migrations/004_date_precision.sql`, new). `alter table key_dates add column if not exists date_precision text not null default 'day' check (date_precision in ('day','month','year'));` Apply to the live DB (ref `ntnlzfezdlbwxbrphknn`) via the Supabase Management API — PAT in `.env`, same POST pattern as 002/003 (documented atop `002_pro_contacts.sql`). Purely additive.
- [ ] **B2 — Import: preserve partials** (`netlify/functions/_import.mjs`). Add `normalizeDateParts(raw)` → `{ value:'YYYY-MM-DD', precision:'day'|'month'|'year' } | null`. The four partial patterns that currently return null now return a placeholder date + precision: year "2021" → `2021-01-01`/`year`; month "June 2020" → `2020-06-01`/`month`; full → `/day` (unchanged). Truly unparseable → still null (row loads without that date, never a hard failure). Wire `normalizeRow` to carry `precision` per key_date; `upsertKeyDates` writes `date_precision` and includes it in the dedup key (`kind|event_date|precision`) so a placeholder "2020" (2020-01-01/year) and a real 2020-01-01/day don't collide. Keep the existing `normalizeDate` (string) for any caller that still wants it.
- [ ] **B3 — Nudge engine skips non-day** (`netlify/functions/nudges-cron.mjs`). Add `.eq("date_precision","day")` per §3.2. **Leave `reminders-cron.mjs` alone.**
- [ ] **B4 — Honest display + sort** (`public/companion.js`, `public/roster.js`). Render `year` → "2021", `month` → "June 2020", `day` → unchanged. Prefer one shared `formatKeyDate(event_date, precision)` used by both files over duplicating logic. Sort by stored `event_date` (the placeholder gives a sensible chronological slot); render the label off `date_precision`.

---

## 5. Verification (must all pass)

- Import "Client since 2021" → a `key_date` stored with `event_date=2021-01-01`, `date_precision='year'`; shows as "2021"; **never** nudges.
- Import "June 2020" → `2020-06-01`/`month`; shows "June 2020"; never nudges.
- A full date (e.g. a real Jan-1 birthday) → `'day'`; stored, displayed, and nudged **exactly as before** (confirm the placeholder-collision guard keeps a genuine Jan-1 date nudging).
- An unparseable date still never blocks the row or the batch.
- Partials sit in a sensible chronological position among full dates in both companion and roster views.
- RLS-scoped to owner; keys server-side; frontend stays vanilla JS.

---

## 6. Guardrails
- Vanilla-JS frontend, no framework. Migration additive only (no destructive alters). Keys server-side; `.env` gitignored.
- **Out of scope:** letting users *manually enter* partial dates; "complete this date" upgrade prompts. TC-43 is only about *imported* partials — don't touch the manual add-date picker.
- Trust: never show a day the user didn't give; never nudge on a guessed day.

---

## 7. If you hit a blocker or something's ambiguous
Hand back to David to route — don't design around it or pull in another role. The spec is your complete input; if it contradicts the code you find, stop and flag it.
