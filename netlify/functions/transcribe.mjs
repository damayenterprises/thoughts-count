// Thoughts Count — voice transcription (TC-51, first testable version).
//
// Turns a short spoken answer into text so people can talk instead of type during
// the intake. The browser records audio, sends it here as base64, and we hand it to
// OpenAI's Whisper speech-to-text and return the transcript. Ungated for now (any
// user can try it) — we'll decide where/whether to gate it later.
//
// Security: the OpenAI key lives ONLY here, server-side (OPENAI_API_KEY). It is never
// sent to the browser. Audio is used only for this transcription and not stored.

// Kept under Netlify's request-body ceiling so the friendly message below can
// actually fire. A few seconds of voice is tens of KB; the client also auto-stops
// recording at ~60s, so this is a backstop, not the primary limit.
import { getStore } from "@netlify/blobs";
import { normalizeAudience } from "./public-config.mjs";
import { requireUser, serviceClient, supabaseConfigured } from "./_supabase.mjs";
import { rosterNames } from "./_capture.mjs";
// TC-106: the audio guard (mime + size) + ext mapping now live in one shared module so the live
// voice front door AND the voice-memo add-a-person door (which rides this SAME endpoint) reject junk
// identically, BEFORE spending a paid Whisper call. Mirrors the image door's ALLOWED_IMAGE_MIMES.
import { audioExtFromMime, guardAudio, MAX_AUDIO_BYTES } from "./_audio.mjs";

// TC-89 (1a): cap the total characters of the roster we hand OpenAI as a spelling bias, so a
// large (Pro) roster can never bloat the transcription request or add latency. rosterNames
// already caps the COUNT (200); this is a belt-and-suspenders char ceiling on the joined string.
const ROSTER_PROMPT_MAX_CHARS = 1200;

// Build the OpenAI transcription `prompt` from the verified user's roster — a documented
// vocabulary/spelling nudge so spoken names land on the spelling the user already saved
// ("John" not "Jon"). Best-effort ONLY: no bearer / bad token / any failure → "" (anon path
// and the open flow are never affected). The roster is derived SERVER-SIDE from the verified
// token — we never trust a client-supplied roster (an anon caller could otherwise inject bias).
async function rosterPrompt(req) {
  try {
    if (!supabaseConfigured()) return "";
    const auth = await requireUser(req);
    if (auth.error || !auth.userId) return ""; // anon or invalid token → skip biasing, transcribe as today
    const names = await rosterNames(serviceClient(), auth.userId);
    if (!names.length) return "";
    // Join newest-first until the char ceiling, so the most-recent (most-likely) names win the budget.
    const parts = [];
    let len = 0;
    for (const n of names) {
      const add = (parts.length ? 2 : 0) + n.length; // ", " + name
      if (len + add > ROSTER_PROMPT_MAX_CHARS) break;
      parts.push(n); len += add;
    }
    if (!parts.length) return "";
    // A light natural-language frame reads better to the model than a bare CSV and keeps it a
    // spelling nudge, not a transcript. Names the user cares about, spelled their way.
    return `Names that may be spoken, spelled as the speaker prefers: ${parts.join(", ")}.`;
  } catch (e) { console.error("rosterPrompt (best-effort, skipping)", e); return ""; }
}

const MAX_BYTES = MAX_AUDIO_BYTES;
// Light abuse guard: cap how often one caller can transcribe, so an open (ungated)
// endpoint calling a paid service can't be milked. Generous for real use — a plan
// uses only a few — but stops a runaway bot. Never blocks on limiter failure.
const RL_LIMIT = 30;
const RL_WINDOW_MS = 10 * 60 * 1000;
async function rateLimited(req) {
  try {
    const ip = (req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim();
    if (!ip) return false;
    const store = getStore("voice-ratelimit");
    const now = Date.now();
    const rec = (await store.get(ip, { type: "json" })) || { count: 0, start: now };
    if (now - rec.start > RL_WINDOW_MS) { rec.count = 0; rec.start = now; }
    rec.count += 1;
    await store.setJSON(ip, rec);
    return rec.count > RL_LIMIT;
  } catch { return false; }
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  // Audience gate (TC-60), enforced server-side so it can't be bypassed. "everyone"
  // (today) is open; "signedin"/"members" require a valid signed-in caller. True Pro
  // (members) enforcement plugs in when the paid flag (TC-40) exists.
  const audience = normalizeAudience(env("VOICE_AUDIENCE"));
  if (audience !== "everyone") {
    const auth = await requireUser(req);
    if (auth.error) return json(auth.status || 401, { error: "Voice is available once you're signed in." });
  }

  if (await rateLimited(req)) {
    return json(429, { error: "You've used voice a lot in a short time — take a breather and try again soon, or type it instead." });
  }

  const key = env("OPENAI_API_KEY");
  if (!key) return json(500, { error: "Voice isn't configured yet." });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "bad request" }); }

  const b64 = body?.audio;
  const mime = String(body?.mime || "audio/webm");
  if (!b64) return json(400, { error: "no audio" });
  // Reject malformed base64 up front so junk never costs a paid Whisper call.
  if (typeof b64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return json(400, { error: "bad audio" });

  let bytes;
  try { bytes = Buffer.from(b64, "base64"); } catch { return json(400, { error: "bad audio" }); }
  // TC-106: one shared mime + size guard (rejects an image/video/oversize memo BEFORE the paid call),
  // used by both this endpoint's callers (live voice + voice-memo add-a-person).
  const g = guardAudio(mime, bytes.length);
  if (!g.ok) return json(g.status, { error: g.error });

  const ext = audioExtFromMime(mime);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), `answer.${ext}`);
  // gpt-4o-mini-transcribe is ~2x faster than whisper-1 at equal accuracy — cuts the wait
  // before the app can reply (the biggest piece of the hands-free latency). Returns { text }.
  form.append("model", "gpt-4o-mini-transcribe");

  // TC-89 (1a): bias the transcription toward the signed-in user's saved names so a spoken name
  // is spelled the way they saved it (the first line of defense against a mis-spelled duplicate).
  // Best-effort — anon callers and any failure just get the un-biased transcription as before.
  const prompt = await rosterPrompt(req);
  if (prompt) form.append("prompt", prompt);

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("whisper error", res.status, detail);
      return json(502, { error: "We couldn't catch that — please try again or type it." });
    }
    const data = await res.json();
    return json(200, { text: String(data.text || "").trim() });
  } catch (err) {
    console.error("transcribe error", err);
    return json(502, { error: "We couldn't catch that — please try again or type it." });
  }
};

function env(name) {
  return (typeof Netlify !== "undefined" && Netlify.env?.get(name)) || process.env[name];
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
