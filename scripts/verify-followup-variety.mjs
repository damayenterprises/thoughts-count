// One-off verification harness for the follow-up-variety change (TC followup-variety).
// NOT part of the app. Reads ANTHROPIC_API_KEY from the repo .env and calls the model
// directly (no netlify dev — it can't read the masked secret on a linked folder),
// reusing the exact MODEL + generation prompt + tool schema from generate-background.mjs.
//
// It runs each situation twice: BEFORE (the prior prompt/schema, reconstructed inline)
// and AFTER (the live SYSTEM_PROMPT + PLAN_SCHEMA imported from generate-background.mjs),
// and prints, for each, whether she scheduled follow-ups and with what timing.
//
// Run:  node scripts/verify-followup-variety.mjs
// Keep keys server-side; never commit .env.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL,
  MAX_OUTPUT_TOKENS,
  PLAN_SCHEMA as PLAN_SCHEMA_AFTER,
  SYSTEM_PROMPT as SYSTEM_PROMPT_AFTER,
  buildUserMessage,
} from "../netlify/functions/generate-background.mjs";
import { herIdentity, HER_CHARACTER } from "../netlify/functions/_persona.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load ANTHROPIC_API_KEY from the repo .env (this worktree, then the main checkout) ──
function loadKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const candidates = [
    path.join(__dirname, "..", ".env"),
    // Worktree lives under <repo>/.claude/worktrees/<id>/; the real .env is at the repo root.
    path.join(__dirname, "..", "..", "..", "..", ".env"),
  ];
  for (const p of candidates) {
    try {
      const txt = fs.readFileSync(p, "utf8");
      const m = txt.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/m);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    } catch {}
  }
  throw new Error("ANTHROPIC_API_KEY not found in env or .env");
}
const API_KEY = loadKey();

// ── BEFORE: the prior prompt + schema, reconstructed exactly as they were pre-change. ──
// (Only the follow_up schema field and the two-line prompt principle differed.)
const SYSTEM_PROMPT_BEFORE = `${herIdentity()}

You are NOT a gift website, a greeting-card writer, or a generic chatbot. You are a thoughtful, emotionally intelligent guide. The person talking to you cares deeply and is a little afraid of getting it wrong. Your job is to replace their uncertainty with confidence.

Who you are (let this shape your voice, never state it): ${HER_CHARACTER}

Principles:
- Meet the real emotional weight of the moment. A death is not a promotion. Match your tone to what happened.
- Be specific to the details shared about this person and relationship. Never generic.
- A gift is only ONE possible answer, and often not the best one.
- Respect the relationship's closeness.
- Respect the stated budget and time.
- Be warm and human, never saccharine or clinical.
- Be concise. Each field is 1-3 sentences or 2-4 short items — quality over volume.

Always respond by calling the generate_action_plan tool. Never respond with plain text.`;

// A minimal schema whose follow_up field matches the OLD description ("2-3 timed follow-ups...").
const PLAN_SCHEMA_BEFORE = JSON.parse(JSON.stringify(PLAN_SCHEMA_AFTER));
PLAN_SCHEMA_BEFORE.properties.follow_up.description =
  "2-3 timed follow-ups for AFTER everyone else moves on, each with a specific small gesture.";
PLAN_SCHEMA_BEFORE.properties.follow_up.items.properties.when.description =
  "Human label for the timing, e.g. 'In two weeks', 'One month out', 'On the one-year anniversary'.";
PLAN_SCHEMA_BEFORE.properties.follow_up.items.properties.days_from_now.description =
  "Whole number of days from today when this follow-up should happen, so a calendar reminder can be set. E.g. 14 for two weeks, 30 for a month, 365 for a one-year anniversary. Must match 'when'.";

const SITUATIONS = [
  { label: "Friend's parent died", answers: { moment: "My friend's dad just passed away after a short illness", relationship: "close friend", name: "Sam", about: "We've known each other since college; he was very close to his dad" } },
  { label: "Coworker had a baby", answers: { moment: "A coworker just had their first baby", relationship: "coworker", name: "Priya", about: "Friendly at work but not close outside it" } },
  { label: "Big promotion", answers: { moment: "My friend just got a huge promotion to VP", relationship: "good friend", name: "Marcus", about: "He's worked toward this for years" } },
  { label: "Friend going through divorce", answers: { moment: "My friend is going through a hard divorce", relationship: "close friend", name: "Dana", about: "It's been messy and she's exhausted" } },
  { label: "Milestone birthday", answers: { moment: "My friend is turning 40 next week", relationship: "friend", name: "Leah", about: "She's a little anxious about the big number" } },
  { label: "Friend's minor surgery", answers: { moment: "My friend is having minor knee surgery on Thursday", relationship: "friend", name: "Tom", about: "Outpatient, but he's nervous about it" } },
];

async function callModel(system, schema, userMessage) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      tools: [{ name: "generate_action_plan", description: "Return a complete, personalized action plan for showing up in this moment.", input_schema: schema }],
      tool_choice: { type: "tool", name: "generate_action_plan" },
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const toolUse = (data.content || []).find((b) => b.type === "tool_use");
  return toolUse?.input || {};
}

function summarizeFollowups(plan) {
  const fu = Array.isArray(plan.follow_up) ? plan.follow_up : [];
  if (!fu.length) return "NONE";
  return fu.map((f) => `"${f.when}" (${f.days_from_now}d)`).join("  |  ");
}

const run = async () => {
  console.log(`Model: ${MODEL}\n`);
  for (const s of SITUATIONS) {
    const userMessage = buildUserMessage(s.answers);
    let before, after;
    try {
      [before, after] = await Promise.all([
        callModel(SYSTEM_PROMPT_BEFORE, PLAN_SCHEMA_BEFORE, userMessage),
        callModel(SYSTEM_PROMPT_AFTER, PLAN_SCHEMA_AFTER, userMessage),
      ]);
    } catch (e) {
      console.log(`### ${s.label}\n  ERROR: ${e.message}\n`);
      continue;
    }
    console.log(`### ${s.label}`);
    console.log(`  BEFORE: ${summarizeFollowups(before)}`);
    console.log(`  AFTER : ${summarizeFollowups(after)}`);
    console.log("");
  }
};

run().catch((e) => { console.error(e); process.exit(1); });
