// Thoughts Count — commit a mapped CSV import (background path, larger files).
//
// A big book of business (> the inline cap) would blow past a normal function's time
// budget, so this runs as a Netlify background function: the client gets a 202 right
// away with its jobId, this keeps working, and it writes progress to Netlify Blobs.
// The page polls import-status until it flips to done. Same dedup core as the inline
// path — one behavior, whatever the size.

import { getStore } from "@netlify/blobs";
import { requireUser, serviceClient } from "./_supabase.mjs";
import { runImport } from "./_import.mjs";

export default async (req) => {
  const store = getStore("imports");
  let jobId, key = null;
  try {
    const body = await req.json();
    jobId = body?.jobId;
    if (!jobId) return new Response("missing jobId", { status: 400 });

    // Auth can't be returned synchronously from a background function. If it fails we
    // can't namespace a record (no user_id) — return quietly; the client's own poll is
    // authed and will surface the sign-in problem. On success, namespace the blob key by
    // the verified user_id so no one else can read this job's status (V#5).
    const auth = await requireUser(req);
    if (auth.error) return new Response("ok", { status: 202 });
    key = `${auth.userId}/${jobId}`;

    const rows = Array.isArray(body?.rows) ? body.rows : [];
    if (!rows.length) {
      await store.setJSON(key, { status: "error", error: "No rows to import." });
      return new Response("ok", { status: 202 });
    }

    await store.setJSON(key, { status: "running", progress: { done: 0, total: rows.length } });

    const supa = serviceClient();
    const summary = await runImport({
      supa,
      userId: auth.userId,
      filename: body?.filename,
      rows,
      source: "csv",
      onProgress: async (done, total) => {
        await store.setJSON(key, { status: "running", progress: { done, total } });
      },
    });

    await store.setJSON(key, { status: "done", result: summary });
    return new Response("ok", { status: 202 });
  } catch (err) {
    console.error("import-commit-background failed", err);
    try {
      if (key) await store.setJSON(key, { status: "error", error: "We couldn't finish that import. Please try again." });
    } catch {}
    return new Response("ok", { status: 202 });
  }
};
