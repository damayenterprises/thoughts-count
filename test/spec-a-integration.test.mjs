// Spec A (TC-47 + TC-46 Fix 2 + TC-44) — live integration verification.
//
// Exercises the REAL dedup core (upsertPerson + resolveCandidate) against the live TC
// Supabase DB, which also proves migration 003's broadened RPC. Runs everything under a
// throwaway auth user and deletes it in a finally{} (cascade wipes all seeded rows), so
// the DB is left pristine — the same pattern used to verify companion v1.
//
// Run:  node --env-file=.env test/spec-a-integration.test.mjs
//   (from a worktree without a local .env:  node --env-file=../thoughtfulness/.env ...)
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ ANON not required).

import crypto from "node:crypto";
import { serviceClient } from "../netlify/functions/_supabase.mjs";
import { upsertPerson, resolveCandidate } from "../netlify/functions/_import.mjs";

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name} ${extra}`); }
}
function eq(name, got, exp) { ok(name, got === exp, `(got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)})`); }

const supa = serviceClient();

// ---- helpers scoped to a userId ----
const mk = (userId) => {
  const imp = (row, contactKind = "contact") =>
    upsertPerson({ supa, userId, row, source: "csv", batchId: null, contactKind });
  const seedPersonal = async (name) => {
    const { data, error } = await supa.from("people")
      .insert({ user_id: userId, name, contact_kind: "personal" }).select("id").single();
    if (error) throw error;
    return data.id;
  };
  const peopleCount = async () => {
    const { count } = await supa.from("people").select("id", { count: "exact", head: true }).eq("user_id", userId);
    return count;
  };
  const reviews = async () => {
    const { data } = await supa.from("review_candidates")
      .select("id, existing_person_id, incoming").eq("user_id", userId);
    const all = data || [];
    return {
      dup: all.filter((r) => !r.incoming?._placement && !r.incoming?._crosskind),
      cross: all.filter((r) => r.incoming?._crosskind),
      placement: all.filter((r) => r.incoming?._placement),
    };
  };
  const identifiersFor = async (personId) => {
    const { data } = await supa.from("identifiers").select("value").eq("user_id", userId).eq("person_id", personId);
    return (data || []).map((r) => r.value).sort();
  };
  const kindOf = async (personId) => {
    const { data } = await supa.from("people").select("contact_kind, kind_locked").eq("id", personId).single();
    return data;
  };
  return { imp, seedPersonal, peopleCount, reviews, identifiersFor, kindOf };
};

async function main() {
  const email = `spec-a-test+${Date.now()}-${crypto.randomBytes(3).toString("hex")}@example.com`;
  const { data: created, error: cErr } = await supa.auth.admin.createUser({
    email, password: crypto.randomUUID(), email_confirm: true,
  });
  if (cErr) throw cErr;
  const userId = created.user.id;
  console.log(`# throwaway user ${userId}\n`);
  const h = mk(userId);

  try {
    // ---------- TC-38 regressions ----------
    console.log("# TC-38 regressions");
    // A) Idempotent re-upload
    const a1 = await h.imp({ name: "Alice Adams", email: "alice.adams@ex.com" });
    eq("idempotent: first import inserts", a1.action, "inserted");
    const before = await h.peopleCount();
    const a2 = await h.imp({ name: "Alice Adams", email: "alice.adams@ex.com" });
    ok("idempotent: re-upload is no-op (updated/unchanged)", a2.action === "updated" || a2.action === "unchanged", `(got ${a2.action})`);
    eq("idempotent: re-upload adds no person", await h.peopleCount(), before);
    eq("idempotent: re-upload adds no review", (await h.reviews()).dup.length, 0);

    // B) Identifier-first: distinct name + distinct email → new person, no review
    const b1 = await h.imp({ name: "Zoe Zeta", email: "zoe.zeta@ex.com" });
    eq("identifier-first: distinct person inserts", b1.action, "inserted");
    eq("identifier-first: no review for distinct person", (await h.reviews()).dup.length, 0);

    // C) Within-kind fuzzy propose-only + surname gate
    await h.imp({ name: "Michael Brown" });                 // id-poor
    const cRev = await h.imp({ name: "Mike Brown" });        // id-poor, nickname, same surname
    eq("within-kind near-dup PROPOSES (not merge/insert)", cRev.action, "review");
    // surname gate: different surname never prompts
    await h.imp({ name: "David May" });
    const cGate = await h.imp({ name: "David Kay" });
    eq("surname gate: different surname inserts (no review)", cGate.action, "inserted");

    // ---------- TC-47 cross-kind convergence ----------
    console.log("\n# TC-47 cross-kind (personal + book import of same person)");
    const jordan = await h.seedPersonal("Jordan Rivera");    // in the intimate circle, name-only
    const j1 = await h.imp({ name: "Jordan Rivera", email: "jordan.rivera@work.com" });
    eq("TC-47: book import onto a personal person PROPOSES (no silent dup)", j1.action, "review");
    eq("TC-47: matched the personal person", j1.personId, jordan);
    const jReviews = await h.reviews();
    const jRev = jReviews.cross.find((r) => r.existing_person_id === jordan);
    ok("TC-47: raised as a CROSS-KIND three-way review (not a plain dup)", !!jRev);
    eq("TC-47: no separate placement prompt raised at import", jReviews.placement.filter((r) => r.existing_person_id === jordan).length, 0);
    // ONE step: "keep personal" → merge + stays personal + locked, review cleared
    const jResolve = await resolveCandidate({ supa, userId, candidateId: jRev.id, action: "keep_personal" });
    eq("TC-47: keep_personal resolves to the same person", jResolve.personId, jordan);
    const jAfter = await h.reviews();
    eq("TC-47: review cleared in one step (no dup left)", jAfter.cross.filter((r) => r.existing_person_id === jordan).length, 0);
    eq("TC-47: no placement prompt spawned (one-step)", jAfter.placement.filter((r) => r.existing_person_id === jordan).length, 0);
    const jk = await h.kindOf(jordan);
    eq("TC-47: keep_personal keeps them personal", jk.contact_kind, "personal");
    eq("TC-47: keep_personal locks the kind", jk.kind_locked, true);
    // re-import same → deterministic (email now merged onto the person), asks nothing
    const jRe = await h.imp({ name: "Jordan Rivera", email: "jordan.rivera@work.com" });
    eq("TC-47: re-import converges silently (updated)", jRe.action, "updated");
    eq("TC-47: re-import raises no placement (kind_locked)", jRe.placement, false);

    // move_to_roster variant → same person, reclassified to roster + locked
    const drew = await h.seedPersonal("Drew Patel");
    const d1 = await h.imp({ name: "Drew Patel", email: "drew.patel@work.com" });
    const dRev = (await h.reviews()).cross.find((r) => r.existing_person_id === drew);
    ok("TC-47 move: cross-kind three-way raised", !!dRev);
    await resolveCandidate({ supa, userId, candidateId: dRev.id, action: "move_to_roster" });
    const dk = await h.kindOf(drew);
    eq("TC-47 move: reclassified to roster (contact)", dk.contact_kind, "contact");
    eq("TC-47 move: kind locked", dk.kind_locked, true);
    eq("TC-47 move: one person only (merged, not duplicated)", (await h.reviews()).cross.filter((r) => r.existing_person_id === drew).length, 0);

    // keep-both variant → two people, no re-ask
    const casey = await h.seedPersonal("Casey Lin");
    const kb = await h.imp({ name: "Casey Lin", email: "casey.lin@work.com" });
    eq("TC-47 keep-both: proposes (cross-kind)", kb.action, "review");
    const kbRev = (await h.reviews()).cross.find((r) => r.existing_person_id === casey);
    ok("TC-47 keep-both: raised as cross-kind", !!kbRev);
    const before2 = await h.peopleCount();
    await resolveCandidate({ supa, userId, candidateId: kbRev.id, action: "keep_both" });
    eq("TC-47 keep-both: yields a second person", await h.peopleCount(), before2 + 1);
    const kbRe = await h.imp({ name: "Casey Lin", email: "casey.lin@work.com" });
    ok("TC-47 keep-both: re-import asks nothing", kbRe.action === "updated" || kbRe.action === "unchanged", `(got ${kbRe.action})`);

    // cross-kind FALSE-POSITIVE guard (Validator R2): a book contact that merely SHARES A
    // SURNAME with a personal person (different first name) must NOT raise a cross-kind
    // prompt. Personal people are always id-poor, and the surname branch is now live, so this
    // is the exact case that regressed. Only name-equivalence (branch a) may go cross-kind.
    await h.seedPersonal("Jane Smith");
    await h.seedPersonal("Tom Patel");
    await h.seedPersonal("Mary Jones");
    for (const [nm, em] of [["Bob Smith", "bob.smith@work.com"], ["Alan Patel", "alan.patel@work.com"], ["Rex Jones", "rex.jones@work.com"]]) {
      const r = await h.imp({ name: nm, email: em });
      eq(`x-kind guard: "${nm}" (shares surname w/ personal, diff first name) inserts, no prompt`, r.action, "inserted");
    }
    // …but a genuine id-poor cross-kind near-dup (same first name) STILL routes via branch (a)
    const jane = await h.seedPersonal("Jane Doe");
    const jd = await h.imp({ name: "Jane Ann Doe" });   // name-only, same first name + surname
    eq("x-kind guard: real id-poor cross-kind near-dup still proposes", jd.action, "review");
    ok("x-kind guard: …and it's a cross-kind three-way", !!(await h.reviews()).cross.find((r) => r.existing_person_id === jane));

    // ---------- TC-46 Fix 2: same-name / DIFFERENT emails both sides ----------
    console.log("\n# TC-46 Fix 2 (different emails on both sides → one gentle review)");
    const fix2 = [
      { seed: { name: "Sam Rivera", email: "sam.rivera.1@ex.com" }, in: { name: "Sam Rivera", email: "sam.rivera.2@ex.com" }, label: "exact" },
      { seed: { name: "Sara Johnson", email: "sara.johnson@ex.com" }, in: { name: "Sarah Johnson", email: "sarah.johnson@ex.com" }, label: "spelling Sara/Sarah" },
      { seed: { name: "Sam Diaz", email: "sam.diaz@ex.com" }, in: { name: "Samuel Diaz", email: "samuel.diaz@ex.com" }, label: "nickname Sam/Samuel" },
      { seed: { name: "Bill Hayes", email: "bill.hayes@ex.com" }, in: { name: "William Hayes", email: "william.hayes@ex.com" }, label: "nickname Bill/William" },
    ];
    for (const c of fix2) {
      const s = await h.imp(c.seed);
      const r = await h.imp(c.in);
      eq(`Fix2 [${c.label}] raises a review`, r.action, "review");
      // merge → one person carrying BOTH emails
      const rev = (await h.reviews()).dup.find((x) => x.existing_person_id === s.personId);
      await resolveCandidate({ supa, userId, candidateId: rev.id, action: "merge" });
      const ids = await h.identifiersFor(s.personId);
      eq(`Fix2 [${c.label}] merged person carries both emails`, ids.length, 2);
    }
    // surname-branch regression guard (Validator R1 fix b): "Bill Ng"/"William Ng" has a
    // full-name trigram of ~0.27 (< the 0.4 RPC floor), so it can ONLY be surfaced by the
    // migration's same-surname UNION branch. If that branch is dead (the old '\s+' bug), no
    // candidate comes back and this silently inserts a duplicate instead of asking.
    await h.imp({ name: "Bill Ng", email: "bill.ng@ex.com" });
    const ng = await h.imp({ name: "William Ng", email: "william.ng@ex.com" });
    eq("surname-branch: low-trigram nickname pair still raises a review", ng.action, "review");

    // negative: same surname, unrelated first names, both have emails → NO review
    await h.imp({ name: "Bob Kent", email: "bob.kent@ex.com" });
    const neg = await h.imp({ name: "Bill Kent", email: "bill.kent@ex.com" });
    eq("Fix2 negative: Bill/Bob same surname (both id'd) → no review", neg.action, "inserted");

    // ---------- Prompt-volume sanity on a realistic ~200-row import ----------
    console.log("\n# Prompt-volume sanity (~200 distinct contacts)");
    const first = ["Emma","Liam","Olivia","Noah","Ava","Ethan","Sophia","Mason","Isabella","Lucas","Mia","Logan","Amelia","Jackson","Harper","Aiden","Evelyn","Elijah","Abigail","Caleb"];
    const surn = ["Nguyen","Patel","Okafor","Rossi","Kim","Silva","Haddad","Cohen","Larsen","Mwangi"];
    const rowsBefore = await h.peopleCount();
    const revBefore = (await h.reviews()).dup.length;
    const t0 = Date.now();
    let n = 0;
    for (const s of surn) for (const f of first) {   // 10 x 20 = 200, all distinct name+email
      await h.imp({ name: `${f} ${s}`, email: `${f}.${s}.${n}@bulk.com`.toLowerCase() });
      n++;
    }
    const ms = Date.now() - t0;
    const added = (await h.peopleCount()) - rowsBefore;
    const newReviews = (await h.reviews()).dup.length - revBefore;
    eq("bulk: all 200 distinct contacts inserted", added, 200);
    ok("bulk: distinct import does not flood with reviews (<5)", newReviews < 5, `(raised ${newReviews})`);
    console.log(`  … 200 rows in ${ms}ms (~${(ms / 200).toFixed(1)}ms/row), ${newReviews} reviews`);
  } finally {
    const { error: dErr } = await supa.auth.admin.deleteUser(userId);
    console.log(`\n# cleanup: deleted user ${userId}${dErr ? ` (WARN: ${dErr.message})` : " ✓ (cascade wiped seeded rows)"}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("FAILED:", fails.join(" · ")); process.exit(1); }
}

main().catch((e) => { console.error("integration run crashed:", e); process.exit(1); });
