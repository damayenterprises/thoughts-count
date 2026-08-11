// TC-117 — pure tests for the check-back SELECTION logic (public/_checkback.js):
// eligibility windows, per-person cooldown, already-asked, grief gate (fresh->silence,
// aged->care-only), per-session throttle, valence classification, and the coarse outcome read.
// Pure + offline, no key/network:
//   node test/spec-tc117-selection.test.mjs
import assert from "node:assert";
import {
  pickCheckback, classifyValenceLite, readOutcome, planValence,
  MIN_ELAPSED_DAYS, MAX_ELAPSED_DAYS, GRIEF_FRESH_DAYS, PER_PERSON_COOLDOWN_DAYS,
} from "../public/_checkback.js";

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); } }

const NOW = Date.parse("2026-08-11T12:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const ALWAYS = () => 0;   // rng always fires (below any rate)
const NEVER = () => 0.99; // rng never fires (above any rate)
const person = (plans) => ({ id: "p1", saved_plans: plans });
const emptyCheckins = { askedPlanIds: new Set(), lastAskedForPlan: new Map() };
const base = { checkins: emptyCheckins, rng: ALWAYS, now: NOW, sessionUsed: false };

console.log("# TC-117 classifyValenceLite (mirror of _analytics.classifyValence)");
t("HARD wins first (conservative grief-safe)", () => {
  assert.equal(classifyValenceLite("dad's funeral"), "hard_time");
  assert.equal(classifyValenceLite("cancer diagnosis"), "hard_time");
});
t("celebration / gratitude / other / unspecified", () => {
  assert.equal(classifyValenceLite("his 40th birthday"), "celebration");
  assert.equal(classifyValenceLite("just wanted to say thank you"), "gratitude");
  assert.equal(classifyValenceLite("lunch"), "other");
  assert.equal(classifyValenceLite(""), "unspecified");
});
t("planValence prefers a STORED valence over derivation", () => {
  assert.equal(planValence({ valence: "hard_time", occasion: "birthday" }), "hard_time");
  assert.equal(planValence({ occasion: "birthday" }), "celebration"); // derived fallback
});

console.log("\n# TC-117 readOutcome — coarse silent word-read");
t("positive -> went_well", () => {
  assert.equal(readOutcome("he cried, he loved the letter"), "went_well");
  assert.equal(readOutcome("it went well, she was thrilled"), "went_well");
});
t("negative -> fell_flat", () => {
  assert.equal(readOutcome("the party fell through"), "fell_flat");
  assert.equal(readOutcome("he never responded, kind of awkward"), "fell_flat");
});
t("mixed / empty -> unclear", () => {
  assert.equal(readOutcome("he loved it but the party fell through"), "unclear");
  assert.equal(readOutcome(""), "unclear");
});

console.log("\n# TC-117 pickCheckback — eligibility windows");
t("too fresh (< MIN_ELAPSED_DAYS) -> no A (null with B suppressed)", () => {
  // rng NEVER so the B-gate can't confound: this asserts the plan is not A-eligible.
  const r = pickCheckback(person([{ id: "a", occasion: "birthday", created_at: daysAgo(MIN_ELAPSED_DAYS - 1) }]), { ...base, rng: NEVER });
  assert.equal(r, null);
});
t("too old (> MAX_ELAPSED_DAYS) -> no A (null with B suppressed)", () => {
  const r = pickCheckback(person([{ id: "a", occasion: "birthday", created_at: daysAgo(MAX_ELAPSED_DAYS + 5) }]), { ...base, rng: NEVER });
  assert.equal(r, null);
});
t("in-window celebration + rng fires -> Mechanism A with fields", () => {
  const r = pickCheckback(person([{ id: "a", occasion: "his 40th birthday", created_at: daysAgo(30) }]), base);
  assert.ok(r && r.mechanism === "A");
  assert.equal(r.plan_id, "a");
  assert.equal(r.valence, "celebration");
  assert.equal(r.grief_care_only, false);
  assert.ok(r.occasion && r.when_phrase);
});
t("in-window but rng does NOT fire -> null (conservative rate)", () => {
  const r = pickCheckback(person([{ id: "a", occasion: "birthday", created_at: daysAgo(30) }]), { ...base, rng: NEVER });
  assert.equal(r, null);
});

console.log("\n# TC-117 pickCheckback — already-asked + per-person cooldown");
t("plan already in askedPlanIds -> not eligible", () => {
  const checkins = { askedPlanIds: new Set(["a"]), lastAskedForPlan: new Map() };
  const r = pickCheckback(person([{ id: "a", occasion: "birthday", created_at: daysAgo(30) }]), { ...base, checkins });
  assert.equal(r === null || r.mechanism === "B", true); // A must NOT fire on the asked plan
  if (r) assert.notEqual(r.plan_id, "a");
});
t("another plan asked within cooldown -> whole person on cooldown (no A)", () => {
  const lastAsked = new Map([["old", NOW - (PER_PERSON_COOLDOWN_DAYS - 5) * 86400000]]);
  const checkins = { askedPlanIds: new Set(["old"]), lastAskedForPlan: lastAsked };
  const r = pickCheckback(person([
    { id: "old", occasion: "lunch", created_at: daysAgo(40) },
    { id: "new", occasion: "birthday", created_at: daysAgo(30) },
  ]), { ...base, checkins, rng: NEVER }); // NEVER so B can't confound the A assertion
  assert.equal(r, null);
});
t("cooldown EXPIRED -> eligible again", () => {
  const lastAsked = new Map([["old", NOW - (PER_PERSON_COOLDOWN_DAYS + 5) * 86400000]]);
  const checkins = { askedPlanIds: new Set(["old"]), lastAskedForPlan: lastAsked };
  const r = pickCheckback(person([{ id: "new", occasion: "birthday", created_at: daysAgo(30) }]), { ...base, checkins });
  assert.ok(r && r.mechanism === "A" && r.plan_id === "new");
});

console.log("\n# TC-117 pickCheckback — grief gate (the safety control)");
t("FRESH grief (< GRIEF_FRESH_DAYS) -> SILENCE (no A)", () => {
  const r = pickCheckback(person([{ id: "g", occasion: "her dad's funeral", created_at: daysAgo(GRIEF_FRESH_DAYS - 1) }]), { ...base, rng: NEVER });
  assert.equal(r, null); // not even eligible; NEVER also blocks B so this is a clean silence check
});
t("AGED grief -> Mechanism A but grief_care_only=true", () => {
  const r = pickCheckback(person([{ id: "g", occasion: "her dad's funeral", created_at: daysAgo(40) }]), base);
  assert.ok(r && r.mechanism === "A");
  assert.equal(r.valence, "hard_time");
  assert.equal(r.grief_care_only, true);
});
t("aged grief uses STORED valence when present (not lossy derivation)", () => {
  // occasion reads cheery, but stored valence says hard_time -> must be care-only.
  const r = pickCheckback(person([{ id: "g", valence: "hard_time", occasion: "Dad's 60th", created_at: daysAgo(40) }]), base);
  assert.ok(r && r.grief_care_only === true);
});

console.log("\n# TC-117 pickCheckback — most-recent pick + per-session throttle");
t("picks the MOST-RECENT eligible plan (one question, never a stack)", () => {
  const r = pickCheckback(person([
    { id: "older", occasion: "birthday", created_at: daysAgo(100) },
    { id: "newer", occasion: "promotion", created_at: daysAgo(20) },
  ]), base);
  assert.ok(r && r.mechanism === "A" && r.plan_id === "newer");
});
t("sessionUsed=true -> null (per-session throttle, even with an eligible plan)", () => {
  const r = pickCheckback(person([{ id: "a", occasion: "birthday", created_at: daysAgo(30) }]), { ...base, sessionUsed: true });
  assert.equal(r, null);
});

console.log("\n# TC-117 pickCheckback — Mechanism B + anonymous / no-plan safety");
t("no eligible A + B rng fires -> Mechanism B", () => {
  // rng() called once for A-gate (skipped, no eligible), once for B-gate.
  const r = pickCheckback(person([]), { ...base, rng: ALWAYS });
  assert.deepEqual(r, { mechanism: "B" });
});
t("no eligible A + B rng does NOT fire -> null", () => {
  const r = pickCheckback(person([]), { ...base, rng: NEVER });
  assert.equal(r, null);
});
t("no person / no plans / garbage -> null (fail-open, byte-identical to today)", () => {
  assert.equal(pickCheckback(null, { ...base, rng: NEVER }), null);
  assert.equal(pickCheckback(undefined, { ...base, rng: NEVER }), null);
  assert.equal(pickCheckback({ id: "x" }, { ...base, rng: NEVER }), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
