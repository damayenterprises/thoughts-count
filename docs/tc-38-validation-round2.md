# TC-38 — Validation Round 2 → Builder Handback

**From:** The Validator · **Date:** 2026-07-28 · **Branch:** `tc-38-pro-import`
**Verdict:** **PASS WITH FIXES — do not merge.** One new blocker (V7). All six Round-1 findings + encoding are verified fixed.

Re-tested live on a fresh preview deploy with a real signed-in user (throwaway user, cascade-deleted, DB confirmed pristine), plus a real-browser pass for the client-only paths, plus 37 unit tests.

## Round-1 findings — all verified FIXED

| # | What I re-tested | Result |
|---|---|---|
| #1 review flood | 200 distinct-email contacts sharing first names, via inline + background | **200 added, 0 review** (was 94/106). Flood gone. |
| #1 not over-corrected | identifier-poor same-surname near-dup ("Sarah"/"Sara Johnson") | still correctly flagged (1 review) |
| #1 precision | different surname identifier-poor ("David May"/"David Kay"); identical name + different emails | not flagged / 2 people, 0 review ✓ |
| #2 headerless | headerless **CSV** and headerless **xlsx** in a real browser | first contact preserved ("3 contacts", "2 contacts"); synthesized "Column A/B/C" ✓ |
| #3 xlsx | real .xlsx with headers, in-browser; esm.sh XLSX loads (no CSP block) | "2 contacts ready", headers parsed ✓ |
| #4 comma-in-email | import + re-upload an email containing a comma | added once, 0 on re-upload (dedup holds) ✓ |
| #5 status poll auth | unauth poll / authed poll | **401** unauth, 200 authed; blob key namespaced by user_id; client sends JWT ✓ |
| encoding | Windows-1252 CSV "José Muñoz" (raw Latin-1 bytes) in-browser | renders correctly, no mojibake ✓ |
| corrupt file | plain text renamed .xlsx | graceful "couldn't find any contacts", no crash ✓ |
| migration | live DB RPC signature | `tc38_fuzzy_person_match` returns `has_identifier` — applied to prod ✓ |

Also confirmed: unit suite grew 28 → **37, all green**.

## NEW blocker

### V7 — [HIGH] The inline commit path times out on normal-size imports

**Reproduction (live):**

| rows (inline) | result | time |
|---|---|---|
| 50 | 200 OK | **29.5s** (perilously close to the limit) |
| 120 | **504 Inactivity Timeout** | ~31s |
| 200 | **504 Timeout** | ~31s |
| 250 (background) | 250 added, OK | completes fine |

**Root cause:** `public/import.js > commit()` routes `rows.length <= 200` to the **inline** endpoint
(`import-commit.mjs`, `MAX_INLINE = 200`), which runs under the ~26–30s synchronous function limit. But the
dedup core does ~6–7 sequential Supabase round-trips per row (contact_sources lookup → identifier match →
fuzzy RPC → insert → identifiers → source → key dates), so ~50 rows already eats ~30s and anything past
~55 rows returns a **504** with the user's rows partially committed. A realtor importing an 80–200 contact
book — the everyday case — hits this.

**Fix direction (either or both):**
1. **Fast + safe:** drop `MAX_INLINE` to ~25 (client threshold too) so anything larger uses the **background +
   poll** path, which is proven (250 rows completed fine, 15-min budget, client already polls). This alone
   stops the 504s.
2. **World-class:** cut the per-row round-trips — for a batch, prefetch existing natural-keys + identifiers in
   bulk, dedup in memory, and bulk-insert new people/identifiers/sources/key-dates. This makes imports feel
   instant instead of ~0.3–0.6s/row.

Minimum bar to clear V7: an import of 150 contacts completes without a gateway timeout and reports an
accurate summary.

**Note:** V7 is pre-existing (the core's per-row I/O + the 200 threshold), not introduced by Round 2 — my
Round 1 pass missed it because I only exercised 5-row inline + 250 background. Round 2's actual six fixes are
all good.

## Not blocking (note for a follow-up)

- **Residual headerless edge:** `looksLikeDataRow` classifies a file as headerless only if row 1 contains an
  email/phone/date. A headerless file whose first row is *name-only* (no email/phone/date) would still be read
  as a header, losing that first contact. Rare for a contact export, but note it.
- Corrupt-file copy could be more specific ("we couldn't read that spreadsheet" vs "couldn't find any
  contacts") — cosmetic.
