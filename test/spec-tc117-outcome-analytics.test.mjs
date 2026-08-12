// TC-117 — pure tests for the plan_outcome analytics: the OUTCOME_VALUES guard shape and the
// computeSummary `outcomes` roll-up (by occasion/valence), plus the privacy invariant that a
// grief-care-only / Mechanism-B check-back contributes NO plan_outcome event.
// Pure + offline:
//   node test/spec-tc117-outcome-analytics.test.mjs
import assert from "node:assert";
import { OUTCOME_VALUES, computeSummary, sanitizeBucket } from "../netlify/functions/_analytics.mjs";

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); } }

console.log("# TC-117 OUTCOME_VALUES — fixed enum, never free text");
t("only the three coarse labels are valid", () => {
  assert.ok(OUTCOME_VALUES.has("went_well"));
  assert.ok(OUTCOME_VALUES.has("fell_flat"));
  assert.ok(OUTCOME_VALUES.has("unclear"));
  assert.ok(!OUTCOME_VALUES.has("he loved the letter")); // no free text ever
  assert.equal(OUTCOME_VALUES.size, 3);
});
t("sanitizeBucket keeps only whitelisted labels (non-identifying)", () => {
  const b = sanitizeBucket({ valence: "celebration", occasion: "birthday", junk: "his name" });
  assert.equal(b.valence, "celebration");
  assert.equal(b.occasion, "birthday");
  assert.ok(!("junk" in b));
});

console.log("\n# TC-117 computeSummary — outcomes roll-up");
const events = [
  { event: "plan_outcome", outcome: "went_well", occasion: "birthday", valence: "celebration", sid: "s1" },
  { event: "plan_outcome", outcome: "went_well", occasion: "birthday", valence: "celebration", sid: "s2" },
  { event: "plan_outcome", outcome: "fell_flat", occasion: "birthday", valence: "celebration", sid: "s3" },
  { event: "plan_outcome", outcome: "unclear", occasion: "thank_you", valence: "gratitude", sid: "s4" },
  // A non-outcome event must not leak into the roll-up.
  { event: "plan_feedback", helpful: true, occasion: "birthday", sid: "s5" },
];
const sum = computeSummary(events);
t("outcomes block exists with totals", () => {
  assert.ok(sum.outcomes);
  assert.equal(sum.outcomes.responses, 4);
  assert.equal(sum.outcomes.went_well, 2);
  assert.equal(sum.outcomes.fell_flat, 1);
  assert.equal(sum.outcomes.unclear, 1);
});
t("landed_rate_pct = went_well / (went_well + fell_flat)", () => {
  assert.equal(sum.outcomes.landed_rate_pct, 66.7); // 2 / 3
});
t("by_occasion + by_valence roll up correctly", () => {
  assert.equal(sum.outcomes.by_occasion.birthday.went_well, 2);
  assert.equal(sum.outcomes.by_occasion.birthday.fell_flat, 1);
  assert.equal(sum.outcomes.by_valence.celebration.went_well, 2);
  assert.equal(sum.outcomes.by_valence.gratitude.unclear, 1);
});
t("plan_feedback events do NOT pollute the outcomes roll-up", () => {
  // 4 outcome events only; the helpful plan_feedback is counted under helpfulness, not outcomes.
  assert.equal(sum.outcomes.responses, 4);
  assert.equal(sum.helpfulness.responses, 1);
});

console.log("\n# TC-117 privacy invariant — grief/B contribute no plan_outcome");
t("a store with ONLY grief/B check-ins (no plan_outcome) yields empty outcomes", () => {
  // The client never posts plan_outcome for grief-care-only A or Mechanism B, so such a store
  // simply has no plan_outcome events — the roll-up is empty, no signal extracted from grief.
  const only = computeSummary([{ event: "plan_feedback", helpful: false, sid: "s1" }]);
  assert.equal(only.outcomes.responses, 0);
  assert.equal(only.outcomes.landed_rate_pct, null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
