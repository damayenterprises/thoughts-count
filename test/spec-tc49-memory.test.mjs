// TC-49 (Phase 1) — memory spine + sovereignty, live integration verification.
//
// Exercises the REAL _memory.mjs engine against the live TC Supabase DB under a throwaway
// auth user, deleted in finally{} (cascade wipes every seeded row) so the DB is left pristine
// — the same pattern as spec-a-integration.test.mjs.
//
// Run:  node --env-file=.env test/spec-tc49-memory.test.mjs
//   (from a worktree without a local .env:  node --env-file=../thoughtfulness/.env test/spec-tc49-memory.test.mjs)
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

import crypto from "node:crypto";
import { serviceClient } from "../netlify/functions/_supabase.mjs";
import { insertFact, updateFact, deleteFact, deletePerson } from "../netlify/functions/_memory.mjs";

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name} ${extra}`); }
}
function eq(name, got, exp) { ok(name, got === exp, `(got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)})`); }

const supa = serviceClient();

// Active facts on a person = what the person card shows: open (not superseded) + not deleted.
async function activeFacts(userId, personId) {
  const { data } = await supa.from("facts").select("id,subject,relation,object,fact_class,surface_until")
    .eq("user_id", userId).eq("person_id", personId).is("valid_to", null).is("deleted_at", null);
  return data || [];
}
async function historyFacts(userId, personId) {
  const { data } = await supa.from("facts").select("id,object,valid_to,superseded_by")
    .eq("user_id", userId).eq("person_id", personId).not("valid_to", "is", null).is("deleted_at", null);
  return data || [];
}
// The exact predicate nudges-cron uses to decide a person's dates may fire.
async function nudgeableDates(userId, personId) {
  const { data } = await supa.from("key_dates")
    .select("id,label,source_fact_id,people!inner(deleted_at)")
    .eq("user_id", userId).eq("person_id", personId);
  return (data || []).filter((kd) => !kd.people?.deleted_at);
}

async function main() {
  const email = `spec-tc49+${Date.now()}-${crypto.randomBytes(3).toString("hex")}@example.com`;
  const { data: created, error: cErr } = await supa.auth.admin.createUser({ email, password: crypto.randomUUID(), email_confirm: true });
  if (cErr) throw cErr;
  const userId = created.user.id;
  console.log(`# throwaway user ${userId}\n`);

  const mkPerson = async (name) => {
    const { data, error } = await supa.from("people").insert({ user_id: userId, name, contact_kind: "personal" }).select("id").single();
    if (error) throw error;
    return data.id;
  };

  try {
    // ---------- create / edit / delete a fact (spec §4) ----------
    console.log("# create / edit / delete");
    const maria = await mkPerson("Maria Edmond");
    const r1 = await insertFact(supa, userId, { personId: maria, subject: "them", relation: "note", object: "loves hiking the Front Range", source: "typed" });
    ok("create: a fact is inserted", !!r1.fact?.id);
    eq("create: default class is DURABLE", r1.fact.fact_class, "DURABLE");
    eq("create: DURABLE never fades (surface_until null)", r1.fact.surface_until, null);
    eq("create: it shows in active reads", (await activeFacts(userId, maria)).length, 1);

    const upd = await updateFact(supa, userId, r1.fact.id, { object: "loves hiking AND trail running" });
    eq("edit: correction updates the value in place", upd.object, "loves hiking AND trail running");
    eq("edit: still exactly one active fact (correction ≠ supersession)", (await activeFacts(userId, maria)).length, 1);

    await deleteFact(supa, userId, r1.fact.id);
    eq("delete: hard-deleted fact leaves active reads", (await activeFacts(userId, maria)).length, 0);
    const { data: delRow } = await supa.from("facts").select("deleted_at").eq("id", r1.fact.id).single();
    ok("delete: deleted_at is stamped", !!delRow?.deleted_at);

    // ---------- supersession: "recovered" replaces "sick" (spec §3 AC) ----------
    console.log("\n# supersession (recovered supersedes sick)");
    const sickR = await insertFact(supa, userId, { personId: maria, subject: "dad", relation: "health_status", object: "sick", factClass: "EPISODIC", source: "typed" });
    ok("episodic: sick gets a surface_until window", !!sickR.fact.surface_until);
    const recR = await insertFact(supa, userId, { personId: maria, subject: "dad", relation: "health_status", object: "recovered", factClass: "MILESTONE", source: "typed" });
    eq("supersede: it retired the prior value", recR.superseded, true);
    const active = await activeFacts(userId, maria);
    const dadActive = active.filter((f) => f.subject === "dad" && f.relation === "health_status");
    eq("supersede: only ONE open dad-health fact", dadActive.length, 1);
    eq("supersede: and it's the new value", dadActive[0].object, "recovered");
    const hist = await historyFacts(userId, maria);
    const sickHist = hist.find((f) => f.id === sickR.fact.id);
    ok("supersede: old 'sick' is in history (valid_to set)", !!sickHist?.valid_to);
    eq("supersede: old 'sick' links forward to its successor", sickHist?.superseded_by, recR.fact.id);

    // ---------- same value reinforces, never duplicates (spec §3) ----------
    console.log("\n# reinforce (same value, no duplicate)");
    const p1 = await insertFact(supa, userId, { personId: maria, subject: "self", relation: "preference", object: "prefers texts to calls", factClass: "PREFERENCE", source: "typed", confidence: 0.8 });
    const p2 = await insertFact(supa, userId, { personId: maria, subject: "self", relation: "preference", object: "prefers texts to calls", factClass: "PREFERENCE", source: "typed", confidence: 0.8 });
    eq("reinforce: second identical capture reinforces", p2.reinforced, true);
    eq("reinforce: no supersession", p2.superseded, false);
    ok("reinforce: confidence bumped", p2.fact.confidence > p1.fact.confidence);
    const prefActive = (await activeFacts(userId, maria)).filter((f) => f.relation === "preference");
    eq("reinforce: still exactly one open preference row", prefActive.length, 1);

    // ---------- a RECURRING fact seeds a key_date (spec §3 AC) ----------
    console.log("\n# recurring fact seeds a key_date");
    const bdayR = await insertFact(supa, userId, { personId: maria, subject: "them", relation: "birthday", object: "birthday", factClass: "RECURRING", eventDate: "1990-06-14", source: "typed", keyDateLabel: "Birthday" });
    ok("seed: insert returned a seeded key_date id", !!bdayR.seededKeyDateId);
    const { data: seeded } = await supa.from("key_dates").select("id,label,recurs,source_fact_id,event_date").eq("source_fact_id", bdayR.fact.id).single();
    ok("seed: a key_date row is linked to the fact", !!seeded?.id);
    eq("seed: it recurs yearly", seeded.recurs, true);
    // deleting the seeding fact removes its seeded date (source_fact_id cascade / explicit)
    await deleteFact(supa, userId, bdayR.fact.id);
    const { data: gone } = await supa.from("key_dates").select("id").eq("source_fact_id", bdayR.fact.id).maybeSingle();
    ok("seed: deleting the fact removes its seeded date", !gone);

    // ---------- person hard-delete purges from reads AND nudges (spec §4 AC) ----------
    console.log("\n# person hard-delete purges reads + nudges");
    const todd = await mkPerson("Todd Hudgens");
    await insertFact(supa, userId, { personId: todd, subject: "them", relation: "job", object: "started at Acme", factClass: "MILESTONE", eventDate: "2026-07-20", source: "typed", keyDateLabel: "New job at Acme" });
    ok("pre-delete: Todd has a nudgeable date", (await nudgeableDates(userId, todd)).length >= 1);
    await deletePerson(supa, userId, todd);
    const { data: toddRow } = await supa.from("people").select("deleted_at").eq("id", todd).single();
    ok("delete-person: deleted_at is stamped", !!toddRow?.deleted_at);
    eq("delete-person: no dates remain nudgeable", (await nudgeableDates(userId, todd)).length, 0);

    // ---------- XOR guard: a fact attaches to exactly one owner-object ----------
    console.log("\n# person XOR household guard");
    let threwNeither = false, threwBoth = false;
    try { await insertFact(supa, userId, { subject: "x", relation: "y", object: "z", source: "typed" }); } catch { threwNeither = true; }
    try { await insertFact(supa, userId, { personId: maria, householdId: crypto.randomUUID(), subject: "x", relation: "y", object: "z", source: "typed" }); } catch { threwBoth = true; }
    ok("xor: rejects a fact with no owner", threwNeither);
    ok("xor: rejects a fact with both a person and a household", threwBoth);
  } finally {
    const { error: dErr } = await supa.auth.admin.deleteUser(userId);
    console.log(`\n# cleanup: deleted user ${userId}${dErr ? ` (WARN: ${dErr.message})` : " ✓ (cascade wiped seeded rows)"}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("FAILED:", fails.join(" · ")); process.exit(1); }
}

main().catch((e) => { console.error("integration run crashed:", e); process.exit(1); });
