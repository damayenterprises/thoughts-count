// TC-122 — register-per-reply mapping (Design Lead spec). Verifies the moment → register decision,
// the load-bearing grief override (never bright on a loss), and the warm default. Pure + offline.
// Run: node test/tc122-register.test.mjs
import assert from "node:assert";
import { registerForReply } from "../netlify/functions/converse.mjs";

const u = (t) => [{ role: "user", content: t }];
let pass = 0, fail = 0;
function t(name, fn){ try { fn(); pass++; console.log(`  ok   ${name}`); } catch(e){ fail++; console.log(`  FAIL ${name} — ${e.message}`); } }

console.log("# registerForReply — moment → emotional register");

// hard time / grief → tender
t("death → tender", () => assert.equal(registerForReply(u("my mom just died"), {}), "tender"));
t("diagnosis → tender", () => assert.equal(registerForReply(u("she was just diagnosed with cancer"), {}), "tender"));
t("job loss → tender", () => assert.equal(registerForReply(u("he got laid off"), {}), "tender"));
t("breakup → tender", () => assert.equal(registerForReply(u("they're getting divorced"), {}), "tender"));

// celebration → bright
t("new baby → bright", () => assert.equal(registerForReply(u("my sister just had a baby"), {}), "bright"));
t("promotion → bright", () => assert.equal(registerForReply(u("my friend got promoted"), {}), "bright"));

// gratitude → fond
t("thank you → fond", () => assert.equal(registerForReply(u("I want to thank my mentor"), {}), "fond"));

// TC-145: light / playful moments the valence buckets miss → fond (not flat warm)
t("hilarious friend → fond", () => assert.equal(registerForReply(u("my friend Bob is hilarious, always good for a laugh"), {}), "fond"));
t("what a character → fond", () => assert.equal(registerForReply(u("he's such a character, cracks me up"), {}), "fond"));
t("grief that mentions laughing stays tender (not fond)", () =>
  assert.equal(registerForReply(u("my dad passed away; we used to laugh so much together"), {}), "tender"));

// default / ambiguous → warm
t("neutral → warm", () => assert.equal(registerForReply(u("I want to reconnect with an old friend"), {}), "warm"));
t("empty messages → warm", () => assert.equal(registerForReply([], {}), "warm"));
t("empty text → warm", () => assert.equal(registerForReply(u(""), {}), "warm"));

// GRIEF OVERRIDE (the load-bearing guardrail): a loss occasion forces tender even when celebratory
// words are present and valence might slip elsewhere. Never bright on a loss.
t("grief override beats celebration words", () =>
  assert.equal(registerForReply(u("he lost his job but he's staying positive and upbeat"), {}), "tender"));

// Uses ctx.moment too (a saved-person conversation may pass the moment in context).
t("reads ctx.moment", () => assert.equal(registerForReply([], { moment: "her father passed away" }), "tender"));

// Only ever returns a valid register.
t("always a valid register", () => {
  for (const s of ["", "hi", "my dog", "party time!!!", "ugh"]) {
    assert.ok(["warm", "bright", "tender", "fond"].includes(registerForReply(u(s), {})), s);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
