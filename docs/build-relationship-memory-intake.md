# Build Plan — Relationship Memory & Conversational Intake (Pro)

**The Architect's implementation plan.** Product spec (the "what/why"): `docs/spec-relationship-memory-intake.md` — its §2 principles and §15 acceptance criteria are **hard constraints** and are restated per phase below. This doc is the "how/where/order" a Builder executes.

**Parent:** TC-34. **Phase tickets:** TC-49 … TC-56 (created).
**UX Phase: RUN** — heavily user-facing (voice UI, To-Review, person cards, front door). The UX Reviewer already gated the product spec (PASS, v2); each phase's built preview still goes through the UX Reviewer before the Validator.

---

## Ground truth (what already exists — build on it, don't reinvent)

- **Stack:** static `public/*.js` (vanilla ES modules, no build step) → Netlify v2 functions → Supabase (free org `ntnlzfezdlbwxbrphknn`, Postgres + RLS) → SendGrid. Model default `claude-sonnet-4-6`. Auth = passwordless magic-link; client uses anon key + RLS scoped to `auth.uid()`.
- **Server auth helpers** (`netlify/functions/_supabase.mjs`): `requireUser(req)`, `userClientFromReq(req)` (RLS-bound), `serviceClient()` (service-role; every write MUST carry the JWT-verified `user_id`), `json()`. **Reuse verbatim.**
- **People/roster already built:** `people` has `name, relationship, notes, location, contact_kind ('personal'|'contact'), kind_locked, primary_email, primary_phone`. Tables: `identifiers(user_id,person_id,type,value)` UNIQUE(user_id,type,value) — **the strong-key store for resolution**; `contact_sources`; `import_batches`; `review_candidates` (import dedup queue). Surfaces: `companion.js` (personal), `roster.js` (book of business), `import.js` (CSV mapper).
- **Dedup + fuzzy engine already built** (`_import.mjs`, `_names.mjs`): `normalizeEmail/Phone/DateParts`, `sameSurname`, `firstNamesEquivalent`, `levenshtein`, and the Postgres RPC `tc38_fuzzy_person_match(p_user_id,p_name,p_threshold)`. **Entity resolution (spec §12) reuses these — do not write new fuzzy matching.**
- **Smart column mapping already built** (`import-analyze.mjs`): heuristic sniff + Claude structured-output (`tool_choice` `propose_mapping`) fallback. **This is the reference pattern for every new Claude call in this build.**
- **Ledger voice pipeline to mirror:** `../damay-ledger/netlify/functions/transcribe-audio.js` (OpenAI Whisper `whisper-1`, base64 audio in) and `parse-expense.js` (Claude structured extract) + `src/App.jsx` `startListening()`/`parseAndSet()` (getUserMedia → MediaRecorder → transcribe → extract → **confirm modal before save**). Reuse the *shape*; replace the *brain* (spec §5a).
- **Migrations at `supabase/migrations/004_*`** → new work starts at `005_`. **No `prompts/` dir** — TC convention is inline structured-output prompts (mirror `import-analyze.mjs`). The extraction prompt is the crux (§ Phase 2) — author it carefully, one module, well-commented, `temperature:0`, tool-forced schema.

---

## Architecture delta (the whole feature)

### New tables (migration `005_relationship_memory.sql`, all RLS `auth.uid()=user_id`)
```
facts                        -- spec §3 model (fact_class, provenance, confidence, bi-temporal,
                             --   surface_until, salience_base, deleted_at). person_id XOR household_id.
households (id,owner,label)
household_member (household_id, person_id, role)
captures                     -- the To-Review inbox (spec §6): raw_text, source, status
                             --   (pending|confirmed|discarded), proposed_person_id/household_id,
                             --   match_confidence, match_evidence, parsed jsonb (array of proposed
                             --   facts/dates), context_locked bool, purge_after timestamptz.
touches (owner, person_id, kind, at)  -- lightweight "I reached out"/capture signal for self-snooze
                             --   & fading detection (spec §8/§9). NOT an activity log.
```
### Extend existing
- `people`: `+ household_id uuid null`, `+ deleted_at timestamptz null` (user hard-delete; excluded from every read/nudge).
- `key_dates`: `+ source_fact_id uuid null` (a RECURRING/MILESTONE fact with `event_date` seeds a key_date; the link keeps it idempotent and lets delete cascade).
- Strong keys for resolution = existing `identifiers` table (already stores every email/phone). No new person arrays.

### New shared libs (`netlify/functions/`)
- `_capture.mjs` — **the shared brain.** `extract(rawText, {lockedPersonId})` → Claude structured-output (facts/episodes classified per spec §3 + person/household hints + suggested gesture) → normalized proposed-capture object; `resolve(userId, parsed, supa)` → entity-resolution gate (spec §12) reusing `identifiers` + `tc38_fuzzy_person_match`/`_names.mjs`, returns confidence level A/B + evidence string. One code path for all five doors.
- `_memory.mjs` — fact writes + temporal rules: deterministic supersession on `(person/household, subject, relation)`, `surface_until` defaults by class, key_date seeding, salience read for ranking. Never LLM-at-recall.

### New functions
| Function | Job | Auth |
|---|---|---|
| `transcribe.mjs` | audio(base64)→text (Whisper, mirror Ledger) | requireUser |
| `capture-extract.mjs` | rawText(+lockedPersonId)→ run `_capture.extract`+`resolve` → write a `captures` row (Level A also writes facts) | requireUser |
| `capture-resolve.mjs` | confirm / reassign / discard a capture → `_memory` fact writes + key_date seed; purge raw | requireUser |
| `scan-extract.mjs` | image→Claude vision→date/facts→`captures` row → **discard image** | requireUser |
| `capture-inbound-email.mjs` | SendGrid Inbound Parse webhook → resolve user by address token → extract → `captures` row → **purge raw** | signature-verified (no JWT) |

### Frontend
- `capture.js` (new) — voice command bar (front door), the To-Review surface, confirmation toasts (Level A/B/C), scan capture. Reuses `companion.js`/`roster.js` DOM idioms + the anon Supabase client.
- Person card additions (in `companion.js` + `roster.js`): "Things you've noticed" (facts read/edit/**hard-delete**), the context-lock mic/scan/add controls, the gesture last-mile (copy / prefilled mailto/sms / "I reached out").
- Memory export: client gathers the user's people+facts+dates+plans → downloads JSON/CSV (no new endpoint needed; RLS-scoped anon reads).

---

## Phased tasks (build order = product spec §17)

### Phase 1 — TC-49 · Memory spine + sovereignty
**Goal:** the facts/households data layer everything feeds, plus the user's absolute edit/delete/export.
- Migration `005`: `facts`, `households`, `household_member`, `touches`; extend `people`/`key_dates`; RLS on all; indexes (`facts(owner_id,person_id) where deleted_at is null`, `facts(owner_id,household_id)`).
- `_memory.mjs`: insert-fact with deterministic supersession + `surface_until` defaults + key_date seeding; user hard-delete (sets `deleted_at`, cascades key_date seed); export gather.
- Person card "Things you've noticed": read (plain warm language — spec §7, **never** show fact_class/confidence/salience), inline edit, hard-delete; whole-person delete; export button.
- **Hard constraints:** engine vocabulary invisible (P4); user hard-delete overrides retire (P3/§4); RLS per owner; households optional (individual-only users never see them).
- **AC:** create/edit/delete a fact on a person; "recovered" supersedes "sick" (old retired, visible in history, not in active reads); a RECURRING fact seeds a key_date; user delete purges from all reads and nudges; export produces the user's full data; no engine term appears in UI. Depends: none.

### Phase 2 — TC-50 · Capture lifecycle + To-Review + extraction/resolution engine (typed door)
**Goal:** the connective tissue — one extract→resolve→confirm path — proven on the typed door first.
- `_capture.mjs` extraction: inline Claude structured-output (mirror `import-analyze.mjs`; `temperature:0`, tool-forced schema) → array of proposed facts/episodes (subject/relation/object/`fact_class`/event_date/provenance/confidence/suggested_gesture) + person/household hints. **One utterance may yield multiple facts across multiple people/household** (UX note) — schema returns a list, each routable.
- `_capture.mjs` resolution (spec §12): strong-key via `identifiers` → Level A; fuzzy via `tc38_fuzzy_person_match`+`_names.mjs` → 0.60–0.90 Level B, <0.60 new/household; **bias to split, never auto-merge**; build the plain-language `match_evidence`.
- `captures` table + `capture-extract.mjs` + `capture-resolve.mjs`.
- Confirmation model (spec §6): **Level A** passive toast "Saved to Maria ✓ · Undo" + writes facts immediately (capture `confirmed`); **Level B** → `captures` pending, nothing written, badge on front door; **Level C** handled in Phase 3. To-Review surface: list, confirm / reassign / discard, one-tap, satisfying.
- Wire the **typed** door (`companion.js`/`roster.js` free-text add) through this engine as first consumer.
- **Hard constraints:** nothing silent — floor is a visible undoable confirm (P2); ambiguous never guessed → To-Review; never auto-merge two people (P7); no fact without a `source` (P5).
- **AC:** typing "Maria just closed on the lake house; her mom is moving in" attaches two facts to the right Maria with a visible confirm; an ambiguous name lands in To-Review with evidence and writes nothing until confirmed; reassign/discard work; re-confirm is idempotent. Depends: TC-49.

### Phase 3 — TC-51 · Voice capture + conversational front door
**Goal:** the flagship — hands-free find→lock→update.
- `transcribe.mjs`: mirror Ledger's `transcribe-audio.js` (Whisper). **Decision/risk:** needs `OPENAI_API_KEY` in TC Netlify env (TC has none today; Ledger does). See Risks.
- `capture.js` voice command bar (front door): "find Maria Edmond" → resolve (reuse resolution engine) → **spoken disambiguation capped at 2–3**, else one narrowing cue, else defer to To-Review (spec §5a); find-or-add unified; then voice update → extract → confirm.
- Context-lock: mic on a person's card → `lockedPersonId` → skips resolution (100% right).
- **Level C (car):** spoken "Got it, saved to Maria, I'll show you later"; confident → Level A write; ambiguous → held in To-Review, spoken "I'll ask you when you've stopped."
- **Hard constraints:** voice leads but every action has an equal typed/tap path (P/§5a); eyes-free disambiguation degrades gracefully; never-silent satisfied by the spoken confirm + To-Review review-when-parked.
- **AC:** in-browser and mobile viewport, "find [name]" opens one match / disambiguates 2–3 by voice / offers add on zero; a spoken update attaches to the locked person; 4+ matches defer rather than read a long list; typed equivalents exist for every step. Depends: TC-50.

### Phase 4 — TC-52 · Payoff loop (brought forward, not last)
**Goal:** capture pays off instantly; the secret-sauce prompt appears.
- Pro front door = a "Coming up" + "who you might be losing touch with" agenda (spec §10/§16-decision-1 — recommend replacing the raw roster list as the landing view; flag as branch point, non-blocking).
- First-capture reward: the person's card visibly gains what was just noticed; new/near dates reflect in "Coming up" immediately.
- Post-import win banner: "3 of your people have a moment in the next two weeks."
- Per-person secret-sauce onboarding: a single gentle "What do they mean to you?" / "Anything worth remembering?" (voice or text), never a form, never bulk.
- **AC:** first capture produces a visible change on first try; post-import shows an immediate upcoming-moments win; thin-context person shows the one gentle prompt; empty Pro state is a warm on-ramp, never a blank roster. Depends: TC-49, TC-50.

### Phase 5 — TC-53 · Import dead-list fixes
**Goal:** a name+email CSV stops being dead weight.
- Extend `import-analyze.mjs`/`_import.mjs`: surface **derived** dates as a confirmable step — "client since/closing/policy/hire date" → yearly anniversary (`RECURRING`, `source=derived`, spec §13); DOB → birthday. Never silently assert a personal fact from a business column.
- Post-import smart-moment prompt: offer to add birthdays for the *handful they interact with most* (rank by recency/touch), not all rows.
- **Hard constraints:** derive only from the user's own uploaded columns; no external enrichment (P5); confirmable, not silent.
- **AC:** importing a file with a "client since" column offers to turn 40 of them into anniversaries on confirm; declining changes nothing; no external lookup exists. Depends: existing import, TC-49.

### Phase 6 — TC-54 · Scan capture (extract-and-discard)
- `scan-extract.mjs`: image → Claude vision → date/fact extract → `captures` row → **image discarded whether or not saved** (spec §5b, P6). Context-lock supported. In-flow trust copy ("we read the date and don't keep the photo").
- **AC:** scanning a dated card extracts the date to a capture and stores no image; confirm seeds the date; context-locked scan attaches with zero resolution. Depends: TC-50.

### Phase 7 — TC-55 · Email forward capture (SendGrid, extract-and-discard)
- SendGrid Inbound Parse: MX on `capture.thoughtscount.com`, one webhook → `capture-inbound-email.mjs`. Per-user secret address `u_<token>@…`; token→user map (new small table or reuse a column). ECDSA signature verify, SPF/DKIM/spam checks, rate-limit, dead-letter (≤24h encrypted) then **purge raw** (spec §5c, P6). Setup-time user trust copy.
- **Hard constraints:** email body purged after extraction; identity via sender address against `identifiers`; ambiguous → To-Review.
- **AC:** forwarding an email to the user's address creates a capture attributed via sender match, then purges the raw within the window; a spoofed/failed-auth inbound is rejected; unknown token rejected. Depends: TC-50. **Spike first:** confirm the `capture.thoughtscount.com` subdomain can carry the MX without disturbing existing SendGrid outbound/DKIM.

### Phase 8 — TC-56 · Nudge engine v2 + gesture last-mile
- Extend `nudges-cron.mjs`: rank by salience + `surface_until` (episodic facts stop nudging after window, stay in timeline); **self-snooze** off `touches`/saved_plans/captures; **surface-the-fading-person** from touch recency (not activity logging); day-granular, context-rich copy (spec §9).
- Gesture last-mile (spec §8): copy note / open prefilled mailto/sms / ready link + one-tap "I reached out" writing a `touches` row (feeds self-snooze + fading).
- **Hard constraints:** gestures never auto-sent (P1); nudge produces a ready gesture the human sends; scales over hundreds of people (batch, watch cron cost).
- **AC:** an episodic fact nudges inside its window and not after; reaching out silences the nudge; a fading person surfaces; sending is one tap and never automatic. Depends: TC-49, TC-52.

---

## Edge cases & risks (David/Builder decisions)

1. **Whisper API key (Phase 3).** TC has no `OPENAI_API_KEY`. Options: (a) reuse Ledger's OpenAI Whisper — add the key to TC Netlify env (small cost, best accuracy, proven); (b) browser Web Speech API — free/on-device but weaker on proper nouns (names are the whole point). **Recommend (a)**; flag cost. Names are Whisper's weak spot → the resolution confirm (Level B/spoken disambiguation) is the safety net, which we have.
2. **Extraction model quality is the crux.** Default `claude-sonnet-4-6` (project standard). If extraction accuracy on messy speech underperforms in Phase 2/3 testing, allow an Opus bump for `capture-extract` only. Prompt lives inline (no `prompts/` dir) but in one well-commented module; treat it as versioned.
3. **To-Review vs import review_candidates.** Two separate queues (different shapes) by design; recommend a single visual "To review" home later (nice-to-have), not now.
4. **Households from voice** ("Dave and Maria") — Phase 3 detects co-mentioned names → household flow; keep the *link?* prompt one-tap, skippable.
5. **Nudge cron scale** — a book of hundreds × salience ranking. Batch reads; validate query cost (the pro-import brief already flagged this).
6. **Front-door reframe (spec §16-1)** — agenda vs roster landing. Recommend agenda; non-blocking, surfaced in Phase 4.
7. **Email subdomain MX (Phase 7)** — must not disturb existing SendGrid outbound/DKIM on `thoughtscount.com`; isolate on `capture.` subdomain, spike first.

## Out of scope
- Billing/paywall (TC-33). Assume `isPro()` gate exists (stubbed in `roster.js`).
- Follow Up Boss integration (TC-48) — unaffected; converges via `identifiers` later.
- External/public enrichment — permanently out (P5), not a phase.
- Unifying the two review queues into one surface — later polish.
