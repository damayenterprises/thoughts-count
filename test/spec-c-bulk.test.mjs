// Spec C (TC-45) — bulk import path parity + speed, live against the TC Supabase DB.
//
// The bulk path (prefetch → resolve in memory → bulk write) MUST produce byte-for-byte the
// same outcomes as the per-row path (upsertPerson loop) it replaces. This test proves it by
// running the SAME fixture — the whole TC-38 + Spec A matrix, plus intra-file duplicates and
// a bad row — through BOTH paths under two throwaway users, then diffing the resulting DB
// state (people, identifiers, review candidates, key dates). It also checks idempotent
// re-upload and single-digit-second timing on 200 distinct contacts.
//
// Run:  node --env-file=.env test/spec-c-bulk.test.mjs
//   (from a worktree without a local .env:  node --env-file=../thoughtfulness/.env test/spec-c-bulk.test.mjs)
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Deletes both users in finally{} (cascade
// wipes every seeded row), so the DB is left pristine.

import crypto from "node:crypto";
import { serviceClient } from "../netlify/functions/_supabase.mjs";
import { runImport, upsertPerson } from "../netlify/functions/_import.mjs";

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name} ${extra}`); }
}
function eq(name, got, exp) { ok(name, JSON.stringify(got) === JSON.stringify(exp), `(got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)})`); }

const supa = serviceClient();

async function mkUser(tag) {
  const email = `spec-c-${tag}+${Date.now()}-${crypto.randomBytes(3).toString("hex")}@example.com`;
  const { data, error } = await supa.auth.admin.createUser({ email, password: crypto.randomUUID(), email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

// Seed the personal circle (name-only) + one personal person carrying an identifier, exactly
// the same for both users. Cross-kind + placement cases key off these.
async function seed(userId) {
  const seedPersonal = async (name, email = null) => {
    const { data, error } = await supa.from("people")
      .insert({ user_id: userId, name, contact_kind: "personal", primary_email: email }).select("id").single();
    if (error) throw error;
    if (email) {
      const { error: iErr } = await supa.from("identifiers")
        .insert({ user_id: userId, person_id: data.id, type: "email", value: email });
      if (iErr) throw iErr;
    }
    return data.id;
  };
  await seedPersonal("Jordan Rivera");                       // cross-kind fuzzy target
  await seedPersonal("Jane Smith");                          // x-kind false-positive guard
  await seedPersonal("Pat Morgan", "pat.morgan@home.com");   // placement-via-identifier target
}

// The fixture — one ordered file exercising the whole matrix (comments show the expected route).
const FIXTURE = [
  { name: "Alice Adams", email: "alice.adams@ex.com" },                 // insert
  { name: "Alice Adams", email: "alice.adams@ex.com" },                 // intra-file dup → updated
  { name: "Zoe Zeta", email: "zoe.zeta@ex.com" },                       // insert
  { name: "Michael Brown" },                                            // insert (id-poor)
  { name: "Mike Brown" },                                               // intra-batch within-kind fuzzy → review
  { name: "David May" },                                                // insert
  { name: "David Kay" },                                                // surname gate → insert
  { name: "Sam Rivera", email: "sam.rivera.1@ex.com" },                 // insert
  { name: "Sam Rivera", email: "sam.rivera.2@ex.com" },                 // exact-name near-dup (both id'd) → review
  { name: "Sara Johnson", email: "sara.j@ex.com" },                     // insert
  { name: "Sarah Johnson", email: "sarah.j@ex.com" },                   // spelling near-dup → review
  { name: "Jordan Rivera", email: "jordan.rivera@work.com" },           // cross-kind fuzzy → review
  { name: "Bob Smith", email: "bob.smith@work.com" },                   // x-kind guard (shares surname, diff first) → insert
  { name: "Pat Morgan", email: "pat.morgan@home.com" },                 // identifier hit on personal → placement (review)
  { name: "Weird Name", email: "weird,name@x.com" },                    // comma-email insert
  { name: "Weird Name", email: "Weird,Name@x.com" },                    // comma-email intra-file dup → updated
  null,                                                                 // bad row → skipped, never blocks
  { name: "Grace Kim", email: "grace.kim@ex.com", key_dates: [{ kind: "birthday", date: "6/5/1990" }] }, // insert + key date
];

const EXPECTED_COUNTS = { added: 10, updated: 2, needs_review: 5, skipped: 1 };

// Reference implementation of the OLD per-row runImport, kept here so we can diff against it.
async function rowPathImport(userId, rows) {
  const { data: batch } = await supa.from("import_batches").insert({ user_id: userId, filename: "ref" }).select("id").single();
  const batchId = batch.id;
  let added = 0, updated = 0, needs_review = 0, skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      const r = await upsertPerson({ supa, userId, row: rows[i], source: "csv", batchId });
      if (r.placement) needs_review++;
      else if (r.action === "inserted") added++;
      else if (r.action === "updated" || r.action === "unchanged") updated++;
      else if (r.action === "review") needs_review++;
    } catch (err) { skipped++; console.log(`    [row-path] row ${i} threw: ${err?.message || err}`); }
  }
  return { batch_id: batchId, added, updated, needs_review, skipped };
}

// Snapshot the user's DB state in an id-independent, path-independent shape.
async function snapshot(userId) {
  const { data: ppl } = await supa.from("people")
    .select("id, name, contact_kind, kind_locked, relationship, notes, location, primary_email, primary_phone").eq("user_id", userId);
  const nameById = Object.fromEntries((ppl || []).map((p) => [p.id, p.name]));

  const people = (ppl || [])
    .map((p) => `${p.name}|${p.contact_kind}|${p.kind_locked}|${p.primary_email || ""}|${p.primary_phone || ""}|${p.relationship || ""}|${p.notes || ""}|${p.location || ""}`)
    .sort();

  const { data: ids } = await supa.from("identifiers").select("type, value").eq("user_id", userId);
  const identifiers = (ids || []).map((r) => `${r.type}|${r.value}`).sort();

  const { data: rcs } = await supa.from("review_candidates").select("existing_person_id, incoming").eq("user_id", userId);
  const candidates = (rcs || [])
    .map((r) => { const inc = r.incoming || {}; return `${nameById[r.existing_person_id] || "?"}|${inc.name || ""}|x=${!!inc._crosskind}|p=${!!inc._placement}`; })
    .sort();

  const { data: kds } = await supa.from("key_dates").select("person_id, kind, event_date, date_precision, recurs").eq("user_id", userId);
  const keyDates = (kds || [])
    .map((r) => `${nameById[r.person_id] || "?"}|${r.kind}|${r.event_date}|${r.date_precision}|${r.recurs}`)
    .sort();

  return { people, identifiers, candidates, keyDates };
}

async function main() {
  const bulkUser = await mkUser("bulk");
  const rowUser = await mkUser("row");
  console.log(`# bulk user ${bulkUser}\n# row  user ${rowUser}\n`);

  try {
    await seed(bulkUser);
    await seed(rowUser);

    // ---- run the SAME fixture through both paths ----
    console.log("# counts parity (bulk vs row vs expected)");
    const bulkSummary = await runImport({ supa, userId: bulkUser, filename: "fixture", rows: FIXTURE, source: "csv" });
    const rowSummary = await rowPathImport(rowUser, FIXTURE);
    const strip = ({ added, updated, needs_review, skipped }) => ({ added, updated, needs_review, skipped });
    eq("bulk counts match expected", strip(bulkSummary), EXPECTED_COUNTS);
    eq("row-path counts match expected", strip(rowSummary), EXPECTED_COUNTS);
    eq("bulk counts == row-path counts", strip(bulkSummary), strip(rowSummary));

    // ---- diff the resulting DB state ----
    console.log("\n# state parity (row-path vs bulk-path DB diff)");
    const snapBulk = await snapshot(bulkUser);
    const snapRow = await snapshot(rowUser);
    eq("people rows identical", snapBulk.people, snapRow.people);
    eq("identifiers identical", snapBulk.identifiers, snapRow.identifiers);
    eq("review candidates identical (dup + cross-kind + placement)", snapBulk.candidates, snapRow.candidates);
    eq("key dates identical", snapBulk.keyDates, snapRow.keyDates);

    // ---- spot-check the matrix landed the way we expect (on the bulk user) ----
    console.log("\n# matrix spot-checks (bulk user)");
    ok("13 people total (3 seeded + 10 inserted)", snapBulk.people.length === 13, `(got ${snapBulk.people.length})`);
    ok("5 review candidates raised", snapBulk.candidates.length === 5, `(got ${snapBulk.candidates.length})`);
    ok("cross-kind review on Jordan Rivera", snapBulk.candidates.some((c) => c.startsWith("Jordan Rivera|Jordan Rivera|x=true")));
    ok("placement review on Pat Morgan", snapBulk.candidates.some((c) => c.includes("|p=true") && c.startsWith("Pat Morgan|")));
    ok("within-kind dup review for Mike/Michael Brown", snapBulk.candidates.some((c) => c.startsWith("Michael Brown|Mike Brown|x=false|p=false")));
    ok("comma-email identifier stored", snapBulk.identifiers.includes("email|weird,name@x.com"));

    // ---- idempotent re-upload (bulk path) ----
    console.log("\n# idempotent re-upload (bulk path)");
    const before = await snapshot(bulkUser);
    const reSummary = await runImport({ supa, userId: bulkUser, filename: "fixture", rows: FIXTURE, source: "csv" });
    eq("re-upload adds 0 people", reSummary.added, 0);
    const after = await snapshot(bulkUser);
    eq("re-upload leaves people unchanged", after.people, before.people);
    eq("re-upload leaves candidates unchanged (no re-ask)", after.candidates, before.candidates);
    eq("re-upload leaves identifiers unchanged", after.identifiers, before.identifiers);

    // ---- speed: 200 distinct contacts in single-digit seconds ----
    console.log("\n# speed (200 distinct contacts, bulk path)");
    const speedUser = await mkUser("speed");
    try {
      const first = ["Emma","Liam","Olivia","Noah","Ava","Ethan","Sophia","Mason","Isabella","Lucas","Mia","Logan","Amelia","Jackson","Harper","Aiden","Evelyn","Elijah","Abigail","Caleb"];
      const surn = ["Nguyen","Patel","Okafor","Rossi","Kim","Silva","Haddad","Cohen","Larsen","Mwangi"];
      const rows = [];
      let k = 0;
      for (const s of surn) for (const f of first) { rows.push({ name: `${f} ${s}`, email: `${f}.${s}.${k}@bulk.com`.toLowerCase() }); k++; }
      const t0 = Date.now();
      const s = await runImport({ supa, userId: speedUser, filename: "bulk200", rows, source: "csv" });
      const ms = Date.now() - t0;
      eq("bulk: all 200 distinct contacts inserted", s.added, 200);
      ok("bulk: distinct import does not flood reviews (<5)", s.needs_review < 5, `(raised ${s.needs_review})`);
      ok("bulk: 200 rows in single-digit seconds (<10s)", ms < 10000, `(took ${ms}ms)`);
      console.log(`  … 200 rows in ${ms}ms (~${(ms / 200).toFixed(1)}ms/row), ${s.needs_review} reviews`);
    } finally {
      await supa.auth.admin.deleteUser(speedUser);
    }
  } finally {
    for (const u of [bulkUser, rowUser]) {
      const { error } = await supa.auth.admin.deleteUser(u);
      console.log(`# cleanup: deleted ${u}${error ? ` (WARN ${error.message})` : " ✓"}`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("FAILED:", fails.join(" · ")); process.exit(1); }
}

main().catch((e) => { console.error("spec-c run crashed:", e); process.exit(1); });
