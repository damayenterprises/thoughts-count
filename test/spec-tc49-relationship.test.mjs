// TC-49 (UX fix #4 v2) — relationship-chip matcher. Pure function, no DB.
//   node test/spec-tc49-relationship.test.mjs

import { matchRelationshipChip } from "../public/_relationship.js";

const PICKS = ["Close friend", "Friend", "Partner / spouse", "Parent", "Sibling", "Other family", "Coworker", "Someone I manage", "My boss", "Neighbor", "Client"];

let pass = 0, fail = 0; const fails = [];
function eq(input, expected) {
  const got = matchRelationshipChip(input, PICKS);
  const ok = got === expected;
  if (ok) { pass++; console.log(`  ok   "${input}" → ${JSON.stringify(got)}`); }
  else { fail++; fails.push(input); console.log(`  FAIL "${input}" → ${JSON.stringify(got)} (expected ${JSON.stringify(expected)})`); }
}

console.log("# exact label");
eq("Coworker", "Coworker");
eq("someone i manage", "Someone I manage"); // case-insensitive exact
eq("Partner / spouse", "Partner / spouse");

console.log("\n# direction-aware manage vs boss (the reported case)");
eq("a teammate I manage", "Someone I manage");   // manage-down beats the teammate hint
eq("my manager", "My boss");                     // 'manager' role → boss, NOT swallowed by 'manage'
eq("my boss", "My boss");
eq("she reports to me", "Someone I manage");
eq("one of my direct reports", "Someone I manage");
eq("I report to her", "My boss");
eq("my supervisor", "My boss");

console.log("\n# other roles");
eq("we're coworkers", "Coworker");
eq("a colleague from work", "Coworker");
eq("my wife", "Partner / spouse");
eq("my husband Tom", "Partner / spouse");
eq("my mom", "Parent");
eq("her father", "Parent");
eq("my little brother", "Sibling");
eq("a close friend", "Close friend");
eq("just a friend", "Friend");
eq("my neighbor", "Neighbor");
eq("a client of mine", "Client");

console.log("\n# conservative: no false positives");
eq("my grandmother", "Other family");            // whole-word: 'mother' inside 'grandmother' must NOT hit Parent
eq("my aunt", "Other family");
eq("someone I met at a conference", null);        // ambiguous → no chip
eq("", null);
eq("it's complicated", null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILED:", fails.join(" · ")); process.exit(1); }
