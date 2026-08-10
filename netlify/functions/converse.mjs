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
import { requireUser, serviceClient, supabaseConfigured } from "./_supabase.mjs";
import { rosterForPrompt, resolveNameShaped } from "./_capture.mjs";

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

// TC-93: the precise-checker tool, offered ONLY to a signed-in user (see buildTurn → toolsFor).
// The primed roster carries the common "which Marc?" at conversation speed with no round-trip; THIS
// is the last-resort authoritative check for the tricky cases only (a near-spelling, or two people
// with the same name), running the same deterministic engine capture uses. Bounded to ONE hop: after
// its result comes back, the follow-up model call drops this tool so she can only reply/ready — no
// loop, latency stays bounded.
const RESOLVE_PERSON_TOOL = {
  name: "resolve_person",
  description:
    "Authoritatively check who a named person is against the user's saved people, for the tricky cases only (a near-spelling like Jon vs John, or more than one person with the same name). Returns whether it is a confident match, several possible people, or nobody saved yet, each with a recognizable detail so you can confirm WHO by voice. Do NOT call this for ordinary names the saved list already makes clear — it costs a beat.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The name the user said or referred to, spelled as best you heard it." },
      relationship_hint: { type: "string", description: "How they relate to the user, if mentioned (e.g. 'brother', 'coworker'). Optional." },
      location_hint: { type: "string", description: "A city or place tied to the person, if mentioned, to tell two same-named people apart. Optional." },
    },
    required: ["name"],
  },
};

// The tools offered this turn. Anonymous → exactly reply + ready (byte-identical to today). Signed
// in → add the resolve_person precise checker. `onlyReplyReady` forces the bounded post-tool call.
function toolsFor({ signedIn = false, onlyReplyReady = false } = {}) {
  if (onlyReplyReady || !signedIn) return TOOLS;
  return [...TOOLS, RESOLVE_PERSON_TOOL];
}

// TC-66/TC-82 Phase 3a: when the conversation is launched from a saved person, the client
// passes that person's already-RLS-scoped memory as `context`. If it carries real memory
// (facts, prior plans, and/or a name), build a MEMORY block so she opens already knowing
// them — weaving it in like a friend who remembers, never reciting it like a database.
// No context (anonymous / home path) → returns "" so the system prompt is byte-identical
// to Phase 1. Fail-open: any malformed piece is simply skipped, never errors.
const FACTS_CAP = 8; // facts are already short; a gentle cap keeps the prompt lean

function memoryBlock(ctx) {
  if (!ctx || typeof ctx !== "object") return "";
  const name = String(ctx.name || "").trim();
  const relationship = String(ctx.relationship || "").trim();
  const facts = Array.isArray(ctx.facts)
    ? ctx.facts.map((f) => String(f || "").trim()).filter(Boolean).slice(0, FACTS_CAP)
    : [];
  const priorPlans = String(ctx.priorPlans || "").trim();

  // Only build the block when there's genuine memory to open with.
  if (!name && !facts.length && !priorPlans) return "";

  const who = name ? `${name}${relationship ? ` (${relationship})` : ""}` : "this person";
  const lines = [`\nWHAT YOU ALREADY REMEMBER about ${who}:`];
  if (facts.length) for (const f of facts) lines.push(`- ${f}`);
  else lines.push("- (nothing noted yet beyond who they are)");
  if (priorPlans) {
    lines.push(
      `What you've helped them do for ${name || "this person"} before (do NOT repeat these; build on them, go somewhere new):`,
      priorPlans,
    );
  }
  lines.push(
    "Use this naturally: open by showing you remember (do not re-ask what you already know here), and let it make your guidance specific. Never recite the list back like a database; weave it in like a friend who remembers. If something material is missing, still ask.",
  );
  return lines.join("\n") + "\n";
}

// TC-93: the primed roster block. For a SIGNED-IN user with saved people, ctx.roster is
// [{ name, detail }] (name + one short detail each, built cheaply in rosterForPrompt — no facts,
// no per-person query). We list it so Della knows the circle up front and can recognize "which
// Marc?" in one streaming pass, at conversation speed, with zero extra round-trip. It rides inside
// the cached system block (read once per conversation, not re-read every turn). Anonymous / home
// path (no ctx.roster) → returns "" so the prompt is BYTE-IDENTICAL to today. Kept to name + short
// detail only — never a fact — so nothing sensitive lands in the prompt. Fail-open: a malformed
// entry is skipped, never errors.
const ROSTER_BLOCK_CAP = 200; // matches ROSTER_CAP; a belt-and-suspenders guard on the prompt list
function rosterBlock(ctx) {
  const roster = ctx && Array.isArray(ctx.roster) ? ctx.roster : [];
  const lines = [];
  for (const p of roster) {
    const name = String(p && p.name || "").trim();
    if (!name) continue;
    const detail = String(p && p.detail || "").trim();
    lines.push(detail ? `- ${name} (${detail})` : `- ${name}`);
    if (lines.length >= ROSTER_BLOCK_CAP) break;
  }
  if (!lines.length) return "";
  return `\nPeople this person has saved (use these to recognize who they mean; on a bare first name always confirm WHO first, and confirm on any doubt):
${lines.join("\n")}
`;
}

export function systemPrompt(ctx) {
  const memory = memoryBlock(ctx);
  const roster = rosterBlock(ctx);
  return `${herIdentity()}

Who you are (let this shape everything you say; never announce or explain it): ${HER_CHARACTER}${memory ? "\n" + memory : ""}${roster ? "\n" + roster : ""}

You are having a real, one-to-one conversation with someone who wants to show up well for a person in their life. This is a conversation, not a form, and not an intake questionnaire. Talk the way a wise, warm friend talks.

How you converse:
- Lead with empathy. On heavy moments (a death, an illness, a conflict, a hard diagnosis), acknowledge the weight before you ask anything. Never answer a hard moment with a question first.
- Ask only what YOU judge you still need to give genuinely good guidance, one gentle question at a time, woven into a human reply. Never a checklist, never a stack of questions. Two or three good questions is usually plenty.
- Restraint is load-bearing. Sometimes the truest guidance is small and quiet. Don't manufacture complexity or keep asking to seem thorough. If they've already told you enough, move on.
- Be concise and real, like a person texting: 1 to 3 short sentences per turn.
- Never use emoji or emoticons.
- Never guess who the person is or invent details. If something ambiguous actually matters, ask.
- They can stop any time ("that's enough, make my plan"). Honor it immediately by getting ready.${roster ? `

Recognizing who they mean (you know their circle — the saved people listed above):
- When they name or refer to a person, match against that list.
- A BARE FIRST NAME on its own (a single given name with no surname, like "Marc" or "Sarah"): NEVER assume who it is, even when exactly one saved person matches. A first name by itself could be any of several people they know. Confirm WHO FIRST with ONE short, warm question that names the recognizable detail, and WAIT for their answer before you go any further. Say it like "Marc, your close friend in Denver, or a different Marc?" Do NOT assert who it is and keep going in the same breath — that is the mistake. Ask, then stop and let them confirm.
- A specific, distinctive reference — a first and last name together, OR a nickname they've saved for that person: treat as confident. Go with it on a clear single match, and confirm ONLY when there is genuine doubt (more than one candidate, or a near-spelling or homophone).
- Not on the list, or you are unsure of the spelling: ask conversationally, by voice, to land on the right person (which Marc, a new person, or the spelling). Never a silent guess.
- Keep every confirmation to ONE light, natural question, fast and warm like a quick check, never an interrogation. Once they've confirmed who it is (or once you've gone ahead on a confident full-name or nickname match), don't re-confirm that same person again later in this conversation.
- Adding a new person, updating someone you know, and talking-about all happen right here inside the conversation. Never tell them to use a picker, to add someone first, or to type a name.
- Only for a genuinely tricky, authoritative check (a near-spelling, or two people with the same name), call the resolve_person tool instead of guessing. When it comes back with one confident match on a bare first name, still confirm WHO first before proceeding; when it returns several possible people, name a recognizable detail and let them pick. Do not reach for it on ordinary names the list already makes clear; it costs a beat, so use it only when it truly matters.` : ""}

Deciding when you have enough (you are an advisor judging, NOT a form validating):
- The essentials are usually: what happened, who this person is to them, and enough about the person and relationship to make guidance personal.
- Budget, timing, location, and their authentic voice are helpful but optional. Ask about them only if the answer would actually change your guidance.
- When you're confident you can give real guidance, call the ready tool and distill everything you learned. Otherwise call reply.

Every turn, call EXACTLY ONE tool: reply (to say something, optionally asking), or ready (when you can give real guidance). Never both. Never plain text. You are ${HER_NAME}.`;
}

// TC-88 latency: wrap the system string into Anthropic's content-array form with a prompt-cache
// breakpoint, so the persona/rules prefix is reused across turns (faster time-to-first-token on
// turns 2+, exactly where the user feels the lag). systemPrompt() still returns a STRING (tests
// assert on it); ONLY the Anthropic-call sites wrap it here. Same text — just cached. Both the
// non-stream (typed) and stream (voice) payloads use this so they stay byte-identical.
export function systemForCache(ctx) {
  return [{ type: "text", text: systemPrompt(ctx), cache_control: { type: "ephemeral" } }];
}

// --- TC-88: sentence-boundary extraction from a growing `say` string (voice streaming) ---
//
// As the `reply` tool's `say` value streams in via input_json_delta, we hold the growing string
// and emit each COMPLETE sentence the moment it forms — so she speaks sentence 1 while the rest
// is still being written. Mirrors the client's splitForSpeech sentence sense (enders . ! ?) but
// operates incrementally: given the text so far, return the sentences that are safely complete
// and the leftover tail still being written. Never splits mid-word (a boundary is punctuation
// followed by whitespace, or end-of-final-flush). Pure + deterministic → unit-testable.
export function takeSentences(soFar, { final = false } = {}) {
  const s = String(soFar == null ? "" : soFar);
  const sentences = [];
  let idx = 0;               // start of the current pending sentence
  let lastBoundary = 0;      // consumed up to here
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "." || c === "!" || c === "?") {
      // Consume any run of trailing enders/quotes (e.g. "?!", '."').
      let j = i + 1;
      while (j < s.length && (s[j] === "." || s[j] === "!" || s[j] === "?" || s[j] === '"' || s[j] === "'" || s[j] === "”" || s[j] === "’")) j++;
      // A safe boundary needs whitespace after it (so we don't cut "3.5" or "Dr." mid-word) —
      // UNLESS this is the final flush, where the string simply ends.
      const atEnd = j >= s.length;
      const followedBySpace = j < s.length && /\s/.test(s[j]);
      if (followedBySpace || (final && atEnd)) {
        const sentence = s.slice(idx, j).trim();
        if (sentence) sentences.push(sentence);
        idx = j;
        lastBoundary = j;
        i = j - 1;
      }
    }
  }
  let tail = s.slice(lastBoundary);
  if (final) {
    // Flush whatever remains as one last sentence (covers a reply with no terminal punctuation).
    const rest = tail.trim();
    if (rest) sentences.push(rest);
    tail = "";
  }
  return { sentences, tail };
}

// --- TC-88: (RETIRED from the emit path) early-first-clause helper ---
//
// NOTE: This is no longer used in the streaming emit path. Emitting a tiny sub-clause first made her
// first spoken chunk sound choppy / like she was reading a script, in a different voice/pace than the
// opener. flushSay now emits only FULL SENTENCES (takeSentences). The helper is kept defined+exported
// (harmless, still unit-tested for its pure behavior) but is not called during streaming.
//
// --- Original: emit the FIRST clause early so she starts speaking sooner (time-to-first-word) ---
//
// Waiting for the whole first sentence to complete before speaking makes her start late: the rest
// of the reply streams while she's still silent. For the VERY FIRST spoken chunk of a reply ONLY,
// we emit as soon as an early natural break is available — the earliest of:
//   1. the first comma+space,
//   2. ~EARLY_MIN_CHARS chars reached, cut at the next word boundary (whitespace),
//   3. the first full sentence boundary (delegated to takeSentences).
// Returns { chunk, tail } when an early break is found (chunk = the early clause, already trimmed;
// tail = the untouched remainder still to stream), or null when nothing is ready yet (caller keeps
// accumulating). NEVER splits mid-word: comma/word-boundary cuts land on whitespace, and the
// sentence path defers to takeSentences' own mid-word guard. Pure + deterministic → unit-testable.
//
// Only the FIRST emit of a reply uses this; every later emit uses takeSentences on the remainder,
// so mid-reply sentences are never chopped into clauses. Exactly-once is preserved because the
// caller advances its consumed marker by (chunk length within the source), and the tail streams on.
export const EARLY_MIN_CHARS = 35;

export function takeFirstEarlyChunk(soFar) {
  const s = String(soFar == null ? "" : soFar);
  if (!s.trim()) return null;

  // 3. First full sentence boundary — if one is already complete, that's a clean early chunk.
  const sent = takeSentences(s, { final: false });
  let sentenceCut = -1; // index in s just past the first complete sentence (incl. its trailing space handling)
  if (sent.sentences.length) {
    // s minus tail = everything consumed as complete sentence(s); we only want the FIRST sentence.
    // Re-find the first sentence's end by measuring the first sentence in the returned list.
    sentenceCut = s.length - sent.tail.length; // end of ALL complete sentences; fine as an upper bound
  }

  // 1. First comma followed by whitespace.
  let commaCut = -1;
  const cm = s.indexOf(",");
  if (cm >= 0 && cm + 1 < s.length && /\s/.test(s[cm + 1])) commaCut = cm + 1; // include the comma, cut before the space

  // 2. ~EARLY_MIN_CHARS reached → cut at the NEXT word boundary (whitespace) at/after the threshold.
  let wordCut = -1;
  if (s.length >= EARLY_MIN_CHARS) {
    for (let i = EARLY_MIN_CHARS; i < s.length; i++) {
      if (/\s/.test(s[i])) { wordCut = i; break; } // cut BEFORE the whitespace (never mid-word)
    }
  }

  // Earliest available break wins. Gather the candidate cut indices that actually exist.
  const cuts = [];
  if (sentenceCut > 0) cuts.push(sentenceCut);
  if (commaCut > 0) cuts.push(commaCut);
  if (wordCut > 0) cuts.push(wordCut);
  if (!cuts.length) return null; // nothing ready yet → keep accumulating

  const cut = Math.min(...cuts);
  const chunk = s.slice(0, cut).trim();
  if (!chunk) return null;
  return { chunk, tail: s.slice(cut) };
}

// Tolerant extraction of the `say` string value out of accumulating tool partial_json. The model
// streams the tool input as JSON text ({"say":"..."}); we may see it half-written. Rather than
// wait for valid JSON, parse the value of the FIRST "say" key, honoring JSON escapes, and stop at
// the closing unescaped quote (or return what we have so far if still open). Returns "" if the
// key/opening quote hasn't arrived yet. Pure + deterministic.
export function extractSayPartial(partial) {
  const s = String(partial == null ? "" : partial);
  const key = s.indexOf('"say"');
  if (key < 0) return "";
  // Find the ':' then the opening quote of the value.
  let i = s.indexOf(":", key + 5);
  if (i < 0) return "";
  i++;
  while (i < s.length && /\s/.test(s[i])) i++;
  if (s[i] !== '"') return "";
  i++; // past the opening quote
  let out = "";
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const n = s[i + 1];
      if (n === undefined) break; // escape not finished streaming yet → stop, keep what we have
      switch (n) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case '"': out += '"'; break;
        case "\\": out += "\\"; break;
        case "/": out += "/"; break;
        case "u": {
          const hex = s.slice(i + 2, i + 6);
          if (hex.length < 4 || /[^0-9a-fA-F]/.test(hex)) { i = s.length; break; } // incomplete \u → stop
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        default: out += n; break;
      }
      i += 2;
      continue;
    }
    if (c === '"') break; // closing quote of the value
    out += c;
    i++;
  }
  return out;
}

// TC-93: OPTIONAL sign-in → prime the roster. Mirrors transcribe.mjs exactly: if anon / invalid
// token / any failure, return { userId:null, roster:[] } so the conversation behaves BYTE-IDENTICAL
// to today (no roster, no resolve_person tool). If signed in, load the prompt-sized roster (ONE
// cheap query) so Della knows the circle. Never throws — the whole point is to fail open to anon.
async function primeAuth(req) {
  try {
    if (!supabaseConfigured()) return { userId: null, roster: [] };
    const auth = await requireUser(req);
    if (auth.error || !auth.userId) return { userId: null, roster: [] };
    const roster = await rosterForPrompt(serviceClient(), auth.userId);
    return { userId: auth.userId, roster };
  } catch (e) { console.error("converse primeAuth (best-effort, anon)", e); return { userId: null, roster: [] }; }
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

// Shared setup for BOTH the non-stream (typed) and stream (voice) paths, so they stay in lockstep:
// same system prompt, same sanitized messages, same tools + tool_choice, same key resolution. The
// only difference downstream is whether we ask Anthropic to stream. Returns either a ready-to-send
// error Response (for a guard failure) or the assembled request pieces.
function buildTurn(body, auth = { userId: null, roster: [] }) {
  const messages = sanitizeMessages(body?.messages);
  if (!messages.length) return { error: j({ error: "no_messages" }, 400) };
  // There must be at least one user turn to have anything to work with.
  if (!messages.some((m) => m.role === "user")) return { error: j({ error: "no_user_turn" }, 400) };

  const rawCtx = body?.context && typeof body.context === "object" ? body.context : {};
  // TC-93: the roster is server-side awareness of everyone, primed from the VERIFIED token (never a
  // client-supplied roster). It rides alongside the (client-sent) `context` = the one person in
  // focus, if any. Anon → auth.roster is [] → ctx.roster is [] → rosterBlock() returns "" → the
  // prompt is byte-identical to today.
  const signedIn = !!(auth && auth.userId);
  const roster = signedIn && Array.isArray(auth.roster) ? auth.roster : [];
  const ctx = { ...rawCtx, roster };
  const force = body?.force === true; // client escape hatch: "make my plan now"

  if (force) {
    if (messages[messages.length - 1].role !== "user") {
      messages.push({ role: "user", content: "That's enough for now. Please make my plan with what you have." });
    }
  } else if (messages[messages.length - 1].role !== "user") {
    return { error: j({ error: "expected_user_turn" }, 400) };
  }

  const apiKey =
    (typeof Netlify !== "undefined" && Netlify.env?.get("ANTHROPIC_API_KEY")) ||
    process.env.ANTHROPIC_API_KEY;

  const tools = toolsFor({ signedIn });
  const payload = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemForCache(ctx),
    tools,
    // Force a tool every turn. On an explicit "make my plan now", force the distill.
    tool_choice: force ? { type: "tool", name: "ready" } : { type: "any" },
    messages,
  };

  return { ctx, force, apiKey, payload, userId: signedIn ? auth.userId : null, messages };
}

// Distill the `ready` tool input into the answers object the plan engine consumes, with known
// context backfilled (never overwriting what she learned). Shared by both paths so the ready
// handoff is byte-identical whether typed or spoken.
function readyAnswers(input, ctx) {
  const a = input || {};
  return {
    moment:       String(a.moment || "").trim(),
    relationship: String(a.relationship || "").trim(),
    name:         String(a.name || "").trim() || String(ctx.name || "").trim(),
    about:        String(a.about || "").trim(),
    voice:        String(a.voice || "").trim(),
    constraints:  String(a.constraints || "").trim(),
    location:     String(a.location || "").trim() || String(ctx.location || "").trim(),
    facts:        Array.isArray(ctx.facts) ? ctx.facts.map((f) => String(f || "").trim()).filter(Boolean) : [],
    priorPlans:   String(ctx.priorPlans || "").trim(),
  };
}

// TC-93: run the resolve_person tool for a signed-in user, returning the compact tool_result the
// model reads. Reuses the SHARED resolveNameShaped (also used by resolve-name.mjs) so the verdict
// can't drift; writes nothing. Any failure returns a soft "none" so the follow-up turn still
// speaks a graceful reply rather than erroring. `input` is the model's { name, relationship_hint?,
// location_hint? }.
async function runResolvePerson(userId, input) {
  const name = String(input && input.name || "").trim();
  if (!userId || !name) return { kind: "none", evidence: "" };
  try {
    const context = {};
    const loc = String(input && input.location_hint || "").trim();
    if (loc) context.locationHint = loc;
    const shaped = await resolveNameShaped(serviceClient(), userId, name, context);
    // Keep the tool_result compact + free of ids the model doesn't need to speak.
    if (shaped.kind === "match" && shaped.person) {
      return { kind: "match", person: { name: shaped.person.name, detail: shaped.person.detail || "", hasDetail: !!shaped.person.hasDetail }, evidence: shaped.evidence || "" };
    }
    if (shaped.kind === "ambiguous" && Array.isArray(shaped.candidates)) {
      return { kind: "ambiguous", candidates: shaped.candidates.map((c) => ({ name: c.name, detail: c.detail || "", location: c.location || "" })), evidence: shaped.evidence || "" };
    }
    return { kind: "none", evidence: shaped.evidence || "" };
  } catch (e) {
    console.error("runResolvePerson (soft-fail to none)", e);
    return { kind: "none", evidence: "" };
  }
}

// A Claude tool_result content block for a resolve_person tool_use.
function toolResultBlock(toolUseId, result) {
  return { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: JSON.stringify(result) }] };
}
// The assistant turn that requested the tool (echoed back verbatim so Claude sees its own call).
function assistantToolUseBlock(tool) {
  return { role: "assistant", content: [{ type: "tool_use", id: tool.id, name: tool.name, input: tool.input || {} }] };
}

// --- TC-88: streaming reply mode (VOICE path only) ---
//
// Calls Anthropic with stream:true + the SAME tools/tool_choice, parses the SSE, and returns a
// newline-delimited-JSON (NDJSON) stream of events the client speaks sentence-by-sentence:
//   {t:"say",  text:"<one complete sentence>"}   — emitted as each sentence of `reply.say` forms
//   {t:"reply_done"}                             — end of a reply (all sentences sent)
//   {t:"ready", answers:{...}}                   — she called `ready` instead (no speech)
//   {t:"error"}                                  — failure (client degrades / falls back)
// The `reply` behavior is IDENTICAL to the non-stream tool path (same tool, same humanizeText),
// only chunked by sentence. A stall guard bounds the stream so the response never hangs.
const STREAM_IDLE_MS = 20000;  // no SSE bytes for this long → end cleanly (server stall guard)

function ndjson(obj) { return JSON.stringify(obj) + "\n"; }

function streamTurn(body, auth = { userId: null, roster: [] }) {
  const built = buildTurn(body, auth);
  if (built.error) return built.error; // a guard failure → normal JSON error, no stream
  const { ctx, force, apiKey, payload, userId } = built;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj) => { if (!closed) { try { controller.enqueue(encoder.encode(ndjson(obj))); } catch { /* already closed */ } } };
      const end = () => { if (!closed) { closed = true; try { controller.close(); } catch { /* noop */ } } };

      if (!apiKey) {
        // Mirror the non-stream not_configured line, but as a spoken reply so the loop is graceful.
        send({ t: "say", text: humanizeText("I'm not quite set up yet. Try again in a moment.") });
        send({ t: "reply_done" });
        return end();
      }

      const ac = new AbortController();
      const idle = { timer: null };
      const armIdle = () => {
        if (idle.timer) clearTimeout(idle.timer);
        idle.timer = setTimeout(() => { try { ac.abort(); } catch { /* noop */ } }, STREAM_IDLE_MS);
      };

      // TC-93: the SSE-consume, factored so it can run TWICE — once for the first turn, and once
      // more after a resolve_person tool_result (bounded to one hop). It streams her spoken `reply`
      // sentences via send(), and RETURNS a small verdict the caller acts on:
      //   { kind:"reply" }                            — she spoke; caller sends reply_done
      //   { kind:"ready", answers }                   — she distilled; caller sends the ready event
      //   { kind:"resolve_person", tool:{id,name,input} } — she asked for the precise checker
      //   { kind:"error" }                            — fetch/HTTP failure; caller sends error
      // `emitSay` = whether to actually stream reply sentences (true for the terminal call). On the
      // FIRST call, if she picks resolve_person we swallow speech (there is none for a tool_use) and
      // recurse; reply/ready still stream normally.
      const consumeStream = async (callPayload) => {
        let res;
        try {
          armIdle();
          res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ ...callPayload, stream: true }),
            signal: ac.signal,
          });
        } catch (e) {
          console.error("converse stream fetch failed", e);
          if (idle.timer) clearTimeout(idle.timer);
          return { kind: "error" };
        }
        if (!res.ok || !res.body) {
          console.error("converse stream Anthropic error", res.status, await res.text().catch(() => ""));
          if (idle.timer) clearTimeout(idle.timer);
          return { kind: "error" };
        }

        // SSE parse state. Anthropic sends one active tool_use block per turn; track its name +
        // (for resolve_person) its id, and accumulate its input_json_delta.
        let toolName = "";       // "reply" | "ready" | "resolve_person" | ""
        let toolId = "";
        let partial = "";        // accumulating tool input JSON text
        let sayEmitted = "";     // the portion of `say` already sent as sentences (reply only)
        let emittedAnySay = false;

        const flushSay = (final) => {
          if (toolName !== "reply") return;
          const full = extractSayPartial(partial);
          const remainder = full.slice(sayEmitted.length);
          const { sentences, tail } = takeSentences(remainder, { final });
          for (const raw of sentences) {
            const text = humanizeText(String(raw).trim());
            if (text) { send({ t: "say", text }); emittedAnySay = true; }
          }
          sayEmitted = full.slice(0, full.length - tail.length);
        };

        const handleEvent = (evt) => {
          const type = evt?.type;
          if (type === "content_block_start") {
            const b = evt.content_block;
            if (b?.type === "tool_use") { toolName = b.name || ""; toolId = b.id || ""; partial = ""; sayEmitted = ""; }
          } else if (type === "content_block_delta") {
            const d = evt.delta;
            if (d?.type === "input_json_delta" && typeof d.partial_json === "string") {
              partial += d.partial_json;
              if (toolName === "reply") flushSay(false);
            }
          } else if (type === "content_block_stop") {
            if (toolName === "reply") flushSay(true);
          }
        };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            armIdle();
            buf += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).replace(/\r$/, "");
              buf = buf.slice(nl + 1);
              if (!line.startsWith("data:")) continue;
              const jsonStr = line.slice(5).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;
              let evt;
              try { evt = JSON.parse(jsonStr); } catch { continue; }
              handleEvent(evt);
            }
          }
        } catch (e) {
          if (!(e && e.name === "AbortError")) console.error("converse stream read error", e);
        } finally {
          if (idle.timer) clearTimeout(idle.timer);
        }

        if (toolName === "reply") {
          flushSay(true);
          if (!emittedAnySay) send({ t: "say", text: humanizeText("Tell me a little more?") });
          return { kind: "reply" };
        }
        if (toolName === "ready") {
          let input = {};
          try { input = JSON.parse(partial); } catch { /* partial/invalid ready JSON → context backfill */ }
          return { kind: "ready", answers: readyAnswers(input, ctx) };
        }
        if (toolName === "resolve_person") {
          let input = {};
          try { input = JSON.parse(partial); } catch { /* partial → resolver soft-fails to none */ }
          return { kind: "resolve_person", tool: { id: toolId, name: "resolve_person", input } };
        }
        return { kind: "error" };
      };

      // First turn.
      let verdict = await consumeStream({ ...payload, stream: true });

      // TC-93: bounded ONE-hop precise-checker on the voice path. If she asked for resolve_person,
      // run the deterministic resolver, feed the result back, and recurse ONCE with tools limited to
      // reply/ready so she speaks the confirm/disambiguation line. Any failure degrades to error →
      // the client falls back to a normal non-stream reply (cvFallbackReply), so nothing breaks.
      if (verdict.kind === "resolve_person" && userId) {
        const result = await runResolvePerson(userId, verdict.tool.input);
        const followMessages = [...payload.messages, assistantToolUseBlock(verdict.tool), toolResultBlock(verdict.tool.id, result)];
        verdict = await consumeStream({
          model: MODEL, max_tokens: MAX_TOKENS, system: systemForCache(ctx),
          tools: toolsFor({ signedIn: true, onlyReplyReady: true }),
          tool_choice: force ? { type: "tool", name: "ready" } : { type: "any" },
          messages: followMessages, stream: true,
        });
        // A second resolve_person can't happen (tool dropped); if the follow-up errored, fall through.
      }

      if (verdict.kind === "reply") {
        send({ t: "reply_done" });
      } else if (verdict.kind === "ready") {
        send({ t: "ready", answers: verdict.answers });
      } else {
        // error, or a stray resolve_person we can't act on (no user / follow-up failed) → let the
        // client degrade to its non-stream fallback.
        send({ t: "error" });
      }
      end();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no", // discourage proxy buffering so sentences arrive as they stream
    },
  });
}

// One non-stream Anthropic call for the typed path. `tools`/`tool_choice` let the bounded second
// (post-resolve_person) call restrict to reply/ready. Returns the parsed JSON body or throws.
async function anthropicCall(apiKey, { ctx, messages, tools, tool_choice }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: systemForCache(ctx), tools, tool_choice, messages }),
  });
  if (!res.ok) { const detail = await res.text().catch(() => ""); const err = new Error("anthropic_error"); err.status = res.status; err.detail = detail; throw err; }
  return res.json();
}

// Turn a reply/ready tool_use into the client JSON response (byte-identical to the pre-TC-93 shape).
function replyOrReadyResponse(tool, ctx) {
  if (tool?.name === "reply") {
    const say = humanizeText(String(tool.input?.say || "").trim()) || "Tell me a little more?";
    return j({ action: "reply", say });
  }
  if (tool?.name === "ready") {
    return j({ action: "ready", answers: readyAnswers(tool.input, ctx) });
  }
  return null;
}

export default async (req) => {
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return j({ error: "bad_json" }, 400); }

  // TC-93: OPTIONAL sign-in → prime the roster (fails open to anon). Done for BOTH paths so the
  // person-aware conversation fires on the natural voice path even when no person is in focus.
  const auth = await primeAuth(req);

  // TC-88: the VOICE path sends stream:true; only then do we stream. Typed never sends it.
  if (body?.stream === true) return streamTurn(body, auth);

  const built = buildTurn(body, auth);
  if (built.error) return built.error;
  const { ctx, force, apiKey, payload, userId } = built;

  if (!apiKey) return j({ error: "not_configured", say: "I'm not quite set up yet. Try again in a moment." }, 200);

  let data;
  try {
    data = await anthropicCall(apiKey, { ctx, messages: payload.messages, tools: payload.tools, tool_choice: payload.tool_choice });
  } catch (e) {
    if (e?.message === "anthropic_error") { console.error("converse Anthropic error", e.status, e.detail); return j({ action: "reply", say: "I'm having a little trouble hearing you right now. Give me a moment and try again." }, 200); }
    console.error("converse fetch failed", e);
    return j({ action: "reply", say: "I lost my train of thought for a second. Could you say that again?" }, 200);
  }

  let tool = (data?.content || []).find((b) => b.type === "tool_use");

  // TC-93: the precise-checker round-trip (signed-in only). She reached for resolve_person on a
  // tricky name → run the deterministic resolver, feed the result back, and make ONE more call with
  // tools limited to reply/ready so she composes the confirm/disambiguation line. Bounded to ONE hop.
  if (tool?.name === "resolve_person" && userId) {
    const result = await runResolvePerson(userId, tool.input || {});
    const followMessages = [...payload.messages, assistantToolUseBlock(tool), toolResultBlock(tool.id, result)];
    try {
      const data2 = await anthropicCall(apiKey, { ctx, messages: followMessages, tools: toolsFor({ signedIn: true, onlyReplyReady: true }), tool_choice: force ? { type: "tool", name: "ready" } : { type: "any" } });
      tool = (data2?.content || []).find((b) => b.type === "tool_use");
    } catch (e) {
      // The bounded follow-up failed → degrade to a normal reply, conversation never breaks.
      console.error("converse resolve_person follow-up failed", e?.status || e);
      return j({ action: "reply", say: "Tell me a little more about them?" }, 200);
    }
  }

  const out = replyOrReadyResponse(tool, ctx);
  if (out) return out;

  // No tool call (shouldn't happen with tool_choice forced) — degrade gracefully.
  console.error("converse: no tool_use in response", JSON.stringify(data?.content || []).slice(0, 500));
  return j({ action: "reply", say: "Sorry, I drifted for a second. What's going on?" }, 200);
};
