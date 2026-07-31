// TC-50 (Phase 2) — capture engine: extraction + entity resolution, live integration.
//
// Exercises the REAL _capture.mjs (resolve + writeFactsToPerson) against the live TC Supabase
// under a throwaway auth user, deleted in finally{} (cascade wipes seeded rows) — same pattern
// as spec-tc49-memory.test.mjs. The extraction (Claude) assertions run only when
// ANTHROPIC_API_KEY is present; everything else is deterministic + DB-backed.
//
// Run:  node --env-file=.env test/spec-tc50-capture.test.mjs
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ ANTHROPIC_API_KEY for the extract block).

import crypto from "node:crypto";
import { serviceClient } from "../netlify/functions/_supabase.mjs";
import { extract, resolve, resolvePerson, writeFactsToPerson } from "../netlify/functions/_capture.mjs";
import { getEnv } from "../netlify/functions/_email.mjs";

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name} ${extra}`); }
}
function eq(name, got, exp) { ok(name, got === exp, `(got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)})`); }

const supa = serviceClient();
const norm = (s) => String(s || "").trim().toLowerCase();

async function activeFacts(userId, personId) {
  const { data } = await supa.from("facts").select("id,subject,relation,object")
    .eq("user_id", userId).eq("person_id", personId).is("valid_to", null).is("deleted_at", null);
  return data || [];
}
async function peopleNamed(userId, name) {
  const { data } = await supa.from("people").select("id").eq("user_id", userId).eq("name", name).is("deleted_at", null);
  return data || [];
}

async function main() {
  const email = `spec-tc50+${Date.now()}-${crypto.randomBytes(3).toString("hex")}@example.com`;
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
    // ---------- resolution: single clear match → Level A (spec §12) ----------
    console.log("# resolution: single match → Level A");
    const mariaE = await mkPerson("Maria Edmond", { location: "Denver, CO" });
    const r1 = await resolvePerson(supa, userId, "Maria", {});
    eq("single first-name match → Level A", r1.level, "A");
    eq("single match → the right person", r1.proposedPersonId, mariaE);
    ok("Level A evidence is plain language (no engine terms)", /only maria/i.test(r1.evidence) && !/confidence|salience|fact_class/i.test(r1.evidence), r1.evidence);

    // ---------- resolution: ambiguous → Level B (To-Review), never guessed ----------
    console.log("\n# resolution: ambiguous → Level B");
    const mariaG = await mkPerson("Maria Gonzalez", { location: "Austin, TX" });
    const r2 = await resolvePerson(supa, userId, "Maria", {});
    eq("two Marias → Level B (ambiguous, not guessed)", r2.level, "B");
    ok("Level B evidence explains why we didn't guess", /didn't want to guess|people this could be/i.test(r2.evidence), r2.evidence);

    // ---------- resolution: a location hint disambiguates → Level A ----------
    console.log("\n# resolution: location hint disambiguates");
    const r3 = await resolvePerson(supa, userId, "Maria", { locationHint: "Denver" });
    eq("location hint picks exactly one → Level A", r3.level, "A");
    eq("…and it's the Denver Maria", r3.proposedPersonId, mariaE);

    // ---------- resolution: no match → Level B new person, writes nothing ----------
    console.log("\n# resolution: unknown name → Level B new-person");
    const r4 = await resolvePerson(supa, userId, "Nobody McGhost", {});
    eq("unknown name → Level B", r4.level, "B");
    eq("unknown name → no proposed person (offer to add)", r4.proposedPersonId, null);

    // ---------- resolution: strong key (email) wins outright → Level A ----------
    console.log("\n# resolution: strong key → Level A");
    const jce = await mkPerson("JC Cowart");
    await supa.from("identifiers").insert({ user_id: userId, person_id: jce, type: "email", value: "jc@example.com" });
    const r5 = await resolvePerson(supa, userId, "Whoever", { identifiers: [{ type: "email", value: "jc@example.com" }] });
    eq("strong-key match → Level A", r5.level, "A");
    eq("strong-key → the identified person", r5.proposedPersonId, jce);

    // ---------- write: subject-relative fact stays on the person, spawns NO one (clarification #1) ----------
    console.log("\n# write: 'her mom' is a subject on Maria, never a new person");
    const beforeMomPeople = (await peopleNamed(userId, "mom")).length + (await peopleNamed(userId, "her mom")).length;
    const facts = [
      { person_hint: "Maria", subject: "self", relation: "home", object: "closed on the lake house", fact_class: "MILESTONE", event_date: null, confidence: 0.95 },
      { person_hint: "Maria", subject: "mom", relation: "living_situation", object: "moving in", fact_class: "EPISODIC", is_health: false, event_date: null, confidence: 0.9 },
    ];
    const ids = await writeFactsToPerson(supa, userId, mariaE, facts, "typed", "Maria just closed on the lake house; her mom is moving in");
    eq("both facts written to Maria", ids.length, 2);
    const mf = await activeFacts(userId, mariaE);
    ok("the 'self' fact is on Maria", mf.some((f) => f.subject === "self" && /lake house/.test(f.object)));
    ok("the 'mom' fact is on Maria with subject 'mom'", mf.some((f) => f.subject === "mom" && /moving in/.test(f.object)));
    const afterMomPeople = (await peopleNamed(userId, "mom")).length + (await peopleNamed(userId, "her mom")).length;
    eq("no person named 'mom' was ever created", afterMomPeople, beforeMomPeople);

    // ---------- resolve(): groups facts by NAMED person, one resolution per person ----------
    console.log("\n# resolve(): one group per named person (relatives don't split off)");
    const parsed = {
      facts: [
        { person_hint: "Maria", subject: "self", relation: "note", object: "loves hiking", fact_class: "DURABLE", confidence: 0.9 },
        { person_hint: "Maria", subject: "mom", relation: "living_situation", object: "moving in", fact_class: "EPISODIC", confidence: 0.9 },
      ],
      location_hint: "Denver",
      co_mentioned: false,
    };
    const { groups } = await resolve(userId, parsed, supa);
    eq("one named person → exactly one group", groups.length, 1);
    eq("the group carries BOTH facts (self + mom)", groups[0].facts.length, 2);
    eq("the group resolves to a person (location hint → Level A)", groups[0].resolution.level, "A");
    eq("…the Denver Maria", groups[0].resolution.proposedPersonId, mariaE);

    // ---------- extraction (live Claude; only if a key is present) — the AC sentence ----------
    if (getEnv("ANTHROPIC_API_KEY")) {
      console.log("\n# extraction (live): the acceptance-criteria sentence");
      const ex = await extract("Maria just closed on the lake house; her mom is moving in", {});
      ok("extract: yields at least two facts", (ex.facts || []).length >= 2, `(got ${ex.facts?.length})`);
      const hints = new Set((ex.facts || []).map((f) => norm(f.person_hint)));
      ok("extract: every fact's person is Maria (relatives are subjects, not people)", [...hints].every((h) => h === "maria"), `(hints ${[...hints].join("|")})`);
      const subjects = (ex.facts || []).map((f) => norm(f.subject));
      ok("extract: one fact is about Maria herself (self)", subjects.some((s) => s === "self" || s === "" || s === "them"));
      ok("extract: one fact is about her mom (subject 'mom')", subjects.some((s) => s.includes("mom")), `(subjects ${subjects.join("|")})`);
      ok("extract: NO fact treats 'mom' as the named person", ![...hints].some((h) => h.includes("mom")));

      console.log("\n# extraction (live) context-locked: person_hint is always empty");
      const exL = await extract("loves hiking; allergic to shellfish", { lockedPersonId: mariaE });
      ok("locked extract: yields facts", (exL.facts || []).length >= 1);
      ok("locked extract: person_hint is empty on every fact", (exL.facts || []).every((f) => !f.person_hint));
    } else {
      console.log("\n# extraction (live): SKIPPED (no ANTHROPIC_API_KEY)");
    }
  } finally {
    const { error: dErr } = await supa.auth.admin.deleteUser(userId);
    console.log(`\n# cleanup: deleted user ${userId}${dErr ? ` (WARN: ${dErr.message})` : " ✓ (cascade wiped seeded rows)"}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("FAILED:", fails.join(" · ")); process.exit(1); }
}

main().catch((e) => { console.error("integration run crashed:", e); process.exit(1); });
