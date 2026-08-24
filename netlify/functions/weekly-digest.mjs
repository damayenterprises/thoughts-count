// Thoughts Count — weekly report scheduler.
// Runs every Monday at 13:00 UTC (~8am Central) and emails the usage/SEO/analytics
// digest to the report recipients. The heavy lifting lives in _digest.mjs so the
// same report can be sent on demand via send-digest.

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
