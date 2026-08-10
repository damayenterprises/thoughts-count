# Spec — TC-93 (person-aware voice conversation + one voice) & TC-94 (type-in code sign-in)

**Architect:** Agent 1 of the pipeline. This is the Builder's only input — build from it without further context.
**Author date:** 2026-08-09. **Target:** deploy to prod TONIGHT as phone-tested increments.
**Branch:** cut a feature branch off `main` (do NOT build on `main`; deploy is manual — merge → `netlify deploy --prod` → verify → push).

> **THE RULE (read first, applies to build AND review):** design and review START at the home page doing the obvious thing — **talk**. The natural voice path (`home → "Say it out loud" → speak`) must work end-to-end on the running app before anything ships. If the capability doesn't fire on that path, it's a BLOCKING miss (this is exactly how TC-89/91 shipped a full day of work that did nothing for David). See memories `feedback_ux_reviewer_real_user_path`, `feedback_tc_voice_first_autonomous`, `feedback_tc_one_voice`.

---

## Background: the exact gap

`netlify/functions/converse.mjs` is the brain behind the home **"Say it out loud"** conversation. It receives an optional `context` object ONLY when a conversation is *launched from* an already-picked saved person. On the natural home path `flowPerson` is `null`, so `context` is `undefined`, and **converse never touches the roster and does no person resolution at all.** It also takes **no auth token**.

The deterministic matching engine we must REUSE is fully built + tested and lives in:
- `netlify/functions/_names.mjs` — `firstNamesEquivalent`, `sameSurname` (owns the Jon/John homophone + diminutive + length-floor rules).
- `netlify/functions/_capture.mjs` — `resolvePerson(supa, userId, name, {fallbackFirstName, locationHint})` (the verdict), `recognizableDetail(supa, userId, personId)` ("your close friend" / "in Denver" / most-recent fact), `rosterNames(supa, userId)` (bounded 200-cap read).
- `netlify/functions/resolve-name.mjs` — the authed, READ-ONLY endpoint that already wraps `resolvePerson` + `recognizableDetail` and returns `{kind:'match'|'ambiguous'|'none', person?, candidates?}`.

**Do NOT rebuild any matching logic.** The whole build is: make the home conversation person-aware by wiring these in.

**Proven pattern to copy:** `netlify/functions/transcribe.mjs` already does exactly the "optional sign-in → load roster" dance we need (`requireUser` → if anon, skip; if signed in, `rosterNames(serviceClient(), userId)`). Mirror it.

---

## David's decisions (locked this session)

1. **How Della resolves WHO = BOTH (hybrid).** She *knows the circle up front* (roster + one detail each, primed into the conversation so the common "which Marc?" is instant, one pass, no latency cost) AND has a *precise checker* (the deterministic engine) she reaches for on the tricky cases only.
2. **Speed is the bar — Siri/Alexa.** Non-negotiable. See the Performance section. The primed roster carries the common case at full conversation speed; the precise-checker tool costs one extra short round-trip and must fire ONLY when it genuinely matters (near-spelling / same-name ambiguity), never on every name.
3. **Ship all of it** tonight, but as independently-shippable, phone-tested increments (build order below) so a late-night snag on the hardest piece can't sink the whole night.
4. **The "…add to someone you already know" picker stays but is NOT primary and NOT required.** It's fine for someone who wants to jump straight to a person, or make a quick update/check. The conversation must do everything by voice; the picker is a convenience, not the mechanism.
5. **One voice everywhere.** Audit every surface Della speaks/writes; single-source how she SOUNDS (already `nova` via `/api/speak`, no browser-speech fallback — verify) and how she TALKS (one persona via `_persona.mjs`).

---

## Feature 1: TC-94 — type-in code sign-in
## Goal: An iPhone home-screen-app user can sign in by typing the emailed code, landing signed in *inside the app* (not bounced to Safari) — which is also the prerequisite for David to test everything else on-device.

### Architecture
- **Frontend-only.** The sign-in email already contains an 8-digit code token (confirmed 2026-08-09). No backend change for the returning-user path.
- Files: `public/companion.js` only (plus its CSS in `public/index.html` if needed for the new field).
- Both sign-in surfaces get a code path: `openSignIn()` (~line 323) and `promptSignInToRemember(transcript)` (~line 382). Both currently ONLY call `sb.auth.signInWithOtp({ email, options:{ emailRedirectTo } })` and then `renderCheckInbox(email)` which says "open it from your email."
- After a link is sent, `renderCheckInbox(email, opts)` (~line 355) is where the user waits. Add a **"Enter the code from your email"** field + verify button here. Lead with the code for home-screen users (it's the whole point of the ticket) while keeping the link as the secondary option.
- Verify calls `sb.auth.verifyOtp({ email, token, type: 'email' })`.

### Post-sign-in routing (critical — must match link behavior)
The magic-link return routing lives in `onAuthStateChange` (~line 221) and is **gated on `fromMagicLink`**, which is FALSE for a typed code (no tokens in the URL). So the code-verify success path must run the **same routing explicitly** rather than relying on that gate:
1. On `verifyOtp` success, `consumePendingVoice()`. If a pending "remember" request exists (TC-62), `closeModal()` + `window.tcResumeRemember(pend.transcript)` and land on "[Name] is on your list".
2. Otherwise `closeModal()` and stay on the **main page** (TC-92 — do NOT auto-open "People I care about").
Factor this shared post-sign-in routing so both the link path and the code path call the identical logic (avoid drift).

### New-user (signup) edge — PROPOSE, don't apply
For a brand-new email, `signInWithOtp` (shouldCreateUser default) sends a **signup confirmation** email, whose template was NOT confirmed to carry the code token on 2026-08-09.
- The Builder must verify (read-only) whether the signup/confirmation email template includes the code token.
- **If it's missing, that is a small infra change to the confirmation email template — PROPOSE it to David (write it up, do NOT apply).** Per `feedback_agent_infra_guardrail`, no auth/template change is applied without David's approval routed through the pipeline.
- Test BOTH: a returning user (has account) and a new email, so we know the code path works for signups or we've flagged the gap.

### Acceptance criteria
- On the running app, request a sign-in, type the code, and you are signed in **in the same context** (verified on David's real iPhone home-screen app — signed-in state persists inside the app, no Safari hop).
- Returning-user sign-in works (MANDATORY live returning-user test — `feedback_auth_frontdoor_live_test`).
- After code sign-in: no pending request → land on main page; pending "remember" → resumes correctly.
- The magic link still works unchanged.
- New-user path either works or the template gap is written up as a proposal for David.

---

## Feature 2: TC-93 — the home conversation becomes person-aware
## Goal: When you name or refer to someone mid-conversation ("my friend Mark"), Della recognizes who you mean, and confirms WHO by voice with a recognizable detail whenever there's any doubt — smoothly, at conversation speed — all inside the talk, never a picker or a typed name.

### Architecture (hybrid: primed roster + precise-checker tool)

**A. Client — send the auth token on the conversation calls.**
`public/index.html` calls `/api/converse` in three places: the streaming voice turn (`cvStreamReply`, ~line 2044), the non-stream voice fallback (`cvFallbackReply`, ~line 2126), and the typed turn (`cvTurn`, ~line 2336). None send an `Authorization` header. Add `Authorization: Bearer <token>` from `window.TCCompanion.authToken()` to all three (copy the exact guarded pattern already used for `/api/transcribe` at ~lines 1080, 1483, 2876). This lets the server load the roster for a signed-in user **on the home path even when `flowPerson` is null** (the case David hit). Leave `cvBuildCtx()` unchanged — `context` stays "the one person in focus, if any"; the auth token is separately "awareness of everyone."

**B. Server — optional auth + a cheap roster read for the prompt.**
In `converse.mjs`, mirror `transcribe.mjs`: call `requireUser(req)`. Anonymous / invalid token → behave exactly as today (no roster, no tools beyond reply/ready — byte-identical to current anon behavior). Signed in → load a **prompt-sized roster** and enable the precise-checker tool.
- Add a helper (new, in `_capture.mjs` next to `rosterNames`) `rosterForPrompt(supa, userId)` → `[{ name, detail }]` from **ONE** query: `people` (name, relationship, location), user-id pinned, undeleted, newest-first, capped at the existing `ROSTER_CAP` (200). Build `detail` inline from relationship→location (e.g. "your close friend", "in Denver", or "" if neither). **Do NOT call `recognizableDetail` per person here** — that's N queries and would blow the speed budget; the fact-based detail is only for the precise checker. One query, cheap.

**C. Server — prime the roster into the (cached) system prompt.**
Extend `systemPrompt(ctx)` (and therefore `systemForCache`, which already sets an ephemeral cache breakpoint) to include, for signed-in users with people, a ROSTER block, e.g.:
```
People this person has saved (use these to recognize who they mean; confirm WHO by voice whenever there is ANY doubt):
- Marc (your close friend, in Denver)
- John Miller (brother)
- ...
```
Plus behavior instructions in her voice-rules:
- When the user names or refers to a person, match against this list.
- Confident single match → proceed, but **confirm WHO by voice with the recognizable detail whenever there's any doubt** (a homophone like Mark/Marc, a same-name, or anything ambiguous): *"Marc, your close friend in Denver — or someone new?"*
- Not found / ambiguous / unsure of spelling → ask conversationally, by voice, to arrive at the right person (which Marc / a new person / the spelling).
- Adding a new person, updating an existing one, and talking-about all happen **inside the conversation**. Never tell the user to use a picker, "add someone," or to type a name.
- If a genuinely tricky/authoritative check is needed (near-spelling, or two people with the same name), call the `resolve_person` tool (below) rather than guessing.
The roster is inside the cached system block → **read once per conversation, not re-read every turn** (protects latency + cost). Keep the block to name + short detail only (no sensitive facts).

**D. Server — the precise-checker tool `resolve_person` (signed-in only).**
Add a third tool, offered ONLY when signed in:
- Name: `resolve_person`. Input: `{ name: string, relationship_hint?: string, location_hint?: string }`.
- When called: run `resolvePerson(serviceClient(), userId, name, { fallbackFirstName: true, locationHint })`, then enrich the matched person / each candidate with `recognizableDetail`. Return a compact tool_result:
  `{ kind:'match'|'ambiguous'|'none', person?:{name,detail,hasDetail}, candidates?:[{name,detail,location}], evidence }` — the SAME shape `resolve-name.mjs` already produces (reuse its logic; ideally factor a shared function so converse and `resolve-name.mjs` can't drift).
- After a `resolve_person` result comes back, Della composes and speaks the confirm/disambiguation line.
- **Bound to ONE hop:** after a `resolve_person` tool_result, the follow-up model call must offer only `reply`/`ready` (drop `resolve_person`) so she can't loop and latency stays bounded. Never more than one checker call per user turn.

**E. Server — make the tool round-trip work on BOTH paths.**
- **Typed (non-stream) path** (`export default`, ~line 593): if the returned `tool_use` is `resolve_person`, run the resolver, append `assistant(tool_use)` + `user(tool_result)` to `messages`, and make ONE more non-stream call with tools limited to `[reply, ready]`. Then handle reply/ready exactly as today. (Straightforward.)
- **Voice (stream) path** (`streamTurn`, ~line 369): in the SSE handler, if the active tool is `resolve_person` (not reply/ready), emit no speech; accumulate its input; when the block completes, run the resolver, append tool_use + tool_result, and **recurse once** into the same stream logic with tools `[reply, ready]`, streaming her spoken reply. Refactor the SSE-consume into a helper callable twice. The existing idle guard + the client's degrade-to-non-stream fallback (`cvFallbackReply`) cover failures — if the second call fails, the user just gets a normal reply.
- Keep `MODEL`, `humanizeText`, per-sentence emit, ready-distill, and `readyAnswers` unchanged.

**F. Writes stay deterministic + already-authenticated.**
No new write surface. When the conversation wraps (`ready`), the existing `rememberFromConversation()` bridge (client, ~line 268 of companion.js) still routes the user's turns through the authenticated capture pipeline (`requireUser` + service role + ownership check + `resolvePerson`) locked to the focused person. So even if the in-conversation model match were ever off, the **actual save is still gated by the deterministic engine** — a wrong person never sticks silently. Confirm this path is unaffected.

### Performance (the Siri/Alexa bar — David's explicit standard)
- **Knowing the circle (part 1):** the roster is name + one short detail each; even 125 people is ~a page of text, sits inside the cached system prompt (paid once per conversation, hidden behind her opening line), capped at the 200 most-recent. **No perceptible startup delay.** Do NOT add a separate "load contacts" step or a per-person `recognizableDetail` loop at prime time.
- **Finding a match (part 2):** the primed roster handles the common "which Marc?" with **zero** extra round-trip (one streaming pass, as fast as today). The `resolve_person` tool costs one extra short model round-trip — comparable to Siri's think-beat — and must fire ONLY on genuinely tricky turns, never on every name. If on-device the beat feels heavy, the fallback is to lean on the primed roster alone (still fires on the natural path).
- Voice is only judged real on David's iPhone. Keep him in the loop to test on-device before go-live.

### Acceptance criteria
- On the running app, signed in, starting at home and talking: say "I want to talk about my friend Mark" when a "Marc" is saved → Della confirms WHO by voice with a recognizable detail ("Marc, your close friend — or someone new?"). This is the David-scenario that must pass.
- Homophone/near-spelling (Jon/John) and same-name-more-than-one both get a spoken, conversational disambiguation — never a silent guess, never a picker.
- A brand-new name → she adds/handles it inside the conversation (no "use the picker" dead-ends).
- Anonymous home path is byte-identical to today (no roster, no tools, no regressions).
- Common naming turns stay at full conversation speed; the checker beat only appears on tricky turns.
- Typed conversation gets the same person-awareness as voice.

---

## Feature 3: TC-93 — one voice, one personality, one guide
## Goal: Every surface Della speaks or writes reads and sounds like the exact same person as the home page.

### Tasks
- **Sound — verify + guard (already true, lock it in):** all speech goes through `/api/speak` (OpenAI `nova`, `gpt-4o-mini-tts`); the client has **no** `speechSynthesis`/browser-voice fallback (confirmed — `ttsAvailable()` only checks `Audio`+`fetch`). Add a brief guard/comment so a future change can't silently reintroduce a robotic fallback. No behavior change expected; just verify + document.
- **Talk — confirm persona routing:** the conversation (`converse.mjs`) and the plan copy (`generate-background.mjs`) both already build their prompts from `_persona.mjs` (`herIdentity` + `HER_CHARACTER`). Confirm they still read as one person after the TC-93 prompt edits.
- **GAP — nudge/reminder emails are NOT in her voice:** `nudges-cron.mjs`, `reminders-cron.mjs`, and `_email.mjs` do not route through `_persona.mjs` — the emails she "sends" are templated copy, a different voice from the home page. Bring these into one voice: align the human-written lines + signature to Della's persona (route the copy through `_persona.mjs` where practical, or at minimum match tone + sign as Della). This is copy work; keep dates/links/reminder logic untouched. **This is the most deferrable piece — if the clock gets tight, ship Features 1, 2, 4 and this one falls to a fast-follow.**
- **Spoken/confirm UI strings — tone + AI-tell sweep:** audit the hardcoded conversation/confirm strings in `index.html` (openers, "Add to <Name>" confirm card, the "I can't hear you…" recovery lines, voice cues) so they sound like Della and carry no AI-tell punctuation (em/en dashes, curly quotes, ellipsis chars) — ties to `feedback_human_sendable_copy_no_ai_tells` and TC-83/85.
- **Reviewer gut-check for this feature:** "does this sound and read like the exact same person as the home page?" on every surface touched.

---

## Feature 4: TC-93 — demote the picker (keep it, don't require it)
## Goal: Voice is unmistakably the primary path; the picker remains available for someone who wants to jump straight to a person or make a quick update/check.

### Tasks
- Keep the second home door ("Choose from your people") and the "…add to someone you already know" link (`#cvAboutKnown` in `renderConverse`, ~line 1756, → `tcVoicePickPerson`) — do NOT remove them.
- Because Features 2 makes the conversation handle add/update/talk-about by voice, the picker is now a convenience, not the mechanism. Soften the in-conversation link copy so it reads as optional (e.g. lead with talking; the link is a quiet "or jump to someone"), and confirm nothing in the flow forces a user through it.
- Do NOT reintroduce any "you must add someone first" gating.

---

## Build order (each step independently shippable + phone-tested)
1. **TC-94 code sign-in** — first, it unblocks David testing everything else signed-in on his phone. Depends on: nothing.
2. **TC-93 primed roster** (Feature 2 parts A, B, C + F) — the person-aware conversation via the primed roster; one pass, no latency cost, fires on the natural path. This alone makes the David-scenario pass. Depends on: TC-94 (to test signed-in on device).
3. **TC-93 precise-checker tool** (Feature 2 parts D, E) — add `resolve_person` for the tricky authoritative cases; phone-test the beat. Depends on: step 2.
4. **One voice sweep + picker demotion** (Features 3 & 4) — can run alongside/after; the email one-voice piece is the deferrable tail. Depends on: nothing hard, but review after step 3.

If time runs out late tonight: steps 1–2 are the must-ship (they satisfy the core failure TC-93 was written to fix). Steps 3–4 fast-follow.

---

## Edge Cases & Risks
- **Streaming tool round-trip is the single biggest risk.** The primed roster (step 2) deliberately needs NO tool round-trip, so step 2 is safe even if step 3's stream recursion proves fiddly on-device. Keep them as separate commits so step 3 can be held back without losing step 2.
- **Latency creep** from `resolve_person` firing too often. The prompt must make it a last-resort authoritative check, not a per-name reflex. Watch the on-device beat.
- **Anon regression.** Signed-out home conversation must stay byte-identical. Test it explicitly.
- **New-user signup code** may not be in the confirmation email template — verify; if missing, PROPOSE the template change to David (do not apply).
- **Auth token freshness** on long conversations — `authToken()` reads the current session token; fine for a single conversation, and the server fails open to anon behavior if it's stale/absent.
- **Roster privacy** — only name + relationship/location go into the prompt; loaded server-side from a verified token; never expose more to the browser than it already holds.
- **Cost** — roster lives in the cached system block (paid once/conversation). `resolve_person` adds one short model call only on tricky turns. Acceptable.

## Ambiguities needing David (surface, don't guess)
- Signup/confirmation email template code token — if absent, the template edit is David's call (infra guardrail).
- If the `resolve_person` beat feels heavy on David's phone: fall back to primed-roster-only for tonight (his on-device judgment).

## Out of Scope
- TC-90 (mic re-asks permission every time on the saved app) — separate ticket, 2 phone tests pending.
- TC-91's existing capture-door work (already deployed) — we reuse it, don't touch it.
- Reading the plan aloud (TC-67) — unchanged.
- Any change to the deterministic matching rules themselves (`_names.mjs`) — reuse only.
- Rebuilding the picker (`tcVoicePickPerson`) — it stays as-is, just non-primary.

## UX Phase: RUN
The UX Reviewer gates this between Builder and Validator. This touches the on-screen conversation, the sign-in screens, and the primary flow. **The UX review MUST start at the home page and talk** (the TC-93 rule) as champion of the user — not check the diff or the picker door. Reviewer gut-checks: (1) does the person-awareness fire on the natural voice path? (2) does every surface sound/read like the exact same person as the home page? A capability that doesn't fire on the natural path is a BLOCKING miss.
