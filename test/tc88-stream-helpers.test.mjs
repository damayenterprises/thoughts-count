// TC-88 — pure-helper tests for the streaming voice reply.
// Server: takeSentences (incremental sentence-boundary splitter) + extractSayPartial (tolerant
// pull of the `say` string out of accumulating tool partial_json). Client: cvMayOpenMic (the
// "queue drained → may open mic" feedback-loop predicate, mirrored here since it's inline in
// index.html). All pure + offline.  Run: node test/tc88-stream-helpers.test.mjs
import assert from "node:assert";
import { takeSentences, extractSayPartial } from "../netlify/functions/converse.mjs";

let pass = 0, fail = 0;
function t(name, fn){ try { fn(); pass++; console.log(`  ok   ${name}`); } catch(e){ fail++; console.log(`  FAIL ${name} — ${e.message}`); } }

console.log("# takeSentences — incremental sentence emission (never mid-word)");

t("no complete sentence yet → nothing emitted, all is tail", () => {
  const r = takeSentences("That sounds hard");
  assert.deepStrictEqual(r.sentences, []);
  assert.strictEqual(r.tail, "That sounds hard");
});

t("one complete sentence (punct + space) emits; tail is the next fragment", () => {
  const r = takeSentences("That sounds hard. What matters");
  assert.deepStrictEqual(r.sentences, ["That sounds hard."]);
  assert.strictEqual(r.tail, " What matters");
});

t("trailing sentence WITHOUT a following space is NOT emitted mid-stream", () => {
  // "hard." with nothing after it could be "hard.5" or "Dr." — wait for a space or final flush.
  const r = takeSentences("That sounds hard.");
  assert.deepStrictEqual(r.sentences, []);
  assert.strictEqual(r.tail, "That sounds hard.");
});

t("final flush emits the trailing sentence even without a following space", () => {
  const r = takeSentences("That sounds hard.", { final: true });
  assert.deepStrictEqual(r.sentences, ["That sounds hard."]);
  assert.strictEqual(r.tail, "");
});

t("final flush emits a reply with NO terminal punctuation as one sentence", () => {
  const r = takeSentences("no punctuation here", { final: true });
  assert.deepStrictEqual(r.sentences, ["no punctuation here"]);
  assert.strictEqual(r.tail, "");
});

t("multiple sentences in one pass", () => {
  const r = takeSentences("Oh no. I'm so sorry. What happened next", {});
  assert.deepStrictEqual(r.sentences, ["Oh no.", "I'm so sorry."]);
  assert.strictEqual(r.tail, " What happened next");
});

t("does not split a decimal (no space after the dot)", () => {
  const r = takeSentences("It costs 3.5 dollars and more");
  assert.deepStrictEqual(r.sentences, []); // "3.5" has no space after the dot → not a boundary
});

t("consumes a run of terminators (?! and closing quote) as one boundary", () => {
  const r = takeSentences('Really?! "Yes." next', { final: true });
  assert.deepStrictEqual(r.sentences, ["Really?!", '"Yes."', "next"]);
});

t("incremental: feeding growth only yields NEW sentences off the remainder", () => {
  // Simulate the server's use: emit new sentences, then advance a consumed marker by full-tail.
  let full = "";
  let emitted = "";
  const step = (chunk, final=false) => {
    full += chunk;
    const remainder = full.slice(emitted.length);
    const { sentences, tail } = takeSentences(remainder, { final });
    emitted = full.slice(0, full.length - tail.length);
    return sentences;
  };
  assert.deepStrictEqual(step("Oh no. "), ["Oh no."]);
  assert.deepStrictEqual(step("I'm sorry. "), ["I'm sorry."]);
  assert.deepStrictEqual(step("Tell me", true), ["Tell me"]);
});

console.log("\n# extractSayPartial — tolerant pull of `say` from accumulating tool JSON");

t("empty / no key yet → empty string", () => {
  assert.strictEqual(extractSayPartial(""), "");
  assert.strictEqual(extractSayPartial('{"mo'), "");
  assert.strictEqual(extractSayPartial(null), "");
});

t("opening quote not arrived yet → empty", () => {
  assert.strictEqual(extractSayPartial('{"say":'), "");
  assert.strictEqual(extractSayPartial('{"say": '), "");
});

t("value still being written → the partial value so far", () => {
  assert.strictEqual(extractSayPartial('{"say":"That sounds ha'), "That sounds ha");
});

t("closed value → the full string, stops at closing quote", () => {
  assert.strictEqual(extractSayPartial('{"say":"All done."}'), "All done.");
});

t("escaped quote inside the value is honored", () => {
  assert.strictEqual(extractSayPartial('{"say":"She said \\"hi\\" to me"}'), 'She said "hi" to me');
});

t("escaped newline decodes; value not yet closed", () => {
  assert.strictEqual(extractSayPartial('{"say":"line one\\nline two'), "line one\nline two");
});

t("a lone trailing backslash (escape still streaming) is not consumed", () => {
  // "...to me\" with the escape half-arrived → keep what we have, don't crash.
  assert.strictEqual(extractSayPartial('{"say":"to me\\'), "to me");
});

t("whitespace between colon and quote tolerated", () => {
  assert.strictEqual(extractSayPartial('{ "say" :  "hello"'), "hello");
});

console.log("\n# cvMayOpenMic — the feedback-loop 'may open mic' predicate (mirror of index.html)");
// Mirror of the inline helper: mic opens ONLY when the reply is fully done, nothing is playing,
// and nothing is queued. If you change cvMayOpenMic in index.html, change this copy too.
function cvMayOpenMic(sp){
  return !!(sp && sp.replyDone && !sp.playing && sp.queue.length === 0);
}

t("not done yet → false (never open mid-reply)", () => {
  assert.strictEqual(cvMayOpenMic({ replyDone: false, playing: false, queue: [] }), false);
});
t("done but still playing → false (no talking over herself)", () => {
  assert.strictEqual(cvMayOpenMic({ replyDone: true, playing: true, queue: [] }), false);
});
t("done, idle, but sentences still queued → false", () => {
  assert.strictEqual(cvMayOpenMic({ replyDone: true, playing: false, queue: ["one"] }), false);
});
t("done + drained + idle → TRUE (open the mic)", () => {
  assert.strictEqual(cvMayOpenMic({ replyDone: true, playing: false, queue: [] }), true);
});
t("null / undefined → false (never throws)", () => {
  assert.strictEqual(cvMayOpenMic(null), false);
  assert.strictEqual(cvMayOpenMic(undefined), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
