# Spec: TC-89 — Voice name catch-&-correct + talk about an existing person

**Author:** The Architect (Agent 1) · 2026-08-09
**Ticket:** TC-89 (High, Backlog) — "Voice: catch & correct misspelled names + start a voice chat about an existing person"
**Status of this doc:** Ready for Builder. Two DB items inside are **PROPOSED, NOT APPLIED** (see §DB).

---

## Feature: Voice name catch-&-correct + target-an-existing-person

## Goal
When someone speaks a name into the voice front door, land it on the *already-saved* person (with the spelling they chose) instead of silently creating a mis-spelled duplicate — and give them a gentle, eyes-free way to fix a name on the confirm card, or to start a voice note *about* a person they already have.

This is three cooperating parts, built together:

1. **Match-before-write** — bias speech-to-text with the user's roster, and make sure the resolver actually surfaces an existing homophone as a candidate.
2. **Editable name on the confirm card** — show the parsed person name and let the user tap to correct the spelling before saving (covers the brand-new-person path especially).
3. **Target an existing person from the voice screen** — find → lock → update, eyes-free, without opening that person's page first.

---

## Architecture

### The pieces as they exist today (verified in code)

- **`netlify/functions/transcribe.mjs`** — POST audio (base64) → OpenAI `gpt-4o-mini-transcribe` → `{ text }`. **Open in "everyone" audience** (`VOICE_AUDIENCE`), so it does NOT call `requireUser` today and has no user context. Rate-limited by IP. No roster biasing.
- **`netlify/functions/_capture.mjs`** — `extract()` (Claude structured output) + `resolvePerson()`. Resolver calls RPC `tc38_fuzzy_person_match(user_id, name, threshold=0.4)`, then the deterministic `_names.mjs` decides real equivalence. Levels A/B; bias-to-split; never auto-merge.
- **`netlify/functions/_names.mjs`** — deterministic first-name equivalence: exact ∪ nickname dictionary ∪ spelling-close (Levenshtein ≤2, ≤0.34·len, longer≥4). "Jon"/"John" **passes** here (dist 1, len 4).
- **`supabase/migrations/003_crosskind_fuzzy.sql`** — the live RPC: returns candidates where `similarity ≥ threshold` **OR same surname**. `LIMIT 25`.
- **`netlify/functions/capture-extract.mjs`** — the door. `preview:true` returns `kind: add | update | pick` and writes nothing (holds a pending capture). **Requires auth** (`requireUser`) already.
- **`netlify/functions/capture-resolve.mjs`** — writes on confirm. Accepts `personId` (existing/reassign) or `newPersonName` (create). Idempotent.
- **Client** (`public/index.html`, `_capture.js`, `companion.js`, `_inline-mic.js`):
  - `tcVoiceRemember()` = anon "remember someone" flow; `tcVoiceNote(personId,…)` = locked note on a known person (already passes `lockedPersonId`).
  - `crecTranscribeBlob()` POSTs `/api/transcribe` and **already attaches a bearer token when signed in** (`window.TCCompanion.authToken()`), but the server ignores it today.
  - Confirm card `renderRememberCard(cap)` renders `add | update | pick`. Person name is shown **read-only** (eyebrow for update, `personHint` for add). Buttons: confirm / cancel / candidate picks. Confirm calls `captureConfirm` → `/api/capture/resolve`.
  - `capture-extract` / `capture-resolve` client calls go through `post()` in `_capture.js`, which **already attaches the Supabase bearer token**.
  - `loadPeople()` in `companion.js` already loads the user's people for the "Your People" modal — a roster is available client-side when signed in. No people-search affordance exists on the voice screen.

### Data flow after this feature (signed-in user)

```
mic tap
  └─ record → POST /api/transcribe  { audio, mime, roster?:[names] }   ← NEW roster hint
        server: if bearer present → load roster → pass as OpenAI `prompt` bias
        → { text }  (spelled toward saved names)
  └─ POST /api/capture/extract { rawText, preview:true }   (unchanged auth)
        server: extract → resolvePerson (RPC recall widened) → kind add|update|pick
  └─ confirm card renders
        • name shown + EDITABLE (tap-to-fix)   ← NEW
        • on confirm → POST /api/capture/resolve { captureId, personId|newPersonName }
              newPersonName / reassignment now carries the corrected spelling
```

Plus a **new entry-point branch**: from the voice screen the user can say/pick "a note about <existing person>" → resolve to that person → run the **locked** capture path (`tcVoiceNote`, `lockedPersonId`) that already exists.

---

## Part 1 — Match existing people before writing anything

### 1a. Roster-bias the transcription (the safe-auth question)

**The constraint:** `/api/transcribe` is open in "everyone" mode and does not look up the user, and we must NOT break the open/anon voice flow (anon users must still be able to transcribe).

**Recommended approach — server-side roster fetch, opportunistic auth, never required:**

- Client keeps sending audio exactly as today. When signed in, it **already** sends the bearer token to `/api/transcribe` (`crecTranscribeBlob`). No client change needed for auth.
- In `transcribe.mjs`, after the existing audience gate, add an **opportunistic, best-effort** roster lookup:
  - If a bearer token is present, verify it with the existing `requireUser(req)` (already imported). **On any failure, do not error — just skip biasing** (anon path unaffected).
  - If verified, fetch that user's people names via `serviceClient()` (bounded: first names + full names, `deleted_at is null`, `LIMIT 200`, `contact_kind` any). Build a compact, deduped comma list.
  - Pass it to OpenAI as the transcription **`prompt`** field (the documented vocabulary/spelling bias for `gpt-4o-mini-transcribe`). Cap the prompt length (e.g. ≤ ~300 names / a few hundred tokens) so it never bloats the request or the latency.
- **Do NOT** trust any roster names sent in the request body from the client — that would let an anon caller inject arbitrary bias and is pointless (server can fetch authoritatively). The roster is derived **server-side from the verified token only**. (This is the safe design; the `roster?` field in the data-flow sketch above is illustrative — the Builder should fetch server-side, not accept a client roster.)

**Why this is safe:** anon users hit the identical code path minus the prompt (best-effort try/catch, like the existing rate-limiter's "never blocks on failure" pattern). No new endpoint, no new gate, no anon breakage. The service-role read is pinned to the JWT-verified `userId` (never a body value) — matches the `_supabase.mjs` safety contract.

**Latency note:** the roster query is one indexed `select` on `people` by `user_id`; it runs in parallel with nothing (it precedes the Whisper call), so it adds one small round-trip before an already ~1s transcription. Acceptable. If David wants it tighter later, cache the roster string in a Netlify Blob per user with a short TTL — **out of scope here**, noted as a future optimization.

### 1b. Make sure the resolver surfaces the homophone candidate

**The worry in the ticket:** does the RPC's `threshold=0.4` miss low-trigram homophones like Jon/John (~0.29)?

**Finding (verified):** the live RPC (`003_crosskind_fuzzy.sql`) is **already a UNION of `similarity ≥ threshold` OR same surname**. So:
- Same-surname homophones ("Jon Smith" vs "John Smith") **already** come back via the surname branch regardless of trigram score, and `_names.mjs` (`firstNamesEquivalent`) accepts Jon/John. **These already work.**
- The real gap is **first-name-only, no-surname** homophones: user says "Candice" (bare), saved person is "Candace" (bare). Trigram("candice","candace") ≈ 0.5 → clears 0.4, so **Candice/Candace already clears**. But a pair like **"Jon"/"John"** as bare first names scores ~0.29 < 0.4 and has no surname → the RPC returns nothing → resolver says "you don't have anyone named Jon yet" → **duplicate created.** This is the actual homophone miss.

**Recommended fix — lower the RPC trigram threshold for the recall band, keep the JS gate strict.** The RPC is only a *candidate feeder*; the deterministic `_names.mjs` still makes the real yes/no decision and the "bias-to-split / never auto-merge" guarantees are unchanged. Concretely:

- Change the resolver's call in `_capture.mjs` from `p_threshold: 0.4` to **`p_threshold: 0.25`** (a value below the Jon/John 0.29 trigram, chosen so bare-first-name homophones enter the candidate set; still high enough to keep the set small). No RPC signature change — `p_threshold` is already a parameter.
- The RPC already `LIMIT 25` and the JS already filters to real `nameMatchKind` equivalence, so a wider band cannot produce a wrong match — only a wider *candidate* net that JS then narrows. Worst case is a few extra rows scanned per resolve; on a personal roster (tens to low-hundreds of people) this is negligible.
- **No migration needed for 1b** — it's a caller-side threshold change. (The RPC definition already supports it.) This keeps the change fully in application code and reversible by one number.

**Trade-off considered & rejected:** lowering the threshold *inside* the RPC default. Rejected — leave the RPC default at 0.4 so other callers (import dedup) are untouched; only the voice/typed resolver opts into wider recall. Pass it explicitly at the call site.

**Edge:** an even lower threshold (e.g. 0.2) starts pulling unrelated short names into the candidate set; 0.25 is the recommended floor. If Jon/John-class misses persist in Validator testing, the *correct* next lever is the phonetic branch — which is **explicitly the out-of-scope fast-follow**, not this ticket. Flag and stop, don't chase it here.

---

## Part 2 — Editable name at the voice confirm step

**Today:** `renderRememberCard(cap)` shows the person name read-only:
- `kind:"add"` → shows `cap.personHint` ("I'll remember **Candice** and note:") and confirms with `newPersonName: cap.personHint`.
- `kind:"update"` → shows `cap.personName` in the eyebrow ("Update · **Maria**") and confirms with `personId: cap.personId`.
- `kind:"pick"` → lists candidates.

**Change:** make the name a gentle, tap-to-edit affordance on the **add** and **update** cards. The name becomes the load-bearing correctable field.

### Interaction (warm, eyes-free-friendly — not a form)

- The name is rendered as **tappable text with a subtle "edit" affordance** (a small pencil/underline styling consistent with the app; icon not emoji per the polish bar), *not* a bare input box. Reads as "I'll remember **Candice** — tap the name to fix the spelling."
- Tapping the name reveals a single, focused inline text field pre-filled with the current name, with the on-screen keyboard, plus a "Done" / checkmark. No other fields — just the name.
- Confirming the card uses the (possibly edited) name:
  - **add:** `newPersonName = editedName` (already the create path; `capture-resolve` uses `newPersonName` to create). ✅ no server change.
  - **update:** here's the subtlety. If the user *edits the name on an update card*, they're saying "this isn't the right person / this spelling is wrong." Two sub-cases:
    - Edited name still resolves to the same saved person (e.g. cosmetic) → keep `personId`, ignore the text (don't silently rename the saved person from a capture — renaming a person is not this flow's job).
    - Edited name clearly differs → treat as **"actually a different/new person"**: drop `personId`, send `newPersonName = editedName` so `capture-resolve` creates/reassigns. This prevents the "wrong-person attach" that the whole ticket is fighting.
  - **Recommended simplification for the Builder:** on the **update** card, editing the name flips the card's confirm to the **add/new-person** semantics (send `newPersonName`, no `personId`). This is the safe default and needs **no server change** — `capture-resolve` already branches on `personId` vs `newPersonName`. Document this in the card so it's obvious ("This will save to a new person named X").
- **Re-resolve on edit (recommended, small):** when the user edits the name on an **add** card and the edited spelling now *matches an existing person*, we'd ideally catch it. Cheapest correct approach: on "Done", if the edited name changed, re-call `/api/capture/extract` **preview** with the corrected text is overkill; instead add a tiny **name-resolve preview** — reuse the pending capture: send the edited name to `capture-resolve` and let the server's create path run, OR (preferred) do nothing fancy and rely on the *next* capture being biased. **Recommendation: keep Part 2 dumb** — the edited name is taken at face value on confirm (add→newPersonName, update-edited→newPersonName). Live homophone re-matching on edit is a nice-to-have; if David wants it, it's a follow-up. Flagged as an open question below.

**Server:** no change required for Part 2 if we adopt the "edited name → newPersonName" rule. `capture-resolve` already accepts `newPersonName`. The only file touched is the client (`index.html` card render + confirm handler; possibly a helper in `_capture.js`).

**Accessibility / warmth:** the edit field must be reachable by tap with a large hit target, announce as "Edit name," and never trap focus. Keep the calm copy; no red/validation-error styling for a name.

---

## Part 3 — Start a voice note ABOUT an existing person, from the voice screen

**Today:** the voice screen only does fresh capture (`tcVoiceRemember`). The locked path (`tcVoiceNote(personId, personName, …)` → `lockedPersonId`) exists but is **only reachable from a person's card/page.** TC-51's "find → lock → update."

**Change:** add an entry point on the voice screen to **target an existing person first**, then run the existing locked capture flow.

### Recommended UX (eyes-free-first, gentle)

Two ways in, same destination:

1. **Speak it naturally (primary, eyes-free).** On the main voice screen, in addition to "remember someone," allow the user to say e.g. *"a note about Maria"* / *"update Maria."* The extract path already produces a `person_hint`; when the utterance is clearly *about* an existing resolved person (Level A / single match), the confirm card is already the **update** card. **So a large slice of Part 3 falls out of Parts 1–2 for free** once recall is fixed: saying "Maria got the job" already routes to the update card for the saved Maria. The genuinely new capability is **targeting a person to talk to *before* saying the note** (empty-handed "I want to add to Maria… <pause> …she started a new job").

2. **Pick the person, then dictate (fallback / discoverability).** Add a small affordance on the voice screen — a "…about someone you know" control — that opens a **lightweight people picker** (reusing `loadPeople()` already in `companion.js`; searchable list, first names, large tap targets). Selecting a person calls the existing **`tcVoiceNote(personId, personName, onSaved)`** — which is already fully built (locked preview → confirm card baked to that person). **No new capture machinery** — Part 3's picker is just a new front door onto an existing locked flow.

**Voice-first version of the picker (recommended, matches "eyes-free"):** after tapping "…about someone you know," Della prompts "Who?"; the user says a name; we transcribe (roster-biased from Part 1) and resolve it:
- single confident match → **lock** to them, confirm by voice/tap ("Adding to Maria — go ahead"), then record the note → the locked confirm card.
- multiple matches → speak/show the small pick list.
- no match → "I don't have a <name> yet — want to add them?" → falls back to the fresh-capture add flow.

This is the "find → lock → update" loop, eyes-free.

**Gating:** targeting an existing person requires being signed in (you must *have* people). When `VOICE_AUDIENCE="everyone"` and the user is anon, the "…about someone you know" control is hidden or, if tapped, gently invites sign-in ("Sign in to pick from your people"). Reuse the existing sign-in affordance; do not build a new gate.

**Files:** client only — `index.html` (voice screen: add the entry control + the "Who?" mini-flow), `companion.js` (reuse `loadPeople`; a small searchable picker), possibly `_inline-mic.js` if the picker rides the mic component. Server: **none** — `tcVoiceNote` → `capture-extract` (locked) → `capture-resolve` all already exist and are auth'd.

---

## Tasks (in build order)

- [ ] **T1 — Resolver recall widen (Part 1b).** Change `p_threshold` 0.4 → 0.25 at the voice/typed resolve call in `_capture.mjs` (`resolvePerson`). Add a one-line comment tying it to TC-89 and the Jon/John trigram gap. — Files: `netlify/functions/_capture.mjs` — Depends on: nothing. *No migration.*
- [ ] **T2 — Roster-bias transcription (Part 1a).** In `transcribe.mjs`: after the audience gate, opportunistically verify bearer (`requireUser`), and if verified fetch roster names (`serviceClient`, `user_id`-pinned, `deleted_at is null`, `LIMIT 200`), build a capped comma list, pass as OpenAI `prompt`. Wrap in try/catch so anon and any failure silently skip biasing. — Files: `netlify/functions/transcribe.mjs` — Depends on: nothing (parallel with T1).
- [ ] **T3 — Editable name on confirm card (Part 2).** In `renderRememberCard` + confirm handler: render the person name as tap-to-edit on `add` and `update` cards; on edit, confirm sends `newPersonName = editedName` (drop `personId` on an edited update card, with clear "saves to a new person" copy). Warm styling, icon-not-emoji, large hit target. — Files: `public/index.html` (card render + `confirmRemember`), possibly `public/_capture.js` helper — Depends on: nothing (parallel), but review together with T1/T2 since it closes the loop.
- [ ] **T4 — Target-an-existing-person entry point (Part 3).** Add "…about someone you know" control on the voice screen → searchable people picker (reuse `loadPeople`) → call existing `tcVoiceNote(personId, personName)`. Add the voice-first "Who?" mini-flow (transcribe → resolve → lock/pick/offer-add). Hide/sign-in-gate for anon. — Files: `public/index.html`, `public/companion.js`, maybe `public/_inline-mic.js` — Depends on: T2 (so the "Who?" transcription is roster-biased) and benefits from T1 recall.

**Parallelism:** T1 and T2 are independent backend changes (parallel). T3 is independent client work (parallel). T4 depends on T2 landing (roster bias in the "Who?" step) but can start against a stub. Critical path: **T2 → T4.** Suggested order to ship value fastest: T1 (one-liner, immediate recall win) → T2 → T3 → T4.

---

## DB / infra (PROPOSED, NOT APPLIED)

- **No migration is required for this ticket.** T1 uses the existing `p_threshold` parameter (application-side value change); the RPC in `003_crosskind_fuzzy.sql` already supports it. Nothing in this spec runs a migration, deploy, or env change.
- **Env:** no new env vars. `VOICE_AUDIENCE` unchanged. `OPENAI_API_KEY` / Supabase keys unchanged, server-side only.
- If the Builder discovers a genuine need for an RPC change, that migration is **written to a file + committed to a branch, flagged "proposed not applied," and routed to David** — never applied by the Builder/Validator.

---

## Edge Cases & Risks

- **Anon voice must not break.** T2's roster fetch is best-effort; any missing/invalid token → skip biasing, transcribe as today. Explicit try/catch, mirroring the rate-limiter's "never blocks on failure."
- **Roster prompt bloat / latency.** Cap names passed to OpenAI (~≤300) and total prompt length; large rosters (Pro import) must not blow the transcription request. Truncate deterministically (e.g. most-recently-touched first) if David wants; default = first N by name.
- **Prompt bias is a nudge, not a guarantee.** OpenAI's `prompt` biases spelling, it doesn't force it — Parts 1b + 2 are the real safety net. Don't oversell T2 alone.
- **Edited-name-on-update semantics.** The safe rule (edited update → new person via `newPersonName`) avoids silently renaming a saved person from a capture. Make the copy explicit so the user knows they're creating/redirecting, not renaming.
- **Wider recall band false candidates.** 0.25 threshold pulls a slightly larger candidate set; `_names.mjs` still gates truth and the flow still biases-to-split, so no wrong auto-attach — worst case is a "pick" card appearing where before it silently (wrongly) created a dup. That's the desired direction.
- **Never trust a client-supplied roster.** Server derives roster from the verified JWT only.
- **Out-of-scope temptation (phonetic recall).** If Jon/John-class misses survive T1's 0.25 threshold, STOP — the fix is the phonetic branch, which is the explicit fast-follow, not this ticket. Hand back, don't build it.

## Ambiguous — needs David's decision

1. **Live re-match on name edit (Part 2):** when a user fixes "Candice"→"Candace" on an *add* card and "Candace" now matches a saved person, do we (a) take it at face value and create/keep as typed [recommended, simplest], or (b) re-resolve on the fly and offer "that matches your saved Candace — use her?" Recommendation: ship (a); add (b) as a fast-follow only if testing shows it matters.
2. **Part 3 entry style:** ship BOTH a tappable picker and the voice-first "Who?" mini-flow, or start with just the tappable picker (simpler, guaranteed) and add voice-first "Who?" as a fast-follow? Recommendation: **picker first in this ticket, voice-first "Who?" if time allows**, since the picker reuses fully-built pieces and de-risks the ticket.
3. **Roster cap number / ordering** (300? by recency?) — a knob, safe to default; confirm if you have a preference.

## Out of Scope

- Phonetic "Did you mean Candace?" recall requiring a DB extension (pg_trgm is not phonetic; this needs e.g. `fuzzystrmatch`/Soundex) — **separate fast-follow.**
- The canonical-spelling-on-match automated test — **separate fast-follow.**
- The mic-permission bug (**TC-90**).
- Renaming a saved person from within a capture (a person-edit surface, not this flow).
- Per-user roster caching in Blobs (latency optimization) — future, not needed for correctness.

## UX Phase: RUN

Parts 2 and 3 change on-screen flow and layout (an editable name affordance; a new "talk about an existing person" entry point + people picker + voice "Who?" mini-flow) in a warm, eyes-free consumer surface. This is exactly the kind of flow/affordance work the UX Reviewer gates — and this app has a live-test rule for anything touching capture/auth flow. UX phase ON; the UX Reviewer gates between Builder and Validator. (Part 1 alone would be SKIP-eligible as backend-only, but the ticket ships together.)
