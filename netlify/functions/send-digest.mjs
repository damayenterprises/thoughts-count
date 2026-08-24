// Thoughts Count — manual "send the weekly report now" trigger (admin token).
// Lets us preview the digest on demand or re-send it, without waiting for Monday.
// Auth: ?token=<ANALYTICS_TOKEN>. Optional ?to=email overrides recipients (preview).

import { getEnv } from "./_email.mjs";
import { runDigest, REPORT_RECIPIENTS } from "./_digest.mjs";
import { recordSend } from "./_sendlog.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const token = req.headers.get("x-analytics-token") || url.searchParams.get("token") || "";
  const expected = getEnv("ANALYTICS_TOKEN");
  if (!expected || token !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }

  const to = url.searchParams.get("to");
  const recipients = to ? to.split(",").map((s) => s.trim()).filter(Boolean) : REPORT_RECIPIENTS;
  // A `?to=` preview override is NOT the real weekly send — don't log it as the Monday
  // job (that would let a preview satisfy the watchdog). Only the real recipient run logs.
  const isRealSend = !to;

  try {
    const out = await runDigest(recipients);
    // Record the send so the watchdog can confirm the weekly report fired. This is the
    // SAME job name the watchdog checks; QStash triggers this endpoint Mondays now that
    // the native Netlify schedule proved unreliable (missed 2026-08-24). recordSend is
    // fail-soft and never blocks the send.
    if (isRealSend) {
      const audience = Array.isArray(out?.recipients) ? out.recipients.length : recipients.length;
      const delivered = Array.isArray(out?.results) ? out.results.filter((r) => r && r.ok).length : audience;
      await recordSend({ job: "weekly-digest", status: delivered < audience ? "partial" : "ok", audience, delivered, failed: audience - delivered, meta: { via: "send-digest", weekVisitors: out?.weekVisitors } });
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (err) {
    console.error("send-digest error", err);
    if (isRealSend) await recordSend({ job: "weekly-digest", status: "error", meta: { via: "send-digest", error: String(err).slice(0, 200) } });
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
