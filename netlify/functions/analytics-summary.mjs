// Thoughts Count — analytics summary (admin only).
// Reads the raw event log and returns aggregates: the funnel, unique visitors,
// unique emails, and the anonymized "what people need" breakdowns. Test/insider
// events are excluded by default (?includeTest=1 to see everything).
//
// Auth: pass ?token=<ANALYTICS_TOKEN> (or header x-analytics-token). If the env var
// isn't set, the endpoint stays locked.

import { getStore } from "@netlify/blobs";
import { getEnv } from "./_email.mjs";
import { loadAllEvents, computeSummary } from "./_analytics.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const token = req.headers.get("x-analytics-token") || url.searchParams.get("token") || "";
  const expected = getEnv("ANALYTICS_TOKEN");
  if (!expected || token !== expected) return json(401, { error: "unauthorized" });

  const includeTest = url.searchParams.get("includeTest") === "1";
  const store = getStore("analytics");
  const events = await loadAllEvents(store);
  const real = events.filter((e) => includeTest || (!e.test && !e.bot));

  return json(200, {
    generated_at: new Date().toISOString(),
    excluded_noise_events: includeTest ? 0 : events.length - real.length,
    ...computeSummary(real),
  });
};

function json(status, obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
