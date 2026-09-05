// Thoughts Count — TC-174 Surface 2: the morning "daily thought" send.
//
// Once a day (after the day's thought turns over at 7am CT), fetch TODAY's approved thought from
// the same source the on-site bar uses (Marketing OS), then email it to every active subscriber.
// This is what makes the "a small thought each morning" promise real instead of a captured address
// that never hears from us.
//
// Idempotent + re-run safe: each subscriber record stamps the day of the thought last sent, so a
// retry (or a second scheduler fire) never double-sends the same day's line. If there is no thought
// approved for today, we send nothing and simply record the (empty) run so the watchdog knows the
// job fired.

import { getStore } from "@netlify/blobs";
import { getEnv, sendEmail, dailyThoughtEmailHtml } from "./_email.mjs";
import { logEvent, isTestEmail } from "./_analytics.mjs";
import { recordSend } from "./_sendlog.mjs";
import { SUBSCRIBER_STORE } from "./subscribe-daily.mjs";
import { recordThought } from "./_thoughts.mjs";

export const config = { schedule: "30 13 * * *" }; // 13:30 UTC daily (~8:30am CT), after the 7am CT thought turnover

const MOS_DAILY_THOUGHT = "https://damay-marketing-os.netlify.app/api/daily-thought?app=thoughts-count";
const TIMEOUT_MS = 6000;

export default async () => {
  const today = ymd(new Date());
  let audience = 0, delivered = 0, failed = 0, errored = false;

  // 1) Fetch today's thought (same contract as daily-reflection.mjs). No thought → no send.
  let thought = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(MOS_DAILY_THOUGHT, { signal: ctrl.signal });
      if (r.ok) {
        const d = await r.json();
        if (d && d.line && String(d.line).trim()) {
          // dayMark drives the once-per-day dedupe, so it must be ONE stable format run-to-run
          // regardless of whether MOS returns `day`. Normalize to dashed YYYY-MM-DD always
          // (MOS's `day` is already dashed; the fallback matches it) so a run where MOS omits
          // `day` can't flip the format vs a run where it includes it and cause a double-send.
          thought = { line: String(d.line).trim(), day: normalizeDay(d.day) };
        }
      }
    } finally { clearTimeout(t); }
  } catch (e) { console.error("daily-thought fetch failed", e); }

  if (!thought) {
    await recordSend({ job: "daily-thought-send", status: "ok", audience: 0, delivered: 0, failed: 0, meta: { today, reason: "no-thought" } });
    return json({ skipped: "no-thought-today", today });
  }

  // 2) Send to every active subscriber, once per thought-day.
  const siteUrl = (getEnv("URL") || "https://thoughtscount.com").replace(/\/+$/, "");
  const readUrl = `${siteUrl}/thoughts/`;
  const dayMark = thought.day; // always dashed YYYY-MM-DD (normalized above)
  // TC-179: archive today's line so the /thoughts/ hub always has the latest, even on days no one
  // loaded the home bar. Idempotent by day, fail-soft.
  await recordThought({ line: thought.line, day: thought.day }).catch(() => {});
  try {
    const store = getStore(SUBSCRIBER_STORE);
    let cursor;
    do {
      const page = await store.list({ cursor });
      cursor = page.cursor;
      for (const b of page.blobs || []) {
        // Per-recipient isolation: a thrown fetch/store error for ONE subscriber must not abort the
        // whole batch (sendEmail doesn't wrap fetch, so a network error would otherwise bubble to the
        // outer try and skip everyone left). Count it failed and move on; an unsent record keeps its
        // old lastSentDay, so the next fire retries it.
        try {
          const rec = await store.get(b.key, { type: "json" });
          if (!rec || rec.active === false || !rec.email) continue;
          if (rec.lastSentDay === dayMark) continue; // already sent this day's line (idempotent)
          audience++;
          const unsubUrl = `${siteUrl}/api/daily-unsub?token=${encodeURIComponent(rec.token || "")}`;
          const res = await sendEmail({
            to: rec.email,
            subject: "A thought for today",
            html: dailyThoughtEmailHtml({ line: thought.line, unsubUrl, readUrl }),
          });
          if (res.ok) {
            await store.setJSON(b.key, { ...rec, lastSentDay: dayMark });
            delivered++;
            await logEvent("daily_thought_sent", { insider: isTestEmail(rec.email) });
          } else {
            failed++;
          }
        } catch (e) {
          console.error("daily-thought-send: recipient failed", e);
          failed++;
        }
      }
    } while (cursor);
  } catch (err) {
    console.error("daily-thought-send error", err);
    errored = true;
  }

  await recordSend({
    job: "daily-thought-send",
    status: errored ? "error" : (failed ? "partial" : "ok"),
    audience, delivered, failed, meta: { today, day: dayMark },
  });
  return json({ audience, delivered, failed, today, day: dayMark });
};

function ymd(d) {
  return d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
}
// Canonical dashed YYYY-MM-DD for the dedupe key. Accepts MOS's dashed `day` (passed through),
// a bare YYYYMMDD (dashed), or nothing/garbage (falls back to today, dashed) — so `dayMark` is
// one consistent format on every run.
function normalizeDay(v) {
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function json(obj) {
  return new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });
}
