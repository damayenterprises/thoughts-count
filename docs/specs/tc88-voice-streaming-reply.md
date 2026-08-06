# Spec — TC-88: streaming voice reply ("speak as she thinks")

**Author:** Architect · 2026-08-06
**Ticket:** TC-88 (voice 2b). The single biggest lever for making the spoken conversation feel conversational instead of slow.

## The problem (device-confirmed)
The spoken turn is fully SEQUENTIAL: user stops → 2s listen settle → she generates her ENTIRE reply (dead air, nothing happens) → the audio for the whole reply is made → then she speaks. She waits for the complete thought before saying a word. David: "that's not conversational, that's slow and frustrating; she should listen and then start talking as it begins typing out."

## The fix
**Stream her reply and speak it sentence-by-sentence as she generates it.** The moment her first sentence exists, she starts saying it aloud WHILE the rest is still being written and while later sentences' audio is being generated. This overlaps generation with speech and collapses the dead-air gap. The 2s listen stays (David wants her to listen fully — err toward listening). This only attacks the delay AFTER the user has finished speaking.

Scope: VOICE path only. The typed "Type it out" conversation and everything else (plan, memory, `ready`/generate handoff) stay UNCHANGED.

## Current state to build on
- `netlify/functions/converse.mjs`: one non-streaming Anthropic call with `tools:[reply, ready]` + `tool_choice`, returns the full reply (`{action:"reply", say}`) or `{action:"ready", answers}`.
- Client voice loop (`public/index.html`, from Phase 2 2a): `cvTurn` → `/api/converse` → `cvSpeakThenListen(d.say)` → `speakPrompt()` (which already chunks the text via `splitForSpeech`, generates chunks in parallel, plays in order, starts on the first ~0.5s). The feedback-loop guard opens the mic only after playback fully ends. `cvStopVoice` aborts TTS + recording on every exit.

## Design

### Server: a streaming reply mode (voice only)
- The voice path sends `stream:true` in the `/api/converse` request. Only then does converse stream; without it, behavior is byte-identical to today (typed path unchanged).
- On `stream:true`: call Anthropic with `stream:true` + the SAME `tools`/`tool_choice`. Parse the SSE:
  - For the `reply` tool, the `say` value arrives via `content_block_delta` `input_json_delta` (partial JSON). Accumulate it and incrementally extract the growing `say` string. Whenever a COMPLETE SENTENCE has formed (sentence-ending punctuation at a safe boundary), emit it to the client immediately.
  - Return a STREAMING response to the client (a `ReadableStream` / newline-delimited JSON events). Events:
    - `{t:"say", text:"<one sentence>"}` — emit as each sentence completes.
    - `{t:"reply_done"}` — end of a reply (all sentences sent).
    - `{t:"ready", answers:{...}}` — if she called `ready` instead (no speech; hand to plan). Emit once at end.
    - `{t:"error"}` — on failure (client degrades).
  - Humanize each emitted sentence with `humanizeText` (same as today) before sending.
- Netlify streaming: a spoken reply is 1-3 short sentences and streams in a few seconds — within limits. Still, guard: if the model stream stalls, end cleanly (don't hang the response); the client also has its own timeout.
- Keep the non-stream path exactly as-is for typed. Consider factoring the shared setup (system prompt, messages, tools) so both modes reuse it.
- IMPLEMENTATION NOTE for the Builder: extracting a growing string from streaming tool-JSON is fiddly. Two acceptable approaches — (a) accumulate `partial_json` and tolerant-parse the `say` string value so far, emitting on sentence boundaries; or (b) if cleaner/more reliable, use a non-tool streamed TEXT reply for the VOICE path with `ready` decided by a lightweight rule/sentinel — BUT only if it keeps her reply behavior identical to the tool path and reliably detects ready. Prefer (a) to keep one converse brain; choose (b) only if (a) proves unreliable, and flag the choice. Sentence-splitting should reuse/`splitForSpeech`-style logic and never split mid-word.

### Client: speak each sentence as it streams (a speak-queue)
- The voice turn calls the streaming endpoint and reads the event stream.
- Maintain a **sequential speak-queue**: each `{t:"say", text}` event → append the sentence to her chat bubble (growing) AND enqueue it for TTS. The queue plays sentences strictly in order, one after another (never overlapping — no talking over herself). Reuse `speakPrompt`/the existing `/api/speak` chunked playback per sentence, or a per-sentence variant.
- She starts speaking sentence 1 as soon as it arrives (while sentence 2 is still streaming/being generated) — the core win.
- On `{t:"reply_done"}`: once the queue has drained AND the last sentence's playback fully ends → open the mic (the feedback-loop guard now keys off "all queued speech finished", not a single utterance). 
- On `{t:"ready"}`: stop the voice loop, speak a short handoff, hand to `generate()` (unchanged).
- `speakSafeText`/the 400-char cap applies per sentence (sentences are short; fine).

## Guardrails (the crux — streaming + audio is failure-prone)
- **Feedback-loop guard STILL holds:** the mic opens ONLY after ALL her queued speech has finished playing (not after the first sentence). Never record while any sentence is still playing or queued.
- **No overlap / no talking over herself:** the speak-queue is strictly sequential; a new sentence waits for the previous to finish. One audio at a time.
- **Interrupt/abort:** `cvStopVoice` (typed turn / Stop voice / make-my-plan / close) must now ALSO abort the in-flight stream (an AbortController on the fetch), clear the speak-queue, and stop current TTS + recording. Idempotent. No orphaned stream, no audio after stop.
- **Can't hang:** a stalled stream must end (server-side stall guard + a client read-timeout); if the stream dies mid-reply, degrade — speak what arrived, or fall back to typed with a calm message; the turn is retryable.
- **Graceful degradation:** if the streaming endpoint errors, fall back to the existing non-streaming path (or typed) — never break the conversation.
- **No regression:** typed path (no `stream:true`) is byte-identical; the non-stream converse response shape unchanged; plan/memory/`ready` handoff unchanged.
- **Cost/limits:** streaming uses the same Anthropic call (one per turn) + the same per-sentence `/api/speak` calls (a 3-sentence reply = 3 speak calls, similar to today's chunking). Within the existing rate limits; flag if a concern.

## Explicitly OUT of scope
- Barge-in (interrupting her mid-sentence) — still strict turn-taking.
- Streaming the TYPED conversation (no need; typing has no audio latency).
- Any change to the plan engine, memory, or the converse "brain" (system prompt / ready logic).

## Files likely touched
- `netlify/functions/converse.mjs` — add the `stream:true` streaming mode (Anthropic stream + SSE/NDJSON out); keep non-stream path intact; factor shared setup.
- `public/index.html` — voice loop: call the streaming endpoint, the sentence speak-queue, mic-after-all-speech, abort-the-stream in `cvStopVoice`, degradation.
- Tests: pure helpers where extractable (the sentence-boundary splitter; the "should open mic (queue drained)" predicate). Streaming/audio itself is device-verified.

## Definition of done
- In a spoken conversation, she begins speaking her first sentence within ~1s of finishing her thought's start (as it generates), not after the whole reply — the dead-air gap is gone and it feels conversational.
- The feedback-loop guard still holds (mic only after ALL speech ends); no overlap/talking-over-herself; interrupt/stop aborts the stream + audio cleanly; no hang; degrades gracefully.
- Typed flow + plan + memory + ready handoff unchanged.
- Passes independent UX (verifiable: the streaming wiring, no-regression, degradation; the felt latency is David's device call) + independent Validator (stream lifecycle: no hang, no overlap, abort correctness, feedback-loop guard keyed on queue-drained, no regression). Real feel = David on the preview URL.
