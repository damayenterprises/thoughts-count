// Thoughts Count — TC-179 daily-thought archive.
//
// The daily thought is authored/approved in Marketing OS and read live by the site + the morning
// email. On its own it is ephemeral: it shows once on the home bar, goes out once by email, and is
// gone. This tiny archive captures each day's approved line into TC's own Blob store so the daily
// cadence compounds into a durable, crawlable asset (the /thoughts/ hub) instead of evaporating.
//
// Never the source of truth (MOS is) — just a growing local record. Capture is opportunistic and
// idempotent by day: whenever the site or the send-cron fetches today's line, we upsert it here. A
// second write for the same day is a no-op unless the approved line was edited.

import { getStore } from "@netlify/blobs";

export const THOUGHTS_STORE = "daily-thoughts";

// Canonical dashed YYYY-MM-DD. Accepts MOS's dashed `day`, a bare YYYYMMDD, or nothing (falls back
// to today) so the key format is identical on every path that writes.
export function normalizeDay(v) {
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Upsert today's (or a given day's) approved line. Idempotent: skips the write when the same line is
// already stored for that day. Fail-soft: any storage error is swallowed so capture never breaks the
// page or the send that triggered it.
export async function recordThought({ line, author, day } = {}) {
  try {
    const clean = String(line || "").trim();
    if (!clean) return { ok: false, reason: "empty" };
    const key = normalizeDay(day);
    const store = getStore(THOUGHTS_STORE);
    const existing = await store.get(key, { type: "json" }).catch(() => null);
    if (existing && existing.line === clean) return { ok: true, unchanged: true, day: key };
    await store.setJSON(key, {
      day: key,
      line: clean,
      author: author || null,
      capturedAt: new Date().toISOString(),
    });
    return { ok: true, day: key };
  } catch (e) {
    console.error("recordThought failed", e);
    return { ok: false, reason: "error" };
  }
}

// Most-recent-first list of archived thoughts, capped. Fail-soft: returns [] on any error.
export async function listRecentThoughts(limit = 30) {
  try {
    const store = getStore(THOUGHTS_STORE);
    const keys = [];
    let cursor;
    do {
      const page = await store.list({ cursor });
      cursor = page.cursor;
      for (const b of page.blobs || []) keys.push(b.key);
    } while (cursor);
    keys.sort().reverse(); // dashed YYYY-MM-DD sorts lexically = chronologically
    const out = [];
    for (const k of keys.slice(0, limit)) {
      const rec = await store.get(k, { type: "json" }).catch(() => null);
      if (rec && rec.line) out.push(rec);
    }
    return out;
  } catch (e) {
    console.error("listRecentThoughts failed", e);
    return [];
  }
}
