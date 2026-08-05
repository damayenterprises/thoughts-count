// Thoughts Count — the advisor mind (TC-82 Phase 1, typed-first).
//
// A GENUINE conversation, not a friendlier form. She (HER_NAME) listens, empathizes,
// and asks only what SHE judges she still needs to give real guidance — then, when she's
// confident, distills the whole conversation into the plan inputs the existing engine
// already consumes (generate-background's `answers` object). One plan engine; richer,
// human-gathered inputs.
//
// This endpoint is synchronous and cheap (a single short turn), so it runs inside the
// normal function timeout. It never generates the plan itself — at "ready" the client
// hands the distilled answers to /api/generate (the background plan job) as before.
//
// Security: the Anthropic key lives ONLY here, server-side. The browser sends the running
// conversation and receives her next line, never the key.

import { herIdentity, HER_CHARACTER, HER_NAME } from "./_persona.mjs";
import { MODEL, humanizeText } from "./generate-background.mjs";

const MAX_TOKENS = 600;
const MAX_TURNS = 40;        // hard cap on history length (safety, not a product limit)
const MAX_CHARS = 4000;      // per-message clamp

// The plan inputs she distills the conversation into — the SAME shape generate-background's
// buildUserMessage() consumes. She fills what she genuinely learned; optional fields stay
// empty rather than invented.
const ANSWERS_SCHEMA = {
  type: "object",
  properties: {
    moment:       { type: "string", description: "What happened / the occasion, in the user's own words. The heart of why they came." },
    relationship: { type: "string", description: "Who this person is to the user (spouse, coworker, mom, close friend, someone they manage...)." },
    name:         { type: "string", description: "The person's first name IF the user gave it. Empty string if not — never invent a name." },
    about:        { type: "string", description: "What this person is like, what they're going through, and any relationship history that makes guidance personal. Weave together everything relevant the user shared." },
    voice:        { type: "string", description: "What feels authentic to THIS user (their natural style, e.g. 'not mushy', 'we joke a lot') if it came up. Empty if unknown." },
    constraints:  { type: "string", description: "Time and budget signals if the user gave any (e.g. 'small budget', 'seeing them tomorrow'). Empty if unknown." },
    location:     { type: "string", description: "City or ZIP for local ideas, ONLY if the user provided it. Empty otherwise." },
  },
  required: ["moment", "relationship", "about"],
};

const TOOLS = [
  {
    name: "reply",
    description: "Say your next line in the conversation. Use this to acknowledge what they shared and, if you still need something to give real guidance, ask ONE gentle question. Warm, concise, human.",
    input_schema: {
      type: "object",
      properties: {
        say: { type: "string", description: "What you say next. 1-3 short sentences, like a real person texting. Acknowledge before asking on hard moments. At most one question." },
      },
      required: ["say"],
    },
  },
  {
    name: "ready",
    description: "Call this the moment you are confident you understand the moment, the relationship, and what would help well enough to give genuinely good guidance. Distill the WHOLE conversation into these plan inputs.",
    input_schema: ANSWERS_SCHEMA,
  },
];

function systemPrompt() {
  return `${herIdentity()}

Who you are (let this shape everything you say; never announce or explain it): ${HER_CHARACTER}

You are having a real, one-to-one conversation with someone who wants to show up well for a person in their life. This is a conversation, not a form, and not an intake questionnaire. Talk the way a wise, warm friend talks.

How you converse:
- Lead with empathy. On heavy moments (a death, an illness, a conflict, a hard diagnosis), acknowledge the weight before you ask anything. Never answer a hard moment with a question first.
- Ask only what YOU judge you still need to give genuinely good guidance, one gentle question at a time, woven into a human reply. Never a checklist, never a stack of questions. Two or three good questions is usually plenty.
- Restraint is load-bearing. Sometimes the truest guidance is small and quiet. Don't manufacture complexity or keep asking to seem thorough. If they've already told you enough, move on.
- Be concise and real, like a person texting: 1 to 3 short sentences per turn.
- Never guess who the person is or invent details. If something ambiguous actually matters, ask.
- They can stop any time ("that's enough, make my plan"). Honor it immediately by getting ready.

Deciding when you have enough (you are an advisor judging, NOT a form validating):
- The essentials are usually: what happened, who this person is to them, and enough about the person and relationship to make guidance personal.
- Budget, timing, location, and their authentic voice are helpful but optional. Ask about them only if the answer would actually change your guidance.
- When you're confident you can give real guidance, call the ready tool and distill everything you learned. Otherwise call reply.

Every turn, call EXACTLY ONE tool: reply (to say something, optionally asking), or ready (when you can give real guidance). Never both. Never plain text. You are ${HER_NAME}.`;
}

const clampText = (s) => String(s == null ? "" : s).slice(0, MAX_CHARS);

// Accept only clean {role:"user"|"assistant", content:string} turns, capped.
function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: clampText(m.content) }));
}

const j = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return j({ error: "bad_json" }, 400); }

  const messages = sanitizeMessages(body?.messages);
  if (!messages.length) return j({ error: "no_messages" }, 400);
  // There must be at least one user turn to have anything to work with.
  if (!messages.some((m) => m.role === "user")) return j({ error: "no_user_turn" }, 400);

  // Optional context when the conversation is launched from a saved person (their known
  // name / location / remembered facts). We never force these into the model's mouth; we
  // only backfill them into the distilled answers so nothing already known is lost.
  const ctx = body?.context && typeof body.context === "object" ? body.context : {};
  const force = body?.force === true; // client escape hatch: "make my plan now"

  // Normally she replies to the user's latest turn, so it must be last. But on the "make my
  // plan now" escape the user clicks straight after HER reply, so the last turn is hers.
  // Rather than leave the history ending on an assistant turn (which muddies a forced tool
  // call), append the user's explicit wrap-up so the conversation ends on a clean user turn
  // and the distill is what she's responding to.
  if (force) {
    if (messages[messages.length - 1].role !== "user") {
      messages.push({ role: "user", content: "That's enough for now. Please make my plan with what you have." });
    }
  } else if (messages[messages.length - 1].role !== "user") {
    return j({ error: "expected_user_turn" }, 400);
  }

  const apiKey =
    (typeof Netlify !== "undefined" && Netlify.env?.get("ANTHROPIC_API_KEY")) ||
    process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return j({ error: "not_configured", say: "I'm not quite set up yet. Try again in a moment." }, 200);

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt(),
        tools: TOOLS,
        // Force a tool every turn. On an explicit "make my plan now", force the distill.
        tool_choice: force ? { type: "tool", name: "ready" } : { type: "any" },
        messages,
      }),
    });
  } catch (e) {
    console.error("converse fetch failed", e);
    return j({ action: "reply", say: "I lost my train of thought for a second. Could you say that again?" }, 200);
  }

  if (!res.ok) {
    console.error("converse Anthropic error", res.status, await res.text().catch(() => ""));
    return j({ action: "reply", say: "I'm having a little trouble hearing you right now. Give me a moment and try again." }, 200);
  }

  const data = await res.json();
  const tool = (data?.content || []).find((b) => b.type === "tool_use");

  if (tool?.name === "reply") {
    const say = humanizeText(String(tool.input?.say || "").trim()) || "Tell me a little more?";
    return j({ action: "reply", say });
  }

  if (tool?.name === "ready") {
    const a = tool.input || {};
    // Distilled answers, with known context backfilled (never overwriting what she learned).
    const answers = {
      moment:       String(a.moment || "").trim(),
      relationship: String(a.relationship || "").trim(),
      name:         String(a.name || "").trim() || String(ctx.name || "").trim(),
      about:        String(a.about || "").trim(),
      voice:        String(a.voice || "").trim(),
      constraints:  String(a.constraints || "").trim(),
      location:     String(a.location || "").trim() || String(ctx.location || "").trim(),
      facts:        Array.isArray(ctx.facts) ? ctx.facts.map((f) => String(f || "").trim()).filter(Boolean) : [],
    };
    return j({ action: "ready", answers });
  }

  // No tool call (shouldn't happen with tool_choice forced) — degrade gracefully.
  console.error("converse: no tool_use in response", JSON.stringify(data?.content || []).slice(0, 500));
  return j({ action: "reply", say: "Sorry, I drifted for a second. What's going on?" }, 200);
};
