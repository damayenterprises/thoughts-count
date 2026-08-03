// TC-62 Validator unit test — the pending-voice stash contract (companion.js).
// The stash is the one genuinely-new pure-logic surface in TC-62 and had no test.
// This copies the EXACT implementation from public/companion.js and drives it against
// mock localStorage variants (normal, blocked, malformed) to prove the spec's contract:
//   - one-shot read (consume deletes)
//   - 30-min TTL (stale → null)
//   - version gate (v!==1 → null)
//   - malformed JSON → null (no throw)
//   - blocked/absent storage never throws
//
// Run:  node test/tc62-pending-voice.test.mjs   (no env, no network)

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; fails.push(n); console.log(`  FAIL ${n}`); } };

// ---- exact copy of companion.js TC-62 stash block ----
const PENDING_VOICE_KEY = "tc_pending_voice";
const PENDING_VOICE_TTL_MS = 30 * 60 * 1000;
function makeStash(localStorage) {
  function stashPendingVoice({ intent, transcript }) {
    try {
      if (!intent || !transcript) return;
      localStorage.setItem(PENDING_VOICE_KEY, JSON.stringify({ v: 1, intent, transcript, ts: Date.now() }));
    } catch (e) {}
  }
  function clearPendingVoice() { try { localStorage.removeItem(PENDING_VOICE_KEY); } catch (e) {} }
  function consumePendingVoice() {
    let raw = null;
    try { raw = localStorage.getItem(PENDING_VOICE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    clearPendingVoice();
    try {
      const p = JSON.parse(raw);
      if (!p || p.v !== 1 || !p.transcript || !p.ts) return null;
      if (Date.now() - p.ts > PENDING_VOICE_TTL_MS) return null;
      return p;
    } catch (e) { return null; }
  }
  return { stashPendingVoice, clearPendingVoice, consumePendingVoice };
}
// ---- end copy ----

function mockLS() {
  const m = new Map();
  return {
    _m: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

// 1. Round trip
{
  const ls = mockLS(); const s = makeStash(ls);
  s.stashPendingVoice({ intent: "remember", transcript: "grandma's birthday is soon" });
  const p = s.consumePendingVoice();
  ok("round-trip returns intent+transcript", p && p.intent === "remember" && p.transcript === "grandma's birthday is soon");
}
// 2. One-shot: second consume is null
{
  const ls = mockLS(); const s = makeStash(ls);
  s.stashPendingVoice({ intent: "remember", transcript: "x y z" });
  s.consumePendingVoice();
  ok("one-shot: second consume is null", s.consumePendingVoice() === null);
  ok("one-shot: key removed from storage", ls.getItem(PENDING_VOICE_KEY) === null);
}
// 3. TTL: >30min stale → null
{
  const ls = mockLS(); const s = makeStash(ls);
  ls.setItem(PENDING_VOICE_KEY, JSON.stringify({ v: 1, intent: "remember", transcript: "old", ts: Date.now() - (31 * 60 * 1000) }));
  ok("stale (>30min) → null", s.consumePendingVoice() === null);
}
// 4. TTL: just under 30min → fresh
{
  const ls = mockLS(); const s = makeStash(ls);
  ls.setItem(PENDING_VOICE_KEY, JSON.stringify({ v: 1, intent: "remember", transcript: "recent", ts: Date.now() - (29 * 60 * 1000) }));
  const p = s.consumePendingVoice();
  ok("fresh (<30min) → returned", p && p.transcript === "recent");
}
// 5. Version mismatch → null
{
  const ls = mockLS(); const s = makeStash(ls);
  ls.setItem(PENDING_VOICE_KEY, JSON.stringify({ v: 2, intent: "remember", transcript: "future", ts: Date.now() }));
  ok("version mismatch → null", s.consumePendingVoice() === null);
}
// 6. Malformed JSON → null, no throw
{
  const ls = mockLS(); const s = makeStash(ls);
  ls.setItem(PENDING_VOICE_KEY, "{not valid json");
  let threw = false; let r;
  try { r = s.consumePendingVoice(); } catch (e) { threw = true; }
  ok("malformed JSON → null, no throw", !threw && r === null);
}
// 7. Missing transcript field → null
{
  const ls = mockLS(); const s = makeStash(ls);
  ls.setItem(PENDING_VOICE_KEY, JSON.stringify({ v: 1, intent: "remember", ts: Date.now() }));
  ok("missing transcript → null", s.consumePendingVoice() === null);
}
// 8. stash refuses empty transcript / intent (never writes junk)
{
  const ls = mockLS(); const s = makeStash(ls);
  s.stashPendingVoice({ intent: "remember", transcript: "" });
  s.stashPendingVoice({ intent: "", transcript: "hi" });
  ok("empty transcript/intent not stored", ls.getItem(PENDING_VOICE_KEY) === null);
}
// 9. Blocked storage (throws on every op) never throws out
{
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const s = makeStash(blocked);
  let threw = false; let r;
  try { s.stashPendingVoice({ intent: "remember", transcript: "hi" }); r = s.consumePendingVoice(); s.clearPendingVoice(); } catch (e) { threw = true; }
  ok("blocked storage never throws", !threw);
  ok("blocked storage consume → null", r === null);
}
// 10. Empty store → null
{
  const ls = mockLS(); const s = makeStash(ls);
  ok("empty store consume → null", s.consumePendingVoice() === null);
}

console.log(`\nTC-62 stash: ${pass} passed, ${fail} failed`);
if (fail) { console.log("FAILS:", fails.join(", ")); process.exit(1); }
