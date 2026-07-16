// Thoughts Count — "email me my plan" + opt into date-based email reminders.
// Emails the plan immediately, and (if requested) stores the follow-up reminders
// so the daily scheduler can send each one on its date.

import { getStore } from "@netlify/blobs";
import { sendEmail, planEmailHtml } from "./_email.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }

  const email = (body?.email || "").trim();
  const plan = body?.plan;
  const wantReminders = !!body?.wantReminders;
  if (!EMAIL_RE.test(email)) return json(400, { error: "Please enter a valid email address." });
  if (!plan || !plan.headline) return json(400, { error: "No plan to send." });

  // 1) Email the plan now.
  const sent = await sendEmail({
    to: email,
    subject: "Your Thoughts Count plan",
    html: planEmailHtml(plan),
  });
  if (!sent.ok) return json(502, { error: sent.error || "We couldn't send the email." });

  // 2) Optionally schedule the follow-up reminders.
  let scheduled = 0;
  if (wantReminders && Array.isArray(plan.follow_up)) {
    try {
      const store = getStore("reminders");
      for (const f of plan.follow_up) {
        const days = Number(f?.days_from_now);
        if (!Number.isFinite(days) || days < 0) continue;
        const d = new Date();
        d.setDate(d.getDate() + days);
        const sendOn = ymd(d);
        const id = "r_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        await store.setJSON(`${sendOn}_${id}`, {
          email,
          when: f.when || "",
          gesture: f.gesture || "",
          headline: plan.headline || "",
          sendOn,
          sent: false,
        });
        scheduled++;
      }
    } catch (err) {
      console.error("reminder store error", err);
      // Plan email already sent; don't fail the whole request over reminders.
    }
  }

  return json(200, { ok: true, scheduled });
};

function ymd(d) {
  return d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
}
function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
