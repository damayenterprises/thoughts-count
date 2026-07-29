// Thoughts Count — poll a background import's progress (mirrors plan.mjs).
// The page calls this every second or two after kicking off a large import, until the
// record flips to done (or error). Auth-gated + namespaced by the verified user_id, so
// one user can never read another user's import status even if they know the jobId
// (V#5). The stored record holds only counts, never contact data.

import { getStore } from "@netlify/blobs";
import { requireUser, json } from "./_supabase.mjs";

export default async (req) => {
  const auth = await requireUser(req);
  if (auth.error) return json(auth.status, { status: "error", error: auth.error });

  const url = new URL(req.url);
  const jobId = url.searchParams.get("job_id") || url.searchParams.get("jobId");
  if (!jobId) return json(400, { status: "error", error: "missing job_id" });

  try {
    const store = getStore("imports");
    const record = await store.get(`${auth.userId}/${jobId}`, { type: "json" });
    if (!record) return json(200, { status: "pending" });
    return json(200, record); // { status:'running', progress } | { status:'done', result } | { status:'error', error }
  } catch (err) {
    console.error("import-status poll error", err);
    return json(200, { status: "pending" });
  }
};
