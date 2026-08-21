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

// TC-122 — Della's emotional REGISTERS (Design Lead spec). She feels the moment WITH you: one
// register chosen per REPLY (server-side, from the moment's valence/occasion) and applied to every
// clip of that reply — so she's expressive ACROSS moments yet steady WITHIN a reply (honors TC-120,
// which pinned pace steady so clips don't drift). Registers differ ONLY in energy / warmth /
// brightness / tenderness — NEVER in pace (no speed/tempo/pause language anywhere). The register is
// pre-decided by converse.mjs and passed in as `register`; speak.mjs NEVER infers mood from the text
// and NEVER accepts a free-form style from the client (whitelist below → default warm).
//
// One-voice floor (feedback_tc_one_voice): the OPEN and TAIL are byte-identical across all four —
// only the middle mood clause changes — so every register is unmistakably the SAME person. If the
// open/tail is ever edited, it must change in all four together.
const REG_OPEN = "Speak as Della — warm, present and human, soft and caring, like a wise friend who genuinely cares and is glad to be here. Never robotic, never flat, never transactional.";
const REG_TAIL = "Keep a steady, even rhythm and the same energy from your first word to your last — never rush, never drag, never shift pace or volume mid-thought.";
const REG_MOODS = {
  // default — the Della of today
  warm:   "Hold an even, gently engaged warmth — settled and reassuring, simply glad to be here with them.",
  // celebration — quiet delight FOR them
  bright: "Let a genuine, quiet delight lift your warmth — a real smile in the voice, bright-eyed and happy for them, glowing but grounded. Warmer and lighter than usual, never giddy, loud, or bubbly.",
  // hard time / grief — hushed, holding space
  tender: "Soften into a hushed, tender gentleness — quiet, close, and full of care, holding space with them in something heavy. Lower and softer than usual, unhurried and kind. Never bright, never cheerful.",
  // gratitude / light short reactions — easy warmth WITH them
  fond:   "Let an easy, affectionate lightness come through — a warm smile between old friends, a touch of playfulness, unforced and glad. Light and fond, never solemn, never over-eager.",
};
const REGISTERS = Object.fromEntries(Object.entries(REG_MOODS).map(([k, mood]) => [k, `${REG_OPEN} ${mood} ${REG_TAIL}`]));
// Whitelist at the boundary: any missing/unknown register → warm (never guess toward an extreme).
function instructionsFor(register) {
  const key = typeof register === "string" && REGISTERS[register] ? register : "warm";
  return REGISTERS[key];
}
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
  const instructions = instructionsFor(body?.register); // TC-122: whitelisted register → delivery

  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, instructions, response_format: "mp3" }),
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
