// TC-88 — pure-helper tests for the streaming voice reply.
// Server: takeSentences (incremental sentence-boundary splitter) + extractSayPartial (tolerant
// pull of the `say` string out of accumulating tool partial_json). Client: cvMayOpenMic (the
// "queue drained → may open mic" feedback-loop predicate, mirrored here since it's inline in
// index.html). All pure + offline.  Run: node test/tc88-stream-helpers.test.mjs
import assert from "node:assert";
import { takeSentences, extractSayPartial, takeFirstEarlyChunk, EARLY_MIN_CHARS } from "../netlify/functions/converse.mjs";

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

console.log("\n# takeFirstEarlyChunk — the FIRST spoken chunk emits early (time-to-first-word)");

t("nothing yet (empty / whitespace) → null (keep accumulating)", () => {
  assert.strictEqual(takeFirstEarlyChunk(""), null);
  assert.strictEqual(takeFirstEarlyChunk("   "), null);
  assert.strictEqual(takeFirstEarlyChunk(null), null);
});

t("short fragment under threshold, no comma/sentence → null (not ready)", () => {
  // "Oh that's" is < 35 chars, no comma, no sentence end → wait for more.
  assert.strictEqual(takeFirstEarlyChunk("Oh that's"), null);
});

t("first comma+space fires early (before a full sentence)", () => {
  const r = takeFirstEarlyChunk("Oh no, I'm so sorry to hear that happened.");
  assert.strictEqual(r.chunk, "Oh no,");
  assert.strictEqual(r.tail, " I'm so sorry to hear that happened.");
});

t("early chunk never splits mid-word (comma cut lands on the comma, tail starts at space)", () => {
  const r = takeFirstEarlyChunk("Well, tell me more");
  assert.strictEqual(r.chunk, "Well,");
  assert.ok(/^\s/.test(r.tail), "tail should begin with the boundary whitespace, not mid-word");
});

t("no comma but >=35 chars → cut at the next word boundary (never mid-word)", () => {
  // 35+ chars, no comma, no sentence end yet.
  const s = "That sounds like it was really heavy and hard to carry";
  const r = takeFirstEarlyChunk(s);
  assert.ok(r, "should emit an early chunk once past the char threshold");
  assert.ok(r.chunk.length >= EARLY_MIN_CHARS, "chunk reaches at least the min-char threshold");
  // Reassembling chunk (trimmed) + tail must equal the source (no drop, no dup, no mid-word split).
  assert.strictEqual((r.chunk + r.tail).replace(/\s+/g, " ").trim(), s.replace(/\s+/g, " ").trim());
  // The boundary is a real whitespace split → the char just after the chunk in the source is space.
  assert.ok(!/\S$/.test(r.tail[0]) || /\s/.test(r.tail[0]), "tail begins at a word boundary");
});

t("first full sentence (shorter than 35 chars, no comma) fires as the early chunk", () => {
  const r = takeFirstEarlyChunk("Oh no. What happened next after that");
  assert.strictEqual(r.chunk, "Oh no.");
  assert.strictEqual(r.tail, " What happened next after that");
});

t("EARLIEST break wins: a comma before the char threshold beats the word-boundary cut", () => {
  const s = "Okay, that is a lot to hold all at once and I hear you";
  const r = takeFirstEarlyChunk(s);
  assert.strictEqual(r.chunk, "Okay,"); // comma at index 4 beats the ~35-char word cut
});

console.log("\n# flushSay emit model — FULL SENTENCES only (no clause-chopping; matches converse.mjs)");

// Mirror of the server's flushSay after TC-88's early-clause removal: emit ONLY complete sentences
// via takeSentences, advancing a consumed marker (sayEmitted) so each char is emitted EXACTLY once.
// No takeFirstEarlyChunk in the path → the first spoken chunk is a whole sentence, like the opener.
function flushSayModel(deltas) {
  let full = "", sayEmitted = "";
  const emitted = [];
  const flush = (final) => {
    const remainder = full.slice(sayEmitted.length);
    const { sentences, tail } = takeSentences(remainder, { final });
    for (const sen of sentences) emitted.push(sen);
    sayEmitted = full.slice(0, full.length - tail.length);
  };
  for (const d of deltas) { full += d; flush(false); }
  flush(true);
  return emitted;
}

t("full round-trip: each emit is a WHOLE sentence, no dup / no drop", () => {
  const source = "Oh no, I'm so sorry. That must have been so hard. Tell me what you need";
  // Feed it in growing chunks the way input_json_delta arrives.
  const deltas = ["Oh no, I'm ", "so sorry. That must ", "have been so hard. Tell ", "me what you need"];
  const emitted = flushSayModel(deltas);
  // The leading "Oh no, I'm so sorry." is ONE sentence now — not chopped at the comma.
  assert.deepStrictEqual(emitted, [
    "Oh no, I'm so sorry.",
    "That must have been so hard.",
    "Tell me what you need",
  ]);
  // Reassembly proves exactly-once: concatenating every emitted piece == the source (whitespace-normalized).
  assert.strictEqual(emitted.join(" ").replace(/\s+/g, " ").trim(), source.replace(/\s+/g, " ").trim());
});

t("no sentence is clause-chopped at its inner commas", () => {
  // A long comma-laden sentence must emit whole, not split at its commas.
  const source = "Hi. I think we should talk, gently, about what comes next now.";
  const deltas = ["Hi. I think we should ", "talk, gently, about ", "what comes next now."];
  const emitted = flushSayModel(deltas);
  assert.deepStrictEqual(emitted, [
    "Hi.",
    "I think we should talk, gently, about what comes next now.", // NOT split at its inner commas
  ]);
});

t("first spoken chunk is a full sentence, not a sub-clause (the founder-feedback fix)", () => {
  // Even when the reply opens with a comma clause, the first emit waits for the full sentence.
  const deltas = ["Oh, that sounds ", "really heavy to carry. ", "What happened"];
  const emitted = flushSayModel(deltas);
  assert.deepStrictEqual(emitted, [
    "Oh, that sounds really heavy to carry.", // whole sentence, NOT "Oh," early
    "What happened",
  ]);
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
