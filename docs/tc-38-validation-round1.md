# TC-38 — Validation Round 1 → Builder Handback

**From:** The Validator · **To:** The Builder · **Date:** 2026-07-28
**Branch:** `tc-38-pro-import` · **Spec:** `docs/tc-38-spec.md`
**Verdict:** **PASS WITH FIXES — do not merge.** Fix all findings below, then hand back for Round 2.

David's bar for this feature (restated in-session, verbatim intent): *"We are going to read any
upload in any way and convert into useable… if there are certain lines we're not going to reject
everything and upload the rest. Then we're going to gently work with the user… we will do the work
for him and not push it back to them."* Findings #1 and #2 are direct violations of that bar.

---

## What already works (verified live on a preview deploy, real signed-in user, then cleaned up)

Do **not** regress these — they passed Round 1 and are the foundation:

- Unknown/weird column headers resolve via content-sniff + the model call (e.g. "Electronic Mail"→email,
  "Cell Digits"→phone, "When We Closed"→closing date).
- TSV, semicolon-delimited, quoted-commas, duplicate headers, blank lines all parse.
- **Partial-failure tolerance:** rows with a bad phone / partial date / no name still load (bad values
  nulled), nothing rejected. 0 hard-skips.
- **Idempotency:** re-uploading the identical file → 0 added (recognized as already present).
- Fuzzy matches never auto-merge; they route to the one-tap review queue.
- Background path (>200 rows) processes all rows with live progress + pollable result.
- Review resolve: merge (no new person), keep-both (one new person), queue clears, double-resolve → 409.
- RLS: reads scoped to the user; every service-role write pinned to the JWT-verified user_id.
- 28 unit tests in `test/import-core.test.mjs` pass. **Keep them green + add the new ones below.**

---

## Findings to fix

### #1 — [HIGH] The duplicate-check floods the review queue at scale (the "no homework" violation)

**Reproduction (live):** Imported 200 contacts that are unambiguously *different people* — each with a
**distinct email** — who merely share common first names (40 "Jonathan", 40 "Michelle", etc., like a
real book of business). Result: **94 added, 106 dumped into "are these the same person?" review.**

**Root cause:** In `_import.mjs > upsertPerson`, step 3 (`fuzzyMatch`) runs on the person's **name only**
and fires for *any* existing roster contact with trigram similarity ≥ `FUZZY_LOW` (0.4). Because
`tc38_fuzzy_person_match` returns the best match across the **whole** growing roster, a shared first
name alone clears 0.4 often enough that ~half of a realistic import lands in review — even though step 2
already proved the incoming row's email matched **nobody**.

**Why it matters:** A realtor importing 200 contacts and facing ~100 duplicate questions is precisely
"pushing work back to them." This is the make-or-break failure mode.

**Fix direction (identifier-first dedup):**
- If the incoming row carries a strong identifier (email or E.164 phone) and it matched **no** existing
  identifier in step 2, then a **name-only** fuzzy hit against a person who has a **different** known
  identifier must **NOT** create a review candidate — they are different people. Insert as new.
- Only raise a fuzzy review candidate when the incoming row is **identifier-poor** (no email/phone), OR
  the fuzzy-matched existing person is *also* identifier-poor (so we genuinely can't tell them apart).
- Additionally tighten the name signal for the remaining name-only case: raise the threshold and/or
  require a shared *surname/distinguishing* token — short names currently false-positive
  ("Bob Lee" vs "Rob Lee" = 0.455; "David May" vs "David Kay" = 0.538; "Chris P" vs "Chris Q" = 0.600).
  Genuine near-dups must still flag ("Sarah/Sara Johnson" 0.80, "Michael/Mike Brown" 0.47,
  "Jane Doe"/"Jane Ann Doe" 0.69).

**Acceptance (I will re-test):**
- Import 200 distinct-email contacts sharing first names → **~200 added, ~0 review.**
- Import a set of name-only rows containing a true near-dup pair → that pair (and only genuinely
  ambiguous pairs) appears in review.
- The existing "Jane A Doe" vs "Jane Ann Doe" review behavior still holds for identifier-poor rows.

---

### #2 — [HIGH] A file with no header row silently loses the first contact

**Reproduction:** A headerless CSV (`Jane Doe,jane@x.com,213-373-4253\nBob Lee,…`) parsed with the
current `Papa.parse(file, { header:true })` in `public/import.js` turns **row 1 into the column names** —
Jane is consumed as headers (never imported), Bob's fields are labeled with Jane's data.

**Why it matters:** David's words — *"does it even matter if they have titles?"* Today it does; a raw
export with no title row loses a person and mislabels the rest.

**Fix direction:**
- Before committing to `header:true`, sniff row 1: if its cells look like **data** (any cell matches
  email/phone/date, or row 1's content-type profile matches the rows beneath it), treat the file as
  **headerless** — reparse with `header:false`, synthesize placeholder names ("Column A/B/C"), and let
  the existing mapping-preview UI name them (content-sniff will still map email/phone/date columns).
- The first data row must survive and import.

**Acceptance:** A headerless CSV imports **all** rows including the first; the mapping preview shows
sensible column guesses; no contact lost.

---

### #3 — [MEDIUM→ raised] Support real `.xlsx` import alongside CSV (David's call: xlsx AND csv)

`.xlsx`/`.xls` — a very common realtor/CRM export — is currently blocked by the file picker's `accept`
and would parse as binary garbage if drag-dropped. **David's decision (in-session): support both `.xlsx`
and `.csv` for real** — not a "please export as CSV" fallback.

**Fix direction:**
- Add **SheetJS (xlsx)** client-side (CDN/esm import, mirroring the papaparse pattern). On file pick,
  branch on type: CSV/TSV → papaparse; `.xlsx`/`.xls` → SheetJS → read the first sheet to the same
  `{ headers, rows }` shape the rest of the pipeline already consumes. One code path downstream.
- Update the picker `accept` (and drag-drop handling) to include `.xlsx,.xls` +
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- Multi-sheet workbooks: use the first non-empty sheet for v1 (note it in the preview); revisit
  sheet-picker later.
- The **headerless sniff (#2) must apply to xlsx too** — an Excel export with no header row must not lose
  its first data row.
- Keep a graceful message for genuinely unreadable/corrupt spreadsheets (never a dead-end "looked empty").

**Acceptance (I will re-test):**
- A real `.xlsx` with headers imports all rows, columns mapped, same as the CSV path.
- A headerless `.xlsx` loses no rows.
- The existing CSV/TSV paths still work unchanged.
- A corrupt/binary file yields a clear, specific message.

---

### #4 — [LOW] Identifier-match filter is built by string interpolation

`_import.mjs > matchByIdentifier` composes a PostgREST `.or()` filter by interpolating raw email/phone
values: `and(type.eq.${i.type},value.eq.${i.value})`. An email containing `,` `(` `)` (rare but RFC-legal)
would malform the filter → the identifier match silently fails → a **duplicate person** (dedup miss).
Not a security leak (user scoping via `.eq('user_id', …)` still applies), but it undercuts the dedup
promise.

**Fix direction:** query identifiers safely — e.g. batch by `type` with `.in('value', values)`, or use an
RPC, instead of interpolating values into the `.or()` string.

**Acceptance:** A contact whose email contains a comma dedups correctly on re-upload (0 added).

---

### #5 — [LOW] `import-status` poll is unauthenticated

`import-status.mjs` returns a job record for any caller who knows the jobId (a client-generated
capability). The record holds only counts (no contact data), so impact is minimal, but a world-class bar
should namespace the job to the user and/or require the JWT.

**Fix direction:** prefix the blob key with the verified user_id, or require + verify the JWT on the poll.
**Acceptance:** One user cannot read another user's import status even with the jobId.

---

### #6 — [LOW / known limit] Whole import posts in one request body

The background path sends the entire parsed file in one POST (~6MB Netlify limit ≈ 25–30k rows). Fine for
launch, but a genuinely huge book would fail to start with an opaque error.

**Fix direction (later):** chunk the upload, or upload the file to Blobs first and have the background
function stream it. At minimum, catch the oversize case and message it clearly.
**Acceptance:** An oversize file yields a clear message, not a silent failure.

---

## Additional tests the Builder should add (so Round 2 re-validation is airtight)

- **Intra-file duplicates:** the same person listed twice in ONE upload collapses to one (logic looks
  correct via `contact_sources` short-circuit, but it was not explicitly tested in Round 1).
- **Headerless import** (finding #2) end-to-end.
- **Comma-in-email dedup** (finding #4).
- **Encoding:** a Latin-1 / Windows-1252 CSV with accented names ("José Muñoz") — confirm names aren't
  mojibaked (FileReader defaults to UTF-8). Flag if broken; realtor exports are often not UTF-8.

## Cross-kind convergence note (not a blocker — confirm intent)

Step 2 identifier-match is NOT scoped to `contact_kind`. A book-of-business row whose email matches a
person already in the user's **personal** circle will merge into that personal person (stays
`contact_kind='personal'`, so it shows in the personal modal, not the roster). This is arguably the
intended "one person, many doors" behavior, but worth a conscious confirm.
