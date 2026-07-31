# TC-45 / Spec C — Import Speed — Validation Report

**Spec:** `docs/spec-C-import-speed.md` · **Branch:** `feature/tc-45-import-speed` (merged ff → main `e6bb5e7`)
**Validator review round:** 1 · **Date:** 2026-07-30 · **Verdict: PASS → deployed & live**

## What was validated
The `runImport()` rewrite in `netlify/functions/_import.mjs`: per-row Supabase round-trips replaced with **prefetch → resolve in memory → bulk write** (`prefetch()` / `resolveBatch()` / `flushBatch()`, shared `pickAmbiguous()`). Single-row path (`upsertPerson` / `insertPerson`) kept intact for review "keep both". Commit endpoints unchanged (both call `runImport`).

## Spec compliance
- C1–C5 all implemented. No schema changes. Progress UI unchanged (3 coarse checkpoints).
- **Approved deviation — verified sound:** the fuzzy step uses an in-memory same-surname index, not the per-row `tc38_fuzzy_person_match` RPC. Decision-equivalent because migration 003's RPC returns `{similarity ≥ 0.4} ∪ {same surname}` and every `pickAmbiguous` branch requires `sameSurname` → the surname index is a superset of the only selectable candidates (trigram-only different-surname matches are inert). Migration 003 confirmed **live in prod** (pulled `pg_get_functiondef` before deploy: returns `contact_kind`, `[[:space:]]+` surname UNION, limit 25).

## Bugs found
- **Fixed (Builder):** extracting `pickAmbiguous()` left a dangling `isPersonal` reference in `upsertPerson`'s crossKind line — the single-row path was silently throwing on fuzzy-review rows. Inlined the `contact_kind` check. Caught by the parity test.

## Security
- All bulk reads/writes user-scoped (`user_id` on every insert, `.eq("user_id", userId)` on every update/delete). No string-interpolated `.or()` SQLi surface; parameterized `.in()`/`.eq()` retained. Keys server-side. RLS-consistent.

## Tests (run live vs the real TC Supabase DB, throwaway users, auto-cleaned)
- `names.test.mjs` — 22/22
- `import-core.test.mjs` — 51/51
- `spec-a-integration.test.mjs` (row-path regression) — 44/44
- `spec-c-bulk.test.mjs` (byte-for-byte row↔bulk DB diff on the full TC-38 + Spec A matrix + idempotent re-upload + speed) — 20/20
- **Total 137/137.** Re-ran spec-c on merged main before push: 20/20.

## Speed
200 distinct contacts: **~1.2–1.4s (~6–7ms/row)** on the bulk path vs **~119–127s** on the row path (measured same session). Acceptance (single-digit seconds) met with headroom.

## Known non-blocking notes (follow-ups)
1. Row path (`upsertPerson` + `fuzzyMatch` + the RPC) now has **no production caller** — bulk path is the sole live path; row path is reached only by the parity test (kept as rollback + parity oracle). The `review_candidates.score` column is vestigial (null from the only live writer; `import.js` selects but never renders it). Optional future cleanup.
2. Prefetch loads all people/identifiers/key_dates/review_candidates for the user into memory — fine for the realtor beachhead (hundreds–low thousands); revisit chunking only at tens of thousands (spec-flagged, deferred).
3. Theoretical non-parity edges (propose-only, zero correctness risk): with 2+ same-surname candidates satisfying the same `pickAmbiguous` branch, or >25 people sharing one surname for one user, the surname-index order/subset could pair a review against a different-but-valid person than the RPC would.

## Deploy
Fast-forward merge `feature/tc-45-import-speed` → main (`e6bb5e7`), pushed, Netlify build succeeded. Prod + thoughtscount.com serving new code (import fn 401 auth-gated; a one-off apex 500 during propagation cleared immediately). TC-45 → **Done** (David approved). Worktree removed, branch deleted.
