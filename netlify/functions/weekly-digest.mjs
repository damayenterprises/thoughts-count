// Thoughts Count — weekly report scheduler.
// Runs every Monday at 13:00 UTC (~8am Central) and emails the usage/SEO/analytics
// digest to the report recipients. The heavy lifting lives in _digest.mjs so the
// same report can be sent on demand via send-digest.

import { runDigest } from "./_digest.mjs";

export const config = { schedule: "0 13 * * 1" }; // Mondays 13:00 UTC (~8am CT)

export default async () => {
  try {
    const out = await runDigest();
    return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
  } catch (err) {
    console.error("weekly-digest error", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
