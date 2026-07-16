// Thoughts Count — result poller. The page calls this every couple seconds after
// kicking off a background job, until the plan is ready (or errored).

import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) return json(400, { status: "error", error: "missing jobId" });

  try {
    const store = getStore("plans");
    const record = await store.get(jobId, { type: "json" });
    if (!record) return json(200, { status: "pending" });
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
