// TC-139 — Send accountability logger (ported from MAP-432).
//
// Every automated/scheduled send calls recordSend(...) when it finishes running, so the
// send-watchdog can confirm each expected send actually fired. FAIL-SOFT by contract: it
// never throws and never blocks a send — a logging failure must not break the send itself.
// Writes one row to the send_log table (supabase/migrations/TC-139-send-log.sql) EVERY run,
// even when the send delivered 0, so a missing row means the job genuinely did not fire.

import { serviceClient, supabaseConfigured } from "./_supabase.mjs";

export async function recordSend({ job, status = "ok", audience = 0, delivered = 0, failed = 0, meta = null } = {}) {
  if (!job || !supabaseConfigured()) return;
  try {
    const n = (v) => (Number.isFinite(v) ? v : 0);
    await serviceClient().from("send_log").insert({
      job,
      status,
      audience: n(audience),
      delivered: n(delivered),
      failed: n(failed),
      meta: meta == null ? null : meta,
    });
  } catch (err) {
    // Never surface — accountability logging must not break the actual send.
    console.error(`[sendLog] could not record "${job}":`, err?.message || err);
  }
}
