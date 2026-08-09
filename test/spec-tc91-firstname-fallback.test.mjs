// TC-91 — first-name fallback in the voice/typed resolver + canonical-spelling-on-match.
//
// The gap: the resolver compared a spoken name against each person's FULL stored name via the
// trigram RPC, so a bare spoken first name ("Jon") vs a saved full name ("John Miller") scored
// ~0.14 and was MISSED — the person never surfaced, risking a mis-spelled duplicate. This test
// exercises the REAL _capture.mjs against the live TC Supabase under a throwaway user (deleted in
// finally{}), same pattern as spec-tc50-capture.test.mjs. Purely deterministic + DB-backed — no
// Claude call needed (we drive resolvePerson / the write path directly).
//
// Run:  node --env-file=.env test/spec-tc91-firstname-fallback.test.mjs
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

import crypto from "node:crypto";
import { serviceClient } from "../netlify/functions/_supabase.mjs";
import { resolvePerson, writeFactsToPerson } from "../netlify/functions/_capture.mjs";

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name} ${extra}`); }
}
function eq(name, got, exp) { ok(name, got === exp, `(got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)})`); }

const supa = serviceClient();

async function peopleCount(userId) {
  const { data } = await supa.from("people").select("id").eq("user_id", userId).is("deleted_at", null);
  return (data || []).length;
}
async function personName(userId, personId) {
  const { data } = await supa.from("people").select("name").eq("user_id", userId).eq("id", personId).maybeSingle();
  return data?.name || null;
}
async function activeFacts(userId, personId) {
  const { data } = await supa.from("facts").select("id,object").eq("user_id", userId).eq("person_id", personId).is("valid_to", null).is("deleted_at", null);
  return data || [];
}

async function main() {
  const email = `spec-tc91+${Date.now()}-${crypto.randomBytes(3).toString("hex")}@example.com`;
  const { data: created, error: cErr } = await supa.auth.admin.createUser({ email, password: crypto.randomUUID(), email_confirm: true });
  if (cErr) throw cErr;
  const userId = created.user.id;
  console.log(`# throwaway user ${userId}\n`);

  const mkPerson = async (name, extra = {}) => {
    const { data, error } = await supa.from("people").insert({ user_id: userId, name, contact_kind: "personal", ...extra }).select("id").single();
    if (error) throw error;
    return data.id;
  };

  try {
    // ---------- fallback catches a bare first name against a saved FULL name ----------
    console.log("# fallback: bare 'Jon' catches saved 'John Miller' (trigram missed it)");
    const johnMiller = await mkPerson("John Miller", { location: "Denver, CO" });

    // Baseline: WITHOUT the fallback opt-in, the RPC misses the bare-first-name homophone → no match.
    const rOff = await resolvePerson(supa, userId, "Jon", {});
    eq("without fallback opt-in → no proposed person (RPC misses Jon/John Miller)", rOff.proposedPersonId, null);
    eq("without fallback opt-in → Level B (add-new)", rOff.level, "B");

    // WITH the fallback opt-in (voice/typed path) → John Miller surfaces as a single confirm-WHO.
    const rJon = await resolvePerson(supa, userId, "Jon", { fallbackFirstName: true });
    eq("fallback surfaces the saved person", rJon.proposedPersonId, johnMiller);
    ok("fallback is flagged as a homophone guess (not a confident match)", rJon.fallback === true, JSON.stringify(rJon));
    eq("fallback stays Level B — user must confirm WHO (no silent attach)", rJon.level, "B");
    ok("fallback evidence asks to confirm (is this them?)", /is this them\?/i.test(rJon.evidence || ""), rJon.evidence);

    // INVARIANT #1: a fallback hit must NOT be raised to Level A (that would be a silent write path).
    ok("INVARIANT: fallback is never Level A (never a silent wrong-person attach)", rJon.level !== "A");

    // ---------- guard false positives: a DIFFERENT first name must NOT attach ----------
    console.log("\n# false-positive guard: 'Tim' does NOT attach to 'John Miller'");
    const rTim = await resolvePerson(supa, userId, "Tim", { fallbackFirstName: true });
    eq("Tim → no proposed person (Tim ≠ John, _names length-floor rejects it)", rTim.proposedPersonId, null);
    eq("Tim → Level B add-new (unchanged behavior)", rTim.level, "B");
    ok("Tim → not flagged as a fallback match", !rTim.fallback, JSON.stringify(rTim));

    // ---------- bias-to-split: several same-first-name people → ambiguous candidate list ----------
    console.log("\n# bias-to-split: two Jons/Johns → ambiguous 'which one?' (never a default pick)");
    const jonnyB = await mkPerson("Jonny Baker", { location: "Austin, TX" });
    const rMulti = await resolvePerson(supa, userId, "Jon", { fallbackFirstName: true });
    eq("multiple first-name matches → Level B", rMulti.level, "B");
    eq("INVARIANT: multiple matches → NO defaulted proposed person (bias-to-split)", rMulti.proposedPersonId, null);
    ok("multiple matches → carries the candidate list to pick from", (rMulti.candidates || []).length >= 2, JSON.stringify(rMulti.candidates));
    const candIds = new Set((rMulti.candidates || []).map((c) => c.id));
    ok("…candidates include both John Miller and Jonny Baker", candIds.has(johnMiller) && candIds.has(jonnyB));

    // clean up the second person so the canonical-on-match test below has a single clear target
    await supa.from("people").update({ deleted_at: new Date().toISOString() }).eq("user_id", userId).eq("id", jonnyB);

    // ---------- canonical-spelling-on-match: confirming a variant keeps the STORED spelling ----------
    console.log("\n# canonical-on-match: confirming 'Jon' onto 'John Miller' keeps the stored name, no dup");
    const before = await peopleCount(userId);
    const nameBefore = await personName(userId, johnMiller);
    // Simulate the confirm-WHO -> capture-resolve write: facts land on the EXISTING person id, and
    // the write path (writeFactsToPerson) must NEVER rename the person nor create a new one.
    const { writtenIds } = await writeFactsToPerson(
      supa, userId, johnMiller,
      [{ subject: "self", relation: "note", object: "just got a promotion", fact_class: "MILESTONE", confidence: 0.95 }],
      "voice", "Jon just got a promotion"
    );
    const after = await peopleCount(userId);
    const nameAfter = await personName(userId, johnMiller);
    eq("no duplicate person created on match", after, before);
    eq("stored canonical spelling is preserved (still 'John Miller', not renamed to 'Jon')", nameAfter, nameBefore);
    eq("…and it's still exactly 'John Miller'", nameAfter, "John Miller");
    ok("the fact landed on the existing saved person", writtenIds.length === 1);
    const facts = await activeFacts(userId, johnMiller);
    ok("…the promotion fact is on John Miller", facts.some((f) => /promotion/.test(f.object)));

    // ---------- second variant ('Candice' → saved 'Candace Reed') keeps canonical too ----------
    console.log("\n# canonical-on-match: 'Candice' → saved 'Candace Reed' keeps stored 'Candace Reed'");
    const candace = await mkPerson("Candace Reed");
    const rCand = await resolvePerson(supa, userId, "Candice", { fallbackFirstName: true });
    // Candice/Candace: firstNamesEquivalent true (edit-distance 1, len 7). Depending on trigram it may
    // surface via the RPC (candidate) OR the fallback — either way it must resolve to Candace Reed and,
    // on confirm, keep the stored spelling. (This test asserts the resolve + write, not which path.)
    ok("Candice resolves to the saved Candace Reed (RPC or fallback)", rCand.proposedPersonId === candace || (rCand.candidates || []).some((c) => c.id === candace), JSON.stringify(rCand));
    const cBefore = await peopleCount(userId);
    await writeFactsToPerson(supa, userId, candace, [{ subject: "self", relation: "note", object: "loves pottery", fact_class: "DURABLE", confidence: 0.9 }], "voice", "Candice loves pottery");
    const cAfter = await peopleCount(userId);
    eq("no duplicate person for the Candice/Candace variant", cAfter, cBefore);
    eq("stored spelling stays 'Candace Reed' (never renamed to 'Candice')", await personName(userId, candace), "Candace Reed");

  } finally {
    const { error: dErr } = await supa.auth.admin.deleteUser(userId);
    console.log(`\n# cleanup: deleted user ${userId}${dErr ? ` (WARN: ${dErr.message})` : " ✓ (cascade wiped seeded rows)"}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("FAILED:", fails.join(" · ")); process.exit(1); }
}

main().catch((e) => { console.error("integration run crashed:", e); process.exit(1); });
