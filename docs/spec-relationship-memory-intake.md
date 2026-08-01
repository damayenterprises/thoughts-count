# Spec — Relationship Memory & Conversational Intake (Pro)

**Status:** Draft v2 (UX refinements folded in) → Architect
**Linear:** TC-34 (learning engine / Loops 2 & 3) — this is the foundational build under it
**Author:** Session "TC Pro sort", 2026-07-30
**Scope:** The intake + memory engine that powers the Pro experience (book-of-business roster). Personal companion (`companion.js`) inherits the same spine but keeps its intimate, low-volume UI.

> **This is the crux.** This build activates the paid secret sauce — **"tell me about them"** and **"what do they mean to you."** Those two questions, captured effortlessly and remembered intelligently over time, are the entire reason a Pro pays us and the entire reason we beat a generic chat box. Everything below exists to make answering them frictionless and to make that answer compound into better gestures forever. No shortcuts. If the capture is clumsy or the memory is dumb, this is a pile of hopes; if they're effortless and smart, it's the business.

---

## 1. Why this exists (north star)

Busy professionals — **attorneys, HR leaders, investment bankers, financial planners, real estate agents, and many others** — care about the people they look after but can't hold hundreds of lives in their head. They miss the moment (a loss, a graduation, a home anniversary) or find out too late. They already have a CRM for pipeline data; they do **not** want another one.

**The product is not the list. The product is: notice the right moment, know what to say, and show up personally — effortlessly.** The roster is only fuel for that.

### The secret sauce (the paid activation)
The magic isn't dates — dates tell us *when*. The magic is **relationship context**: *who this person is to you* and *what you know about them*. "Maria's dad has been sick, they just relocated from Austin, the twins start high school" is what turns a generic nice idea into a gesture that could only come from *this* user for *this* person. **No general AI platform has that**, because it isn't on the internet — it lives only in the head of the person who noticed it. Capturing it, effortlessly, and remembering it, intelligently, is the whole product and the whole moat.

### The moat (name it, protect it)
Every competitor (Clay, Dex, Covve, wealth/legal tools) is *network-first*: they auto-scrape LinkedIn/email metadata to detect that a relationship is *cooling*, but they can never know *why a person matters*. Scraping is also structurally blind to the people thoughtfulness is most about — a client's spouse, an old friend, a teammate's sick parent — who have no profile to mine. **A memory built from what the user noticed and said owns exactly the people the enrichment industry cannot see.**

**Unoccupied position:** Monica's warmth + Dex's zero-effort intake, executed reliably. Manual apps die of data-entry friction; auto-sync apps die of bugs and creepiness. **Intake and reliability ARE the product.**

---

## 2. Non-negotiable principles (hard constraints — may not be designed away)

1. **The human always performs the kindness.** We prompt and equip; the user acts. **Gestures are NEVER auto-sent.** We are not an autopilot that blasts "happy birthday" — that robs the user of the act of kindness and makes us the mail-merge tool we define ourselves against.
2. **Nothing is ever silent.** Nothing about a person changes, and nothing goes into the world, without the user knowing. Every capture is **visible and reversible.** The floor is a passive, glanceable, undoable confirmation — *never* a write the user can't see. (Full model in §6.)
3. **Memory is the user's, not ours.** It is visible, editable, **user-deletable**, and exportable — and **NEVER paywalled.** The system may *retire* facts for its own hygiene, but a user-initiated delete is absolute and overrides retire (§4). Three apps in this space died and left users "grieving" lost memory; the most-hated dark pattern is charging so the AI "won't forget you." Monetize the *help*, never the memory. (Constraint on TC-33.)
4. **The memory model is invisible.** Fact classes, confidence scores, salience, "supersession" — this vocabulary NEVER appears in the UI. The user sees warm, plain language ("Things you've noticed about Maria," "Coming up"). (§7 governs all user-facing language.)
5. **No external enrichment of personal facts.** We never scrape LinkedIn/social/people-search to backfill jobs, family, or life events. If we can't cite where a fact came from, we don't store it and never act on it.
6. **Extract-and-discard for sensitive raw material.** Scans/images AND forwarded email bodies: read the datum, confirm, save the datum, **discard the raw artifact.** We never become a store of licenses, documents, or confidential client correspondence. (§5b, §5c.)
7. **Never silently merge two people.** A false merge can send a gesture referencing the wrong person's private life. Bias every threshold toward *split, not merge*.
8. **Reliability is a feature.** A capture that feels slow or loses a forwarded email breaks the whole promise.
9. **Not a CRM.** No pipeline stages, no activity/sales logging, no tags-as-segments, no CRM sync/export-back. Saying no to these *is* the product.

---

## 3. The memory spine — facts + episodes

Two kinds of things are remembered about a person:

- **Facts** — durable ("has twin daughters", "loves hiking", "allergic to shellfish"). Never fade.
- **Episodes** — timestamped, time-sensitive ("dad has been sick" · 2026-07-20; "going through a divorce"; "just started at Acme"). Matter now, fade later.

Every captured item carries: a **date-added**, a **provenance** (told-by-user vs inferred) + **confidence**, and a **fact class** that determines temporal behavior. Low-confidence items surface as a gentle **question** ("Is Sarah's daughter starting college this fall?"), never a silent assertion — the direct fix for "wrong facts baked into memory." **Every fact should pair with a suggested gesture** ("daughter got into college → want to send a card?").

> **Internal only.** Everything in this section is engine machinery. Per principle 4, none of these terms/scores are ever shown to the user (§7).

### Fact classes & temporal behavior (internal)
| Class | Example | Behavior |
|---|---|---|
| `DURABLE` | twins, loves hiking, allergy | Never decays; surfaces forever |
| `EPISODIC` (health) | dad is sick, recovering from surgery | Strong ~21 days, then fades from nudges — **not deleted** |
| `EPISODIC` (life) | divorce, job hunt | Fades over ~90 days |
| `MILESTONE` | got the job, moved to Denver | Congratulate window ~14 days → then becomes durable background ("works at Acme since 2026") and **supersedes** prior state |
| `RECURRING` | birthday, work anniversary | Never decays; salience **spikes** near the date each year |
| `PREFERENCE` | prefers texts to calls, likes bourbon | Durable but **supersedable** (newer retires older) |

Classification happens **once, at capture time**, by the extraction step — not at recall.

### The temporal rule (answers "'dad is sick' must expire")
- **Timestamp everything.** Nothing floats in time.
- **System retires; user deletes.** System behavior: never hard-delete — "recovered" arrives → the "sick" episode's validity closes and links to its successor; three years later it's visible in her timeline but never nudges. **User behavior overrides:** a user hard-delete removes the row entirely (§4).
- **Deterministic supersession at capture, not LLM-at-recall.** A new fact sharing `(person, subject, relation)` with a different value retires the old one structurally (similarity can't reliably tell "contradiction" from "duplicate"). Same value → reinforce confidence, don't duplicate.
- **Salience decay** applied only at recommendation-ranking time: durable flat; episodic/milestone decay by half-life; recurring spike near their date. Past its `surface_until` window an episode is suppressed from proactive nudges but stays queryable.
- **The gesture engine only ever reads open, in-window facts, pre-ranked by salience.**

### Data model (memory)
```
fact
  id            uuid
  owner_id      uuid            -- the user
  person_id     uuid null       -- attach to a person…
  household_id  uuid null       -- …or a household (shared context)
  subject       text            -- "dad", "self", "daughter Ava"
  relation      text            -- "health_status", "job", "hobby", "allergy"
  object        text            -- "sick", "started new job at Acme"
  fact_class    enum            -- DURABLE|EPISODIC|MILESTONE|RECURRING|PREFERENCE
  raw_text      text            -- original phrasing (audit/trust)
  source        enum            -- voice|scan|email|typed|import|derived
  provenance    enum            -- user_stated | inferred
  confidence    float           -- 0..1
  event_date    date null       -- when it happened in the world
  valid_from    timestamptz
  valid_to      timestamptz null -- NULL = currently valid
  superseded_by uuid null
  surface_until date null       -- soft window; NULL = durable
  salience_base float
  created_at    timestamptz
  deleted_at    timestamptz null -- user hard-delete (excluded from all reads)
```
`key_dates` (existing) remains the schedule layer for reminders; a `RECURRING`/`MILESTONE` fact with an `event_date` seeds a key_date.

---

## 4. Memory sovereignty — edit, delete, export

Principle 3 in practice. The user must always be able to:
- **See** everything we hold about a person, in plain language, on that person's card ("Things you've noticed").
- **Edit** any fact inline (fix a name, correct a detail).
- **Delete** any fact, or a whole person, **hard** — `deleted_at` set, excluded from every read and every nudge, purged from backups on the normal cycle. This **overrides** system-retire: "never delete" is a *hygiene* rule for the AI, never a cage for the user. A user asking us to forget something must be honored completely and quickly.
- **Export** all of their people, facts, dates, and plans (simple JSON/CSV), any time, no paywall.

This is the trust contract that lets an attorney or banker put confidential relationship context into us at all. It is load-bearing for the paid tier, not a compliance afterthought.

---

## 5. Intake — five conversational doors, one brain

All doors feed the **same extraction-and-confirm engine** and the **same memory**. Build order: **voice → scan → email**, with **typed** and **import** as always-there baseline.

**Two capture paths — but the choice is never a mode the user has to think about:**
- **Quick capture (default)** — mic/scan/type from the top level, conversational, fastest; we resolve *who* afterward (§6). This is the everyday path.
- **Context-lock (a natural affordance, not a toggle)** — when the user is *already looking at Maria*, the mic/scan/add controls live on her card, so capturing there simply *is* locked to her — nothing to resolve, 100% right by construction. The user never chooses "lock mode"; being on a person's card is the lock.

### 5a. Voice — flagship + conversational front door
Reuse Damay Ledger's proven *pipeline shape* (`getUserMedia` → `MediaRecorder` → server transcribe → LLM extract → **confirm before save**; ref `damay-ledger/src/App.jsx` `startListening`/`parseAndSet`, `netlify/functions/transcribe-audio.js` Whisper, `parse-expense.js` Claude). **Replace the brain:** Ledger's flat single-record expense parser becomes our facts/episodes + entity-resolution + household-detection engine. Ledger's limits we must exceed: no people/relationships, no soft context, exact-match-only dedup, single record.

**Voice is also the front door, not just intake** — a conversational command bar:
- **Hero flow:** get out of a meeting, in the car — *"find Maria Edmond"* →
  1. **Resolve:** one match → open her; a few → spoken disambiguation (see cap below); none → *"I don't have a Maria Edmond yet — want to add her?"*
  2. **Lock:** once confirmed, identity is nailed.
  3. **Capture:** *"She just closed on the lake house and her mom's moving in"* → parse → attach to Maria.
- **Eyes-free is a safety requirement, and it degrades gracefully:**
  - Spoken disambiguation is **capped at 2–3 options** read aloud. Beyond that we do NOT read a long list — we ask **one more spoken narrowing cue** ("which city — or roughly when did you last talk?"), and if still ambiguous, defer: *"I found several — I'll pull them up when you've stopped."* The capture is held in To-Review (§6), never guessed.
  - Disambiguation is answerable by voice ("the first one," "the Denver one"). We never require reading a screen while driving.
- **Find-or-add unified:** the same phrase opens an existing person or starts adding a new one — the user needn't know in advance.
- **Never-silent, adapted for the car:** the user *consciously spoke* the update (satisfies principle 2 in the moment); the parse-verification lands in To-Review for a glance when parked ("I'll show you what I saved to Maria"), easy to correct.
- **Voice leads but is NOT mandatory** — every voice action (find, add, capture, disambiguate) has an equal typed/tap path. Voice is the leader, never the gate.

Other commands the bar grows into: "who's coming up this week," "who am I losing touch with," "add the Hendersons."

### 5b. Scan — extract-and-discard
Scan something with a date (invite, save-the-date, form, card). Vision model reads the date → confirm → save the **date only** → **discard the image** (never persisted, save or not). Prefer on-device read where feasible; otherwise processed-and-dropped server-side, never stored. Context-lock available (scan from within a person). **State the discard guarantee to users in-flow** — "we read the date and don't keep the photo" — it's a trust feature, not fine print.

### 5c. Email — forward to capture (extract-and-discard, same as scan)
**Provider decision: stay on SendGrid Inbound Parse.** Included free in the current plan, one MX record + one webhook, ECDSA signature verification against spoofing, clean parsed text. Postmark's edge (quoted-thread stripping) is irrelevant because an LLM reads the whole email. Not worth adding a vendor.
- Each user gets a unique **secret** forward address: `u_<token>@capture.thoughtscount.com` (subdomain catch-all → one webhook; opaque token, rotatable/revocable).
- Email has the **easiest identity** — the sender address is a near-unique key against `person.emails`.
- **Extract-and-discard applies to the email body, exactly like a scan (principle 6).** For attorneys/bankers a forwarded email may carry privileged client content — we do NOT become a store of client correspondence. Flow: receive → extract facts/dates → land in To-Review → on confirm, keep only the extracted facts → **purge the raw message and attachments.**
  - The ONLY retention is a short, encrypted **dead-letter window** (target ≤24h) so an extraction failure isn't silently lost; after the window, or on successful confirm, the raw is purged. This retention is stated to the user when they set up their forward address.
- **User-facing trust story (required copy):** what the address does, that we extract and then delete the email, that it's their eyes only. Confidentiality is the deciding factor for these personas — the reassurance is part of the feature, not marketing.
- Guardrails: verify signature (anti-spoof), check SPF/DKIM/spam verdicts, sanitize any transiently-handled HTML, rate-limit per token, respond 200 fast (no stacked retries).

### 5d. Typed — the obvious baseline
Plain text add/edit stays everywhere, conversational (free text the engine parses), the humble fallback and the accessible equal of voice.

**One memory store (no second notes box).** There is exactly ONE place a user records "what I know about them" — the relationship memory ("Things you've noticed"). The add-person "anything worth remembering" field is NOT a separate store; it is the **on-ramp to that same memory — the first noticed entry** (copy: "Start with anything you already know about them — you can add more anytime"). The legacy `people.notes` blob is retired as a distinct user-facing field: existing values migrate in as the first noticed item(s); `notes` survives only as a migration source / raw fallback. **The plan/gesture engine reads the memory, never a separate notes blob** — so text typed at add-time and text noticed later feed the plan identically (kills the invisible-difference redundancy the UX gate caught). Phase 2 extraction silently structures this free text into facts; the user only ever sees one box.

### 5e. Import — fight the dead list
The make-or-break for Pro: a CSV of name + email generates **zero value** until contacts have dates/context. So:
- **Derive from the columns they gave us** (safe, no external anything): "client since"/"closing"/"policy start"/"hire date" → a yearly **relationship anniversary** (`RECURRING`, `source=derived`); DOB column → birthday. Present as confirmable: *"We found a client-since date for 40 people — turn these into anniversaries?"* Never silently assert a personal fact from a business column.
- **Column-type detection** at import (date vs company vs name-part); low confidence → ask, don't guess. A short mapping-confirm screen is trust-building, not friction.

---

## 6. The capture lifecycle & confirmation model (the connective tissue)

Every door lands in one lifecycle. This is the surface that makes "effortless" and "nothing silent" both true.

### The "To review" surface (first-class)
A single, obvious place — **badge on the Pro front door** ("2 to review") — where captures that need a human glance wait. Each item shows, in plain language:
- what we heard/read ("She just closed on the lake house; her mom is moving in"),
- **who we think it's about** (with the person's name + the plain reason we think so — "the Maria in Denver you noted in June"),
- one-tap **Confirm** / **Assign to someone else** / **Discard**.

Nothing in To-Review has been written to a person yet. Clearing it is satisfying and fast (the Dex "checking off reminders is fun" insight), never a chore.

### Three confirmation levels (defines principle 2)
| Level | When | What the user experiences |
|---|---|---|
| **A — Passive confirm** | Confident: context-lock, OR strong-key match, OR ≥0.90 + corroborating context | A glanceable toast — "Saved to Maria ✓ · Undo" — and the item appears in her card's "recently noticed." Written immediately, fully reversible, **seen** but not interrupting. |
| **B — To-review** | Ambiguous (0.60–0.90), or parse uncertainty, or two names co-occur | Nothing written to a person; item lands in To-Review, badge increments. No interruption, nothing lost, nothing guessed. |
| **C — Eyes-free (car)** | Voice while driving | Spoken confirm — "Got it, saved to Maria, I'll show you later." If identity is confident → Level A behavior + the spoken line. If ambiguous → held in To-Review with a spoken "I'll ask you who that was when you've stopped." Never guessed. |

**Hard floor:** there is no level below A. A capture is never silent-to-the-eye. The lowest-friction path is still a visible, undoable confirmation.

**Gestures are separate and never auto:** confirmation levels govern *capturing what the user said*. They never govern *sending a gesture* — a gesture is always an explicit, deliberate user action (§8).

---

## 7. User-facing language (principle 4 made concrete)

The engine's vocabulary is banned from the UI. Mapping:
- facts/episodes → "Things you've noticed" / "What's going on lately"
- fact class / salience / decay → *(never shown)*; behavior is felt, not labeled
- confidence < threshold → a warm question ("Did I get this right — is her daughter starting college this fall?")
- retire/supersede → the old thing simply moves into her timeline/history; new thing shows as current
- entity resolution → "who is this about?" phrased as recognition ("the Maria in Denver?")

Tone throughout: a thoughtful friend who remembers, not a database that logs.

---

## 8. The gesture's last mile (don't strand them)

We refuse to auto-send (principle 1) — so *sending* must be effortless or we've made them thoughtful and then made the kindness a chore. After a plan/nudge produces a ready gesture:
- **Hand it over frictionlessly:** copy the note in one tap; open their mail or messages **pre-filled** with it; for a card/gift, a ready link. The user does the sending, in their own voice — we remove every step between "I want to" and "done."
- **"I reached out" marker:** a one-tap "done" that (a) feeds **self-snoozing** so we stop nudging about that moment, and (b) is a lightweight touch signal for "who's fading" (§9) — NOT an activity log, just enough to know they showed up.

---

## 9. Reminders / nudges

- **Opt-in, day-granular** ("sometime today," never "2 pm sharp").
- **Context-rich:** "it's been 3 months since Jane — last time she'd just started at Stripe." A bare "reach out to Jane" is a chore.
- **Self-snoozing:** if the user already reached out (an "I reached out" marker, a saved plan, or a capture referencing that person), the nudge quietly disappears.
- **Surface the fading person:** detect who the user is losing touch with (from touch signals, not activity logging) and serve them up, rather than making them configure "every 6 weeks" on 300 people (the #1 abandonment cause).
- Always routes through the human: a nudge produces a *ready gesture the user sends* (§8), never an auto-send.

---

## 10. First-run & the payoff loop (so early capture pays off immediately)

The build sequence brings the payoff forward so a new Pro never captures into a void:
- **Right after import:** show the win immediately — "3 of your people have a moment in the next two weeks" (from derived anniversaries + any dates) — *plus* the dead-list honesty ("40 have a date we can remind you about — add birthdays for your top few?").
- **After the very first voice/scan capture:** the person's card visibly gains what was just noticed, and if it created or neared a date, "Coming up" reflects it at once. Capture must produce a visible reward on the first try, or it feels pointless (the "week-three plateau" risk).
- **Empty Pro state (no imports yet):** one warm path — "Bring in the people you look after" (import) with a one-line promise, and the mic/add right there. Never a blank roster.
- **Per-person onboarding of the secret sauce:** when a person has thin context, a single gentle prompt — *"What do they mean to you?"* / *"Anything worth remembering about them?"* — answerable by voice or text, never a form, never for all 300 at once.

---

## 11. Entity model — people & households

Couples/families are the norm for planners, attorneys, some HR. Model: **two linked person records under an OPTIONAL household** — not one blended record (an attorney can't fuse a divorcing couple), not two orphans (loses the shared anniversary).

```
person
  id, owner_id, primary_name,
  emails text[], phones text[],   -- strong keys for resolution
  relationship, notes, location,
  contact_kind enum,              -- 'personal' | 'contact' (existing)
  household_id uuid null

household
  id, owner_id, label             -- "The Hendersons"

household_member
  household_id, person_id, role   -- "spouse" | "partner" | "child" | "co-founder" | null
```
- A fact/date attaches to a **person** ("Maria's birthday") or the **household** ("anniversary", "just moved"). Gesture engine reads the union.
- **Dissolving a household** (divorce, business split) deletes `household_member` rows only; both people and their full individual histories survive.
- HR/banker who only deal in individuals simply never use the household layer.

---

## 12. Entity resolution — the gate (never guess, never merge)

Run at capture, before writing, for the **quick-capture** path only (context-lock skips it):
1. **Strong-key match** (email/phone exact) → Level A passive confirm.
2. **Fuzzy name + context** (Jaro-Winkler/nickname-aware + shared household/employer/city/co-mention + recency) → a score.
3. **Thresholds:**
   - ≥0.90 + corroborating context → Level A.
   - 0.60–0.90 → **Level B (To-review)**; the "Did you mean…?" shows the *evidence that drove the guess* — showing our reasoning is what makes it feel magical, not creepy.
   - <0.60 → new person; two names co-occur ("Dave and Maria") → household flow ("link Dave and Maria as a household?").
4. **Bias to split, not merge.** A false split (a duplicate) is recoverable; a false merge can send a gesture to the wrong person. Store the match decision + score + evidence for audit.

---

## 13. Filling gaps WITHOUT user input — the honest boundary

- ✅ **Derive from the user's own uploaded data** (import columns → anniversaries/birthdays).
- ✅ **Smart-moment prompting:** when we nudge about a date but context is thin, ask for *one* small thing then; after import, prompt for the *handful they interact with most*.
- ❌ **No external/public-source enrichment** (principle 5).
- ❌ **No inferring facts from nothing** — every fact traces to a `source`.

---

## 14. Privacy & trust

RLS-locked per owner (existing). Extract-and-discard for images AND email bodies. Provenance + confidence on every fact. Memory fully visible/editable/**user-deletable**/exportable; never paywalled. Intimate third-party data governed by temporal decay so it never resurfaces awkwardly.

---

## 15. Acceptance criteria (hard gates)

- [ ] No gesture is ever sent without an explicit user action. (P1, §8)
- [ ] No capture is silent-to-the-eye; the floor is a passive, glanceable, undoable confirmation. Ambiguous identity/parse lands in To-Review, never guessed. (P2, §6)
- [ ] A "To review" surface exists with confirm / reassign / discard; nothing is written to a person until confirmed except Level-A confident captures (which are shown + undoable). (§6)
- [ ] Users can edit, **hard-delete** (overriding retire), and export any fact/person. (P3, §4)
- [ ] Engine vocabulary (fact class, confidence, salience, supersede) never appears in the UI. (P4, §7)
- [ ] Scanned images are never persisted; only extracted data is stored. (P6, §5b)
- [ ] Forwarded email bodies are extracted then purged (≤24h encrypted dead-letter max); user is told this. (P6, §5c)
- [ ] No fact is stored without a `source`; no external enrichment path exists. (P5, §13)
- [ ] Episodic facts stop generating nudges after their window but remain in the timeline. (§3)
- [ ] Voice leads but every voice action has an equal typed/tap path; spoken disambiguation caps at 2–3 then narrows or defers. (§5a)
- [ ] Context-lock is being-on-a-person's-card, not a mode toggle. (§5)
- [ ] The gesture last-mile (copy / pre-filled send / "I reached out") is one tap. (§8)
- [ ] First capture and post-import both produce an immediate visible payoff. (§10)
- [ ] No two people are ever merged without explicit user confirmation; thresholds bias to split. (P7, §12)

---

## 16. Open decisions for David

1. **Pro front door = a voice-forward agenda / "who's coming up & who's fading" feed, replacing the roster list as the landing view?** (Recommended: yes.)
2. Confirm household `role` vocabulary is enough (spouse/partner/child/co-founder/none).

*(Both are non-blocking for build start; the Architect can proceed and surface them as branch points.)*

## 17. Build sequence (payoff brought forward)

1. **Memory spine** (facts/episodes, dates, provenance, decay, supersession, households, user delete/export) — everything feeds this.
2. **Capture lifecycle + To-Review surface + confirmation levels** — the connective tissue; nothing ships without it.
3. **Voice** capture + conversational front door (find→lock→update hero flow, eyes-free caps).
4. **Payoff loop** (Coming up + first-capture reward + post-import win) — early, not last.
5. **Import** dead-list fixes (derive anniversaries + smart-moment prompts).
6. **Scan** (extract-and-discard).
7. **Email** forward (SendGrid, per-user address, extract-and-discard).
8. **Nudges:** surface-the-fading-person + context-rich, self-snoozing; gesture last-mile.

Typed + context-lock available throughout.
