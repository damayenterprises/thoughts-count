// Thoughts Count — manual "send the weekly report now" trigger (admin token).
// Lets us preview the digest on demand or re-send it, without waiting for Monday.
// Auth: ?token=<ANALYTICS_TOKEN>. Optional ?to=email overrides recipients (preview).

import { getEnv } from "./_email.mjs";
import { runDigest, REPORT_RECIPIENTS } from "./_digest.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const token = req.headers.get("x-analytics-token") || url.searchParams.get("token") || "";
  const expected = getEnv("ANALYTICS_TOKEN");
  if (!expected || token !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }

  const to = url.searchParams.get("to");
  const recipients = to ? to.split(",").map((s) => s.trim()).filter(Boolean) : REPORT_RECIPIENTS;

  try {
    const out = await runDigest(recipients);
    return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (err) {
    console.error("send-digest error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
