// TC-82 Phase 2 (2a): unit test for the >400-char speak-truncation helper used by the spoken
// advisor loop. The real function is inline in public/index.html (window.__tcSpeakSafeText); this
// mirrors it EXACTLY so the >cap behavior stays deterministic and regression-guarded. If you
// change speakSafeText in index.html, change this copy too.
// Contract: the VISIBLE bubble always shows the full reply; ONLY the audio is trimmed, never past
// the /api/speak MAX_CHARS (400). Prefer whole sentences up to the cap; else a clean word cut.
// Run: node test/tc82-speak-safe.test.mjs
import assert from "node:assert";

function speakSafeText(text, cap){
  const CAP = cap || 400;
  const s = String(text == null ? '' : text).trim();
  if (s.length <= CAP) return s;
  const sentences = s.match(/[^.!?]+[.!?]+/g) || [];
  let out = '';
  for (const sen of sentences){
    if ((out + sen).trim().length > CAP) break;
    out += sen;
  }
  out = out.trim();
  if (out) return out;
  let cut = s.lastIndexOf(' ', CAP);
  if (cut < CAP * 0.5) cut = CAP;
  return s.slice(0, cut).trim();
}

let pass = 0, fail = 0;
function t(name, fn){ try { fn(); pass++; console.log(`  ok   ${name}`); } catch(e){ fail++; console.log(`  FAIL ${name} — ${e.message}`); } }

console.log("# speakSafeText — the >400-char speak guard");

t("short reply (the common case) passes through untouched", () => {
  const s = "That sounds hard. What matters most to them right now?";
  assert.strictEqual(speakSafeText(s), s);
});

t("empty / null / whitespace → empty string (never throws)", () => {
  assert.strictEqual(speakSafeText(""), "");
  assert.strictEqual(speakSafeText(null), "");
  assert.strictEqual(speakSafeText(undefined), "");
  assert.strictEqual(speakSafeText("   "), "");
});

t("never returns audio text longer than the cap", () => {
  const long = ("This is one sentence that is fairly long and warm. ").repeat(20); // ~1000 chars
  const out = speakSafeText(long, 400);
  assert.ok(out.length <= 400, `got ${out.length}`);
});

t("prefers whole sentences up to the cap (clean boundary, no mid-word cut)", () => {
  const a = "A".repeat(200) + ". " + "B".repeat(300) + ". " + "C".repeat(50) + ".";
  const out = speakSafeText(a, 400);
  // First sentence (201 incl period) fits; adding the 2nd (301) would exceed → stop after the 1st.
  assert.ok(out.endsWith("."), "ends on a sentence boundary");
  assert.ok(out.startsWith("A"), "starts at the beginning");
  assert.ok(!out.includes("B"), "does not include the over-cap second sentence");
  assert.ok(out.length <= 400);
});

t("no sentence boundary within the cap → clean word-boundary cut (no partial word)", () => {
  const words = Array.from({length: 120}, (_,i) => "word" + i).join(" "); // long, no periods
  const out = speakSafeText(words, 400);
  assert.ok(out.length <= 400, `got ${out.length}`);
  assert.ok(!/\s$/.test(out), "no trailing space");
  // The cut is at a space, so the last token is a whole 'wordN' (not sliced mid-token).
  assert.ok(/word\d+$/.test(out), "ends on a whole word");
});

t("exactly at cap length is left untouched", () => {
  const s = "x".repeat(400);
  assert.strictEqual(speakSafeText(s, 400), s);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
