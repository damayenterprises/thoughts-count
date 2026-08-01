# TC-50 Validation Report — Capture lifecycle + To-Review + extract/resolve engine (typed door)

**Spec:** `docs/spec-relationship-memory-intake.md` (§4/§6/§12) + `docs/build-relationship-memory-intake.md` (Phase 2)
**Branch:** `feature/tc-50-capture` → merged to `main` (`61c6680`), deployed live.
**Validated:** 2 rounds. Final verdict **PASS**. Shipped 2026-08-01.

## What shipped
- **DB:** `supabase/migrations/006_captures.sql` — `captures` To-Review inbox (raw_text, source, status pending|confirmed|discarded, proposed_person_id/household_id, match_confidence, match_evidence, parsed jsonb, context_locked, purge_after). Additive, RLS `auth.uid()=user_id`. Applied to live TC Supabase (ref `ntnlzfezdlbwxbrphknn`).
- **Engine:** `netlify/functions/_capture.mjs` — `extract()` (inline Claude structured-output, temp 0, tool-forced, mirrors `import-analyze.mjs`), `resolve()`/`resolvePerson()` (reuses `identifiers` + `tc38_fuzzy_person_match` + `_names.mjs`; no new fuzzy), `writeFactsToPerson()`. Subject-relative facts ("her mom") stay on the named person, never spawn a person.
- **Endpoints:** `capture-extract.mjs`, `capture-resolve.mjs` (both `requireUser`); redirects `/api/capture/extract`, `/api/capture/resolve` in `netlify.toml`. Level A writes now (undoable toast); Level B holds in To-Review; confirm/reassign/discard/undo; re-confirm idempotent.
- **Frontend:** `public/_capture.js` (quick-capture default door, To-Review surface + badge, Level-A undo toast, ambiguous pick-one picker); `public/_memory.js` (person-card add + on-ramp route through the engine context-locked; `displayObject()` labels category facts — "Allergic to peanuts", "Enjoys pottery"). Wired into `companion.js` + `roster.js`.
- **Tests:** `test/spec-tc50-capture.test.mjs` (43 live-DB assertions) + `npm run test:tc50`.

## Findings & fixes (Validator, 2 rounds)

### Round 1 — PASS WITH FIXES (2 HIGH + 1 MEDIUM, all proven live against the DB)
- **[HIGH #1] Facts written into a hard-deleted person → silent data loss.** `tc38_fuzzy_person_match` and `strongKeyMatch` (identifiers outlive a person tombstone) both resolved to a `deleted_at` person at Level A; `capture-extract` wrote regardless. Violated spec §4 + P2.
- **[HIGH #2] "Undo" of a Level-A capture that superseded a single-valued fact destroyed the prior value.** Undo only deleted the new facts; the retired prior value stayed closed → person left with neither. Violated §6 "fully reversible".
- **[MEDIUM] Ambiguous same-name confirm defaulted to a guess.** `resolvePerson` pre-set `proposedPersonId = best` with generic evidence; a one-tap Confirm attached to an unidentified same-named person (P7 risk).

### Round 2 — PASS (all fixed, independently re-verified)
- HIGH #1: fuzzy drops tombstoned matches (`peopleMetaFor.deleted`); strong-key gated by `personIsLive`; Level A re-checks liveness; confirm returns 409 on a since-removed person.
- HIGH #2: `insertFact` returns `supersededIds` → threaded through `writeFactsToPerson` → persisted as `superseded_fact_ids` on the capture → Undo `reopenFact()`s them (`deleted_at`-guarded).
- MEDIUM: `proposedPersonId: null` + `candidates` list → To-Review renders a pick-one picker (name · city), never a defaulted Confirm.

## Verification
- **Tests (all live stack):** TC-50 **43/43** (+11 regressions covering all 3 findings), TC-49 memory **29/29**, TC-49 relationship **26/26**. Green on merged main.
- **Independent Validator re-probes** through the real code paths: deleted-person → resolves to `null` (fuzzy + strong-key); undo-supersede → prior value "Austin" restored. Both confirmed FIXED.
- **Deploy:** merged → main (`61c6680`), pushed, Netlify auto-deploy `ready`. Live checks: `thoughtscount.com` 200; `/api/capture/extract` + `/api/capture/resolve` 401 (auth-gated); `captures` table live (migration 006 applied).

## Deferred (not blockers — carried to a follow-up ticket)
1. **facts→plan allergen safety** — improved (`displayObject`/`noticedList` now sends "Allergic to peanuts", not bare "peanuts", into the plan). Still wants a dedicated test that a peanut-allergy plan never suggests an allergen.
2. **Zero-people empty state** hides quick-capture — the ≥1-person branch is verified; the 0-state needs an empty account eyeball.
3. **Mobile wrap ~375px** — CSS confirms `flex-wrap` on the capture rows; needs an on-device check.
