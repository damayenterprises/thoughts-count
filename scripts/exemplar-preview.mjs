// Thoughts Count — TC-59 before/after review harness (DEV ONLY, not shipped).
//
// The Netlify DRAFT-deploy preview can't complete a plan (background-function + Blobs
// scoping on draft URLs), so this runs the REAL production generation call locally —
// twice per scenario, craft library OFF vs ON — so Design/UX/David/Validator can see
// exactly how the exemplars shape a plan. It reuses the SAME MODEL, SYSTEM_PROMPT,
// PLAN_SCHEMA, and buildUserMessage as generate-background.mjs (imported, no drift);
// the ONLY difference between the two runs is buildExemplarBlock() appended to system.
//
// It does NOT resolve gift products / local places (that enrichment is unrelated to the
// craft copy under review) and writes nothing anywhere.
//
// Usage (from repo root, ANTHROPIC_API_KEY read from .env):
//   node scripts/exemplar-preview.mjs
//   node scripts/exemplar-preview.mjs bereavement     # run one scenario by key

import { readFileSync } from "node:fs";
import { MODEL, MAX_OUTPUT_TOKENS, PLAN_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from "../netlify/functions/generate-background.mjs";
import { bucketOf } from "../netlify/functions/_analytics.mjs";
import { getExemplars, buildExemplarBlock } from "../netlify/functions/_exemplars.mjs";

// --- read ANTHROPIC_API_KEY from .env (no dotenv dependency) ---
function loadKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  for (const path of [".env", "../thoughtfulness/.env"]) {
    try {
      const txt = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      const m = txt.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/m);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    } catch { /* try next */ }
  }
  return "";
}
const API_KEY = loadKey();
if (!API_KEY) { console.error("ANTHROPIC_API_KEY not found (env or .env)."); process.exit(1); }

// Scenarios chosen to exercise the seeded buckets, incl. the sensitive ones.
const SCENARIOS = {
  bereavement: { moment: "My close friend's mother just passed away after a long illness.", relationship: "a close friend", constraints: "" },
  illness_diagnosis: { moment: "My brother was just diagnosed with cancer and starts treatment soon.", relationship: "my brother", constraints: "" },
  new_baby: { moment: "My friend just had her first baby and is home from the hospital.", relationship: "a good friend", constraints: "" },
  job_loss: { moment: "My coworker was just laid off in a round of cuts.", relationship: "a coworker", constraints: "" },
};

async function generate(answers, useExemplars) {
  const bucket = bucketOf(answers);
  const block = useExemplars ? buildExemplarBlock(getExemplars(bucket)) : "";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT + block,
      tools: [{ name: "generate_action_plan", description: "Return a complete, personalized action plan for showing up in this moment.", input_schema: PLAN_SCHEMA }],
      tool_choice: { type: "tool", name: "generate_action_plan" },
      messages: [{ role: "user", content: buildUserMessage(answers) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  const tool = (data.content || []).find((b) => b.type === "tool_use");
  if (!tool) throw new Error("no tool_use in response");
  return { plan: tool.input, hadExemplars: !!block };
}

function show(label, plan) {
  const list = (arr) => (arr || []).map((x) => "     - " + (typeof x === "string" ? x : x.action)).join("\n");
  console.log(`\n  ── ${label} ──`);
  console.log(`   HEADLINE: ${plan.headline}`);
  console.log(`   WHAT TO SAY:\n${list(plan.what_to_say)}`);
  console.log(`   WHAT NOT TO SAY:\n${list(plan.what_not_to_say)}`);
  console.log(`   THOUGHTFUL ACTIONS:\n${list(plan.thoughtful_actions)}`);
  console.log(`   GIFT IDEAS: ${(plan.gift_ideas || []).length}  ·  SPEND: ${plan.spend_guidance}`);
}

async function runScenario(key) {
  const answers = SCENARIOS[key];
  const bucket = bucketOf(answers);
  console.log("\n" + "=".repeat(78));
  console.log(`SCENARIO: ${key}   (occasion=${bucket.occasion}, relationship=${bucket.relationship})`);
  console.log(`"${answers.moment}"`);
  const off = await generate(answers, false);
  const on = await generate(answers, true);
  if (!on.hadExemplars) console.log("  (note: this bucket has NO exemplars — both runs are identical by design)");
  show("LIBRARY OFF (today)", off.plan);
  show("LIBRARY ON (TC-59)", on.plan);
}

const only = process.argv[2];
const keys = only ? [only] : Object.keys(SCENARIOS);
for (const k of keys) {
  if (!SCENARIOS[k]) { console.error(`unknown scenario "${k}" — options: ${Object.keys(SCENARIOS).join(", ")}`); continue; }
  try { await runScenario(k); } catch (e) { console.error(`  scenario ${k} failed: ${e.message}`); }
}
console.log("\n" + "=".repeat(78) + "\nReview note: only the system prompt differs between OFF/ON (the exemplar block).\n");
