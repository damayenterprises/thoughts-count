# TC-62 — Value-first anon voice flow + magic-link round-trip preserves the request

**Architect spec.** Builder's only input — execute without further context.
Ticket priority: **Urgent**. Depends on shipped TC-60 (gate), TC-51 slice 1 (talk→plan), TC-61 (remember-by-voice, signed-in).

---

## Feature: Value-first anon voice + request-preserving sign-in
## Goal: An anon visitor can speak, get a one-off plan with no account, AND — if they want to *remember* a person — is invited to sign in framed as safekeeping (never a wall), with their spoken request held across the magic-link email round-trip and auto-completed on return, landing on "[Name] is on your list" rather than a blank home.

---

## What already works (do NOT rebuild — verify it stays intact)

- **Anon → plan is already value-first and unwalled.** `startHomeVoice()` (index.html:904) is not gated by sign-in; `renderHomeReflect()` (index.html:1029) shows anon users "Yes, make my plan →" → `startPlanFromText()` (index.html:1073), which requires no account. **This is the guardrail "if they decline sign-in, still deliver the one-off plan" — it must keep working.**
- **Signed-in remember-by-voice works** (`rememberFromText` index.html:1088 → `capturePreview`/`captureConfirm` in companion.js:148-153 → confirm cards → `renderRememberDone` "[Name] is on your list").
- **The voice gate** (`voiceAllowedClient`, TC-60) already controls whether the mic shows at all. TC-62 changes nothing about the gate.

## The two real gaps TC-62 closes

- **Gap A — anon has no "remember" path.** `renderHomeReflect` sets `canRemember` = signed-in only (index.html:1037), so the "Remember this about them →" button never renders for anon. Anon users can't even *express* the intent to remember someone.
- **Gap B — the magic-link return does not resume the request.** On a genuine magic-link return, `boot()`'s SIGNED_IN handler (companion.js:136) calls `openHome()` — lands on "People I care about" (empty for a brand-new account), NOT on the completed remember action. The spoken transcript + intent are lost.

---

## Architecture

### Components involved
- `public/index.html` — voice front-door flow (reflect screen, remember flow, plan-from-voice). Owns the transcript + the remember UI.
- `public/companion.js` — Supabase auth, magic-link send (`signInWithOtp`), SIGNED_IN handling, the modal. Owns the account + the round-trip.
- **New shared contract:** a small `pendingVoice` stash (localStorage) that survives the email round-trip, plus a handful of `window.*` bridges so companion.js (auth) can hand control back to index.html (voice UI) on return.

### Data flow (the round-trip)
```
Anon speaks → transcribe → renderHomeReflect (now shows Remember for anon too)
   │
   ├─ taps "Yes, make my plan →"          → startPlanFromText   (unchanged, no account)
   │
   └─ taps "Remember this about them →"    → promptSignInToRemember(transcript)   [companion.js, NEW]
          │  warm safekeeping card: reflect the words back, frame sign-in as keeping them safe
          │  + a "Just make my plan instead →" decline  → startPlanFromText (guardrail)
          │
          └─ enters email → signInWithOtp({ emailRedirectTo: origin })
                 │  on send success: stashPendingVoice({ intent:'remember', transcript })  [localStorage, NEW]
                 │  show "check your inbox — open it on THIS device to pick up where you left off"
                 ▼
          ── email round-trip (same browser) ──
                 ▼
          boot() → getSession() (now authed) → onAuthStateChange SIGNED_IN + fromMagicLink
                 │  pend = consumePendingVoice()  (one-shot, TTL 30 min)
                 │  if pend?.intent === 'remember' && fresh:
                 │       closeModal(); window.tcResumeRemember(pend.transcript)   [NEW bridge]
                 │  else: openHome()   (today's behavior — safe fallback)
                 ▼
          tcResumeRemember → opens flow scrim → rememberFromText(transcript)
                 → capturePreview (now authed) → confirm card(s) → save
                 → renderRememberDone: "[Name] is on your list."   ✅ lands on the payoff
```

### API contracts
- **No new server endpoints.** Reuses `/api/transcribe`, and the existing RLS-locked capture engine (`capturePreview`/`captureConfirm` via companion.js). The capture engine only works signed-in (RLS) — which is exactly why anon stashes the *raw transcript* and the extract→resolve→confirm→save runs *after* sign-in on return.
- **No Claude/Anthropic call added or changed** → no `prompts/` file needed (project has no prompts/ dir; nothing in scope touches the model).

### The stash (client-only, the user's own words on their own device)
- Key: `tc_pending_voice`. Value: `{ v: 1, intent: 'remember', transcript: <string>, ts: <epoch ms> }`.
- **TTL 30 minutes** (magic links are short-lived). Read is **one-shot**: `consumePendingVoice()` reads, deletes, and returns null if missing/stale/malformed.
- Cleared on: consume, successful decline-to-plan, and version mismatch.
- Rationale: this is the user's own transcript on their own device — consistent with the client-only trust model, never pooled cross-user. Not a server object.

---

## Tasks (in build order)

- [ ] **Task 1 — Stash helpers (companion.js).** Add `stashPendingVoice({intent, transcript})`, `consumePendingVoice()` (one-shot, TTL 30 min, try/catch around all localStorage access so a blocked/absent store never throws). Export nothing globally — they're used internally by companion.js. — Files: `public/companion.js` — Depends on: nothing.

- [ ] **Task 2 — Bridges from index.html.** Expose `window.startPlanFromText` and add `window.tcResumeRemember(transcript)`. `tcResumeRemember` must: open the flow surface (scrim + `document.body.style.overflow`, mirror what `startHomeVoice` does at index.html:907) so the modal is visible on cold return, then call the existing `rememberFromText(transcript)`. Guard: if called with an empty transcript, fall through to `openHome()`-equivalent (do nothing harmful). — Files: `public/index.html` — Depends on: nothing.

- [ ] **Task 3 — Offer "Remember" to anon (index.html `renderHomeReflect`).** Change `canRemember` to always render the "Remember this about them →" button. Branch the onclick: signed-in → `rememberFromText(t)` (today); anon → `window.TCCompanion.promptSignInToRemember(t)`. Keep "Yes, make my plan →" as the primary/first CTA for anon (value-first ordering preserved). Copy tweak on the anon eyebrow/help so the screen reads warm ("Here's what I heard" stays; helper can invite either path). — Files: `public/index.html` — Depends on: Task 4 (needs `promptSignInToRemember` to exist on `window.TCCompanion`).

- [ ] **Task 4 — Safekeeping sign-in card (companion.js `promptSignInToRemember`).** New method exported on `window.TCCompanion`. Renders a modal variant of `openSignIn` that:
  - reflects the spoken words back warmly and frames sign-in as **safekeeping, not a gate** (e.g. eyebrow "Let me hold onto that", body "Sign in with just your email so I can keep them — and their dates — safe. No password.");
  - has the email input + send button (reuse the `signInWithOtp({ email, options:{ emailRedirectTo: location.origin } })` path from `openSignIn`, companion.js:228);
  - **on send success:** call `stashPendingVoice({intent:'remember', transcript})` BEFORE `renderCheckInbox`, and use a safekeeping-flavored inbox confirmation that adds one line: "Open the link on **this device** to pick up right where you left off.";
  - offers a **decline that is never a dead-end:** a "Just make my plan instead →" link → `window.startPlanFromText(transcript)` (and clear any stash). — Files: `public/companion.js` — Depends on: Task 1, Task 2.

- [ ] **Task 5 — Resume on magic-link return (companion.js `boot` SIGNED_IN handler).** In the `evt === "SIGNED_IN" && fromMagicLink` branch (companion.js:136), before `openHome()`: `const pend = consumePendingVoice();` if `pend && pend.intent === 'remember' && pend.transcript && window.tcResumeRemember` → `closeModal(); window.tcResumeRemember(pend.transcript); return;`. Otherwise keep today's `closeModal(); openHome();`. Defensive: if `tcResumeRemember` is somehow not yet defined, fall back to `openHome()` (never leave the user on a blank screen). — Files: `public/companion.js` — Depends on: Task 1, Task 2.

- [ ] **Task 6 — Lightweight, PII-free analytics.** Fire-and-forget via the existing `tcTrack` (index.html) / event path — NO transcript, NO names. Events: `voice_remember_signin_prompted` (Task 3 anon tap), `voice_remember_signin_sent` (Task 4 send success), `voice_remember_declined_to_plan` (Task 4 decline), `voice_remember_resumed` (Task 5 resume fires). These feed the launch-readiness read on whether the round-trip actually completes. — Files: `public/index.html`, `public/companion.js` — Depends on: Tasks 3–5.

---

## Edge Cases & Risks

- **Cross-device round-trip (accepted limitation).** If the user opens the magic link on a *different* device/browser than they spoke on, localStorage doesn't carry the transcript → `consumePendingVoice()` returns null → falls back to `openHome()` (warm "People I care about", empty). This is **not a dead-end**, just not auto-resumed. Mitigated by the inbox copy ("open on this device"). A server-side stash keyed by email would fix cross-device but (a) stores a raw pre-account transcript server-side tied to an email, which raises a trust/PII surface, and (b) is materially more work. **Recommendation: ship localStorage/same-device for v1; do NOT build the server stash unless David asks.** Same-device (phone speaks → phone opens the email link) is the overwhelming common case.
- **Stale stash.** TTL 30 min + one-shot consume prevents a week-old transcript from resurrecting on a future unrelated sign-in. Verify: sign in normally (no pending) → lands on Home, never a phantom resume.
- **SIGNED_IN re-fires.** Supabase re-fires SIGNED_IN on session restore/tab refocus; the existing `fromMagicLink` one-shot flag (companion.js:117, consumed at :136) already guards this. Resume must sit INSIDE that `fromMagicLink` guard so a refocus never re-triggers a resume.
- **Empty/garbled transcript on return.** `rememberFromText` already handles no-captures via `renderRememberEmpty` (offers "make a plan instead"). Resume inherits that graceful path.
- **`window.tcResumeRemember` timing.** index.html's inline script defines the bridges synchronously at parse; companion.js is a deferred module whose auth resolves async — so the bridge exists before SIGNED_IN fires. Task 5's defensive fallback covers any ordering surprise.
- **Decline must clear the stash** so a later legitimate sign-in doesn't resume a request the user abandoned in favor of a plan.

---

## Out of Scope

- **Plan generation is never gated and does not round-trip.** A plan needs no account; only the *remember* intent round-trips. Do not add sign-in in front of any plan path.
- **Server-side / cross-device transcript stash** (see Risks) — not built unless David requests.
- **Hands-free voice "yes" confirm** — that's TC-63, the next ticket. Confirm here is still a tap.
- **Update/plan intent routing on the home mic** (add vs update vs plan disambiguation) — that's TC-61's slice already shipped / TC-51 territory; TC-62 only adds the anon-remember + round-trip, riding the existing reflect→remember flow.
- No changes to the voice gate (TC-60), the capture engine, or any server function.

---

## UX Phase: RUN
Touches on-screen flow and copy: a new safekeeping sign-in card, the anon reflect screen gains a second CTA, and the round-trip return lands on a new state. The trust framing ("safekeeping not a gate", "never a silent dead-end") is load-bearing and exactly what the UX Reviewer should gate. David confirms.
