// TC-139 smoke test — exercises runWatchdog against the REAL send_log using isolated
// tc139-test-* job names (never touches real job namespaces) and a captured send (no real
// email). Run: node --env-file=.env test/watchdog-smoke.mjs
import { runWatchdog } from "../netlify/functions/send-watchdog.mjs";
import { serviceClient } from "../netlify/functions/_supabase.mjs";

const sb = serviceClient();
const captured = [];
const fakeSend = async (m) => { captured.push(m); return { ok: true }; };

const PRESENT = "tc139-test-present";
const MISSING = "tc139-test-missing";
const ERRORED = "tc139-test-errored";
const expected = [
  { job: PRESENT, label: "Present job", daily: true },
  { job: MISSING, label: "Missing job", daily: true },
  { job: ERRORED, label: "Errored job", daily: true },
];

async function cleanup() {
  for (const j of [PRESENT, MISSING, ERRORED]) await sb.from("send_log").delete().eq("job", j);
}

function assert(cond, msg) { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else { console.log("PASS:", msg); } }

try {
  await cleanup(); // start clean

  // Seed: PRESENT ran ok today; ERRORED ran with status error today; MISSING has no row.
  await sb.from("send_log").insert([
    { job: PRESENT, status: "ok", audience: 3, delivered: 3, failed: 0 },
    { job: ERRORED, status: "error", audience: 2, delivered: 0, failed: 2 },
  ]);

  const out = await runWatchdog({ supabase: sb, send: fakeSend, expected });
  console.log("watchdog result:", JSON.stringify(out.detail.map((p) => ({ job: p.job, issue: p.issue }))));

  assert(out.checked === 3, "checked all 3 due jobs");
  const byJob = Object.fromEntries(out.detail.map((p) => [p.job, p.issue]));
  assert(!(PRESENT in byJob), "PRESENT (ran ok) is NOT flagged");
  assert(MISSING in byJob && /DID NOT RUN/.test(byJob[MISSING]), "MISSING is flagged as did-not-run");
  assert(ERRORED in byJob && /ERRORED/.test(byJob[ERRORED]), "ERRORED is flagged as errored");
  assert(out.problems === 2, "exactly 2 problems (missing + errored)");
  assert(captured.length === 1 && /2 scheduled sends need attention/.test(captured[0].subject), "one alert email captured with correct subject");
  assert(captured[0].to && captured[0].replyTo === "care@thoughtscount.com", "alert has admin recipient + care@ reply-to");

  // Now seed MISSING too → expect zero problems, no email.
  captured.length = 0;
  await sb.from("send_log").delete().eq("job", ERRORED); // remove the errored one
  await sb.from("send_log").insert({ job: MISSING, status: "ok", audience: 1, delivered: 1, failed: 0 });
  const out2 = await runWatchdog({ supabase: sb, send: fakeSend, expected: expected.filter((e) => e.job !== ERRORED) });
  assert(out2.problems === 0, "all present → zero problems");
  assert(captured.length === 0, "no alert email when everything fired");

  await cleanup();
  console.log("done, test rows cleaned up.");
} catch (e) {
  console.error("smoke test threw:", e);
  await cleanup();
  process.exitCode = 1;
}
