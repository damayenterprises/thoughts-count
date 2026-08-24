// Thoughts Count — weekly report handler.
// Emails the usage/SEO/analytics digest to the report recipients. The heavy lifting
// lives in _digest.mjs so the same report can be sent on demand via send-digest.
//
// TRIGGER: NOT the native Netlify schedule anymore. The native `schedule` proved
// unreliable — it silently did NOT fire on 2026-08-24 (no send_log row at all), the
// same Netlify native-cron flakiness the portfolio standard replaced with QStash.
// The Monday send is now driven by QStash -> POST /api/send-digest (which recordSend()s
// as job "weekly-digest"). This handler is kept as a manual/internal entry point but
// is NO LONGER scheduled, so it can never double-fire against the QStash trigger.
// See reference_scheduler_standard_qstash + reference_netlify_scheduled_fn_403.

import { runDigest } from "./_digest.mjs";
import { recordSend } from "./_sendlog.mjs";

export default async () => {
  try {
    const out = await runDigest();
    // TC-139: record the weekly send so the watchdog can confirm it fired each Monday.
    const audience = Array.isArray(out?.recipients) ? out.recipients.length : 1;
    const delivered = Array.isArray(out?.results) ? out.results.filter((r) => r && r.ok).length : audience;
    await recordSend({ job: "weekly-digest", status: delivered < audience ? "partial" : "ok", audience, delivered, failed: audience - delivered, meta: { weekVisitors: out?.weekVisitors } });
    return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
  } catch (err) {
    console.error("weekly-digest error", err);
    await recordSend({ job: "weekly-digest", status: "error", meta: { error: String(err).slice(0, 200) } });
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
