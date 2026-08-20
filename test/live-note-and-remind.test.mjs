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
import { systemForCache, toolsFor, MODEL, dispatchNoteAndRemind } from "../netlify/functions/converse.mjs";

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

// FIX 1 — the heart of the voice value prop: RELATIVE dates. Before the fix the model had no
// TODAY anchor, so "in 3 weeks" returned event_date:null, the note fell to a plain DURABLE, and
// every reminder the user asked for was silently dropped. With today's date injected into the
// system prompt she must now resolve the relative date to a concrete YYYY-MM-DD AND carry the
// reminders (including the negative "after" lead). This is the exact spec §4.1 primary example.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
await t("RELATIVE date 'in 3 weeks' → concrete event_date + reminders incl. a negative lead", async () => {
  const { name, input } = await askDella(
    "Her next chemo is in 3 weeks. Check on me a few days before and again the day after."
  );
  assert.equal(name, "note_and_remind", `expected note_and_remind, got ${name}`);
  assert.ok(
    ISO.test(String(input.event_date || "")),
    `expected a concrete YYYY-MM-DD event_date resolved from "in 3 weeks", got ${JSON.stringify(input.event_date)}`
  );
  const leads = [...leadSet(input)];
  assert.ok(leads.length >= 2, `expected >=2 reminders, got ${leads.join(",") || "(none)"}`);
  assert.ok(leads.some((n) => n > 0), `expected a 'before' (positive) lead, got ${leads.join(",")}`);
  assert.ok(leads.some((n) => n < 0), `expected an 'after' (negative) lead, got ${leads.join(",")}`);
});

// BEHAVIOR FLIP (2026-08): a dated note with NO stated timing now takes ONE server-seeded default
// nudge (a few days before). The MODEL must still return an EMPTY reminders array (it does not invent
// a cadence — the default is a SERVER concern), AND it must resolve a concrete event_date, AND Della's
// `say` must NAME a concrete date so the user knows the nudge is coming and can adjust it. This is the
// exact spec case: "she just started..." (undated) gets no nudge; a DATED no-timing note does.
const DATE_IN_SAY = /(january|february|march|april|may|june|july|august|september|october|november|december|\b\d{1,2}(st|nd|rd|th)\b|\b\d{4}-\d{2}-\d{2}\b)/i;
await t("DATED, no timing → note_and_remind, EMPTY reminders, concrete event_date, say names a date", async () => {
  const { name, input } = await askDella(
    "Just so you don't let me forget — her surgery is on September 7th 2027. I didn't say when to remind me."
  );
  assert.equal(name, "note_and_remind", `expected note_and_remind, got ${name}`);
  // The model does NOT fabricate a cadence — the single default is seeded by the server, not the model.
  assert.equal(leadSet(input).size, 0, `model must leave reminders empty (server seeds the default); got ${[...leadSet(input)].join(",")}`);
  // She must resolve a concrete date so a default nudge can lead from it.
  assert.ok(ISO.test(String(input.event_date || "")), `expected a concrete YYYY-MM-DD event_date, got ${JSON.stringify(input.event_date)}`);
  // And she must NAME a concrete date in her spoken line so the default nudge is transparent + editable.
  assert.ok(DATE_IN_SAY.test(String(input.say || "")), `say should name a concrete date the nudge lands on; got: ${JSON.stringify(input.say)}`);
});

await t("UNDATED durable fact → no nudge promised (default applies only to dated moments)", async () => {
  const { name, input } = await askDella("Just remember that she just started a new job.");
  // Whatever she routes to, she must NOT fabricate a reminder cadence, and (if she captures) her say
  // should not promise a nudge for a fact with no date to lead from.
  if (name === "note_and_remind") {
    assert.equal(leadSet(input).size, 0, `no date to lead from → no reminder; got ${[...leadSet(input)].join(",")}`);
  }
});

// SELF-KNOWLEDGE / TEACHING — when a user asks "how does this work / what can you do", Della must
// actually TEACH: explain (in her own voice) that she remembers the people + moments, and that she
// can set/change reminders — one OR several. We assert on the CONCEPTS being present, not exact
// wording, so it stays robust to her voice varying every time. We open cold (no prior person) and
// ask the meta question, then read whatever she speaks — the reply tool's `say`, or a note's `say`.
async function askDellaCold(userText, { retries = 2 } = {}) {
  const payload = {
    model: MODEL,
    max_tokens: 600,
    system: systemForCache({ roster: [] }),
    tools: toolsFor({ signedIn: false }),
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: userText }],
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
      return { name: tool.name, input: tool.input || {}, say: String((tool.input || {}).say || "") };
    }
    lastErr = `Anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`;
    if (res.status < 500) break;
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  throw new Error(lastErr);
}

await t("'how does this work / what can you do' → she TEACHES: remembers people + can set/change reminders (multiple possible)", async () => {
  const { name, say } = await askDellaCold(
    "I'm new here — what can you do, and how does this all work?"
  );
  // She should explain, not silently route to a capture (nothing was told to remember yet).
  assert.equal(name, "reply", `expected her to explain via reply, got ${name}`);
  const s = say.toLowerCase();
  assert.ok(say.trim().length > 0, "she said nothing");
  console.log(`\n    --- her explanation ---\n    ${say.replace(/\n/g, "\n    ")}\n    -----------------------`);
  // CONCEPT 1: she remembers the people / moments that matter.
  assert.ok(/rememb|hold onto|hold on to|keep track|carry/.test(s), `should convey she REMEMBERS; got: ${say}`);
  assert.ok(/people|person|someone|who matter|matter to you|friend|the people/.test(s), `should reference the people she remembers; got: ${say}`);
  // CONCEPT 2: reminders can be set — and are adjustable / can be more than one.
  assert.ok(/remind|nudge|heads[- ]?up|check on|check in|let you know/.test(s), `should convey she can REMIND/nudge; got: ${say}`);
  assert.ok(
    /change|adjust|remove|drop|more than one|another|several|multiple|one or |as many|whenever you|times you|when you want|day before|day of|day after|week before/.test(s),
    `should convey reminders are flexible/changeable OR that more than one is possible; got: ${say}`
  );
});

// ---------------------------------------------------------------------------------------------
// NO-FALSE-PROMISE — Della must only claim "done / I'll nudge you" when it is TRULY saved.
// These drive the REAL model + the REAL dispatchNoteAndRemind so a mock can't hide the bug David hit
// live (she said "Done, I'll nudge you on <date>" before anything was saved). Runs anon (no DB) so
// dispatch's own contract (noted_anon / confirm_who / noted) is exercised without a live Supabase.
// ---------------------------------------------------------------------------------------------
const PROMISES_DONE = /\bdone\b|i'll nudge you|i'll remind you|\bsaved\b|it's set|all set/i;

console.log("\n# NO-FALSE-PROMISE — she never declares done before it is saved\n");

// (a) SIGNED-OUT dated note → the model may say whatever, but dispatch OVERRIDES the spoken line to a
// value-first sign-in invite: signInPrompt true, and NO done/nudge promise survives.
await t("(a) signed-out dated note → noted_anon, signInPrompt, say makes NO done/nudge promise", async () => {
  const { name, input } = await askDella(
    "My sister is moving on October 1st 2027. Remind me a week before."
  );
  assert.equal(name, "note_and_remind", `expected note_and_remind, got ${name}`);
  // Drive dispatch as an ANONYMOUS user (userId null) — the authoritative override runs here.
  const out = await dispatchNoteAndRemind(null, input, {});
  assert.equal(out.action, "noted_anon", `anon should route to noted_anon, got ${out.action}`);
  assert.equal(out.signInPrompt, true, "anon must surface the sign-in prompt");
  assert.ok(!PROMISES_DONE.test(out.say), `anon say must NOT promise done/nudge; got: ${out.say}`);
  assert.ok(/sign(ed)? in/i.test(out.say), `anon say should invite sign-in; got: ${out.say}`);
});

// (b) SIGNED-IN, UNKNOWN person: with a saved roster that does NOT contain the sister, the model
// should FIRST ask the name via reply (verify-on-doubt) rather than confidently declaring done. We
// assert on the model's OWN choice with the signed-in tool set + a roster the person isn't in.
async function askDellaSignedIn(userText, roster, { retries = 2 } = {}) {
  const payload = {
    model: MODEL,
    max_tokens: 600,
    system: systemForCache({ roster }),
    tools: toolsFor({ signedIn: true }),
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: userText }],
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
      return { name: tool.name, input: tool.input || {}, say: String((tool.input || {}).say || "") };
    }
    lastErr = `Anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`;
    if (res.status < 500) break;
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  throw new Error(lastErr);
}

await t("(b) signed-in, UNKNOWN person → asks the name (reply) OR routes to a who-check, NEVER 'done'", async () => {
  // Roster deliberately excludes any "sister" / the name — so the sister is a person she doesn't know.
  const roster = [{ name: "Marcus", detail: "coworker" }, { name: "Priya", detail: "college friend" }];
  const { name, say } = await askDellaSignedIn(
    "My sister is moving on October 1st 2027. Remind me a week before.",
    roster
  );
  // She must NOT confidently declare done for someone she hasn't identified. Acceptable: reply asking
  // the name. If she DID route to note_and_remind, dispatch would confirm_who (server-side override);
  // either way her SPOKEN line must not promise done before who-it-is is settled.
  assert.ok(!PROMISES_DONE.test(say), `must not declare done for an unknown person; got (${name}): ${say}`);
  if (name === "reply") {
    assert.ok(/name|who|which|sister/i.test(say), `a reply here should be asking who; got: ${say}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
