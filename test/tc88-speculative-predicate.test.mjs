// TC-88 — pure-helper test for the speculative-transcribe "should I fire now?" predicate.
// Mirror of crecShouldSpeculate in public/index.html (inline, not importable). If you change the
// predicate there, change this copy too. All pure + offline.
// Run: node test/tc88-speculative-predicate.test.mjs
import assert from "node:assert";

const CREC_MIN_SPEECH_MS = 400;
const CREC_SOFT_PAUSE_MS = 700;

// EXACT mirror of the inline predicate.
function crecShouldSpeculate(s, now){
  return !!(s && s.active && s.spoke && !s.specFired && s.silenceStart
    && (now - s.spokeAt) > CREC_MIN_SPEECH_MS
    && (now - s.silenceStart) >= CREC_SOFT_PAUSE_MS);
}

// A speaker who has spoken well past the grace window, currently in silence that started at `silenceStart`.
function state(over){
  return Object.assign({
    active: true, spoke: true, specFired: false,
    spokeAt: 0,            // spoke at t=0
    silenceStart: 5000,    // silence began at t=5000
  }, over || {});
}

let pass = 0, fail = 0;
function t(name, fn){ try { fn(); pass++; console.log(`  ok   ${name}`); } catch(e){ fail++; console.log(`  FAIL ${name} — ${e.message}`); } }

console.log("# crecShouldSpeculate — fire ONE speculative transcribe at the soft-pause");

t("silence just started (< soft-pause) → false", () => {
  assert.strictEqual(crecShouldSpeculate(state(), 5000 + 300), false);
});

t("silence reached the soft-pause (700ms) → true", () => {
  assert.strictEqual(crecShouldSpeculate(state(), 5000 + CREC_SOFT_PAUSE_MS), true);
});

t("silence past the soft-pause → still true (until fired)", () => {
  assert.strictEqual(crecShouldSpeculate(state(), 5000 + 1200), true);
});

t("already fired for this window → false (fire at most once per pause)", () => {
  assert.strictEqual(crecShouldSpeculate(state({ specFired: true }), 5000 + 1200), false);
});

t("no silence yet (silenceStart 0) → false", () => {
  assert.strictEqual(crecShouldSpeculate(state({ silenceStart: 0 }), 9999), false);
});

t("never spoke → false (nothing to transcribe)", () => {
  assert.strictEqual(crecShouldSpeculate(state({ spoke: false }), 5000 + 1200), false);
});

t("still inside the min-speech grace window → false", () => {
  // spokeAt=4800, silenceStart=5000, now=5700: silence>=700 but (now-spokeAt)=900 ... spoke long enough.
  // Make grace fail: spokeAt very close to now.
  assert.strictEqual(crecShouldSpeculate(state({ spokeAt: 5500 }), 5700 + 0), false);
});

t("recorder no longer active → false", () => {
  assert.strictEqual(crecShouldSpeculate(state({ active: false }), 5000 + 1200), false);
});

t("null / undefined state → false (never throws)", () => {
  assert.strictEqual(crecShouldSpeculate(null, 1234), false);
  assert.strictEqual(crecShouldSpeculate(undefined, 1234), false);
});

t("re-armed after resume (specFired cleared) fires again on the next pause", () => {
  // Simulate: fired once, then speech resumed (specFired=false, new later silenceStart), pause again.
  const resumed = state({ specFired: false, silenceStart: 8000, spokeAt: 7500 });
  assert.strictEqual(crecShouldSpeculate(resumed, 8000 + CREC_SOFT_PAUSE_MS), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
