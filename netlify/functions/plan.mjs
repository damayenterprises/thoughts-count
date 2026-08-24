// Thoughts Count — result poller. The page calls this every couple seconds after
// kicking off a background job, until the plan is ready (or errored).

import { getStore } from "@netlify/blobs";
import { envInt } from "./_ratelimit.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) return json(400, { status: "error", error: "missing jobId" });

  try {
    const store = getStore("plans");
    const record = await store.get(jobId, { type: "json" });
    if (!record) return json(200, { status: "pending" });
    // Expire finished plans after the TTL so a leaked jobId link can't read personal plan detail
    // indefinitely. Only bites on stale re-access — the live client polls within seconds of create.
    if (record.status === "done" && record.createdAt) {
      const ttlMs = envInt("TC_PLAN_TTL_DAYS", 30) * 24 * 60 * 60 * 1000;
      if (Date.now() - record.createdAt > ttlMs) {
        return json(200, { status: "error", error: "This plan link has expired." });
      }
    }
    return json(200, record); // { status: 'done', plan } or { status: 'error', error }
  } catch (err) {
    console.error("plan poll error", err);
    return json(200, { status: "pending" });
  }
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
