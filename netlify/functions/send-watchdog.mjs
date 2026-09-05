// TC-139 — Send accountability watchdog (ported from MAP-432).
//
// Runs once daily (after the day's sends have fired) and confirms every scheduled send DUE
// today actually ran (wrote a send_log row) without erroring. Alerts David ONLY when something
// is wrong — "no news = it worked". He never has to remember or manually verify a send again.
//
// Independent-failure coverage: this watchdog runs on Netlify's scheduler, the same one it
// watches. If that scheduler dies entirely, both the sends AND this watchdog stop — so we also
// ping a healthchecks.io dead-man's-switch on every completed run (optional, env
// HEALTHCHECK_WATCHDOG_URL). If the ping stops arriving, healthchecks alerts David out-of-band.

import { getEnv, sendEmail } from "./_email.mjs";
import { serviceClient, supabaseConfigured } from "./_supabase.mjs";

export const config = { schedule: "30 14 * * *" }; // ~9:30am CT daily, after the 13:00/13:15 UTC sends

// What MUST fire, and on which CT weekdays (0=Sun..6=Sat). `daily` = every day. Each job name
// must match the `job` its send passes to recordSend(). This is the per-brand config.
export const EXPECTED_SENDS = [
  { job: "reminders-cron",     label: "Daily plan reminders", daily: true },
  { job: "nudges-cron",        label: "Daily people nudges",  daily: true },
  { job: "daily-thought-send", label: "Daily thought email",  daily: true }, // TC-174 Surface 2
  { job: "weekly-digest",      label: "Weekly report",        days: [1] }, // Mondays
];

// DST-aware America/Chicago helpers.
function ctParts(d) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { dow, ymd: `${p.year}-${p.month}-${p.day}`, hour: parseInt(p.hour, 10) };
}
// Start of "today" in CT, as a UTC ISO string (probes CDT/CST offsets).
function ctDayStartUTC(d) {
  const { ymd } = ctParts(d);
  for (const off of [5, 6]) {
    const guess = new Date(`${ymd}T0${off}:00:00Z`);
    const back = ctParts(guess);
    if (back.ymd === ymd && back.hour === 0) return guess.toISOString();
  }
  return new Date(`${ymd}T05:00:00Z`).toISOString();
}

// A send can report status:ok yet reach almost nobody (a recipient gate silently collapsing the
// audience). Flag two "silent zero" shapes on a job that DID run ok: delivered 0 to a real
// audience, or today's audience collapsed >50% vs the recent high. A floor keeps tiny lists from
// tripping it. Pure + exported so it is unit-testable without the DB.
const HEALTH_FLOOR = 20;
export function deliveryIssue(today, prior) {
  const okToday = (today || []).filter((r) => r.status !== "error");
  if (!okToday.length) return null;
  const todayAudience = Math.max(0, ...okToday.map((r) => r.audience || 0));
  const todayDelivered = Math.max(0, ...okToday.map((r) => r.delivered || 0));
  if (todayAudience >= HEALTH_FLOOR && todayDelivered === 0) {
    return `ran but delivered 0 of ${todayAudience} — nobody received it`;
  }
  const priorOk = (prior || []).filter((r) => r.status !== "error");
  const baseline = priorOk.length ? Math.max(0, ...priorOk.map((r) => r.audience || 0)) : 0;
  if (baseline >= HEALTH_FLOOR && todayAudience < baseline * 0.5) {
    return `audience collapsed to ${todayAudience} (recent high ~${baseline}) — check the recipient gate`;
  }
  return null;
}

// Core, factored so it can be smoke-tested locally with an injected supabase client + send fn
// (Netlify blocks external HTTP to scheduled functions, so we test the logic directly).
export async function runWatchdog({ supabase, now = new Date(), send = sendEmail, expected = EXPECTED_SENDS } = {}) {
  const { dow } = ctParts(now);
  const since = ctDayStartUTC(now);
  const due = expected.filter((s) => s.daily || (s.days || []).includes(dow));

  const problems = [];
  for (const s of due) {
    let rows = null;
    try {
      const { data, error } = await supabase
        .from("send_log")
        .select("status,audience,delivered,failed,fired_at")
        .eq("job", s.job)
        .gte("fired_at", since)
        .order("fired_at", { ascending: false });
      rows = error ? null : (data || []);
    } catch { rows = null; }

    if (rows === null) { problems.push({ ...s, issue: "could not verify (send_log query failed)" }); continue; }
    if (rows.length === 0) { problems.push({ ...s, issue: "DID NOT RUN — no send_log row for today" }); continue; }
    if (rows.some((x) => x.status === "error")) {
      problems.push({ ...s, issue: `ERRORED (${rows[0].failed || 0} failed)` });
      continue;
    }
    // Ran ok — but did it reach anyone? Catch the silent-zero / audience-collapse shapes.
    let prior = [];
    try {
      const { data } = await supabase
        .from("send_log")
        .select("status,audience,delivered,fired_at")
        .eq("job", s.job)
        .lt("fired_at", since)
        .order("fired_at", { ascending: false })
        .limit(15);
      prior = data || [];
    } catch { prior = []; }
    const issue = deliveryIssue(rows, prior);
    if (issue) problems.push({ ...s, issue });
  }

  const adminEmail = getEnv("ADMIN_NOTIFICATION_EMAIL") || "david@damayenterprises.com";
  if (problems.length && adminEmail) {
    const listHtml = problems.map((p) => `<li><strong>${p.label}</strong> (${p.job}) — ${p.issue}</li>`).join("");
    try {
      await send({
        to: adminEmail,
        replyTo: "care@thoughtscount.com",
        subject: `[Thoughts Count] ⚠️ ${problems.length} scheduled send${problems.length > 1 ? "s" : ""} need attention`,
        html: `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#B91C1C">A scheduled send didn't go as expected</h2>
          <p>The send watchdog checked today's due sends and found problem(s):</p>
          <ul>${listHtml}</ul>
          <p style="color:#6B7280;font-size:13px">You only get this email when something is wrong. If a send is fine you hear nothing. Checked ${due.length} due send(s) at ${now.toISOString()}.</p>
        </div>`,
      });
    } catch (e) {
      console.error("[send-watchdog] alert email failed:", e?.message || e);
    }
  }
  return { checked: due.length, problems: problems.length, detail: problems };
}

// Dead-man's-switch: ping healthchecks.io on every completed run so an absence of pings (the
// watchdog itself stopped firing) raises an out-of-band alert. Optional — no-op until the env is set.
async function pingHealthcheck() {
  const url = getEnv("HEALTHCHECK_WATCHDOG_URL");
  if (!url) return;
  try { await fetch(url, { method: "POST" }); } catch (e) { console.error("[send-watchdog] healthcheck ping failed:", e?.message || e); }
}

export default async () => {
  if (!supabaseConfigured()) return json({ skipped: "supabase-not-configured" });
  try {
    const out = await runWatchdog({ supabase: serviceClient() });
    await pingHealthcheck();
    return json(out);
  } catch (err) {
    console.error("send-watchdog error", err);
    return json({ error: String(err?.message || err) }); // fail-soft: never retry-storm
  }
};

function json(obj) {
  return new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });
}
