// Validator security probe (TC-61 slice 2a, req 1b).
// Seeds TWO throwaway users. Confirms a locked preview / confirm CANNOT write to a
// person the JWT user does not own, and that a bogus personId is rejected.
//
// Run:  node --env-file=.env test/voice-locked-security-validate.test.mjs

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.TC_BASE || "https://voicetest--thoughts-count.netlify.app";
const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; fails.push(n); console.log(`  FAIL ${n} ${x}`); } };
const eq = (n, g, e) => ok(n, JSON.stringify(g) === JSON.stringify(e), `(got ${JSON.stringify(g)}, exp ${JSON.stringify(e)})`);

async function api(path, token, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
const factsFor = async (userId, personId) => {
  const { data } = await svc.from("facts").select("id").eq("user_id", userId).eq("person_id", personId).is("deleted_at", null);
  return data || [];
};
async function makeUser() {
  const email = `tc61-sec+${Date.now()}-${crypto.randomBytes(3).toString("hex")}@example.com`;
  const password = crypto.randomUUID() + "Aa1!";
  const { data: created, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sess, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;
  return { userId: created.user.id, token: sess.session.access_token };
}

async function main() {
  const attacker = await makeUser();   // the JWT we drive
  const victim = await makeUser();      // owns the target person
  console.log(`# attacker ${attacker.userId}\n# victim   ${victim.userId}\n`);
  // victim owns a person
  const { data: vp } = await svc.from("people").insert({ user_id: victim.userId, name: "VictimMaria", contact_kind: "personal" }).select("id").single();
  const victimPersonId = vp.id;

  try {
    // 1b-i: locked PREVIEW against a foreign personId → must NOT return an update proposal for it.
    const lp = await api("/api/capture/extract", attacker.token, { rawText: "just got engaged", lockedPersonId: victimPersonId, source: "voice", preview: true });
    console.log("  locked preview (foreign id):", lp.status, JSON.stringify(lp.json));
    ok("locked preview on foreign person → 404/no-leak", lp.status === 404 || lp.status === 400, `status=${lp.status}`);
    ok("locked preview: did not echo victim's name", !JSON.stringify(lp.json).includes("VictimMaria"), JSON.stringify(lp.json));

    // 1b-ii: bogus (random uuid) locked personId → 404
    const bogus = await api("/api/capture/extract", attacker.token, { rawText: "just got engaged", lockedPersonId: crypto.randomUUID(), source: "voice", preview: true });
    eq("locked preview on bogus uuid → 404", bogus.status, 404);

    // 1b-iii: confirm-time cross-tenant write via personId → must be rejected, no fact on victim.
    // First make a legit pending capture as the attacker (add path).
    const seed = await api("/api/capture/extract", attacker.token, { rawText: "add my friend Alex, he loves hiking", source: "voice", preview: true });
    const cap = (seed.json.captures || [])[0];
    ok("attacker made a pending capture", !!cap?.captureId, JSON.stringify(seed.json));
    const cross = await api("/api/capture/resolve", attacker.token, { captureId: cap.captureId, action: "confirm", personId: victimPersonId });
    console.log("  cross-tenant confirm:", cross.status, JSON.stringify(cross.json));
    ok("cross-tenant confirm rejected (404)", cross.status === 404, `status=${cross.status}`);
    eq("victim person got NO fact", (await factsFor(victim.userId, victimPersonId)).length, 0);

    // 1b-iv: attacker cannot resolve a capture belonging to the victim (captureId scoping).
    // Victim makes a capture; attacker tries to confirm it.
    const vSeed = await api("/api/capture/extract", victim.token, { rawText: "add my friend Bea, she paints", source: "voice", preview: true });
    const vCap = (vSeed.json.captures || [])[0];
    const steal = await api("/api/capture/resolve", attacker.token, { captureId: vCap.captureId, action: "confirm", newPersonName: "Bea" });
    console.log("  steal victim capture:", steal.status, JSON.stringify(steal.json));
    ok("attacker cannot resolve victim's capture (404)", steal.status === 404, `status=${steal.status}`);
  } finally {
    await svc.auth.admin.deleteUser(attacker.userId);
    await svc.auth.admin.deleteUser(victim.userId);
    console.log(`\n# cleanup: deleted both users`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("FAILED:", fails.join(" · ")); process.exit(1); }
}
main().catch((e) => { console.error("run crashed:", e); process.exit(1); });
