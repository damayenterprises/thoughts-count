// Validator tests for TC-82 Phase 1 (the advisor conversation).
// Pure + offline: exercises humanizeText's Markdown strip (UX finding 1) and the
// converse handler's deterministic guard paths (the paths that return BEFORE any
// Anthropic call, so no key/network needed). Run WITHOUT --env-file so no key is set:
//   node test/spec-tc82-converse.test.mjs
import assert from "node:assert";
import { humanizeText, buildUserMessage } from "../netlify/functions/generate-background.mjs";
import converse, { systemPrompt } from "../netlify/functions/converse.mjs";

// Guarantee the deterministic (pre-Anthropic) paths: no key in env.
delete process.env.ANTHROPIC_API_KEY;

let pass = 0, fail = 0;
function t(name, fn) { return Promise.resolve().then(fn).then(() => { pass++; console.log(`  ok   ${name}`); }, (e) => { fail++; console.log(`  FAIL ${name} — ${e.message}`); }); }

const post = (bodyObj, { raw } = {}) => new Request("http://local/api/converse", {
  method: "POST", headers: { "content-type": "application/json" },
  body: raw !== undefined ? raw : JSON.stringify(bodyObj),
});
const call = async (req) => { const res = await converse(req); return { status: res.status, body: await res.json() }; };

console.log("# humanizeText — Markdown emphasis strip (UX finding 1) + regression safety");
await t("*italic* -> italic", () => assert.equal(humanizeText("celebrate her *properly*."), "celebrate her properly."));
await t("**bold** -> bold", () => assert.equal(humanizeText("this is **really** big"), "this is really big"));
await t("_italic_ -> italic", () => assert.equal(humanizeText("a _quiet_ gesture"), "a quiet gesture"));
await t("`code` -> code", () => assert.equal(humanizeText("use `code` here"), "use code here"));
await t("identifier health_status untouched", () => assert.equal(humanizeText("keep health_status intact"), "keep health_status intact"));
await t("email underscore untouched", () => assert.equal(humanizeText("reach me at a_b@x.com"), "reach me at a_b@x.com"));
await t("numeric en-dash range still normalizes", () => assert.equal(humanizeText("spend $30–45"), "spend $30-45"));
await t("plain prose unchanged", () => assert.equal(humanizeText("no markers here"), "no markers here"));

console.log("\n# converse handler — deterministic guards (no Anthropic call)");
await t("GET -> 405 method_not_allowed", async () => {
  const res = await converse(new Request("http://local/api/converse", { method: "GET" }));
  assert.equal(res.status, 405); assert.equal((await res.json()).error, "method_not_allowed");
});
await t("malformed JSON -> 400 bad_json", async () => {
  const { status, body } = await call(post(null, { raw: "{ not json" }));
  assert.equal(status, 400); assert.equal(body.error, "bad_json");
});
await t("empty messages -> 400 no_messages", async () => {
  const { status, body } = await call(post({ messages: [] }));
  assert.equal(status, 400); assert.equal(body.error, "no_messages");
});
await t("only assistant turns -> 400 no_user_turn", async () => {
  const { status, body } = await call(post({ messages: [{ role: "assistant", content: "hi" }] }));
  assert.equal(status, 400); assert.equal(body.error, "no_user_turn");
});
await t("non-force ending on HER turn -> 400 expected_user_turn", async () => {
  const { status, body } = await call(post({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "her reply" }] }));
  assert.equal(status, 400); assert.equal(body.error, "expected_user_turn");
});
await t("FORCE ending on HER turn BYPASSES the guard (the fixed bug)", async () => {
  // With no key set, passing the guard lands on the not_configured branch (200) — proving
  // force did NOT 400 with expected_user_turn. This is the exact escape-path regression.
  const { status, body } = await call(post({ force: true, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "her reply" }] }));
  assert.equal(status, 200);
  assert.notEqual(body.error, "expected_user_turn");
  assert.equal(body.error, "not_configured");
});
await t("junk (non-user/assistant) roles filtered -> 400 no_messages", async () => {
  const { status, body } = await call(post({ messages: [{ role: "system", content: "x" }, { role: "tool", content: "y" }] }));
  assert.equal(status, 400); assert.equal(body.error, "no_messages");
});

console.log("\n# TC-66 Phase 3a — systemPrompt MEMORY block (READ) + no-regression");
// The anonymous / home path MUST be byte-identical to Phase 1 (no context, empty context,
// or garbage context all collapse to the same base prompt).
const BASE = systemPrompt();
await t("no context -> base prompt has NO memory block", () => {
  assert.ok(!/WHAT YOU ALREADY REMEMBER/.test(BASE));
});
await t("undefined/empty/garbage context -> byte-identical to base", () => {
  assert.equal(systemPrompt(undefined), BASE);
  assert.equal(systemPrompt(null), BASE);
  assert.equal(systemPrompt({}), BASE);
  assert.equal(systemPrompt({ name: "", facts: [], priorPlans: "" }), BASE);
  assert.equal(systemPrompt({ facts: ["  ", ""], priorPlans: "   " }), BASE);
  assert.equal(systemPrompt("not an object"), BASE);
});
await t("real facts -> MEMORY block appears and weaves in (not a database recite)", () => {
  const sp = systemPrompt({ name: "Maya", relationship: "sister", facts: ["allergic to shellfish", "loves hiking"] });
  assert.ok(sp.startsWith(BASE.split("\n")[0]), "still starts with her identity");
  assert.ok(/WHAT YOU ALREADY REMEMBER about Maya \(sister\):/.test(sp));
  assert.ok(/- allergic to shellfish/.test(sp));
  assert.ok(/- loves hiking/.test(sp));
  assert.ok(/weave it in like a friend who remembers/.test(sp));
  assert.ok(sp.length > BASE.length, "memory block adds to the prompt");
});
await t("prior plans -> no-repeat instruction present", () => {
  const sp = systemPrompt({ name: "Sam", priorPlans: "- Birthday: suggested a handwritten note" });
  assert.ok(/do NOT repeat these; build on them/.test(sp));
  assert.ok(/- Birthday: suggested a handwritten note/.test(sp));
});
await t("name only (no facts/plans) still opens knowing them", () => {
  const sp = systemPrompt({ name: "Lee" });
  assert.ok(/WHAT YOU ALREADY REMEMBER about Lee:/.test(sp));
});
await t("facts capped so the prompt stays lean", () => {
  const many = Array.from({ length: 20 }, (_, i) => `fact ${i}`);
  const sp = systemPrompt({ name: "Cap", facts: many });
  assert.ok(/- fact 7/.test(sp));
  assert.ok(!/- fact 8/.test(sp), "capped at 8 facts");
});

console.log("\n# TC-66 Phase 3a — priorPlans reaches the plan (generate-background)");
await t("buildUserMessage includes the no-repeat block when priorPlans present", () => {
  const msg = buildUserMessage({ moment: "her birthday", about: "my sister", priorPlans: "- Birthday: suggested a spa day" });
  assert.ok(/ALREADY SUGGESTED FOR THIS PERSON BEFORE/.test(msg));
  assert.ok(/- Birthday: suggested a spa day/.test(msg));
});
await t("buildUserMessage UNCHANGED (no no-repeat block) when priorPlans absent", () => {
  const msg = buildUserMessage({ moment: "her birthday", about: "my sister" });
  assert.ok(!/ALREADY SUGGESTED FOR THIS PERSON BEFORE/.test(msg));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
