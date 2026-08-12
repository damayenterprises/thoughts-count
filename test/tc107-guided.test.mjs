// TC-107 — unit tests for the guided one-question-at-a-time capture state machine + answers shape.
// Pure functions, no DB, no browser. Run: node test/tc107-guided.test.mjs
import assert from "node:assert/strict";
import {
  GUIDED_STEPS, makeGuidedState, stepAt, advance, back, isDone, canFinish, answersToDraft,
} from "../public/_guided.js";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.error("FAIL  " + name + "\n      " + e.message); }
}

console.log("\n# GUIDED_STEPS — shape");
t("first step is name and is the only required one", () => {
  assert.equal(GUIDED_STEPS[0].key, "name");
  assert.equal(GUIDED_STEPS[0].optional, false);
  assert.ok(GUIDED_STEPS.slice(1).every((s) => s.optional === true));
});
t("asks the four one-at-a-time questions in order", () => {
  assert.deepEqual(GUIDED_STEPS.map((s) => s.key), ["name", "relationship", "birthday", "note"]);
});
t("copy carries no chrome punctuation (no em/en dash, ellipsis, smart quotes)", () => {
  const blob = JSON.stringify(GUIDED_STEPS);
  assert.ok(!/[–—…‘’“”]/.test(blob), "found a forbidden chrome character in step copy");
});

console.log("\n# state machine — advance / back / skip / done");
t("starts at the first step", () => {
  const s = makeGuidedState();
  assert.equal(s.idx, 0);
  assert.equal(stepAt(s).key, "name");
});
t("advance walks forward one step at a time", () => {
  let s = makeGuidedState();
  s = advance(s); assert.equal(stepAt(s).key, "relationship");
  s = advance(s); assert.equal(stepAt(s).key, "birthday");
  s = advance(s); assert.equal(stepAt(s).key, "note");
});
t("advancing past the last step marks the flow done", () => {
  let s = makeGuidedState();
  for (let i = 0; i < GUIDED_STEPS.length; i++) { assert.equal(isDone(s), false); s = advance(s); }
  assert.equal(isDone(s), true);
  assert.equal(stepAt(s), null);
});
t("advance clamps (never past done)", () => {
  let s = makeGuidedState();
  for (let i = 0; i < 20; i++) s = advance(s);
  assert.equal(s.idx, GUIDED_STEPS.length);
});
t("back never goes before the first step", () => {
  let s = makeGuidedState();
  s = back(s); assert.equal(s.idx, 0);
  s = advance(s); s = advance(s); s = back(s);
  assert.equal(stepAt(s).key, "relationship");
});
t("skip is just advance without an answer (same forward move)", () => {
  // skipping every optional step from name still reaches done
  let s = makeGuidedState();
  s = advance(s); // past name
  s = advance(s); // skip relationship
  s = advance(s); // skip birthday
  s = advance(s); // skip note
  assert.equal(isDone(s), true);
});

console.log("\n# canFinish — only a name is ever required");
t("no name → cannot finish", () => assert.equal(canFinish({}), false));
t("blank name → cannot finish", () => assert.equal(canFinish({ name: "   " }), false));
t("a name alone → can finish", () => assert.equal(canFinish({ name: "Maria" }), true));

console.log("\n# answersToDraft — funnels into the shared resolve/confirm shape");
t("no name → null (nothing to save yet)", () => {
  assert.equal(answersToDraft({}), null);
  assert.equal(answersToDraft({ relationship: "friend" }), null);
});
t("name only → clean rawText + prefill", () => {
  const d = answersToDraft({ name: "Maria" });
  assert.equal(d.rawText, "Remember Maria.");
  assert.deepEqual(d.prefill, { name: "Maria", relationship: "", birthday: "" });
});
t("name + relationship folds into the sentence and prefill", () => {
  const d = answersToDraft({ name: "Maria", relationship: "a close friend" });
  assert.equal(d.rawText, "Remember Maria, a close friend.");
  assert.equal(d.prefill.relationship, "a close friend");
});
t("birthday + note append as their own sentences", () => {
  const d = answersToDraft({ name: "Maria", relationship: "my sister", birthday: "June 15", note: "She just started a new job." });
  assert.equal(d.rawText, "Remember Maria, my sister. Their birthday is June 15. She just started a new job.");
  assert.equal(d.prefill.birthday, "June 15");
});
t("trims whitespace and collapses runs in the note", () => {
  const d = answersToDraft({ name: "  Maria  ", note: "loves   hiking\nand tea" });
  assert.equal(d.prefill.name, "Maria");
  assert.ok(d.rawText.endsWith("loves hiking and tea"));
});
t("birthday stays human text (no date re-invention here)", () => {
  const d = answersToDraft({ name: "Sam", birthday: "6/15" });
  assert.equal(d.prefill.birthday, "6/15"); // parseBirthdayInput runs later on the confirm card
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
