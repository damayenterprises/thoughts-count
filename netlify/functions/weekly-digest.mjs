// Thoughts Count — weekly report handler.
// Emails the usage/SEO/analytics digest to the report recipients. The heavy lifting
// lives in _digest.mjs so the same report can be sent on demand via send-digest.
//
// TRIGGER: native Netlify schedule (interim). This silently did NOT fire on
// 2026-08-24 (no send_log row), the Netlify native-cron flakiness the portfolio
// standard replaces with QStash. Migration to QStash is BLOCKED for now: the shared
// Upstash QStash account is at its 10/10 free-tier schedule quota (all real portfolio
// jobs), so there is no slot for a TC digest schedule yet. Until a slot frees up or
// Upstash is upgraded, we keep the native schedule as the trigger and rely on the
// send-watchdog to catch a miss (it did on 2026-08-24). send-digest.mjs also
// recordSend()s, so a manual re-send is watchdog-visible too. When a QStash slot is
// available: de-schedule this + register QStash -> POST /api/send-digest.
// See reference_scheduler_standard_qstash + reference_netlify_scheduled_fn_403.

import { runDigest } from "./_digest.mjs";
import { recordSend } from "./_sendlog.mjs";

export const config = { schedule: "0 13 * * 1" }; // Mondays 13:00 UTC (~8am CT)

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
