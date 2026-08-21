// TC-143 — pure-helper test for transcript-aware end-of-turn timing.
// Mirror of endOfTurnMs in public/index.html (inline, not importable). If you change the predicate
// there, change this copy too. All pure + offline.
// Run: node test/tc143-eot-predicate.test.mjs
import assert from "node:assert";

const END_OF_TURN_SILENCE_MS = 1700;
const EOT_FINISHED_MS = 1400;
const EOT_OPEN_MS = 2200;
const EOT_OPEN_ENDERS = new Set(['and','but','so','or','because','cause','if','when','while','though','although','to','of','for','with','at','in','on','as','the','a','an','my','your','our','their','his','her','its','i','we','you','they','it','that','this','is','are','was','were','am','be','been','being','like','um','uh','er','hmm','well','also','then','maybe','really','just','about','into','from','than',"that's","it's","i'm","we're","you're"]);

// EXACT mirror of the inline predicate.
function endOfTurnMs(tail){
  const t = String(tail == null ? '' : tail).trim();
  if (!t) return END_OF_TURN_SILENCE_MS;
  if (/[.!?]["')\]]*$/.test(t)) return EOT_FINISHED_MS;
  const words = t.toLowerCase().replace(/[^a-z'\s]/g, ' ').split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] || '';
  if (EOT_OPEN_ENDERS.has(last)) return EOT_OPEN_MS;
  return END_OF_TURN_SILENCE_MS;
}

let pass = 0, fail = 0;
function t(name, fn){ try { fn(); pass++; console.log(`  ok   ${name}`); } catch(e){ fail++; console.log(`  FAIL ${name} — ${e.message}`); } }

console.log("# endOfTurnMs — transcript-aware end-of-turn timing");

// No transcript / empty → neutral default (fail-open).
t("empty → default", () => assert.equal(endOfTurnMs(""), END_OF_TURN_SILENCE_MS));
t("null → default", () => assert.equal(endOfTurnMs(null), END_OF_TURN_SILENCE_MS));
t("whitespace → default", () => assert.equal(endOfTurnMs("   "), END_OF_TURN_SILENCE_MS));

// Finished sentence (terminal punctuation) → snappy.
t("period → finished", () => assert.equal(endOfTurnMs("I need help with my mom."), EOT_FINISHED_MS));
t("question mark → finished", () => assert.equal(endOfTurnMs("How close are you two?"), EOT_FINISHED_MS));
t("exclamation → finished", () => assert.equal(endOfTurnMs("She just got engaged!"), EOT_FINISHED_MS));
t("punct + closing quote → finished", () => assert.equal(endOfTurnMs('he said "thanks."'), EOT_FINISHED_MS));

// Trailing on a hanging word → patient.
t("ends on 'and' → open", () => assert.equal(endOfTurnMs("I want to reach out and"), EOT_OPEN_MS));
t("ends on 'my' → open", () => assert.equal(endOfTurnMs("it's about my"), EOT_OPEN_MS));
t("ends on 'because' → open", () => assert.equal(endOfTurnMs("I'm worried because"), EOT_OPEN_MS));
t("ends on filler 'um' → open", () => assert.equal(endOfTurnMs("I was thinking um"), EOT_OPEN_MS));
t("ends on 'to' → open", () => assert.equal(endOfTurnMs("I don't know what to"), EOT_OPEN_MS));
t("ends on contraction 'it's' → open", () => assert.equal(endOfTurnMs("the thing is it's"), EOT_OPEN_MS));

// Ambiguous (content word, no punctuation) → neutral default (never speeds up on a guess).
t("content word, no punct → default", () => assert.equal(endOfTurnMs("I want to tell you about Sarah"), END_OF_TURN_SILENCE_MS));
t("single content word → default", () => assert.equal(endOfTurnMs("Marcus"), END_OF_TURN_SILENCE_MS));

// The band is respected: never below finished, never above open.
t("all outcomes within [finished, open]", () => {
  for (const s of ["", "done.", "and", "my", "hello there", "why?", "I think that"]) {
    const v = endOfTurnMs(s);
    assert.ok(v >= EOT_FINISHED_MS && v <= EOT_OPEN_MS, `${s} → ${v} out of band`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
