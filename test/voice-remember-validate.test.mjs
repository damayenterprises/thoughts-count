// Validator hands-on test (TC-61 slice 2a — "remember a person by voice").
// Seeds a throwaway user w/ real people, mints their JWT, drives the LIVE deployed
// preview + confirm endpoints with that JWT, asserts DB writes, then deletes the user.
//
// Run:  node --env-file=.env test/voice-remember-validate.test.mjs
// Needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

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

const seedPerson = async (userId, name, kind = "personal", location = null) => {
  const { data, error } = await svc.from("people").insert({ user_id: userId, name, contact_kind: kind, location }).select("id").single();
  if (error) throw error;
  return data.id;
};
const factsFor = async (userId, personId) => {
  const { data } = await svc.from("facts").select("id, relation, object, subject").eq("user_id", userId).eq("person_id", personId).is("deleted_at", null);
  return data || [];
};
const peopleFor = async (userId) => {
  const { data } = await svc.from("people").select("id, name").eq("user_id", userId).is("deleted_at", null);
  return data || [];
};
const captureRow = async (userId, id) => {
  const { data } = await svc.from("captures").select("id, status, proposed_person_id, parsed").eq("user_id", userId).eq("id", id).maybeSingle();
  return data;
};

async function main() {
  const email = `tc61-val+${Date.now()}-${crypto.randomBytes(3).toString("hex")}@example.com`;
  const password = crypto.randomUUID() + "Aa1!";
  const { data: created, error: cErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) throw cErr;
  const userId = created.user.id;
  console.log(`# throwaway user ${userId} (${email})\n`);

  // Mint the user's JWT via password sign-in (real end-user token).
  const anonClient = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sess, error: sErr } = await anonClient.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;
  const token = sess.session.access_token;
  console.log(`# minted JWT (len ${token.length})\n`);

  try {
    // ============ 5. AUTH: preview requires a valid user ============
    console.log("# AUTH");
    const noAuth = await api("/api/capture/extract", null, { rawText: "Sarah got the job", source: "voice", preview: true });
    eq("preview without JWT → 401", noAuth.status, 401);
    const badAuth = await api("/api/capture/extract", "garbage.token.here", { rawText: "x", source: "voice", preview: true });
    eq("preview with bad JWT → 401", badAuth.status, 401);

    // ============ 1. WHICH ONE? (pick) ============
    console.log("\n# 1. Which-one (pick) path");
    const sarahSister = await seedPerson(userId, "Sarah", "personal", "Denver");
    const sarahCoworker = await seedPerson(userId, "Sarah", "contact", "Austin");
    const pv = await api("/api/capture/extract", token, { rawText: "Sarah got the job", source: "voice", preview: true });
    eq("pick preview → 200", pv.status, 200);
    const pcap = (pv.json.captures || [])[0];
    console.log("    candidate objects returned:", JSON.stringify(pcap?.candidates, null, 2));
    console.log("    full pick capture:", JSON.stringify(pcap, null, 2));
    eq("pick: kind === 'pick'", pcap?.kind, "pick");
    ok("pick: two candidates returned", (pcap?.candidates || []).length === 2, `(got ${(pcap?.candidates || []).length})`);
    const candIds = (pcap?.candidates || []).map((c) => c.id).sort();
    eq("pick: candidates are the two seeded Sarahs", candIds, [sarahSister, sarahCoworker].sort());
    // NOTHING written yet
    eq("pick: no fact on Sarah #1 yet", (await factsFor(userId, sarahSister)).length, 0);
    eq("pick: no fact on Sarah #2 yet", (await factsFor(userId, sarahCoworker)).length, 0);
    const pcapRow = await captureRow(userId, pcap.captureId);
    eq("pick: capture held as pending", pcapRow?.status, "pending");
    // Confirm to ONE Sarah
    const pick = await api("/api/capture/resolve", token, { captureId: pcap.captureId, action: "confirm", personId: sarahSister });
    eq("pick confirm → 200", pick.status, 200);
    eq("pick confirm: written to chosen Sarah", pick.json.personId, sarahSister);
    const s1f = await factsFor(userId, sarahSister);
    const s2f = await factsFor(userId, sarahCoworker);
    ok("pick: fact written to chosen Sarah only", s1f.length >= 1, `(chosen=${s1f.length})`);
    eq("pick: OTHER Sarah untouched", s2f.length, 0);
    console.log("    chosen Sarah facts:", JSON.stringify(s1f));

    // ============ 2. ADD a new person ============
    console.log("\n# 2. Add-new path");
    const av = await api("/api/capture/extract", token, { rawText: "add my coworker Todd, his dad just passed away", source: "voice", preview: true });
    eq("add preview → 200", av.status, 200);
    const acap = (av.json.captures || [])[0];
    console.log("    add capture:", JSON.stringify(acap, null, 2));
    eq("add: kind === 'add'", acap?.kind, "add");
    ok("add: personHint mentions Todd", /todd/i.test(acap?.personHint || ""), `(hint=${acap?.personHint})`);
    ok("add: at least one fact", (acap?.facts || []).length >= 1, `(facts=${(acap?.facts || []).length})`);
    const peopleBeforeAdd = (await peopleFor(userId)).length;
    // preview wrote no person
    eq("add: preview created no person", (await peopleFor(userId)).length, peopleBeforeAdd);
    const addC = await api("/api/capture/resolve", token, { captureId: acap.captureId, action: "confirm", newPersonName: acap.personHint });
    eq("add confirm → 200", addC.status, 200);
    ok("add confirm: person created", !!addC.json.personId, JSON.stringify(addC.json));
    eq("add: people count +1", (await peopleFor(userId)).length, peopleBeforeAdd + 1);
    const toddFacts = await factsFor(userId, addC.json.personId);
    ok("add: fact written to Todd", toddFacts.length >= 1, `(${toddFacts.length})`);
    console.log("    Todd:", addC.json.personName, "facts:", JSON.stringify(toddFacts));

    // ============ 3. UPDATE an existing person ============
    console.log("\n# 3. Update path");
    const maria = await seedPerson(userId, "Maria", "personal");
    const uv = await api("/api/capture/extract", token, { rawText: "Maria just got engaged", source: "voice", preview: true });
    eq("update preview → 200", uv.status, 200);
    const ucap = (uv.json.captures || [])[0];
    console.log("    update capture:", JSON.stringify(ucap, null, 2));
    eq("update: kind === 'update'", ucap?.kind, "update");
    eq("update: targets Maria", ucap?.personId, maria);
    eq("update: preview wrote nothing", (await factsFor(userId, maria)).length, 0);
    const upC = await api("/api/capture/resolve", token, { captureId: ucap.captureId, action: "confirm", personId: maria });
    eq("update confirm → 200", upC.status, 200);
    const mf = await factsFor(userId, maria);
    ok("update: fact written to Maria", mf.length >= 1, `(${mf.length})`);
    console.log("    Maria facts:", JSON.stringify(mf));

    // ============ 4. No-write-until-confirm + idempotency + garbage ============
    console.log("\n# 4. Safety / idempotency / garbage");
    // idempotent re-confirm on Maria's update
    const factCountBefore = (await factsFor(userId, maria)).length;
    const reC = await api("/api/capture/resolve", token, { captureId: ucap.captureId, action: "confirm", personId: maria });
    eq("idempotent: re-confirm → 200", reC.status, 200);
    ok("idempotent: re-confirm flagged alreadyConfirmed", reC.json.alreadyConfirmed === true, JSON.stringify(reC.json));
    eq("idempotent: no double-write", (await factsFor(userId, maria)).length, factCountBefore);
    // garbage / empty utterance
    const g1 = await api("/api/capture/extract", token, { rawText: "um, uh, hello there", source: "voice", preview: true });
    ok("garbage: greeting returns no captures gracefully", g1.status === 200 && (g1.json.captures || []).length === 0, `status=${g1.status} caps=${JSON.stringify(g1.json.captures)}`);
    const g2 = await api("/api/capture/extract", token, { rawText: "   ", source: "voice", preview: true });
    eq("empty: whitespace-only → 400", g2.status, 400);

    // ============ 6. REGRESSION: typed quick-capture (preview:false) ============
    console.log("\n# 6. Regression — typed preview:false");
    // Level A: unambiguous existing person → writes immediately
    const solo = await seedPerson(userId, "Priya Kapoor", "personal");
    const typedA = await api("/api/capture/extract", token, { rawText: "Priya Kapoor started a new job at Acme", source: "typed" });
    eq("typed A → 200", typedA.status, 200);
    const tcap = (typedA.json.captures || [])[0];
    eq("typed A: level A", tcap?.level, "A");
    ok("typed A: wrote immediately (no preview flag)", tcap?.preview === undefined, JSON.stringify(tcap));
    ok("typed A: fact on Priya", (await factsFor(userId, solo)).length >= 1);
    // Level B: unknown person → held, nothing written
    const typedB = await api("/api/capture/extract", token, { rawText: "Nobody McUnknown loves sailing", source: "typed" });
    const bcap = (typedB.json.captures || [])[0];
    eq("typed B: level B (held)", bcap?.level, "B");
    const bRow = await captureRow(userId, bcap.captureId);
    eq("typed B: capture pending", bRow?.status, "pending");

    // ============ Ambiguity in preview via location hint (bonus) ============
    // (already proven pick path; skip)

  } finally {
    const { error: dErr } = await svc.auth.admin.deleteUser(userId);
    console.log(`\n# cleanup: deleted user ${userId}${dErr ? ` (WARN ${dErr.message})` : " ✓ cascade"}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("FAILED:", fails.join(" · ")); process.exit(1); }
}

main().catch((e) => { console.error("run crashed:", e); process.exit(1); });
