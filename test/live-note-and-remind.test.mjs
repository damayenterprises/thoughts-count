// GATED LIVE test (BLOCKER 1) — the REAL model tool-selection for note_and_remind.
//
// WHY THIS EXISTS: spec-tc-capture-loop.test.mjs mocks Anthropic and hand-injects the reminders,
// so it can NOT catch the bug the UX gate found — that the REAL model was calling note_and_remind
// with reminders:[] every time, so nothing got scheduled even though Della spoke a specific promise.
// This test makes a REAL Anthropic call with the ACTUAL tools + system prompt the endpoint sends,
// and asserts that for an explicit-timing utterance the note_and_remind tool_use carries a non-empty
// `reminders` array with the right signed lead_days.
//
// It builds the request from the SAME exported pieces the live endpoint uses (systemForCache,
// toolsFor, MODEL) so it can never drift from production.
//
// GATING: it needs a real key. Run it with the key in the environment:
//   node --env-file=.env test/live-note-and-remind.test.mjs
// If ANTHROPIC_API_KEY is absent it SKIPS with a clear notice and exits 0 (so it is safe in the
// no-secrets offline CI gate). It is intentionally NOT part of the offline suite list.

import assert from "node:assert";
import { systemForCache, toolsFor, MODEL } from "../netlify/functions/converse.mjs";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.log("# live-note-and-remind: SKIPPED — no ANTHROPIC_API_KEY in the environment.");
  console.log("  Run the live check with:  node --env-file=.env test/live-note-and-remind.test.mjs");
  process.exit(0);
}

// Build the SAME payload buildTurn() sends. We test REMINDER EMISSION, not person resolution, so we
// use the ANON tool set (reply + ready + note_and_remind, NO resolve_person) and give the fact a
// person already established in the conversation via a prior assistant turn — so Della doesn't first
// reach for the precise-checker on a bare first name (that verify-WHO hop is correct product
// behavior, but it's a separate concern from "did she record the reminders the user stated?"). This
// isolates the bug the UX gate found: the note_and_remind reminders array coming back empty.
async function askDella(userText, { retries = 2 } = {}) {
  const payload = {
    model: MODEL,
    max_tokens: 600,
    system: systemForCache({ roster: [] }),
    tools: toolsFor({ signedIn: false }),          // anon set → no resolve_person to divert the turn
    tool_choice: { type: "any" },
    messages: [
      // Establish WHO up front so the capture turn is about reminder timing, not identity.
      { role: "user", content: "I want to tell you something about my friend Sarah Bennett." },
      { role: "assistant", content: "Of course — what's going on with Sarah?" },
      { role: "user", content: userText },
    ],
  };
  let lastErr = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      const tool = (data.content || []).find((b) => b.type === "tool_use");
      if (!tool) throw new Error("no tool_use in the response");
      return { name: tool.name, input: tool.input || {} };
    }
    lastErr = `Anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`;
    if (res.status < 500) break;                    // only retry transient 5xx (e.g. a 502 gateway blip)
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  throw new Error(lastErr);
}

const leadSet = (input) =>
  new Set((Array.isArray(input.reminders) ? input.reminders : []).map((r) => Number(r.lead_days)));

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); }
};

console.log("# LIVE model tool-selection — note_and_remind must carry the user's stated reminders\n");

await t("'a week before and the day of' → note_and_remind with lead_days {7, 0}", async () => {
  const { name, input } = await askDella(
    "She's having a baby, due April 20th 2027. Remind me a week before and again the day of."
  );
  assert.equal(name, "note_and_remind", `expected note_and_remind, got ${name}`);
  const leads = leadSet(input);
  assert.ok(leads.size >= 2, `expected >=2 reminders, got ${[...leads].join(",") || "(none)"}`);
  assert.ok(leads.has(7), `expected a 7-day-before reminder, got ${[...leads].join(",")}`);
  assert.ok(leads.has(0), `expected a day-of (0) reminder, got ${[...leads].join(",")}`);
});

await t("'a few days before and the day after' → includes a positive AND a NEGATIVE lead", async () => {
  const { name, input } = await askDella(
    "Her chemo is September 7th 2027. Check on me a few days before and again the day after."
  );
  assert.equal(name, "note_and_remind", `expected note_and_remind, got ${name}`);
  const leads = [...leadSet(input)];
  assert.ok(leads.some((n) => n > 0), `expected a 'before' (positive) reminder, got ${leads.join(",") || "(none)"}`);
  assert.ok(leads.some((n) => n < 0), `expected an 'after' (negative) reminder, got ${leads.join(",") || "(none)"}`);
});

await t("'set two reminders: 7 days before and 1 day before' → {7, 1}", async () => {
  const { name, input } = await askDella(
    "Her scan is on the 12th of March 2027. Set two reminders: 7 days before and 1 day before."
  );
  assert.equal(name, "note_and_remind", `expected note_and_remind, got ${name}`);
  const leads = leadSet(input);
  assert.ok(leads.has(7) && leads.has(1), `expected {7,1}, got ${[...leads].join(",") || "(none)"}`);
});

await t("no timing given → note_and_remind with EMPTY reminders (no invented cadence)", async () => {
  const { name, input } = await askDella("Just remember that she's having a baby in April.");
  // She may route to note_and_remind (capture) — whichever, reminders must NOT be fabricated.
  if (name === "note_and_remind") {
    assert.equal(leadSet(input).size, 0, `no timing was given, so reminders must be empty; got ${[...leadSet(input)].join(",")}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
