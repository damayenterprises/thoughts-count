// TC-93 — pure-helper tests for the person-aware home conversation.
// Covers the primed-roster block in systemPrompt(ctx) and its BYTE-IDENTICAL anonymous guarantee
// (a signed-out home conversation must be unchanged from today). Pure + offline, no key needed:
//   node test/spec-tc93-roster-prompt.test.mjs
import assert from "node:assert";
import { systemPrompt } from "../netlify/functions/converse.mjs";

delete process.env.ANTHROPIC_API_KEY;

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); } }

// The signed-out / home baseline: no roster at all.
const BASE = systemPrompt();

console.log("# TC-93 roster block — anonymous byte-identical guarantee");
t("no roster key -> byte-identical to base", () => {
  assert.equal(systemPrompt({}), BASE);
  assert.equal(systemPrompt(undefined), BASE);
});
t("empty roster array -> byte-identical to base (signed in, no people)", () => {
  assert.equal(systemPrompt({ roster: [] }), BASE);
});
t("roster of blank/nameless entries -> byte-identical to base", () => {
  assert.equal(systemPrompt({ roster: [{ name: "" }, { detail: "in Denver" }, {}] }), BASE);
});
t("base prompt carries NO roster block and NO recognize-who rules", () => {
  assert.ok(!/People this person has saved/.test(BASE));
  assert.ok(!/Recognizing who they mean/.test(BASE));
  assert.ok(!/resolve_person/.test(BASE));
});

console.log("\n# TC-93 roster block — appears + reads right when a signed-in user has people");
const sp = systemPrompt({ roster: [
  { name: "Marc", detail: "your close friend" },
  { name: "John Miller", detail: "brother" },
  { name: "Priya", detail: "in Denver" },
  { name: "Sam", detail: "" },
] });
t("still starts with her identity (persona intact)", () => {
  assert.ok(sp.startsWith(BASE.split("\n")[0]));
});
t("roster header present", () => {
  assert.ok(/People this person has saved \(use these to recognize who they mean/.test(sp));
});
t("each name renders with its detail, or bare when no detail", () => {
  assert.ok(/- Marc \(your close friend\)/.test(sp));
  assert.ok(/- John Miller \(brother\)/.test(sp));
  assert.ok(/- Priya \(in Denver\)/.test(sp));
  assert.ok(/- Sam\n/.test(sp) || /- Sam$/.test(sp), "bare name when detail empty");
});
t("recognize-who rules appear (bare-first-name confirm, no picker, resolve_person)", () => {
  assert.ok(/Recognizing who they mean/.test(sp));
  // TC-93 fix: a bare first name must be confirmed WHO FIRST before proceeding.
  assert.ok(/BARE FIRST NAME/.test(sp));
  assert.ok(/Confirm WHO FIRST/.test(sp));
  assert.ok(/WAIT for their answer before you go any further/.test(sp));
  // A distinctive full-name / saved-nickname reference is treated as confident.
  assert.ok(/first and last name together, OR a nickname/.test(sp));
  assert.ok(/Never tell them to use a picker/.test(sp));
  assert.ok(/resolve_person tool/.test(sp));
});
t("prompt grows vs base (block adds content)", () => {
  assert.ok(sp.length > BASE.length);
});

console.log("\n# TC-93 roster + memory coexist (person-in-focus AND circle awareness)");
const both = systemPrompt({ name: "Maya", relationship: "sister", facts: ["loves hiking"], roster: [{ name: "Marc", detail: "your close friend" }] });
t("memory block AND roster block both present", () => {
  assert.ok(/WHAT YOU ALREADY REMEMBER about Maya \(sister\):/.test(both));
  assert.ok(/- loves hiking/.test(both));
  assert.ok(/People this person has saved/.test(both));
  assert.ok(/- Marc \(your close friend\)/.test(both));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
