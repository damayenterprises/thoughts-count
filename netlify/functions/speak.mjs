// Thoughts Count — warm spoken readback (TC-67).
//
// Turns a short line of the app's own copy into a warm, human voice so the confirmation
// can be read aloud (opt-in, hands-free). The browser sends the exact text to speak; we
// hand it to OpenAI's text-to-speech and return the audio. This replaces the robotic
// built-in browser voice, which never met the brand's warmth bar.
//
// Voice: OpenAI "nova" on the newer gpt-4o-mini-tts model, steered warm/gentle/unhurried.
// (We avoid the classic model's `speed` control: it time-stretches the audio, which adds an
// echoey/robotic artifact. gpt-4o-mini-tts paces itself naturally from the instruction — the
// warmer, more human delivery David preferred.)
//
// Security: the OpenAI key lives ONLY here, server-side (OPENAI_API_KEY, shared with the
// transcribe function). It is never sent to the browser. Text is the app's own wording
// (never stored). Cost is bounded by a length cap + a per-IP rate limit.

import { getStore } from "@netlify/blobs";
import { normalizeAudience } from "./public-config.mjs";
import { requireUser } from "./_supabase.mjs";

const MODEL = "gpt-4o-mini-tts";
const VOICE = "nova";
// ONE unconditional delivery spec, applied identically to EVERY clip. Sentences are spoken as
// separate clips streamed one at a time; a conditional clause (e.g. "when you ask a question…")
// would steer question/menu clips to a different prosody than statement clips, so clip N and
// clip N+1 in the SAME reply would drift in pace/energy. This single steady spec keeps her
// sounding like the same present, engaged person from her first sentence to her last. Keep it
// constant — never derive tone from the text; never accept a per-clip style/speed from the client.
const INSTRUCTIONS = "Speak in a warm, present, gently engaged tone — soft, caring and reassuring, like a kind friend who genuinely cares and is glad to be here. Natural and human, never robotic or flat. Keep a steady, even energy and an unhurried, natural conversational pace throughout: the same warmth and the same measured, relaxed rhythm on every line, whether it is a statement, a question, or an invitation. Do not rush, do not speed up or slow down, and never sound transactional or like a menu prompt — always warm, personal and softly engaged.";
const MAX_CHARS = 400; // a readback is ~100 chars; hard cap so cost/latency stay bounded

// Light abuse guard: an open endpoint calling a paid service can't be milked. Generous for
// real use (a session speaks only a few lines). Never blocks on limiter failure.
const RL_LIMIT = 80;
const RL_WINDOW_MS = 10 * 60 * 1000;
async function rateLimited(req) {
  try {
    const ip = (req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim();
    if (!ip) return false;
    const store = getStore("speak-ratelimit");
    const now = Date.now();
    const rec = (await store.get(ip, { type: "json" })) || { count: 0, start: now };
    if (now - rec.start > RL_WINDOW_MS) { rec.count = 0; rec.start = now; }
    rec.count += 1;
    await store.setJSON(ip, rec);
    return rec.count > RL_LIMIT;
  } catch { return false; }
}

export default async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // Same audience gate as transcribe (TC-60), enforced server-side.
  const audience = normalizeAudience(env("VOICE_AUDIENCE"));
  if (audience !== "everyone") {
    const auth = await requireUser(req);
    if (auth.error) return new Response("sign in required", { status: auth.status || 401 });
  }

  if (await rateLimited(req)) return new Response("slow down", { status: 429 });

  const key = env("OPENAI_API_KEY");
  if (!key) return new Response("not configured", { status: 500 });

  let body;
  try { body = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
  let text = String(body?.text || "").trim();
  if (!text) return new Response("no text", { status: 400 });
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, instructions: INSTRUCTIONS, response_format: "mp3" }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("tts error", res.status, detail);
      return new Response("tts error", { status: 502 });
    }
    const audio = await res.arrayBuffer();
    return new Response(audio, { status: 200, headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (err) {
    console.error("speak error", err);
    return new Response("tts error", { status: 502 });
  }
};

function env(name) {
  return (typeof Netlify !== "undefined" && Netlify.env?.get(name)) || process.env[name];
}
