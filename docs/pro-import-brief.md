# Thoughts Count — Pro Contact Ingestion: Architect Brief

**Status:** Ready for The Architect. This brief defines the goal, constraints, and a
recommended shape. The Architect owns the final data model and implementation plan —
where this brief recommends, it is a starting point to refine, not a spec to obey.

**Date:** 2026-07-27
**Feeds:** Linear TC-33 (monetization) foundation — this is the *first* pro-tier capability.

---

## 1. Goal & scope

Give any professional with a roster two ways to get their people into Thoughts Count,
both landing in **one shared, deduplicated set of people**, so the existing engine
(moments → thoughtful plan; key-date nudges) can run across a whole book of business
instead of a handful of personal contacts.

**The two paths are deliberately different in reach — build them that way:**
- **CSV / manual import = the UNIVERSAL on-ramp to the entire market, day one.** Every
  profession and every system exports a CSV — HR platforms, advisor/insurance CRMs, a
  spreadsheet, Google Contacts. The moment the smart importer works, *anyone with a roster*
  (HR managers, financial advisors, insurance agents, small-business owners, sales reps —
  not just realtors) can get in with zero vertical-specific work from us. **This path is
  segment-agnostic and must never be gated to realtors.** It is how we keep the whole
  market's door open while we focus acquisition.
- **Follow Up Boss = the first DEEP vertical integration** — the connect-once-and-forget
  magic for the one vertical we're pointing marketing at first.

Real estate agents are the **go-to-market focus** (who we market to first), **not the
product ceiling.** The smart-mapping mandate (§5.0) is exactly what makes the universal CSV
path viable for *any* industry's export, so it earns its "reaches everyone" billing.

**In scope (this build):**
1. **CSV / manual import** that is **radically forgiving and zero-config** — no required
   template, auto-detected columns (any header text, any order), format-tolerant parsing,
   and **never a hard failure** (§5.0 is the make-or-break mandate) — backed by a
   **robust, idempotent dedup engine** so a user can re-upload their list weekly and it
   *updates in place, never duplicates* (clean re-upload of unchanged data = 0 rows, 0 clicks).
2. **Follow Up Boss (FUB) native integration** — connect once, sync contacts + their key
   dates, keep them fresh, and (later) write back that an outreach happened.
3. **A shared canonical person + identifiers model** that both paths converge into, so a
   person who exists in FUB *and* in a CSV becomes one record, not two.

**Explicitly OUT of scope here (later tickets):**
- Billing / paywall / the pro-tier upgrade flow itself (TC-33 proper). Assume a
  boolean "is pro" gate exists or is stubbed; do **not** build Stripe here.
- Other CRMs / the unified-API middleware (Merge/Finch) for HR & advisors — that is the
  deliberate phase-two expansion. Design the model so it *could* accept more sources, but
  build only FUB + CSV now.
- FUB write-back automation (logging outreach, creating tasks) can be a fast-follow;
  design for it, ship read/sync first.

---

## 2. What exists today (ground truth — build on this, don't reinvent)

**Stack:** static `public/index.html` + `public/companion.js` (vanilla JS ES module,
no framework, no build step) → Netlify v2 functions → Supabase (Postgres) with RLS →
SendGrid for email. Supabase = the free "Thoughts Count" org, ref `ntnlzfezdlbwxbrphknn`.

**Auth:** passwordless magic-link via Supabase Auth. Client uses the **anon key** (public;
`GET /api/public-config`) and every table is guarded by **RLS scoped to `auth.uid()`**.
Server-side functions that must bypass RLS use `SUPABASE_SERVICE_ROLE_KEY` (server-only).

**Existing schema (`supabase/schema.sql`) — all RLS-scoped to `auth.uid() = user_id`:**
- `people` — `id`, `user_id`, `name`, `relationship`, `notes`, `location`, timestamps.
  **No email, no phone, no external id today.** Nothing to dedup on yet.
- `key_dates` — `id`, `user_id`, `person_id`, `label`, `kind`
  (`birthday|work_anniversary|moment|custom`), `event_date` (date), `recurs` (bool),
  `created_at`.
- `saved_plans` — `id`, `user_id`, `person_id` (nullable), `plan_title`, `occasion`,
  `plan` (jsonb), `created_at`.
- `nudge_log` — `key_date_id`, `occurrence` (date), `sent_at`; `UNIQUE(key_date_id,
  occurrence)`; **no RLS** (service-role/cron only). This is the proven "fire at most once"
  pattern — mirror it for import idempotency.

**Relevant code:**
- `public/companion.js` — all sign-in + add-person + add-date UI. Adds are **single-record
  only** (`sb.from("people").insert(...)`, `sb.from("key_dates").insert(...)`). No bulk path.
- `netlify/functions/public-config.mjs` — serves Supabase URL + anon key to the browser.
- `netlify/functions/nudges-cron.mjs` — daily; reads key dates due in 7 days, emails,
  writes `nudge_log`. This is where a bigger roster increases load — keep it in mind.

**Hard constraints the new feature MUST respect:**
- **RLS:** every inserted row carries `user_id = auth.uid()`. A bulk import may run through
  an authenticated Netlify function, but it must scope every write to the calling user —
  either by using the user's JWT with the anon client, or service-role with explicit
  `user_id` on every row. Never let one user's import touch another's rows.
- **Vanilla JS, no build step** on the frontend. Import UI = plain JS in the
  `companion.js` style (file input + preview + summary), using the Supabase JS client.
- **Free Supabase tier** — batch large inserts; an async function is likely needed so a
  1,000-row CSV doesn't hit a request timeout.
- **Passwordless accounts** — no new auth model; the importer is the signed-in user.

---

## 3. Core design principle — the convergence point

Both ingestion paths must write into **one canonical person keyed by our internal id**,
with a **separate identifiers table** that is the dedup + convergence backbone:

> `identifiers(user_id, person_id, type, value)` with `UNIQUE(user_id, type, value)`
> where `type ∈ {email, phone, fub_id, csv_natural_key}` and `value` is normalized.

This one table does three jobs:
1. **Dedup within CSV** — match an incoming row to an existing person by any known
   identifier (email OR phone), even if their other details changed.
2. **Convergence across paths** — a person in FUB (`fub_id`) and in a CSV (email/phone)
   collapses to one person once any identifier overlaps.
3. **Survives edits** — store *every* identifier ever seen for a person (old phone +
   new phone), so next week's re-upload re-matches instead of duplicating.

**Anti-graveyard reminder (the strategic "why"):** the category is littered with dead
relationship tools (Contactually, LionDesk) that died because they became stale contact
*databases* users had to maintain. We win by being the **thinking layer on top of a source
they already keep** (FUB) plus a **frictionless re-sync** (CSV). The identifiers table is
what makes "re-import safely, forever" possible — protect that property above all.

---

## 4. Proposed data-model delta (Architect to finalize)

Additive to the existing schema; nothing above is removed. All new user-data tables get
RLS scoped to `auth.uid() = user_id`.

- **`people` (extend):** consider adding `primary_email`, `primary_phone` (denormalized
  convenience), and a lightweight `contact_kind` to distinguish a *personal* person from a
  *book-of-business* contact if the Architect judges the two shouldn't share a list in the
  UI. (Open decision — see §8.)
- **`identifiers` (new):** as above. The dedup/convergence spine.
- **`contact_sources` (new or folded in):** `person_id`, `source`
  (`csv|fub|manual`), `external_id` (e.g. FUB person id), `natural_key`
  (sha256 of best identifier for CSV), `last_seen_at`. Provenance + idempotency.
- **`import_batches` (new):** one row per CSV upload — counts of added/updated/needs-review,
  filename, timestamp. Drives the "X updated, Y added, Z to review" summary.
- **`review_candidates` (new):** incoming-vs-existing pairs in the ambiguous confidence
  band, for the merge/keep-both review queue. Cleared as the user resolves them.
- **`fub_connections` (new):** `user_id`, OAuth tokens (encrypted / server-only),
  FUB account + owner info, the per-account **custom-field mapping** (which FUB custom
  date field = birthday vs anniversary vs closing date), webhook registration state,
  sync cursor.

Enable Postgres extensions **`pg_trgm`** (trigram similarity + GIN index) and
**`fuzzystrmatch`** (levenshtein/metaphone) on Supabase for fuzzy candidate generation.

---

## 5. Path A — CSV / manual import: the smart, zero-config experience (adoption make-or-break)

### 5.0 The experience mandate — import is where adoption lives or dies

Founder directive: *the smartest, easiest, most intuitive import there is.* The single
biggest killer of tools like this is a cumbersome import — rigid required column titles,
required ordering, fragile format parsing, and hard upload failures. Those don't just
annoy; they cause abandonment before the user ever sees the product's value. **Treat the
import experience as the primary product surface of the pro tier, not a utility.** The
dedup engine (§5.1 below) sits *behind* this experience and must never leak its complexity
into it. Design mandates:

1. **Zero-template, any-file.** Never require our column names, our order, or a downloaded
   template. Accept whatever the user exports from FUB, kvCORE, a spreadsheet, Google
   Contacts, or a hand-built list — as-is.

2. **Intelligent column mapping (the "smart" core).** Auto-detect what each column *is*,
   regardless of header text or position, via layered signals:
   - **Header semantics:** "Email" / "E-mail" / "Primary Email" / "Client Email" → email.
   - **Content sniffing:** a column whose *values* look like emails / phones / dates IS
     that field, even if the header is blank or nonsense.
   - **LLM-assisted mapping** (we already have Claude in the stack): for genuinely ambiguous
     columns, send *only the header row + a few sample values per column* to the model and
     get back a proposed header→canonical-field mapping. This lets us ingest any CRM's export
     with **zero pre-built templates** — a real differentiator. *Privacy:* resolve obvious
     fields with heuristic sniffing; only send minimal samples, server-side, for the
     ambiguous remainder; never send the whole file. Same trust posture as plan generation.
   - **Canonical target fields are profession-agnostic** (this path serves everyone): name,
     emails, phones, role/relationship, notes, location, and *any number of key-date columns*
     mapped to `key_dates` with an inferred kind. Detect dates generically across industries —
     birthday, work anniversary / start date (HR), closing anniversary / "client since"
     (realtor/advisor), renewal date (insurance), or a one-off moment — never a realtor-only set.

3. **Format-tolerant parsing — coerce, don't reject.** Dates in any format (MM/DD/YYYY,
   "March 3", ISO, Excel serial) → normalized; phones in any format → E.164; names as
   "First Last", "Last, First", or split first/last columns → normalized. A messy value is
   best-guessed and flagged, **never a fatal error**.

4. **Never hard-fail.** No "upload failed, fix your file, retry" wall. The good 980 of
   1,000 rows import; the 20 problem rows are surfaced with a plain-language reason and can
   be fixed inline or skipped. **Partial success is always success.**

5. **A preview that's a glance, not a config screen.** Show "we detected these columns →
   mapped like this; here's how your first rows will import." One-click confirm; each
   mapping overridable by a simple dropdown. The user *corrects at most a thing or two* —
   they never *build* the mapping from scratch.

6. **Remember the layout.** Persist the confirmed mapping per source signature (header
   fingerprint) so a weekly re-upload of the same-shaped file needs zero reconfiguration.
   This compounds with idempotent dedup (§5.1) so re-import is truly one drag-and-drop.

7. **Forgiving of real-world files:** unknown/extra columns ignored, blank rows skipped,
   whitespace trimmed, common encodings handled; ideally accept `.xlsx` as well as `.csv`.

8. **We always load what's good — never reject the whole batch.** A single malformed row,
   an unparseable date, one duplicate — *none* of these ever block the import. Everything
   valid loads immediately and the user sees value right away; only the true exceptions are
   set aside. There is no all-or-nothing upload.

9. **When we can't resolve something, WE carry it — the user never gets homework.** Errors,
   ambiguous matches, and unparseable values are *our* problem to tee up, not theirs to go
   fix. The order of operations is: (a) import everything good and show it; (b) **auto-resolve
   everything we can confidently resolve** — silently, no notification; (c) for the genuine
   remainder, ask **one plain-language question with a one-tap answer** ("Looks like the same
   person — merge them?" → *Merge* / *Keep both*), batched on a single quiet screen. We never
   say "go fix your file and re-upload." The measure: **resolving an issue costs a tap, not a
   task.** If the review queue ever feels like data-entry, we've broken the mandate.

**The bar:** a non-technical realtor drags in whatever file they already have and it *just
works, first try, no cleanup.* If they have to rename a column, reformat a date, or fix their
file to get a successful import, we have failed the mandate.

### 5.1 Dedup mechanics (behind the experience)

**Where the work runs:** dedup logic belongs **server-side** (a Netlify function) so it
can do normalization, `ON CONFLICT` upserts, and SQL-side fuzzy matching — not in the
browser. The frontend handles file selection, a column-mapping preview, and the summary.

**Match keys (deterministic-first, ranked):**
1. Tier 1 (auto-merge): normalized **email** (lowercase/trim); **phone → E.164**.
2. Tier 2 (propose only): **name + partial phone / name + zip** fuzzy (`pg_trgm`).
3. First deterministic hit wins. Fuzzy never auto-merges above threshold — it *proposes*.

**Idempotent re-import:**
- Compute a **natural key** per row = `sha256(normalized_email || e164_phone ||
  normalized_name+zip)`. Store on `contact_sources` with a UNIQUE constraint.
- Upsert via Postgres **`INSERT ... ON CONFLICT (<unique target>) DO UPDATE`**. Get the
  conflict target right (must reference the real unique index) or it silently degrades to
  plain insert and duplicates — call this out in tests.
- Per-row routing: deterministic identifier match → **update (field-level merge)**;
  no identifier match → **insert new**; fuzzy-only match in the middle band →
  **review_candidates** (never silent-write).

**Merge/conflict rules:** fill empty fields always; prefer non-empty incoming over empty
existing; for two non-empty conflicting values, last-write-wins **but keep the old value
as an alternate identifier**. **Never** let a CSV overwrite app-native / user-curated data
(their notes, a date they confirmed in-app) — CSV writes to CSV-sourced fields or routes
to review.

**Review queue UX (must stay dead-simple for a non-technical realtor):** one "Possible
duplicates (N)" screen, one card per pair, two buttons — "Same person – merge" /
"Different – keep both." No fields to fill. Keep the ambiguous band narrow so N stays tiny.

**End-to-end target flow:** drop CSV → parse → normalize each row → compute natural key →
match by natural key then by each identifier → route (update / insert / review) → **one
summary: "X updated, Y added, Z need review."** Unchanged weekly re-upload ⇒ 0 rows, 0 clicks.

**Libraries (all Node / Netlify-function friendly):** `papaparse` (CSV, streams large
files), `libphonenumber-js` (E.164), `pg_trgm` + `fuzzystrmatch` for SQL-side fuzzy;
`fastest-levenshtein` / `string-similarity` if any app-side scoring is needed.

---

## 6. Path B — Follow Up Boss integration

**Auth:** OAuth 2.0 Authorization Code (not raw API keys). First **register a "System"**
with FUB (yields `X-System` + `X-System-Key`, and a higher rate limit — 250 vs 125 req /
10s window), then create an OAuth client app via `/v1/oauthApps` (client secret shown
once). Redirect URIs must be public. Store tokens encrypted, server-side, in
`fub_connections`.

**The key-dates catch (load-bearing):** FUB has **no standard birthday/anniversary
fields**. Key dates live as **date-type custom fields** with an `isRecurring` flag
(`true` = birthday/anniversary; `false` = one-time like a closing date). So onboarding must,
per connected account: (a) `GET /v1/customFields` to enumerate, (b) let the user map (or
auto-detect) which custom fields are birthday / work-anniversary / closing-anniversary,
(c) offer to create them if absent (verify programmatic field *creation* during the spike —
docs confirm read/write of existing fields; creation needs a live check). Persist that
mapping in `fub_connections`. On `GET /v1/people` you must pass `fields=allFields` or
custom values are omitted.

**Freshness:** **webhooks + a scheduled reconciliation poll.** Register webhooks
(`POST /v1/webhooks`) for `peopleCreated`, `peopleUpdated`, `peopleStageUpdated`,
`notesCreated`. Payloads are thin — on an event, re-`GET /people/{id}?fields=allFields`.
**Webhooks are owner-only** and capped at 2 per event per system, so for full-book coverage
the **broker/owner installs** (an agent-only token sees only that agent's contacts —
surface this in onboarding). Back webhooks with a periodic cursor-paginated poll
(`_metadata.nextLink`; deep offset paging is blocked — follow the cursor) to catch missed
events and do the initial backfill.

**Convergence:** every FUB person maps to a canonical person via `identifiers`
(`type=fub_id`) — and if their email/phone also arrived via CSV, they collapse to one.

**Write-back (design now, ship as fast-follow):** `POST /v1/notes` ("sent birthday
outreach"), `POST /v1/tasks` (remind the agent), `POST /v1/events`. Rate limit: ~250 req /
10s with a System key; watch the headers.

---

## 7. Automation & cadence

- **CSV:** on-demand (user-initiated), plus keep the door open to a "same file, weekly"
  habit — the whole point of idempotency. No cron needed for v1.
- **FUB:** webhooks (real-time) + a reconciliation poll cron (e.g. daily) per connection.
- **Nudges:** the existing `nudges-cron.mjs` already fires 7-day-out reminders off
  `key_dates`. Once a roster is hundreds of people, validate this cron scales (batching,
  query cost) — flag for the Architect, likely fine but worth a look.

---

## 8. Open decisions for the Architect (with my leanings)

1. **One list or two?** Do book-of-business contacts share the `people` table with a
   user's *personal* people, or live in a separate list/kind? *Lean:* same table + a
   `contact_kind` flag, so the engine and nudges work uniformly and the platform vision
   (one engine, many doors) holds — but split them in the **UI** so a realtor's 400 clients
   don't bury their mom. Architect's call.
2. **Import execution:** authenticated Netlify function using the user's JWT (RLS stays on)
   vs service-role with explicit `user_id` scoping (needed for SQL-side `ON CONFLICT` /
   `pg_trgm`). *Lean:* a dedicated authenticated import function that verifies the user then
   runs the upsert with tight `user_id` scoping — RLS-safe, and where the dedup SQL lives.
3. **Sync vs async:** small CSVs inline; large ones via a background function (like the
   existing `generate-background.mjs` pattern) with a progress poll. *Lean:* one import
   function with a row-count threshold that punts big files to background.
4. **FUB custom-field creation** — confirm during a short spike whether we can create the
   birthday/anniversary custom fields via API or must ask the user to add them in FUB first.
5. **Token encryption** for `fub_connections` — where/how (Supabase vault, app-level crypt,
   or env-key encryption). Architect to choose.
6. **Smart-mapping engine (§5.0)** — how far to lean on heuristics vs the LLM, where the
   mapping step runs, and the exact privacy posture for sending sample values (obvious
   fields resolved by content-sniffing; only ambiguous columns sampled, minimally,
   server-side). This is the highest-value piece of the whole feature — spec it carefully.

---

## 9. Success criteria

- **A non-technical user drops in whatever file they already have — any source, any column
  names, any order, messy dates/phones — and it imports on the first try with no template,
  no renaming, no reformatting, and no hard failure** (correcting at most a mapping or two).
  This is the primary bar; if import needs cleanup, the feature has failed.
- A realtor connects FUB once and sees their contacts + key dates flow in, deduplicated.
- A realtor uploads a CSV; re-uploading the *same* file changes nothing and asks nothing.
- A CSV with edits updates the right people in place; genuine new people are added;
  only true ambiguities land in a short review queue.
- A person present in both FUB and the CSV is **one** record.
- Everything stays RLS-scoped to the owner; no cross-user leakage.
- The frontend stays vanilla-JS, no build step; keys stay server-side.

---

## Appendix — sources (from the research dives)

**FUB:** developer docs — Authentication, OAuth getting-started, Webhooks guide,
`/customFields`, `/events` POST, Rate limiting, Pagination; FUB help — "Never Miss a
Birthday or Anniversary" (custom fields), Custom Fields.
**Dedup/CSV:** Postgres `INSERT ... ON CONFLICT` docs; papaparse; libphonenumber-js;
`pg_trgm` + `fuzzystrmatch` (both available on Supabase); string-similarity / Fuse.js.
