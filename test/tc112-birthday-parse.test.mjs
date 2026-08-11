// TC-112 — unit tests for the year-less birthday helpers in public/_dates.js. Pure functions,
// no DB, no browser. Run: node test/tc112-birthday-parse.test.mjs
import assert from "node:assert/strict";
import {
  parseBirthdayInput, formatMonthDay, isYearlessBirthday, BDAY_SENTINEL_YEAR,
} from "../public/_dates.js";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.error("FAIL  " + name + "\n      " + e.message); }
}

const S = BDAY_SENTINEL_YEAR; // "0004"

console.log("\n# parseBirthdayInput — year-less → sentinel year, recurs");
t('"June 15"', () => assert.deepEqual(parseBirthdayInput("June 15"), { event_date: `${S}-06-15`, recurs: true }));
t('"Jun 15"', () => assert.deepEqual(parseBirthdayInput("Jun 15"), { event_date: `${S}-06-15`, recurs: true }));
t('"15 June"', () => assert.deepEqual(parseBirthdayInput("15 June"), { event_date: `${S}-06-15`, recurs: true }));
t('"6/15"', () => assert.deepEqual(parseBirthdayInput("6/15"), { event_date: `${S}-06-15`, recurs: true }));
t('"march 3" pads', () => assert.deepEqual(parseBirthdayInput("march 3"), { event_date: `${S}-03-03`, recurs: true }));

console.log("\n# parseBirthdayInput — full date → real year, no recur");
t('"June 15, 1990"', () => assert.deepEqual(parseBirthdayInput("June 15, 1990"), { event_date: "1990-06-15", recurs: false }));
t('"1990-06-15" ISO', () => assert.deepEqual(parseBirthdayInput("1990-06-15"), { event_date: "1990-06-15", recurs: false }));
t('"06/15/1990" US', () => assert.deepEqual(parseBirthdayInput("06/15/1990"), { event_date: "1990-06-15", recurs: false }));
t('sentinel ISO round-trips as recurring', () => assert.deepEqual(parseBirthdayInput(`${S}-06-15`), { event_date: `${S}-06-15`, recurs: true }));

console.log("\n# parseBirthdayInput — rejects junk");
t('empty → null', () => assert.equal(parseBirthdayInput(""), null));
t('garbage → null', () => assert.equal(parseBirthdayInput("someday"), null));
t('impossible month → null', () => assert.equal(parseBirthdayInput("13/40"), null));

console.log("\n# formatMonthDay — warm month+day, year always dropped");
t('sentinel → "June 15"', () => assert.equal(formatMonthDay(`${S}-06-15`), "June 15"));
t('full date → "June 15" (year dropped)', () => assert.equal(formatMonthDay("1990-06-15"), "June 15"));
t('single digit day trims leading zero', () => assert.equal(formatMonthDay("1990-03-03"), "March 3"));
t('empty → ""', () => assert.equal(formatMonthDay(""), ""));

console.log("\n# isYearlessBirthday");
t('sentinel → true', () => assert.equal(isYearlessBirthday(`${S}-06-15`), true));
t('real year → false', () => assert.equal(isYearlessBirthday("1990-06-15"), false));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
