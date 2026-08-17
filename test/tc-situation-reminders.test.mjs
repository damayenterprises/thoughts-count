// WP-C — unit tests for the pure helpers in public/_reminders.js (situation reminders).
// Pure functions, no DB, no browser. Run: node test/tc-situation-reminders.test.mjs
import assert from "node:assert/strict";
import { offsetPhrase, remindersSummary, REMINDER_PRESETS } from "../public/_reminders.js";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.error("FAIL  " + name + "\n      " + e.message); }
}

console.log("\n# offsetPhrase — signed lead_days → warm plain language");
t("0 → day of", () => assert.equal(offsetPhrase(0), "day of"));
t("null → day of", () => assert.equal(offsetPhrase(null), "day of"));
t("NaN → day of", () => assert.equal(offsetPhrase("x"), "day of"));
t("1 → 1 day before", () => assert.equal(offsetPhrase(1), "1 day before"));
t("3 → 3 days before", () => assert.equal(offsetPhrase(3), "3 days before"));
t("7 → a week before", () => assert.equal(offsetPhrase(7), "a week before"));
t("14 → two weeks before", () => assert.equal(offsetPhrase(14), "two weeks before"));
t("-1 → 1 day after", () => assert.equal(offsetPhrase(-1), "1 day after"));
t("-3 → 3 days after", () => assert.equal(offsetPhrase(-3), "3 days after"));
t("-7 → a week after", () => assert.equal(offsetPhrase(-7), "a week after"));
t("string '3' coerces", () => assert.equal(offsetPhrase("3"), "3 days before"));

console.log("\n# remindersSummary — chronological (most-before → most-after), skips inactive");
t("empty → ''", () => assert.equal(remindersSummary([]), ""));
t("null → ''", () => assert.equal(remindersSummary(null), ""));
t("sorted before→after", () =>
  assert.equal(
    remindersSummary([{ lead_days: -1 }, { lead_days: 3 }, { lead_days: 0 }]),
    "3 days before, day of, 1 day after"
  ));
t("inactive dropped", () =>
  assert.equal(
    remindersSummary([{ lead_days: 3 }, { lead_days: 0, active: false }]),
    "3 days before"
  ));
t("active:true kept", () =>
  assert.equal(remindersSummary([{ lead_days: 7, active: true }]), "a week before"));
t("all inactive → ''", () =>
  assert.equal(remindersSummary([{ lead_days: 3, active: false }]), ""));

console.log("\n# REMINDER_PRESETS — sane, signed, unique");
t("presets exist", () => assert.ok(REMINDER_PRESETS.length >= 4));
t("presets have signed lead_days + label", () =>
  REMINDER_PRESETS.forEach((p) => { assert.equal(typeof p.lead_days, "number"); assert.ok(p.label); }));
t("presets are unique by lead_days", () =>
  assert.equal(new Set(REMINDER_PRESETS.map((p) => p.lead_days)).size, REMINDER_PRESETS.length));
t("presets round-trip through offsetPhrase", () =>
  REMINDER_PRESETS.forEach((p) => assert.ok(offsetPhrase(p.lead_days).length > 0)));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
