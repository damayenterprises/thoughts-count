// Thoughts Count — front-door uptime monitor.
//
// Runs every 5 minutes and confirms the LIVE site is actually serving: the homepage, the
// function layer, and the plan pipeline. Reports to a healthchecks.io check:
//   • all healthy  → ping <HEALTHCHECK_UPTIME_URL>       (resets the timer)
//   • any down     → ping <HEALTHCHECK_UPTIME_URL>/fail  (immediate DOWN alert email)
// If this monitor itself stops running (a total Netlify outage takes it down too), the check's
// dead-man's-switch fires after its grace window — so both "the app broke" and "the whole host
// died" reach David. The probe endpoints are cheap and NOT rate-limited or billed (no /api/generate
// or /api/converse call), so the monitor never costs anything or trips the abuse guards.

import { env } from "./_ratelimit.mjs";

export const config = { schedule: "*/5 * * * *" }; // every 5 minutes

const SITE = "https://thoughtscount.com";

async function probe(path, okFn) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(SITE + path, { redirect: "manual", signal: ac.signal });
    return { path, status: r.status, ok: okFn(r.status) };
  } catch (e) {
    return { path, status: 0, ok: false, err: String(e?.message || e).slice(0, 120) };
  } finally {
    clearTimeout(t);
  }
}

export default async () => {
  const checks = [
    await probe("/", (s) => s >= 200 && s < 400),          // homepage serves (200, or a healthy redirect)
    await probe("/api/public-config", (s) => s >= 200 && s < 500), // function layer alive (2xx/4xx = up; 5xx = down)
    await probe("/api/plan?jobId=uptime-probe", (s) => s >= 200 && s < 500), // plan pipeline endpoint responds (unknown job → pending 200)
  ];
  const allOk = checks.every((c) => c.ok);

  const hc = env("HEALTHCHECK_UPTIME_URL");
  if (hc) {
    try {
      const url = allOk ? hc : hc.replace(/\/$/, "") + "/fail";
      await fetch(url, { method: "POST", body: JSON.stringify({ allOk, checks }) });
    } catch (e) {
      console.error("[uptime-monitor] healthcheck ping failed:", e?.message || e);
    }
  }
  if (!allOk) console.error("[uptime-monitor] DOWN:", JSON.stringify(checks));

  return new Response(JSON.stringify({ allOk, checks }), { headers: { "content-type": "application/json" } });
};
