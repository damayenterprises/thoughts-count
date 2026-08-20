// Unit tests for the deterministic name-equivalence helper (Spec A / A1b + Validator R1
// fix a). Pure functions, no DB. Run: node test/names.test.mjs
import assert from "node:assert";
import { firstNamesEquivalent, sameSurname, levenshtein, splitNameRelationship } from "../netlify/functions/_names.mjs";

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); } }
const T = (a, b) => assert.equal(firstNamesEquivalent(a, b), true, `${a}/${b} should be equivalent`);
const F = (a, b) => assert.equal(firstNamesEquivalent(a, b), false, `${a}/${b} should NOT be equivalent`);

console.log("# firstNamesEquivalent — exact");
t("Sam/Sam", () => T("Sam", "Sam"));
t("case/space insensitive", () => T("  sam ", "SAM"));

console.log("\n# firstNamesEquivalent — nickname dictionary (bidirectional)");
t("Bill/William", () => T("Bill", "William"));
t("William/Bill", () => T("William", "Bill"));
t("Sam/Samuel", () => T("Sam", "Samuel"));
t("Matt/Matthew", () => T("Matt", "Matthew"));
t("Rob/Robert", () => T("Rob", "Robert"));
t("Kate/Katherine", () => T("Kate", "Katherine"));
t("Liz/Elizabeth", () => T("Liz", "Elizabeth"));

console.log("\n# firstNamesEquivalent — spelling-close (edit-distance)");
t("Sara/Sarah", () => T("Sara", "Sarah"));
t("Jon/John (len 4 — at the floor)", () => T("Jon", "John"));
t("Steven/Stephen", () => T("Steven", "Stephen"));
t("Micheal/Michael", () => T("Micheal", "Michael"));
t("Sofia/Sophia (len 6)", () => T("Sofia", "Sophia"));

console.log("\n# firstNamesEquivalent — negatives (incl. R1 fix a: 3-letter coincidences)");
t("Kim/Tim → NOT equivalent (len-4 floor kills 3-letter noise)", () => F("Kim", "Tim"));
t("Jan/Jon → NOT equivalent (3-letter)", () => F("Jan", "Jon"));
t("Bill/Bob → NOT equivalent (dist 3)", () => F("Bill", "Bob"));
t("David/Daniel → NOT equivalent (dist 3)", () => F("David", "Daniel"));
t("full names: Sara Johnson/Sarah Johnson", () => T("Sara Johnson", "Sarah Johnson"));

console.log("\n# sameSurname + levenshtein sanity");
t("sameSurname Johnson/Johnson", () => assert.equal(sameSurname("Sara Johnson", "Sarah Johnson"), true));
t("sameSurname May/Kay", () => assert.equal(sameSurname("David May", "David Kay"), false));
t("levenshtein kitten/sitting = 3", () => assert.equal(levenshtein("kitten", "sitting"), 3));

console.log("\n# splitNameRelationship — TC capture-loop FIX 1 (descriptor into name)");
const SR = (raw, name, rel) => {
  const r = splitNameRelationship(raw);
  assert.equal(r.name, name, `"${raw}" → name expected "${name}", got "${r.name}"`);
  assert.equal(r.relationship, rel, `"${raw}" → rel expected "${rel}", got "${r.relationship}"`);
};
// Leading "my/the <rel> <Name>"
t('"my neighbor Tom" → Tom / neighbor', () => SR("my neighbor Tom", "Tom", "neighbor"));
t('"my friend Priya" → Priya / friend', () => SR("my friend Priya", "Priya", "friend"));
t('"my coworker Marc" → Marc / coworker', () => SR("my coworker Marc", "Marc", "coworker"));
t('"my co-worker Marc" → Marc / coworker (canonicalized)', () => SR("my co-worker Marc", "Marc", "coworker"));
t('"the neighbor Tom" → Tom / neighbor', () => SR("the neighbor Tom", "Tom", "neighbor"));
t('"my mother-in-law Susan" → Susan / mother-in-law', () => SR("my mother-in-law Susan", "Susan", "mother-in-law"));
t('"my best friend Dana" → Dana / best friend', () => SR("my best friend Dana", "Dana", "best friend"));
t('"my neighbor Tom Reynolds" → Tom Reynolds / neighbor (full name kept)', () => SR("my neighbor Tom Reynolds", "Tom Reynolds", "neighbor"));
// Trailing "<Name>, <rel>"
t('"Tom, neighbor" → Tom / neighbor', () => SR("Tom, neighbor", "Tom", "neighbor"));
t('"Priya, friend" → Priya / friend', () => SR("Priya, friend", "Priya", "friend"));
t('"Marc Reynolds, coworker" → Marc Reynolds / coworker', () => SR("Marc Reynolds, coworker", "Marc Reynolds", "coworker"));
// GUARDS — ordinary names and ambiguous bare forms must be left ALONE
t('"Sarah" unchanged', () => SR("Sarah", "Sarah", ""));
t('"Marc Reynolds" unchanged', () => SR("Marc Reynolds", "Marc Reynolds", ""));
t('"Uncle Bob" (bare, no my/comma) left alone', () => SR("Uncle Bob", "Uncle Bob", ""));
t('"my Tom" (not a relationship word) left alone', () => SR("my Tom", "my Tom", ""));
t('"my neighbor" (no name after) left alone', () => SR("my neighbor", "my neighbor", ""));
t('"Tom, Denver" (trailing non-rel) left alone', () => SR("Tom, Denver", "Tom, Denver", ""));
t('empty → empty', () => SR("", "", ""));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
