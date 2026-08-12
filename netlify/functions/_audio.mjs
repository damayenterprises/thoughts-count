// Thoughts Count — shared audio guard + posture for the voice paths (TC-106).
//
// One place that owns "what audio we accept and how big" so BOTH the live voice front door's
// transcribe endpoint (transcribe.mjs) and the voice-memo add-a-person door (capture-audio via the
// SAME /api/transcribe) reject junk the SAME way — BEFORE we ever spend a paid Whisper call. Mirrors
// the image door's ALLOWED_IMAGE_MIMES guard shape in _extract_image.mjs.
//
// Pure + dependency-free so the unit tests exercise the size/mime guard with no key, no network.

// Common voice-memo / recording containers. Includes the browser MediaRecorder default (webm/ogg),
// Apple Voice Memos (m4a → audio/mp4 / audio/x-m4a), and the workhorse mp3/wav. A bare octet-stream
// or a picker that reports "" is tolerated (some browsers report no type for a picked .m4a); the
// server still infers a safe extension by falling back to a generic container OpenAI accepts.
export const ALLOWED_AUDIO_MIMES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",     // .m4a on many browsers
  "audio/x-m4a",   // .m4a on Safari/iOS
  "audio/m4a",
  "audio/mpeg",    // .mp3
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
];

// Matches transcribe.mjs' existing backstop. A voice memo of a person is short (a few sentences);
// even a minute of speech is well under this. Netlify's request-body ceiling is the harder limit.
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

// Map a mime to the file extension OpenAI's transcription endpoint expects. Falls back to a
// container OpenAI accepts so an unknown-but-allowed type still transcribes. Never throws.
export function audioExtFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav") || m.includes("wave")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("webm")) return "webm";
  return "webm"; // safe default container
}

// Guard a decoded audio payload BEFORE a paid transcription call. Returns { ok:true } or
// { ok:false, status, error } with a warm, human message (no AI tells). byteLength is the decoded
// size (Buffer.length). An empty/allow-listed-fail mime that still names a real container is
// tolerated (some pickers report "" for a .m4a); a clearly-wrong type (an image, a video) is
// rejected so we never burn a Whisper call on it.
export function guardAudio(mime, byteLength) {
  const len = Number(byteLength) || 0;
  if (len <= 0) return { ok: false, status: 400, error: "That memo came through empty. Please try another recording." };
  if (len > MAX_AUDIO_BYTES) return { ok: false, status: 413, error: "That memo is a bit long. Try a shorter one, or a minute or two at most." };
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  // Empty or generic → tolerated (a picked .m4a can report "" or octet-stream); we infer a container.
  if (!m || m === "application/octet-stream") return { ok: true };
  if (ALLOWED_AUDIO_MIMES.includes(m)) return { ok: true };
  // Anything else that clearly isn't audio (an image, a PDF, a video) is refused up front.
  if (!m.startsWith("audio/")) {
    return { ok: false, status: 415, error: "That doesn't look like a voice memo. Upload an audio recording (m4a, mp3, wav, or a voice memo)." };
  }
  // An audio/* we don't explicitly list (a rarer codec) — let it through; OpenAI will judge it.
  return { ok: true };
}
