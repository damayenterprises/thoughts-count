// TC-117 — pure tests for the "circle back" prompt block (checkbackBlock via systemPrompt)
// and the compounding-loop reach (a seeded outcome string arrives in buildUserMessage).
// Pure + offline, no key needed:
//   node test/spec-tc117-checkback-prompt.test.mjs
import assert from "node:assert";
import { systemPrompt } from "../netlify/functions/converse.mjs";
import { buildUserMessage } from "../netlify/functions/generate-background.mjs";

delete process.env.ANTHROPIC_API_KEY;

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); } }

const BASE = systemPrompt();
const BASE_PERSON = systemPrompt({ name: "Maya", relationship: "sister", facts: ["loves hiking"] });

console.log("# TC-117 checkbackBlock — BYTE-IDENTICAL when absent");
t("no checkback key -> byte-identical to base", () => {
  assert.equal(systemPrompt({}), BASE);
  assert.equal(systemPrompt({ name: "Maya", relationship: "sister", facts: ["loves hiking"] }), BASE_PERSON);
});
t("malformed / empty checkback -> byte-identical (fail-open)", () => {
  assert.equal(systemPrompt({ checkback: null }), BASE);
  assert.equal(systemPrompt({ checkback: {} }), BASE);
  assert.equal(systemPrompt({ checkback: { mechanism: "Z" } }), BASE);
  assert.equal(systemPrompt({ checkback: "nope" }), BASE);
});
t("base prompt carries NO circle-back language", () => {
  assert.ok(!/CIRCLING BACK/.test(BASE));
});

console.log("\n# TC-117 Mechanism A (non-grief) — warm 'how did it land', never rate the gesture");
const spA = systemPrompt({ name: "Sam", checkback: { mechanism: "A", occasion: "his 40th birthday", valence: "celebration", when_phrase: "last month" } });
t("block appears + still starts with her identity", () => {
  assert.ok(spA.startsWith(BASE.split("\n")[0]));
  assert.ok(/CIRCLING BACK/.test(spA));
  assert.ok(spA.length > BASE.length);
});
t("ORDERED opener rule present (never the opener; abandon on live need; one attempt)", () => {
  assert.ok(/NEVER your opener/.test(spA));
  assert.ok(/DROP the idea of circling back entirely/.test(spA));
  assert.ok(/ONE warm, natural attempt/.test(spA));
});
t("references the occasion + when phrase", () => {
  assert.ok(/his 40th birthday/.test(spA));
  assert.ok(/last month/.test(spA));
});
t("A prose = how it went for THEM; explicit ban on rating the gesture", () => {
  assert.ok(/how it landed for THEM/.test(spA));
  assert.ok(/did they like it/.test(spA)); // named as a thing to NEVER ask
  assert.ok(/NEVER rate or fish about the gesture/.test(spA));
});
t("no grief clause fires for a celebration A", () => {
  assert.ok(!/GRIEF CLAUSE/.test(spA));
});
t("examples labeled range-of-register (no verbatim)", () => {
  assert.ok(/RANGE and register only — never say them verbatim/.test(spA));
});

console.log("\n# TC-117 Mechanism A (grief_care_only) — wellbeing only, ZERO outcome probe");
const spG = systemPrompt({ name: "Ana", checkback: { mechanism: "A", occasion: "her dad's passing", valence: "hard_time", grief_care_only: true, when_phrase: "a while back" } });
t("grief clause present + wellbeing framing", () => {
  assert.ok(/GRIEF CLAUSE/.test(spG));
  assert.ok(/how are you both holding up/.test(spG));
});
t("grief A bans the 'went well / worked / liked it' framing", () => {
  assert.ok(/NEVER ask whether it "went well"/.test(spG));
});
t("grief A carries NO outcome-probe 'how did it land for THEM' language", () => {
  assert.ok(!/how it landed for THEM/.test(spG));
  assert.ok(!/NEVER rate or fish about the gesture/.test(spG)); // that's the non-grief clause
});
t("grief A notes the text-only blind spot + permission to drop it", () => {
  assert.ok(/cannot hear their voice/.test(spG));
  assert.ok(/dropping it entirely is always allowed/.test(spG));
});
t("opener rule still present for grief A", () => {
  assert.ok(/NEVER your opener/.test(spG));
});

console.log("\n# TC-117 Mechanism B — rare, honest impact check; preferred in grief");
const spB = systemPrompt({ name: "Lee", checkback: { mechanism: "B" } });
t("B prose = honest question about HER own help, rare", () => {
  assert.ok(/CIRCLING BACK/.test(spB));
  assert.ok(/about your OWN help/.test(spB));
  assert.ok(/rare instrument, not a habit/.test(spB));
});
t("B centers grief on the user carrying it, never on the gesture", () => {
  assert.ok(/has any of this helped you carry it/.test(spB));
});
t("opener rule present for B too", () => {
  assert.ok(/NEVER your opener/.test(spB));
});

console.log("\n# TC-117 §7 compounding loop — a seeded outcome reaches buildUserMessage");
t("an outcome-annotated priorPlans digest lands in the plan prompt", () => {
  const digest = "- his 40th birthday: suggested a handwritten letter (this landed well)";
  const msg = buildUserMessage({ moment: "his birthday again", about: "my brother", priorPlans: digest });
  assert.ok(/ALREADY SUGGESTED FOR THIS PERSON BEFORE/.test(msg));
  assert.ok(/\(this landed well\)/.test(msg), "the recorded outcome reaches the next plan");
});
t("a 'fell flat' outcome also reaches the plan", () => {
  const msg = buildUserMessage({ moment: "again", about: "friend", priorPlans: "- dinner: suggested a card (this fell flat)" });
  assert.ok(/\(this fell flat\)/.test(msg));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
