# Spec — TC-82 Phase 2 (TC-51 tree): the SPOKEN advisor conversation

**Author:** Architect · 2026-08-05
**Ticket:** TC-82 Phase 2, reconciled into the TC-51 voice tree. Builds on Phase 1 (typed converse, live) + Phase 3a/3b (memory, live).
**Slice:** Voice-wraps the EXISTING conversation. The `converse` endpoint, the chat UI, and the ready→generate plan handoff are UNCHANGED. This is client orchestration of spoken turn-taking around them, reusing the existing voice stack.

## Goal
"Just like people come to talk to Claude, they come to get advice from her." Today the conversation is typed only. Phase 2 lets a user **talk with her out loud**: she speaks, they speak back, multi-turn, hands-free, until she has enough — then the plan renders. Same advisor mind, now spoken.

## What already exists (reuse — do NOT rebuild)
- **`/api/transcribe`** — POST `{ audio(base64), mime }` → Whisper transcript. Rate-limited, key server-side.
- **`/api/speak`** — POST `{ text }` → OpenAI gpt-4o-mini-tts "nova", warm/gentle. **MAX_CHARS = 400.**
- **Client (index.html):** `startHomeVoice()` (entry: `unlockSpeech()` iOS-prime + `warmVoiceFns()` + sets `__voiceHandsFree`), `beginHomeRecording`/`beginConfirmRecording` (record → silence-detect → `/api/transcribe` → text), the TTS playback path (`/api/speak` → primed `<audio>`, `__ttsCtrl` AbortController), `voiceAllowedClient()`/`voiceAudience` gate (TC-60), and the **feedback-loop guard** (open the mic only AFTER her playback ends).
- **The conversation (Phase 1):** `openConverse`, `cvAppend`, `cvTurn` (→ `/api/converse` → reply/ready), the escape, and `ready`→`generate()`.

## The Phase 2 loop (voice mode)
1. **Entry:** the home **"Say it out loud"** mic. Today it does record→transcribe→reflect→**one-shot** plan. Repoint it to open the conversation in **voice mode** (`openConverse(..., { voice:true })` or a sibling `openConverseVoice()`), reusing the same chat surface as the visual transcript. (This upgrades the current one-shot voice behavior to the multi-turn conversation; it does not conflict with the unbuilt TC-61 intent-routing, which can layer on later.)
2. **She opens, spoken:** show her opener bubble AND speak it via `/api/speak`. (The opener is short, well under 400 chars.)
3. **Turn-taking loop (hands-free), strictly gated by the feedback-loop guard:**
   - **After her playback fully ends**, open the mic (reuse `beginConfirmRecording`'s record + silence-detection + transcribe). Never record while she's speaking.
   - Transcript → show as the user's bubble → send as the user turn to `/api/converse` (same call `cvTurn` makes).
   - On `reply`: show her bubble AND speak it (`/api/speak`). When playback ends → reopen the mic. Repeat.
   - On `ready`: speak a brief handoff line ("Let me put this together."), then hand off to `generate()` exactly as the typed flow does. (Reading the PLAN aloud is TC-67 territory — OUT of scope; the plan renders visually.)
4. **Escape / stop:** the user can end by voice ("that's enough, make my plan" → converse returns ready) AND via a visible tap control (reuse the "make my plan" escape). Both must work; hands-free users need a spoken exit, tap users a button.
5. **Typed fallback within voice mode:** the typed input stays available — a user can type a turn at any time (drives the same `cvTurn`). And a clear way to drop from voice to typed (e.g., stop listening).

## Guardrails (the crux — voice is failure-prone)
- **Feedback-loop guard (load-bearing):** the mic opens ONLY after her TTS playback ends. Reuse the existing guard; never listen over her own voice.
- **iOS/cold-start:** prime audio on the entry tap (`unlockSpeech`) and warm the functions (`warmVoiceFns`) so the first spoken turn isn't a cold start; chunk/fast-start playback as the existing code does.
- **Interruptible:** if the user taps to stop or types, abort in-flight TTS (`__ttsCtrl`) and any recording cleanly (`cancelHomeRecording`/`stopConfirmListen`). No overlapping audio or hung mic.
- **Graceful degradation:** a transcribe or speak failure must not break the conversation — fall back to the visible bubble / typed input, with a calm message. A failed turn is retryable.
- **Gating:** the voice conversation is gated by the existing `voiceAudience` (TC-60). If voice isn't allowed for the user, "Say it out loud" stays hidden/typed-only (current behavior).
- **`/api/speak` 400-char cap:** her conversational replies are 1-3 short sentences (usually < 400). If a reply exceeds the cap, either (a) speak the first ~400 chars / first 2 sentences while showing the full text in the bubble, or (b) chunk into sequential speak calls. Builder's call; prefer the simplest that never truncates the *visible* text. (A small server bump to the cap for this path is acceptable if needed, but treat a cap change as a change to flag — the endpoint is shared with the TC-67 readback.)
- **Cost/rate limits:** transcribe (30/10min) + speak (80/10min) per-IP limits already exist. A multi-turn spoken conversation uses several of each — confirm the limits are generous enough for a real conversation (~6-10 turns) and note if they need raising (flag, don't silently change a shared limiter).
- **No new PII/logging:** voice audio is not stored (transcribe already discards it); don't log transcripts.

## Explicitly OUT of scope
- Reading the finished PLAN aloud (TC-67).
- Voice-driven "add/update a person" intent routing (TC-61/62) — the mic here goes to the advisor conversation → plan.
- Barge-in / interrupting her mid-sentence (MVP = strict turn-taking); can be a fast-follow.
- Any change to `converse`, the plan engine, or memory.

## Phasing within Phase 2 (Builder may slice)
1. **2a — the spoken loop MVP:** entry → she speaks opener → hands-free turn-taking (guarded) → ready → plan. Gated. This is where it's won or lost (latency, the feedback guard, turn-taking feel).
2. **2b — robustness polish:** interruptions, degradation messages, the >400-char handling, exit-to-typed, mobile/iOS pass.

## Files likely touched
- `public/index.html` — repoint "Say it out loud" to the voice-mode conversation; the voice turn-taking loop around `cvTurn` (reusing `beginConfirmRecording` + the `/api/speak` playback + the feedback-loop guard); speak her opener + replies; spoken/tap escape; typed fallback.
- Possibly `netlify/functions/speak.mjs` — ONLY if the 400-char cap needs raising for her replies (flag as a shared-endpoint change, don't silently change).
- Tests: mostly manual/live (voice is hard to unit-test). Add any pure-helper tests where logic is extractable (e.g., the >400-char chunker, the ready-detection). Real verification is a hands-on device pass (UX + a signed-in/mobile check).

## Definition of done
- From the home "Say it out loud" mic, the user has a real spoken, multi-turn conversation with her (she speaks, they speak, hands-free), and it produces the same personalized plan the typed flow does.
- The feedback-loop guard holds (never records her own voice); iOS/cold-start primed; interruptible; degrades gracefully to typed on any voice failure.
- Gated by `voiceAudience`; typed "Talk it through" flow unchanged; `converse`/plan/memory unchanged.
- Passes independent UX (the spoken turn-taking feels natural, warm, not awkward or laggy; the guard/latency are right) and an independent Validator (no feedback-loop/hung-mic/overlapping-audio bugs; graceful degradation; rate-limit/cap handling; no regression to the typed flow or the existing home-voice/readback paths). Given voice's device-dependence, a real mobile/iOS pass is part of DoD (may fold into TC-76).
