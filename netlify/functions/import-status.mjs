// Thoughts Count — poll a background import's progress (mirrors plan.mjs).
// The page calls this every second or two after kicking off a large import, until
// the record flips to done (or error). The jobId is the unguessable capability; the
// stored record holds only counts, never contact data.

import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("job_id") || url.searchParams.get("jobId");
  if (!jobId) return json(400, { status: "error", error: "missing job_id" });

  try {
    const store = getStore("imports");
    const record = await store.get(jobId, { type: "json" });
    if (!record) return json(200, { status: "pending" });
    return json(200, record); // { status: 'running', progress } | { status:'done', result } | { status:'error', error }
  } catch (err) {
    console.error("import-status poll error", err);
    return json(200, { status: "pending" });
  }
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
