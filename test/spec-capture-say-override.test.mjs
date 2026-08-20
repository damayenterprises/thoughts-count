// TC capture-loop (no-false-promise) — the SERVER-SIDE say-override safety net.
//
// The bug David hit live: Della declared "Done, I'll nudge you on <date>" BEFORE anything was saved
// — for a signed-OUT user (no account to hold it) and for a signed-IN user whose person wasn't
// settled yet. dispatchNoteAndRemind now OVERRIDES the model's `say` for those two unsaved outcomes
// so she only ever claims done when it is truly done. These are pure unit tests on the override
// helpers (no network, no DB) — they lock the authoritative line so the model can never re-introduce
// a false promise through its `say`.
//
//   node test/spec-capture-say-override.test.mjs

import assert from "node:assert";
import { sayForAnon, sayForConfirmWho } from "../netlify/functions/converse.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); } };

// The forbidden "already done" claims — no override line may contain any of these.
const CLAIMS_DONE = /\bdone\b|i'll nudge you|i'll remind you|\bsaved\b|it's set|all set|i've got it down/i;

console.log("# ANON (signed-out) say — value-first invite, NEVER a false nudge promise\n");

t("anon say invites sign-in and makes NO done/nudge promise", () => {
  const say = sayForAnon("sister moving October 1st");
  assert.ok(say && say.trim().length, "empty say");
  assert.ok(!CLAIMS_DONE.test(say), `must not claim done/nudge/saved; got: ${say}`);
  assert.ok(/sign(ed)? in/i.test(say), `should invite sign-in; got: ${say}`);
  assert.ok(/remember|hold onto|hold on to|keep/i.test(say), `should convey she'd hold it; got: ${say}`);
});

t("anon say references the note when present, degrades cleanly when empty", () => {
  assert.ok(/moving/i.test(sayForAnon("moving next week")), "should weave in the note fragment");
  const bare = sayForAnon("");
  assert.ok(bare && !CLAIMS_DONE.test(bare), `empty-note fallback must still be safe; got: ${bare}`);
});

console.log("\n# CONFIRM_WHO (signed-in, WHO unsettled) say — ASKS who, NEVER declares done\n");

t("brand-new hinted name → asks who they are, no done claim", () => {
  const say = sayForConfirmWho({ kind: "add", personHint: "Sarah", candidates: [] });
  assert.ok(!CLAIMS_DONE.test(say), `must not claim done; got: ${say}`);
  assert.ok(/Sarah/.test(say), `should name the hinted person; got: ${say}`);
  assert.ok(/\?$/.test(say.trim()), `should be a question; got: ${say}`);
});

t("ambiguous same-name → lists candidates to pick, no done claim", () => {
  const say = sayForConfirmWho({ kind: "pick", candidates: [{ name: "Marc" }, { name: "Marcus" }] });
  assert.ok(!CLAIMS_DONE.test(say), `must not claim done; got: ${say}`);
  assert.ok(/Marc/.test(say) && /Marcus/.test(say), `should offer both candidates; got: ${say}`);
});

t("likely-existing update → confirms it's them or someone new, no done claim", () => {
  const say = sayForConfirmWho({ kind: "update", personName: "Marc", personDetail: "in Denver", personHasDetail: true, candidates: [] });
  assert.ok(!CLAIMS_DONE.test(say), `must not claim done; got: ${say}`);
  assert.ok(/Marc/.test(say) && /(new|someone)/i.test(say), `should confirm-or-new; got: ${say}`);
});

t("no name at all → generic who-question, no done claim", () => {
  const say = sayForConfirmWho({ kind: "add", candidates: [] });
  assert.ok(!CLAIMS_DONE.test(say), `must not claim done; got: ${say}`);
  assert.ok(/who/i.test(say), `should ask who; got: ${say}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
