// Thoughts Count — daily proactive nudges for saved people (companion).
// Once a day, looks at every saved key date, finds the ones coming up in exactly
// LEAD_DAYS, and emails that person's owner a gentle heads-up with a link to build
// a plan. A nudge_log row keeps each date from nudging more than once per year.
// This is what turns per-plan reminders into a standing "we've got your back".
//
// Runs harmlessly (no-op) until Supabase is configured, so it can ship ahead of
// the keys.

import { createClient } from "@supabase/supabase-js";
import { getEnv, sendEmail, peopleNudgeEmailHtml } from "./_email.mjs";

export const config = { schedule: "15 13 * * *" }; // ~8:15am CT daily

const DEFAULT_LEAD_DAYS = 7;

// Human phrasing for how far out a date is, so the email reads naturally whatever
// lead time the user chose ("today", "tomorrow", "in 3 days", "in a week").
function leadPhrase(days) {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === 7) return "in a week";
  if (days === 14) return "in two weeks";
  return `in ${days} days`;
}

export default async () => {
  const url = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return json({ skipped: "supabase-not-configured" });
  }

  const siteUrl = getEnv("URL") || "https://thoughts-count.netlify.app";
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Compute "today" in Central Time, not the function's UTC, so the lead-day
  // countdown lands on the calendar day users actually mean (dates are stored
  // tz-less, and CT is our default reference).
  const today = todayInZone("America/Chicago");
  let checked = 0, sent = 0;

  try {
    const { data: dates, error } = await supabase
      .from("key_dates")
      // TC-43: only day-precise dates nudge. Month/year-precision partials (imported
      // "June 2020" / "2021") carry a placeholder day we must never fire an anniversary
      // on. Legacy rows default to 'day', so this is a no-op for everything imported
      // before partials were preserved.
      .select("id, user_id, person_id, label, event_date, recurs, lead_days, people(name, deleted_at)")
      .eq("date_precision", "day");
    if (error) throw error;

    const emailCache = new Map();

    for (const kd of dates || []) {
      checked++;
      // TC-49: a hard-deleted person is gone from every read and nudge. Their key_dates may
      // still exist (tombstoned via people.deleted_at), so skip any date whose person is gone.
      if (kd.people?.deleted_at) continue;
      const lead = Number.isFinite(kd.lead_days) ? kd.lead_days : DEFAULT_LEAD_DAYS;
      const occ = nextOccurrence(kd.event_date, kd.recurs, today);
      if (!occ) continue;                         // one-off already in the past
      if (daysBetween(today, occ) !== lead) continue;

      const occStr = ymd(occ);

      // Already nudged for this occurrence?
      const { data: seen } = await supabase
        .from("nudge_log").select("id").eq("key_date_id", kd.id).eq("occurrence", occStr).maybeSingle();
      if (seen) continue;

      // Resolve the owner's email (cached per user).
      let email = emailCache.get(kd.user_id);
      if (email === undefined) {
        const { data: u } = await supabase.auth.admin.getUserById(kd.user_id);
        email = u?.user?.email || null;
        emailCache.set(kd.user_id, email);
      }
      if (!email) continue;

      const personName = kd.people?.name || "someone you care about";
      const res = await sendEmail({
        to: email,
        subject: `${personName}'s ${kd.label} is coming up`,
        html: peopleNudgeEmailHtml({
          personName,
          label: kd.label,
          whenText: leadPhrase(lead),
          planUrl: siteUrl,
        }),
      });
      if (res.ok) {
        await supabase.from("nudge_log").insert({ key_date_id: kd.id, occurrence: occStr });
        sent++;
      }
    }
  } catch (err) {
    console.error("nudges-cron error", err);
  }

  return json({ checked, sent, today: ymd(today) });
};

// The next time this date occurs on/after `from`. Recurring dates roll to this or
// next year; one-offs return null once they're in the past.
function nextOccurrence(eventDate, recurs, from) {
  const d = new Date(eventDate + "T00:00:00");
  if (!recurs) return d >= from ? d : null;
  const candidate = new Date(from.getFullYear(), d.getMonth(), d.getDate());
  if (candidate < from) candidate.setFullYear(from.getFullYear() + 1);
  return candidate;
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
// Midnight of "today" as seen in a given IANA timezone, returned as a plain Date so
// it lines up with event dates parsed the same tz-less way (new Date(ymd+"T00:00:00")).
function todayInZone(tz) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t) => parts.find((x) => x.type === t).value;
  return new Date(Number(g("year")), Number(g("month")) - 1, Number(g("day")));
}
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function json(obj) { return new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } }); }
