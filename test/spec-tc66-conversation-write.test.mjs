// TC-66 Phase 3b — conversation memory WRITE-BACK: the capture `source` enum accepts the new
// "conversation" tag (and still rejects junk → "typed"), and the write path stays authenticated
// + ownership-checked. Drives the REAL capture-extract HTTP handler with a real signed-in token
// under a throwaway user (deleted in finally{}, cascade-wiping seeded rows) — same live pattern
// as spec-tc50-capture.test.mjs.
//
// The deterministic assertions (foreign lockedPersonId → 404, unauth → 401) run always. The
// source-persistence assertions call extract() (Claude) and so run only when ANTHROPIC_API_KEY
// is present, exactly like the TC-50 extract block.
//
// Run:  node --env-file=.env test/spec-tc66-conversation-write.test.mjs
// Needs SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY (+ ANTHROPIC_API_KEY for
// the source-persistence block).

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "../netlify/functions/_supabase.mjs";
import { getEnv } from "../netlify/functions/_email.mjs";
import captureExtract from "../netlify/functions/capture-extract.mjs";

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name} ${extra}`); }
}
function eq(name, got, exp) { ok(name, got === exp, `(got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)})`); }

const supa = serviceClient();

// Build the same authenticated Request the client's captureExtract() posts (Bearer + JSON body).
const reqFor = (token, body) => new Request("http://local/api/capture/extract", {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const callJson = async (req) => { const res = await captureExtract(req); return { status: res.status, body: await res.json().catch(() => ({})) }; };

async function main() {
  const password = crypto.randomUUID();
  const email = `spec-tc66+${Date.now()}-${crypto.randomBytes(3).toString("hex")}@example.com`;
  const { data: created, error: cErr } = await supa.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) throw cErr;
  const userId = created.user.id;
  console.log(`# throwaway user ${userId}\n`);

  try {
    // A real session token for this user, so requireUser() verifies a genuine JWT (not a stub).
    const anon = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw sErr;
    const token = signIn.session.access_token;

    const mkPerson = async (name) => {
      const { data, error } = await supa.from("people").insert({ user_id: userId, name, contact_kind: "personal" }).select("id").single();
      if (error) throw error;
      return data.id;
    };
    const maya = await mkPerson("Maya");

    // ---------- guardrail: unauthenticated write is rejected (no token → 401) ----------
    console.log("# write path stays authenticated");
    {
      const { status } = await callJson(reqFor(null, { rawText: "she loves hiking", lockedPersonId: maya, source: "conversation" }));
      eq("no token → 401 (converse gains no anon write path)", status, 401);
    }

    // ---------- guardrail: a FOREIGN lockedPersonId is rejected before any write (404) --------
    // Ownership is checked server-side BEFORE extract, so this is deterministic (no key needed):
    // a client cannot write conversation memory to another user's person.
    console.log("\n# ownership: a foreign lockedPersonId is rejected");
    {
      const foreign = crypto.randomUUID(); // a person id this user does not own
      const { status, body } = await callJson(reqFor(token, { rawText: "she loves hiking", lockedPersonId: foreign, source: "conversation" }));
      eq("foreign lockedPersonId → 404 (cannot write to another user's person)", status, 404);
      ok("…404 is plain-language, not a stack leak", /couldn't find that person/i.test(body.error || ""), body.error);
    }

    // ---------- the source enum: "conversation" is accepted; junk falls back to "typed" --------
    // These land a real Level-A locked write, so they exercise extract() (Claude). Assert the
    // persisted captures.source column carries the tag we sent.
    if (getEnv("ANTHROPIC_API_KEY")) {
      console.log("\n# source enum (live): 'conversation' is accepted and tagged distinctly");
      const before = new Date().toISOString();
      const r1 = await callJson(reqFor(token, { rawText: "Maya just started a new job as a nurse", lockedPersonId: maya, source: "conversation" }));
      eq("conversation-sourced locked capture → 200", r1.status, 200);
      ok("…it wrote a Level-A fact to Maya", ((r1.body.captures || []).some((c) => c.level === "A")), JSON.stringify(r1.body));
      const { data: convRows } = await supa.from("captures").select("source").eq("user_id", userId).eq("source", "conversation").gte("created_at", before);
      ok("captures.source persisted as 'conversation' (new enum value honored)", (convRows || []).length >= 1, JSON.stringify(convRows));

      console.log("\n# source enum (live): junk source falls back to 'typed' (unchanged guard)");
      const before2 = new Date().toISOString();
      const r2 = await callJson(reqFor(token, { rawText: "Maya loves trail running", lockedPersonId: maya, source: "totally-bogus" }));
      eq("junk-sourced locked capture → 200", r2.status, 200);
      const { data: junkConv } = await supa.from("captures").select("id").eq("user_id", userId).eq("source", "totally-bogus").gte("created_at", before2);
      eq("junk source is NOT persisted verbatim (rejected)", (junkConv || []).length, 0);
      const { data: typedRows } = await supa.from("captures").select("id").eq("user_id", userId).eq("source", "typed").gte("created_at", before2);
      ok("…it fell back to 'typed'", (typedRows || []).length >= 1, JSON.stringify(typedRows));
    } else {
      console.log("\n# source enum (live): SKIPPED (no ANTHROPIC_API_KEY)");
    }
  } finally {
    const { error: dErr } = await supa.auth.admin.deleteUser(userId);
    console.log(`\n# cleanup: deleted user ${userId}${dErr ? ` (WARN: ${dErr.message})` : " ✓ (cascade wiped seeded rows)"}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("FAILED:", fails.join(" · ")); process.exit(1); }
}

main().catch((e) => { console.error("integration run crashed:", e); process.exit(1); });
