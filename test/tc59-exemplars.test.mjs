// Unit tests for the TC-59 craft library retrieval + block builder. Pure functions, no
// network. Run: node test/tc59-exemplars.test.mjs
import assert from "node:assert";
import { EXEMPLARS, getExemplars, buildExemplarBlock } from "../netlify/functions/_exemplars.mjs";
import { classifyOccasion } from "../netlify/functions/_analytics.mjs";

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); } }

console.log("# getExemplars — seeded occasion");
t("returns exemplars for a seeded occasion", () => {
  const ex = getExemplars({ occasion: "bereavement", relationship: "friend" });
  assert.ok(ex, "should return an object");
  assert.ok(Array.isArray(ex.what_to_say) && ex.what_to_say.length, "has what_to_say");
  assert.ok(Array.isArray(ex.what_not_to_say) && ex.what_not_to_say.length, "has what_not_to_say");
  assert.ok(Array.isArray(ex.gestures) && ex.gestures.length, "has gestures");
});

t("caps each field to <= 3 snippets", () => {
  for (const occ of Object.keys(EXEMPLARS)) {
    const ex = getExemplars({ occasion: occ });
    if (!ex) continue;
    for (const f of ["what_to_say", "what_not_to_say", "gestures"]) {
      if (ex[f]) assert.ok(ex[f].length <= 3, `${occ}.${f} within cap (got ${ex[f].length})`);
    }
  }
});

console.log("\n# classifyOccasion — routing precedence (birthday not swallowed by new_baby)");
t("'her birthday' routes to birthday, not new_baby", () => {
  assert.equal(classifyOccasion("It's my friend's birthday this week"), "birthday");
  assert.equal(classifyOccasion("she's turning 40 next month"), "birthday");
});
t("actual births still route to new_baby", () => {
  assert.equal(classifyOccasion("my sister just gave birth to a baby"), "new_baby");
  assert.equal(classifyOccasion("they're expecting a newborn"), "new_baby");
});
t("'wedding anniversary' routes to anniversary, not wedding_engagement", () => {
  assert.equal(classifyOccasion("my parents' 40th wedding anniversary"), "anniversary");
  assert.equal(classifyOccasion("they just got engaged"), "wedding_engagement"); // pure wedding still works
});
t("a birthday moment retrieves the birthday exemplars end-to-end", () => {
  const occ = classifyOccasion("my niece's birthday is coming up");
  const ex = getExemplars({ occasion: occ });
  assert.ok(ex && ex.what_to_say.length === 3, "birthday bucket is reachable + populated");
});

console.log("\n# getExemplars — rotation (cross-user variety, TC-59 addendum)");
t("a deep pool (>CAP) surfaces different subsets across calls", () => {
  // bereavement.what_to_say has 5 snippets; each call returns 3. Over many calls we
  // should see more than 3 distinct lines surface (proof of rotation), while any single
  // call still returns exactly 3.
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const ex = getExemplars({ occasion: "bereavement" });
    assert.equal(ex.what_to_say.length, 3, "each call still returns exactly CAP");
    ex.what_to_say.forEach((s) => seen.add(s));
  }
  assert.ok(seen.size > 3, `rotation should surface >3 distinct lines over 40 calls (saw ${seen.size})`);
});

console.log("\n# getExemplars — relationship refinement");
t("prefers by_relationship snippet when relationship matches", () => {
  const base = getExemplars({ occasion: "bereavement", relationship: "friend" });
  const cow = getExemplars({ occasion: "bereavement", relationship: "coworker" });
  const coworkerLine = EXEMPLARS.bereavement.by_relationship.coworker.what_to_say[0];
  assert.ok(cow.what_to_say.includes(coworkerLine), "coworker line surfaces for coworker");
  assert.ok(!base.what_to_say.includes(coworkerLine), "coworker line does NOT surface for friend");
  assert.ok(cow.what_to_say[0] === coworkerLine, "relationship-specific snippet is preferred (first)");
});

t("relationship refinement still respects the cap", () => {
  const cow = getExemplars({ occasion: "bereavement", relationship: "coworker" });
  assert.ok(cow.what_to_say.length <= 3, "capped after merge");
});

console.log("\n# getExemplars — miss");
t("returns null for an unseeded occasion", () => {
  assert.equal(getExemplars({ occasion: "retirement" }), null); // not seeded yet (librarian TC-65)
});
t("returns null for unspecified / missing bucket", () => {
  assert.equal(getExemplars({ occasion: "unspecified" }), null);
  assert.equal(getExemplars({}), null);
  assert.equal(getExemplars(), null);
});

console.log("\n# buildExemplarBlock");
t("returns empty string for null (no-regression path)", () => {
  assert.equal(buildExemplarBlock(null), "");
  assert.equal(buildExemplarBlock(getExemplars({ occasion: "retirement" })), ""); // not seeded yet
});

t("non-empty block carries the load-bearing guardrail framing", () => {
  const block = buildExemplarBlock(getExemplars({ occasion: "bereavement" }));
  assert.ok(block.length > 0, "block is non-empty");
  assert.ok(/do NOT copy/i.test(block), "warns against verbatim copying");
  assert.ok(/one option among many/i.test(block), "carries the anti-gift-push principle");
  assert.ok(/real emotional weight/i.test(block), "reinforces meet-the-weight");
  assert.ok(/not purchases/i.test(block), "frames gestures as non-purchase");
});

t("block includes the actual snippets", () => {
  const ex = getExemplars({ occasion: "new_baby" });
  const block = buildExemplarBlock(ex);
  assert.ok(block.includes(ex.what_to_say[0]), "renders a what_to_say snippet");
  assert.ok(block.includes(ex.gestures[0]), "renders a gesture snippet");
});

console.log("\n# PII-free by construction (sanity)");
t("no obvious placeholder-name tokens leaked into the library", () => {
  const json = JSON.stringify(EXEMPLARS);
  // Guard against a curator accidentally pasting a templated name from a real plan.
  for (const bad of ["Sarah", "Todd", "[name]", "{{", "${"]) {
    assert.ok(!json.includes(bad), `library must not contain "${bad}"`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
