// Thoughts Count — daily scheduler. Runs once a day, finds reminders due today
// (or overdue), emails each one, and marks it sent. This is what makes the
// "keep showing up" nudges actually arrive without the user doing anything.

import { getStore } from "@netlify/blobs";
import { sendEmail, reminderEmailHtml } from "./_email.mjs";
import { logEvent, isTestEmail } from "./_analytics.mjs";
import { recordSend } from "./_sendlog.mjs";

export const config = { schedule: "0 13 * * *" }; // 13:00 UTC daily (~8am CT)

export default async () => {
  const store = getStore("reminders");
  const today = ymd(new Date());
  let checked = 0, sent = 0, due = 0, failed = 0, errored = false;

  try {
    const { blobs } = await store.list();
    for (const b of blobs || []) {
      checked++;
      const rec = await store.get(b.key, { type: "json" });
      if (!rec || rec.sent) continue;
      if (rec.sendOn > today) continue; // not due yet
      due++;

      const res = await sendEmail({
        to: rec.email,
        subject: "A gentle nudge from Thoughts Count",
        html: reminderEmailHtml(rec),
      });
      if (res.ok) {
        await store.setJSON(b.key, { ...rec, sent: true, sentAt: today });
        sent++;
        await logEvent("reminder_sent", { insider: isTestEmail(rec.email) });
      } else {
        failed++;
      }
    }
  } catch (err) {
    console.error("reminders-cron error", err);
    errored = true;
  }

  // TC-139: a row EVERY run (even 0 due) so the watchdog knows the job actually fired.
  await recordSend({ job: "reminders-cron", status: errored ? "error" : (failed ? "partial" : "ok"), audience: due, delivered: sent, failed, meta: { today, checked } });

  return new Response(JSON.stringify({ checked, sent, due, failed, today }), { headers: { "content-type": "application/json" } });
};

function ymd(d) {
  return d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
}
