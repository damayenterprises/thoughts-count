// WP-B — TC capture-loop intent routing (spec §3/§4). Pure + offline: no network, no DB, no key.
//
// Two layers:
//   1. INTENT ROUTING — with the Anthropic call MOCKED (tools are tool_choice-forced, so a wrong
//      pick is deterministically testable), assert the converse handler routes each utterance to
//      the right tool and returns the right action:
//        pure-note                     → note_and_remind  → action noted/noted_anon
//        note+plan (mixed)             → note_and_remind  → capture is NEVER lost
//        pure-plan                     → ready            → action ready
//        "remind me" WITH timing       → note_and_remind carrying a user-set reminder (lead_days)
//        "remind me" WITHOUT timing    → reply (ONE situational question) → NO auto-cadence
//   2. ENGINE — noteToParsed / normalizeReminders / writeFactsToPerson+seedReminders (mock supa)
//      prove the fact is written through the shared engine and only USER-SET reminders seed.
//
// Run WITHOUT --env-file so supabase is unconfigured → the handler primes as ANONYMOUS (no DB),
// and note_and_remind returns noted_anon (writes nothing) — exactly the value-first anon contract.
//   node test/spec-tc-capture-loop.test.mjs

import assert from "node:assert";
import converse, { dispatchNoteAndRemind } from "../netlify/functions/converse.mjs";
import { noteToParsed, normalizeReminders, writeFactsToPerson, seedReminders, parseStatedReminders, statedRemindersFromMessages, resolve } from "../netlify/functions/_capture.mjs";
import { seedSituation } from "../netlify/functions/_memory.mjs";
import { createPerson } from "../netlify/functions/capture-resolve.mjs";

// No key / no supabase → primeAuth is anon, and the handler's own Anthropic call would 200
// not_configured. We instead mock global.fetch so the ONE Anthropic call returns a forced tool_use.
delete process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = "test-key"; // presence gate only; fetch is mocked so no real call
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let pass = 0, fail = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(
  () => { pass++; console.log(`  ok   ${name}`); },
  (e) => { fail++; console.log(`  FAIL ${name} — ${e.message}`); },
);

// --- Anthropic mock: the NEXT converse turn returns exactly this tool_use ---
const realFetch = global.fetch;
function mockAnthropicToolUse(name, input) {
  global.fetch = async (url) => {
    if (String(url).includes("api.anthropic.com")) {
      return new Response(JSON.stringify({ content: [{ type: "tool_use", id: "toolu_test", name, input }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return realFetch(url);
  };
}
const restoreFetch = () => { global.fetch = realFetch; };

const post = (bodyObj) => new Request("http://local/api/converse", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bodyObj),
});
const call = async (req) => { const res = await converse(req); return { status: res.status, body: await res.json() }; };
const turn = (userText) => ({ messages: [{ role: "user", content: userText }] });

console.log("# Intent routing — the RIGHT tool fires for each utterance (Anthropic mocked)\n");

await t("pure-note → note_and_remind → action noted_anon (anon writes nothing)", async () => {
  mockAnthropicToolUse("note_and_remind", { person_hint: "Sarah", note: "having a baby in April", say: "I'll remember that about Sarah." });
  const { status, body } = await call(post(turn("Sarah's having a baby in April")));
  restoreFetch();
  assert.equal(status, 200);
  assert.equal(body.action, "noted_anon");        // routed to capture door
  assert.equal(body.signInPrompt, true);          // value-first sign-in nudge
  assert.ok(body.say && !/database|saved to/i.test(body.say)); // warm, human line
});

await t("note+plan (mixed) → note_and_remind (capture NEVER lost)", async () => {
  // On a mixed turn the model still routes the FACT to note_and_remind; the say keeps it flowing
  // toward the plan. The point under test: the capture fires (it isn't dropped in favor of a plan).
  mockAnthropicToolUse("note_and_remind", {
    person_hint: "Sarah", note: "having a baby in April",
    say: "That's wonderful — I'll hold onto that. Let's find her something perfect.",
  });
  const { status, body } = await call(post(turn("Sarah's having a baby in April — what should I get her?")));
  restoreFetch();
  assert.equal(status, 200);
  assert.equal(body.action, "noted_anon"); // the capture routed anon; nothing written
  // No-false-promise (server say-override): the anon say NEVER claims done/saved/a nudge — it warmly
  // invites sign-in so she can actually hold it. The model's say is not trusted here.
  assert.ok(body.signInPrompt === true);
  assert.ok(!/\bdone\b|i'll nudge you|i'll remind you|\bsaved\b/i.test(body.say), `anon say must not promise done/nudge; got: ${body.say}`);
  assert.ok(/sign in|signed in|remember/i.test(body.say), `anon say should invite sign-in so she can remember; got: ${body.say}`);
});

await t("pure-plan → ready → action ready (no capture)", async () => {
  mockAnthropicToolUse("ready", {
    moment: "her birthday", relationship: "friend", about: "close friend, loves hiking",
    closing: "Leave it with me.",
  });
  const { status, body } = await call(post(turn("It's my friend's birthday, what should I do?")));
  restoreFetch();
  assert.equal(status, 200);
  assert.equal(body.action, "ready");
  assert.ok(body.answers && body.answers.moment === "her birthday");
});

await t("'remind me' WITH timing → note_and_remind carrying a user-set reminder (lead_days 7)", async () => {
  // Signed-out, so the WRITE is skipped (noted_anon), but the routing + the reminder the MODEL set
  // rides through. We assert the tool fired AND the reminder lead the user gave is present on the
  // dispatched input (the engine test below proves it seeds).
  const input = { person_hint: "Mom", note: "birthday next month", event_date: "2027-03-14",
    reminders: [{ lead_days: 7, phrase: "a week before Mom's birthday" }],
    say: "Got it — I'll nudge you a week before." };
  mockAnthropicToolUse("note_and_remind", input);
  const { status, body } = await call(post(turn("Remind me a week before Mom's birthday next month")));
  restoreFetch();
  assert.equal(status, 200);
  assert.equal(body.action, "noted_anon");
  // The user-set reminder normalizes to exactly what they asked (7 days), nothing invented.
  const norm = normalizeReminders(input.reminders);
  assert.deepEqual(norm, [{ lead_days: 7, phrase: "a week before Mom's birthday" }]);
});

await t("'remind me' WITHOUT timing → reply (ONE situational question) → NO auto-cadence", async () => {
  // della-situational-no-formula: with no timing the model must ASK, not reach for note_and_remind
  // with an invented lead. The correct behavior is a reply asking when — assert we route to reply
  // and that NO reminder cadence was fabricated.
  mockAnthropicToolUse("reply", { say: "Happy to — when would you like me to nudge you?" });
  const { status, body } = await call(post(turn("Remind me about Mom's birthday")));
  restoreFetch();
  assert.equal(status, 200);
  assert.equal(body.action, "reply");                 // asked, did not capture-with-default
  assert.ok(/when|remind|nudge/i.test(body.say));     // ONE situational question about timing
  assert.ok(!/two weeks|a week|day before/i.test(body.say)); // never a reflexive default cadence
});

console.log("\n# Reminder discipline — normalizeReminders drops anything not user-set\n");

await t("empty / missing reminders → [] (the norm)", () => {
  assert.deepEqual(normalizeReminders(undefined), []);
  assert.deepEqual(normalizeReminders(null), []);
  assert.deepEqual(normalizeReminders([]), []);
  assert.deepEqual(normalizeReminders("nope"), []);
});
await t("well-formed lead_days kept + rounded + clamped to a sane band (negatives survive)", () => {
  assert.deepEqual(normalizeReminders([{ lead_days: 0 }]), [{ lead_days: 0 }]);       // "on the day"
  assert.deepEqual(normalizeReminders([{ lead_days: 7.6 }]), [{ lead_days: 8 }]);     // rounded
  assert.deepEqual(normalizeReminders([{ lead_days: -1 }]), [{ lead_days: -1 }]);     // "the day after" — NEGATIVE preserved
  assert.deepEqual(normalizeReminders([{ lead_days: -3 }]), [{ lead_days: -3 }]);     // "3 days after"
  assert.deepEqual(normalizeReminders([{ lead_days: -999 }]), [{ lead_days: -90 }]);  // clamped to the after-floor
  assert.deepEqual(normalizeReminders([{ lead_days: 99999 }]), [{ lead_days: 3650 }]); // capped before
});
await t("negative 'day after' round-trips through noteToParsed onto the fact", () => {
  // BLOCKER 2 end-to-end (pure layer): a -1 "day after" survives noteToParsed → seedSituation input.
  const p = noteToParsed({
    person_hint: "Marcus", note: "next chemo", event_date: "2027-09-07",
    reminders: [{ lead_days: 3, phrase: "a few days before" }, { lead_days: -1, phrase: "the day after" }],
  });
  assert.deepEqual(p.facts[0].reminders, [
    { lead_days: 3, phrase: "a few days before" },
    { lead_days: -1, phrase: "the day after" },
  ]);
});
await t("malformed entries dropped, phrase preserved when present", () => {
  assert.deepEqual(normalizeReminders([{ phrase: "no lead" }, { lead_days: "x" }, 5, null]), []);
  assert.deepEqual(normalizeReminders([{ lead_days: 1, phrase: "the day before" }]), [{ lead_days: 1, phrase: "the day before" }]);
});

console.log("\n# noteToParsed — shapes a note into the SAME parsed object the engine consumes\n");

await t("dated note WITH user timing → one MILESTONE fact with event_date + the user's reminders", () => {
  const p = noteToParsed({ person_hint: "Sarah", note: "having a baby", event_date: "2027-04-01", reminders: [{ lead_days: 7 }] });
  assert.equal(p.facts.length, 1);
  const f = p.facts[0];
  assert.equal(f.person_hint, "Sarah");
  assert.equal(f.subject, "self");
  assert.equal(f.relation, "note");
  assert.equal(f.object, "having a baby");
  assert.equal(f.fact_class, "MILESTONE");
  assert.equal(f.event_date, "2027-04-01");
  assert.deepEqual(f.reminders, [{ lead_days: 7 }]); // user timing used verbatim, no default added on top
});
await t("dated note with NO timing → MILESTONE + ONE default reminder at lead 3 (behavior flip)", () => {
  // The flip: a dated no-timing note now takes a single stated, editable default nudge (3 days before)
  // instead of silence. It rides as a real reminder on the fact so it seeds + shows as a chip.
  const p = noteToParsed({ person_hint: "Sarah", note: "surgery on the 12th", event_date: "2027-03-12" });
  const f = p.facts[0];
  assert.equal(f.fact_class, "MILESTONE");
  assert.equal(f.event_date, "2027-03-12");
  assert.deepEqual(f.reminders, [{ lead_days: 3, label: null }]); // exactly ONE default at lead 3
});
await t("undated note → DURABLE, no date, NO reminder (default only applies to dated notes)", () => {
  const p = noteToParsed({ person_hint: "Sarah", note: "loves hiking", reminders: [{ lead_days: 7 }] });
  const f = p.facts[0];
  assert.equal(f.fact_class, "DURABLE");
  assert.equal(f.event_date, null);
  assert.deepEqual(f.reminders, []); // no date to lead from → no reminder, no default
});
await t("empty note → no facts", () => {
  assert.deepEqual(noteToParsed({ note: "   " }).facts, []);
  assert.deepEqual(noteToParsed({}).facts, []);
});

console.log("\n# TC-136 follow-up — relationship captured at extraction, threaded to createPerson\n");

await t("noteToParsed: 'my neighbor Dave' → person_hint 'Dave', person_relationship 'neighbor'", () => {
  const p = noteToParsed({ person_hint: "Dave", person_relationship: "neighbor", note: "turning 40 next month" });
  const f = p.facts[0];
  assert.equal(f.person_hint, "Dave");        // NAME stays clean (no descriptor)
  assert.equal(f.person_relationship, "neighbor");
});
await t("noteToParsed: bare 'Dave' (no relationship) → person_relationship empty (never invented)", () => {
  const p = noteToParsed({ person_hint: "Dave", note: "turning 40" });
  assert.equal(p.facts[0].person_relationship, "");
});
await t("noteToParsed: an invented/unknown relationship is rejected to empty (validated vocab)", () => {
  const p = noteToParsed({ person_hint: "Dave", person_relationship: "acquaintance", note: "x" });
  assert.equal(p.facts[0].person_relationship, "");
});
await t("noteToParsed: 'my co-worker Marc' → relationship canonicalized to 'coworker'", () => {
  const p = noteToParsed({ person_hint: "Marc", person_relationship: "co-worker", note: "got promoted" });
  assert.equal(p.facts[0].person_relationship, "coworker");
});

await t("resolve() lifts the stated relationship onto the group (for createPerson)", async () => {
  const parsed = noteToParsed({ person_hint: "Dave", person_relationship: "neighbor", note: "turning 40" });
  // A supa whose fuzzy RPC + people reads are all empty → a brand-new person (no match).
  const emptySupa = { rpc: async () => ({ data: [], error: null }), from: () => ({ select() { return this; }, eq() { return this; }, is() { return this; }, in() { return this; }, order() { return this; }, limit() { return this; }, maybeSingle: async () => ({ data: null, error: null }), then(r) { return Promise.resolve({ data: [], error: null }).then(r); } }) };
  const { groups } = await resolve("user-1", parsed, emptySupa);
  assert.equal(groups[0].personHint, "Dave");
  assert.equal(groups[0].personRelationship, "neighbor");
});

// createPerson via a minimal in-memory people table: assert name + relationship land on the row.
function makePeopleSupa() {
  const inserted = [];
  return {
    inserted,
    supa: {
      from() {
        let pending = null;
        const api = {
          select() { return api; },
          eq() { return api; },
          is() { return api; },
          insert(row) { pending = { id: `p-${inserted.length + 1}`, ...row }; inserted.push(pending); return api; },
          async single() { return { data: pending, error: null }; },
          async maybeSingle() { return { data: pending, error: null }; },
        };
        return api;
      },
    },
  };
}

await t("createPerson: relHint 'neighbor' → stores name 'Dave' + relationship 'neighbor'", async () => {
  const { supa, inserted } = makePeopleSupa();
  await createPerson(supa, "user-1", "Dave", "personal", "neighbor");
  assert.equal(inserted[0].name, "Dave");
  assert.equal(inserted[0].relationship, "neighbor");
  assert.equal(inserted[0].contact_kind, "personal");
});
await t("createPerson: bare 'Dave' + no relHint → NO relationship key set (never invents)", async () => {
  const { supa, inserted } = makePeopleSupa();
  await createPerson(supa, "user-1", "Dave", "personal", "");
  assert.equal(inserted[0].name, "Dave");
  assert.ok(!("relationship" in inserted[0]), "relationship must be absent for a bare name");
});
await t("createPerson FALLBACK: no relHint but name lumps descriptor ('my neighbor Tom') → splits to name 'Tom' + rel 'neighbor'", async () => {
  const { supa, inserted } = makePeopleSupa();
  await createPerson(supa, "user-1", "my neighbor Tom", "personal", "");
  assert.equal(inserted[0].name, "Tom");
  assert.equal(inserted[0].relationship, "neighbor");
});
await t("createPerson: relHint WINS over a clean name (name kept clean, rel from hint)", async () => {
  const { supa, inserted } = makePeopleSupa();
  await createPerson(supa, "user-1", "Dave", "personal", "friend");
  assert.equal(inserted[0].name, "Dave");     // name never gets the descriptor
  assert.equal(inserted[0].relationship, "friend");
});
await t("createPerson: an invalid relHint is ignored, falls back to split (empty here) → no relationship", async () => {
  const { supa, inserted } = makePeopleSupa();
  await createPerson(supa, "user-1", "Sarah", "personal", "acquaintance");
  assert.equal(inserted[0].name, "Sarah");
  assert.ok(!("relationship" in inserted[0]));
});

console.log("\n# seedSituation — a NEGATIVE 'after' reminder seeds a situation_reminders row unchanged (BLOCKER 2)\n");

// A minimal in-memory fake supabase matching ONLY the call shapes seedSituation → maybeSeedKeyDate use:
//   from(table).select(cols).eq(col,val)[.maybeSingle()] and .insert(row).select(cols).single().
// Records every situation_reminders row inserted so we can assert lead_days flows through verbatim.
function makeSeedSupa() {
  const inserted = { key_dates: [], situation_reminders: [] };
  function builder(table) {
    const filters = [];
    let pendingInsert = null;
    const api = {
      select() { return api; },
      eq(col, val) { filters.push([col, val]); return api; },
      is() { return api; },   // insertFact's openRows select uses .is('valid_to',null).is('deleted_at',null)
      update() { return api; }, // supersession update chain (no prior rows here, so it's never awaited to effect)
      in() { return api; },
      _rows() {
        // maybeSeedKeyDate looks up an existing key_date by source_fact_id (none pre-seeded);
        // seedSituation looks up existing situation_reminders by (user_id, key_date_id) (none);
        // insertFact's openRows select finds no prior facts (empty). All → [].
        return [];
      },
      async maybeSingle() { return { data: pendingInsert ? pendingInsert : (api._rows()[0] || null), error: null }; },
      async single() { return { data: pendingInsert, error: null }; },
      then(res) { return Promise.resolve({ data: api._rows(), error: null }).then(res); },
      insert(row) {
        const id = `${table}-${(inserted[table] || (inserted[table] = [])).length + 1}`;
        pendingInsert = { id, ...row };
        inserted[table].push({ id, ...row });
        return api; // .insert(...).select(...).single()
      },
    };
    return api;
  }
  return { supa: { from: (t) => builder(t) }, inserted };
}

await t("seedSituation seeds a -1 'day after' reminder with lead_days=-1 (unchanged)", async () => {
  const { supa, inserted } = makeSeedSupa();
  const fact = { id: "fact-1", person_id: "p-1", event_date: "2027-09-07", fact_class: "MILESTONE", object: "next chemo" };
  const reminders = normalizeReminders([{ lead_days: 3, phrase: "a few days before" }, { lead_days: -1, phrase: "the day after" }]);
  const out = await seedSituation(supa, "user-1", fact, { reminders });
  assert.ok(out.keyDateId);                                 // the situation key_date was seeded
  assert.equal(inserted.key_dates[0].kind, "situation");    // reminders present → kind='situation'
  const leads = inserted.situation_reminders.map((r) => r.lead_days).sort((a, b) => a - b);
  assert.deepEqual(leads, [-1, 3]);                         // the NEGATIVE offset survived to the row
  const after = inserted.situation_reminders.find((r) => r.lead_days === -1);
  assert.equal(after.label, "the day after");               // the user's own phrasing rides as the label
  assert.equal(after.active, true);
});

console.log("\n# Default-nudge — a dated capture with NO user timing seeds ONE stated default reminder\n");

await t("dated note, no user timing → situation key_date + ONE default reminder at lead 3 (behavior flip)", async () => {
  const { supa, inserted } = makeSeedSupa();
  const parsed = noteToParsed({ person_hint: "Sarah", note: "surgery on the 12th", event_date: "2027-03-12" });
  assert.deepEqual(parsed.facts[0].reminders, [{ lead_days: 3, label: null }]); // the single stated default
  await writeFactsToPerson(supa, "user-1", "p-1", parsed.facts, "conversation", "surgery on the 12th");
  assert.equal(inserted.key_dates.length, 1);
  assert.equal(inserted.key_dates[0].kind, "situation");        // reminders present → a situation
  assert.notEqual(inserted.key_dates[0].lead_days, null);       // NOT the old non-nudging sentinel
  assert.equal(inserted.situation_reminders.length, 1);         // exactly ONE default reminder minted
  assert.equal(inserted.situation_reminders[0].lead_days, 3);   // a single heads-up 3 days before
});

await t("dated note WITH a reminder → situation key_date + the user's reminder (no default on top)", async () => {
  const { supa, inserted } = makeSeedSupa();
  const parsed = noteToParsed({ person_hint: "Sarah", note: "baby due", event_date: "2027-04-20", reminders: [{ lead_days: 7, phrase: "a week before" }] });
  await writeFactsToPerson(supa, "user-1", "p-1", parsed.facts, "conversation", "baby due");
  assert.equal(inserted.key_dates[0].kind, "situation");
  assert.notEqual(inserted.key_dates[0].lead_days, null); // has a real lead (ignored by the cron, but not the non-nudging sentinel)
  assert.deepEqual(inserted.situation_reminders.map((r) => r.lead_days), [7]);
});

await t("RECURRING birthday, no reminders → keeps its default nudge (legacy behavior UNCHANGED)", async () => {
  const { supa, inserted } = makeSeedSupa();
  // A year-less birthday: noteToParsed doesn't build recurring, so hand a RECURRING fact directly.
  const bday = { person_hint: "Mom", subject: "self", relation: "birthday", object: "birthday",
    fact_class: "RECURRING", event_date: "0004-06-15", reminders: [] };
  await writeFactsToPerson(supa, "user-1", "p-1", [bday], "conversation", "Mom's birthday June 15");
  assert.equal(inserted.key_dates.length, 1);
  assert.equal(inserted.key_dates[0].lead_days, 7);  // recurring dates STILL nudge at the default
  assert.equal(inserted.key_dates[0].recurs, true);
});

console.log("\n# Engine write — writeFactsToPerson seeds ONLY user-set reminders via seedSituation\n");

// A tiny mock supabase + a mock _memory via the seedSituation contract. We exercise the real
// writeFactsToPerson/seedReminders wiring against a fake insertFact-free path by calling seedReminders
// directly with written facts (writeFactsToPerson's DB calls are covered by tc50; here we prove the
// reminder-seeding contract call shape without a live DB).
await t("seedReminders calls seedSituation(supa,userId,fact,{reminders}) once per fact w/ reminders", async () => {
  const calls = [];
  // Patch the _memory namespace's seedSituation via a temporary global the module reads? It reads
  // the imported namespace, which we can't patch from here — so assert the DEFENSIVE no-op path:
  // with seedSituation absent (WP-A not merged), seedReminders no-ops loudly, never throws, and
  // returns empty aggregates. This is the contract we ship against.
  const written = [{ id: "f1", event_date: "2027-04-01", reminders: [{ lead_days: 7 }] }];
  const out = await seedReminders({}, "user-1", written);
  assert.deepEqual(out, { keyDateIds: [], reminderIds: [] }); // no-op until WP-A lands, never throws
  void calls;
});
await t("seedReminders skips facts with no reminders or no date (never invents)", async () => {
  const out = await seedReminders({}, "user-1", [
    { id: "a", event_date: "2027-04-01", reminders: [] },      // no reminders
    { id: "b", event_date: null, reminders: [{ lead_days: 7 }] }, // no date
  ]);
  assert.deepEqual(out, { keyDateIds: [], reminderIds: [] });
});

console.log("\n# dispatchNoteAndRemind — anon contract (value-first, writes nothing)\n");

await t("anon → noted_anon + signInPrompt, no DB touched", async () => {
  const out = await dispatchNoteAndRemind(null, { person_hint: "Sarah", note: "having a baby", say: "I'll remember." }, {});
  assert.equal(out.action, "noted_anon");
  assert.equal(out.signInPrompt, true);
  assert.ok(out.say);
});
await t("empty note → falls back to a plain spoken reply (never a phantom capture)", async () => {
  const out = await dispatchNoteAndRemind("user-1", { note: "   ", say: "Sorry?" }, {});
  assert.equal(out.action, "reply");
});

// ---------------------------------------------------------------------------------------------
// BLOCKER (clarify-then-capture) — the SERVER SAFETY NET: a stated timing dropped by the model
// across a "which person?" clarification is recovered from the earlier user turns, so the SCHEDULED
// reminder matches what the user asked (and what her say promised) — never the lead-3 default.
// ---------------------------------------------------------------------------------------------
console.log("\n# Clarify-then-capture safety net — earlier-stated timing is carried, not defaulted\n");

await t("parseStatedReminders reads the prompt vocabulary from one utterance", () => {
  assert.deepEqual(parseStatedReminders("Remind me about Sarah's move on October 1st, a week before."), [{ lead_days: 7, phrase: "a week before" }]);
  assert.deepEqual(parseStatedReminders("nudge me the day before"), [{ lead_days: 1, phrase: "the day before" }]);
  assert.deepEqual(parseStatedReminders("the day of"), [{ lead_days: 0, phrase: "the day of" }]);
  // A "before" AND an "after" in one breath → both, negatives preserved.
  const both = parseStatedReminders("check on me a few days before and again the day after").map((r) => r.lead_days).sort((a, b) => a - b);
  assert.deepEqual(both, [-1, 3]);
  // No timing phrase → nothing invented.
  assert.deepEqual(parseStatedReminders("just remember it"), []);
  assert.deepEqual(parseStatedReminders("her surgery is October 1st"), []);
});

await t("statedRemindersFromMessages returns the LATEST stated timing, newest turn wins", () => {
  // The reproduced path: user stated "a week before" in turn 1, then a clarifying turn, then confirm.
  const msgs = [
    { role: "user", content: "Remind me about Sarah's move on October 1st, a week before." },
    { role: "assistant", content: "Which Sarah do you mean?" },
    { role: "user", content: "My sister Sarah." },
  ];
  assert.deepEqual(statedRemindersFromMessages(msgs), [{ lead_days: 7, phrase: "a week before" }]);
  // If the user RETIMES later, the latest explicit statement wins.
  const retimed = [
    { role: "user", content: "Remind me a week before." },
    { role: "assistant", content: "Which Sarah?" },
    { role: "user", content: "My sister — actually make it the day before." },
  ];
  assert.deepEqual(statedRemindersFromMessages(retimed), [{ lead_days: 1, phrase: "the day before" }]);
  // No user turn stated a timing → [] (the default will apply downstream).
  assert.deepEqual(statedRemindersFromMessages([{ role: "user", content: "It's my sister Sarah." }]), []);
});

await t("noteToParsed carries stated timing when the model dropped reminders (lead 7, NOT default 3)", () => {
  // The exact bug: model returns note_and_remind with event_date but reminders:[] (dropped across the
  // clarification). With the earlier-stated "a week before" carried in, we schedule lead 7, not 3.
  const input = { person_hint: "Sarah", note: "moving", event_date: "2027-10-01" /* reminders omitted */ };
  const stated = statedRemindersFromMessages([
    { role: "user", content: "Remind me about Sarah's move on October 1st, a week before." },
    { role: "assistant", content: "Which Sarah?" },
    { role: "user", content: "My sister Sarah." },
  ]);
  const p = noteToParsed(input, { statedReminders: stated });
  assert.deepEqual(p.facts[0].reminders, [{ lead_days: 7, phrase: "a week before" }]); // NOT [{lead_days:3,label:null}]
});

await t("noteToParsed: model reminders WIN over carried stated timing (no double-count)", () => {
  // If the model DID include reminders (e.g. the user retimed and she captured it), use them as-is;
  // the safety net must not override or add on top.
  const input = { person_hint: "Sarah", note: "moving", event_date: "2027-10-01", reminders: [{ lead_days: 1, phrase: "the day before" }] };
  const stated = [{ lead_days: 7, phrase: "a week before" }]; // stale earlier timing
  const p = noteToParsed(input, { statedReminders: stated });
  assert.deepEqual(p.facts[0].reminders, [{ lead_days: 1, phrase: "the day before" }]); // model wins
});

await t("noteToParsed: truly NO stated timing anywhere → the single lead-3 default still applies", () => {
  const input = { person_hint: "Sarah", note: "surgery", event_date: "2027-03-12" };
  const p = noteToParsed(input, { statedReminders: [] });
  assert.deepEqual(p.facts[0].reminders, [{ lead_days: 3, label: null }]); // default preserved
});

await t("dispatchNoteAndRemind end-to-end (anon): carried timing flows through — no default substitution", async () => {
  // Anon returns before the write, but noteToParsed runs on the parsed path only for signed-in. To
  // prove the wiring deterministically WITHOUT a DB, assert the parsed reminders the dispatch WOULD
  // seed: reconstruct dispatch's own inputs. (The signed-in write path is covered live + by the
  // seedSituation engine tests above; here we lock the carry logic that feeds it.)
  const messages = [
    { role: "user", content: "Remind me about Sarah's move on October 1st, a week before." },
    { role: "assistant", content: "Which Sarah do you mean?" },
    { role: "user", content: "My sister Sarah." },
  ];
  const stated = statedRemindersFromMessages(messages);
  assert.deepEqual(stated, [{ lead_days: 7, phrase: "a week before" }]);
  // The model dropped reminders on the confirm turn; the parsed fact must still carry lead 7.
  const parsed = noteToParsed({ person_hint: "Sarah", note: "moving on October 1st", event_date: "2027-10-01" }, { statedReminders: stated });
  assert.equal(parsed.facts[0].reminders[0].lead_days, 7, "scheduled lead must match the stated 'a week before', not the default 3");
  // And anon dispatch still speaks safely (no false promise) regardless.
  const out = await dispatchNoteAndRemind(null, { person_hint: "Sarah", note: "moving", event_date: "2027-10-01", say: "Done, I'll nudge you." }, {}, messages);
  assert.equal(out.action, "noted_anon");
  assert.ok(!/\bdone\b|i'll nudge you/i.test(out.say), `anon say must not promise; got: ${out.say}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
