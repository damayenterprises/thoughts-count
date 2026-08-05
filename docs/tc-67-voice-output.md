# TC-67 — Voice output / eyes-free spoken confirmation (SHIPPED 2026-08-04)

Opt-in feature that turns Thoughts Count into a hands-free, **eyes-free** voice companion: the
app reads its replies aloud in a warm human voice and listens for spoken answers. Builds on
TC-63 (hands-free confirm) + TC-51/60/61/62 (voice front door). Merged to `main` `3f487c8`.

## User-facing
- **Opt-in toggle** "Read my replies aloud (hands-free)" on the "I'm listening…" screen.
  Per-device (`localStorage['tc_read_aloud']`), **OFF by default** — a personal note is never
  spoken unless the user turns it on (privacy: eyes-free usually means others are in earshot).
- **When ON**, end-to-end voice: "Talk it through" → speak a note → the *"Here's what I heard…"*
  reflect screen **speaks the readback and listens for the spoken choice** ("make a plan" /
  "remember this") → on remember, the add/update confirm card **speaks and listens for "yes"**.
- **TAP always works** alongside voice at every step; one gentle re-ask on an unclear answer,
  then it settles to the on-screen buttons.

## Server
- **`netlify/functions/speak.mjs`** (`/api/speak`): text → OpenAI **`gpt-4o-mini-tts`**, voice
  **`nova`**, warm/gentle steering `instructions` → `audio/mpeg`. `OPENAI_API_KEY` server-side
  (shared with transcribe). POST-only (GET → 405, used as a warm-ping). `VOICE_AUDIENCE` gate +
  per-IP rate limit (Blobs, 80/10min, fail-open) + 400-char cap. No injection/XSS (text→TTS only).
- **`transcribe.mjs`**: model `whisper-1` → **`gpt-4o-mini-transcribe`** (~2× faster, same
  `{text}` shape). Affects all voice input (intake dictation + this feature).
- Redirect `/api/speak` → `/.netlify/functions/speak` in `netlify.toml`.

## Client (`public/index.html`)
- **`speak.mjs` playback** via one reused `<audio>` element (`getTtsAudio`).
- **Chunked progressive playback** (`splitForSpeech` / `speakPrompt`): the line is split into
  short chunks, all generated in parallel, played in order — starts on the first short phrase
  (~0.5s) while the rest generate. Chosen over raw HTTP streaming, which iOS Safari fights.
- **iOS audio unlock** (`unlockSpeech`): primes the reused `<audio>` with `public/silent.mp3`
  inside the entry-tap gesture, so later programmatic plays aren't blocked by iOS.
- **Cold-start warming** (`warmVoiceFns`): GET-pings `/api/speak` + `/api/transcribe` on voice
  entry (throttled 20s; GET→405 so no cost) so the functions are warm by the time they're used.
- **Reflect voice-choice** (`reflectSpeakListen` / `onReflectAnswer` / `parseReflectChoice`):
  conservative — only a clear "plan"/"remember" routes; both/neither → one re-ask → buttons.
- Gating: `voiceReplyOn()` = `ttsAvailable()` && `readAloudEnabled()`. Default OFF reproduces the
  prior (TC-63/TC-62) behavior exactly.

## Trust-critical: no feedback loop
The mic (`beginConfirmRecording`) opens **only after playback fully ends** (`speakPrompt` onDone,
after all chunks, +300ms) — never during speech — so the app can never transcribe its own
"…say yes…" and false-save. Verified for both the confirm card and the reflect fork.

## Gotchas / decisions
- Browser `speechSynthesis` was rejected as too **robotic** for the brand.
- `tts-1-hd` with a `speed` param time-stretches the audio → an **echoey artifact**; avoided.
  `gpt-4o-mini-tts` paces naturally from the instruction = warm, no artifact.
- Ship gate: UX + Validator PASSED; opt-in + off-by-default; prod smoke all green.
