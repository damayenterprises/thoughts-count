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
          thought = { line: String(d.line).trim(), day: d.day || today };
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
  const dayMark = thought.day || today;
  try {
    const store = getStore(SUBSCRIBER_STORE);
    let cursor;
    do {
      const page = await store.list({ cursor });
      cursor = page.cursor;
      for (const b of page.blobs || []) {
        const rec = await store.get(b.key, { type: "json" });
        if (!rec || rec.active === false || !rec.email) continue;
        if (rec.lastSentDay === dayMark) continue; // already sent this day's line (idempotent)
        audience++;
        const unsubUrl = `${siteUrl}/api/daily-unsub?token=${encodeURIComponent(rec.token || "")}`;
        const res = await sendEmail({
          to: rec.email,
          subject: "A thought for today",
          html: dailyThoughtEmailHtml({ line: thought.line, unsubUrl }),
        });
        if (res.ok) {
          await store.setJSON(b.key, { ...rec, lastSentDay: dayMark });
          delivered++;
          await logEvent("daily_thought_sent", { insider: isTestEmail(rec.email) });
        } else {
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
function json(obj) {
  return new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });
}
