// TC-66 leak fix (Validator HIGH) — deterministic unit test for the remember-band inject-or-drop
// guard. The pending "I'll remember that about X." band must inject ONLY on the plan that belongs
// to the same conversation (same person id) and only while fresh; otherwise it must DROP so it can
// never leak onto a different person's saved plan or a fresh anonymous plan.
//
// We extract the pure helper tcRememberShouldInject(pendingPersonId, currentPersonId, ageMs, ttlMs)
// straight out of public/index.html (single source of truth — no copy drift) and exercise it.
//
// Run:  node test/tc66-remember-guard.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

const m = html.match(/function tcRememberShouldInject\([\s\S]*?\n\}/);
if (!m) { console.error("FAIL: could not locate tcRememberShouldInject in public/index.html"); process.exit(1); }
// eslint-disable-next-line no-new-func
const tcRememberShouldInject = new Function(m[0] + "\nreturn tcRememberShouldInject;")();

const TTL = 60000;
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name); } }

// Happy path: same conversation person, fresh → inject.
ok("same person + fresh → inject", tcRememberShouldInject("p1", "p1", 500, TTL) === true);
ok("same person at TTL edge (< ttl) → inject", tcRememberShouldInject("p1", "p1", 59999, TTL) === true);

// Cross-plan leak: a DIFFERENT person's plan is now rendering → drop.
ok("different person → drop", tcRememberShouldInject("p1", "p2", 500, TTL) === false);

// Anonymous / home render (no known person) → drop.
ok("current anon (null) → drop", tcRememberShouldInject("p1", null, 500, TTL) === false);
ok("stash had no person (null) → drop", tcRememberShouldInject(null, "p1", 500, TTL) === false);
ok("both null → drop", tcRememberShouldInject(null, null, 500, TTL) === false);

// Stale stash (renderError cleared it in prod; TTL is belt-and-suspenders) → drop even if same id.
ok("same person but stale → drop", tcRememberShouldInject("p1", "p1", 60001, TTL) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
