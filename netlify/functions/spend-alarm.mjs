// Thoughts Count — spend / volume alarm.
//
// Hourly, reads today's per-endpoint daily counters (the same Blob counters the rate limiter in
// _ratelimit.mjs increments) and emails David the FIRST time any metered endpoint crosses 80% of
// its daily cap — so a traffic surge or an abuse loop is caught BEFORE it hits the ceiling (and,
// for plan generation, before the SHARED Google Places bill runs up). One email per endpoint per
// day (deduped in a Blob), so it never spams. No paid calls — it only reads counters.

import { getStore } from "@netlify/blobs";
import { getEnv, sendEmail } from "./_email.mjs";
import { envInt } from "./_ratelimit.mjs";

export const config = { schedule: "0 * * * *" }; // hourly

const WARN_PCT = 80;
const PLACES_PER_PLAN_USD = 2 * 0.07; // up to 2 lookups/plan × ~7¢ (shared Google account)

// store name = the capStore each endpoint passes to guardPaid(); cap = its env-tunable ceiling.
const JOBS = [
  { store: "generate-dailycap", cap: () => envInt("TC_GEN_DAILY_CAP", 2500),  label: "Plans generated",         killSwitch: "PLANS_DISABLED",    capVar: "TC_GEN_DAILY_CAP",     places: true },
  { store: "converse-dailycap", cap: () => envInt("TC_CONV_DAILY_CAP", 15000), label: "Della conversation turns", killSwitch: "CONVERSE_DISABLED", capVar: "TC_CONV_DAILY_CAP" },
  { store: "sendplan-dailycap", cap: () => envInt("TC_SEND_DAILY_CAP", 500),   label: "Plan emails sent",         killSwitch: "SEND_DISABLED",     capVar: "TC_SEND_DAILY_CAP" },
  { store: "contact-dailycap",  cap: () => envInt("TC_CONTACT_DAILY_CAP", 300), label: "Contact-form messages",   killSwitch: "CONTACT_DISABLED",  capVar: "TC_CONTACT_DAILY_CAP" },
];

async function todayCount(store, day) {
  try {
    const rec = await getStore(store).get(day, { type: "json" });
    return rec?.count || 0;
  } catch { return 0; }
}

export default async () => {
  const day = new Date().toISOString().slice(0, 10); // UTC date — matches the rate limiter's key
  const flags = getStore("spend-alarm");
  const hot = [];

  for (const j of JOBS) {
    const cap = j.cap();
    const count = await todayCount(j.store, day);
    const pct = cap > 0 ? Math.round((count / cap) * 100) : 0;
    if (pct >= WARN_PCT) {
      const flagKey = `${day}:${j.store}`;
      let already = null;
      try { already = await flags.get(flagKey, { type: "json" }); } catch {}
      if (!already) {
        hot.push({ ...j, cap, count, pct });
        try { await flags.setJSON(flagKey, { alertedAt: new Date().toISOString(), pct }); } catch {}
      }
    }
  }

  if (hot.length) {
    const admin = getEnv("ADMIN_NOTIFICATION_EMAIL") || "david@damayenterprises.com";
    const gen = hot.find((h) => h.places);
    const placesNote = gen
      ? `<p style="color:#8a6d00;">Note: plan generation drives the <strong>shared Google Places bill</strong> — roughly ~$${(gen.count * PLACES_PER_PLAN_USD).toFixed(2)} in Places today so far (${gen.count} plans).</p>`
      : "";
    const rows = hot.map((h) => `<li><strong>${h.label}</strong>: ${h.count} of ${h.cap} today (<strong>${h.pct}%</strong> of the daily cap) — raise <code>${h.capVar}</code> if real, or flip <code>${h.killSwitch}=1</code> if abuse</li>`).join("");
    try {
      await sendEmail({
        to: admin,
        replyTo: "care@thoughtscount.com",
        subject: `[Thoughts Count] ⚠️ Usage nearing a daily cap (${hot.map((h) => h.pct + "%").join(", ")})`,
        html: `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#B45309">Usage is approaching a daily cap</h2>
          <p>One or more metered endpoints crossed ${WARN_PCT}% of its daily ceiling today:</p>
          <ul>${rows}</ul>
          ${placesNote}
          <p style="color:#6B7280;font-size:13px">If this is real traffic, raise the cap env var in Netlify (takes effect live, no deploy). If it looks like abuse, flip the matching kill-switch to stop that endpoint instantly. You get this once per endpoint per day.</p>
        </div>`,
      });
    } catch (e) {
      console.error("[spend-alarm] email failed:", e?.message || e);
    }
  }

  return new Response(JSON.stringify({ day, checked: JOBS.length, alerted: hot.length }), { headers: { "content-type": "application/json" } });
};
