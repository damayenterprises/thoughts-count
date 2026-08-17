// Thoughts Count — daily proactive nudges for saved people (companion).
// Once a day, looks at every saved key date and fires the reminders that come due
// TODAY (in Central Time). A nudge_log row keeps each reminder from firing more than
// once per occurrence. This is what turns per-plan reminders into a standing
// "we've got your back".
//
// v2 ("Tell Della, she remembers", spec §5): a key_date can now carry N custom-timed
// reminders (situation_reminders), each with its own lead offset (0 = day-of, +N =
// N days before, negative = N days after the event). We fire each due reminder and
// dedup per (key_date_id, occurrence, reminder_id).
//   • A key_date with ZERO situation_reminders rows keeps today's exact behavior:
//     one implicit reminder at its own lead_days, deduped as (kd, occ, NULL).
//   • Negative offsets ("check on me 3 days after") keep a PAST one-off evaluable for
//     up to max(after-offset) days beyond event_date — the subtle correctness point.
//   • The situation_reminders table may not exist yet (pre-migration): a missing table
//     degrades to empty reminders ⇒ legacy behavior, so the branch previews safely.
//
// Runs harmlessly (no-op) until Supabase is configured, so it can ship ahead of the keys.

import { createClient } from "@supabase/supabase-js";
import { getEnv, sendEmail, peopleNudgeEmailHtml } from "./_email.mjs";

export const config = { schedule: "15 13 * * *" }; // ~8:15am CT daily

const DEFAULT_LEAD_DAYS = 7;

// Human phrasing for how far out (or past) a date is, so the email reads naturally whatever
// lead time the user chose ("today", "tomorrow", "in 3 days", "the day after", "3 days after").
function leadPhrase(days) {
  if (days < 0) {
    const after = -days;
    if (after === 1) return "the day after";
    return `${after} days after`;
  }
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === 7) return "in a week";
  if (days === 14) return "in two weeks";
  return `in ${days} days`;
}

// The core cron pass, factored out so tests can inject `today` and a fake supabase client
// (deterministic — no dependence on the wall clock / time-of-day, per the MOS CI test gate).
// `today` defaults to midnight-in-Central-Time; callers/tests may override.
export async function runNudges(supabase, {
  today = todayInZone("America/Chicago"),
  siteUrl = getEnv("URL") || "https://thoughts-count.netlify.app",
  send = sendEmail,
} = {}) {
  let checked = 0, sent = 0;

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

    // The reminders for this date. Empty (or a missing table pre-migration) ⇒ legacy path.
    const reminders = await loadReminders(supabase, kd.id);

    // Build the list of "reminder fires" to evaluate. Legacy: one implicit fire at the
    // key_date's own lead_days with reminder_id = NULL. v2: one fire per active reminder.
    const fires = reminders.length
      ? reminders.map((r) => ({ leadDays: Number(r.lead_days), reminderId: r.id, label: r.label }))
      : [{ leadDays: Number.isFinite(kd.lead_days) ? kd.lead_days : DEFAULT_LEAD_DAYS, reminderId: null, label: null }];

    // The most-negative offset among this date's fires tells us how many days PAST a one-off
    // event we must keep evaluating it (so an "after" reminder can still fire once the event
    // has passed). For all-nonnegative offsets this is 0 ⇒ a past one-off returns null as today.
    const minLead = Math.min(...fires.map((f) => f.leadDays));
    const occ = occurrenceFor(kd.event_date, kd.recurs, today, minLead);
    if (!occ) continue;                         // one-off already past its last "after" window
    const occStr = ymd(occ);
    const delta = daysBetween(today, occ);      // >0 before the event, 0 on it, <0 after it

    for (const fire of fires) {
      if (delta !== fire.leadDays) continue;    // not this reminder's day

      // Already fired for this (date, occurrence, reminder)? Dedup per reminder; legacy uses NULL.
      if (await alreadyLogged(supabase, kd.id, occStr, fire.reminderId)) continue;

      // Resolve the owner's email (cached per user).
      let email = emailCache.get(kd.user_id);
      if (email === undefined) {
        const { data: u } = await supabase.auth.admin.getUserById(kd.user_id);
        email = u?.user?.email || null;
        emailCache.set(kd.user_id, email);
      }
      if (!email) continue;

      // Della-voiced copy stays a TEMPLATE (leadPhrase + the reminder/date label) — no LLM call
      // in the cron hot path. Reminder timing is user-set only; nothing is injected here.
      const personName = kd.people?.name || "someone you care about";
      const label = (fire.label && String(fire.label).trim()) || kd.label;
      const res = await send({
        to: email,
        subject: `${personName}'s ${label} is coming up`,
        html: peopleNudgeEmailHtml({
          personName,
          label,
          whenText: leadPhrase(fire.leadDays),
          planUrl: siteUrl,
        }),
      });
      if (res.ok) {
        await supabase.from("nudge_log").insert({ key_date_id: kd.id, occurrence: occStr, reminder_id: fire.reminderId });
        sent++;
      }
    }
  }

  return { checked, sent, today: ymd(today) };
}

export default async () => {
  const url = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return json({ skipped: "supabase-not-configured" });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    const out = await runNudges(supabase);
    return json(out);
  } catch (err) {
    console.error("nudges-cron error", err);
    return json({ checked: 0, sent: 0, error: err.message || "failed" });
  }
};

// Load the active reminders for a key_date. Degrades gracefully: if situation_reminders doesn't
// exist yet (pre-migration) or the query errors, return [] ⇒ the caller uses the legacy path.
async function loadReminders(supabase, keyDateId) {
  try {
    const { data, error } = await supabase
      .from("situation_reminders")
      .select("id, lead_days, label")
      .eq("key_date_id", keyDateId)
      .eq("active", true);
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Has this exact reminder already fired for this occurrence? Legacy rows carry reminder_id = NULL,
// so we must query with `.is(null)` there (not `.eq`) — Postgres treats NULL as distinct.
async function alreadyLogged(supabase, keyDateId, occStr, reminderId) {
  let q = supabase.from("nudge_log").select("id").eq("key_date_id", keyDateId).eq("occurrence", occStr);
  q = reminderId == null ? q.is("reminder_id", null) : q.eq("reminder_id", reminderId);
  const { data } = await q.maybeSingle();
  return !!data;
}

// The occurrence of this date to evaluate against `today`. Recurring dates roll to this or next
// year (as before). One-offs return their fixed date — and, crucially, KEEP returning it for up to
// `-minLead` days AFTER it has passed, so a negative-offset "after" reminder can still fire. When
// minLead >= 0 (no "after" reminders) a past one-off returns null, exactly as the old cron did.
function occurrenceFor(eventDate, recurs, from, minLead = 0) {
  const d = new Date(eventDate + "T00:00:00");
  if (recurs) {
    const candidate = new Date(from.getFullYear(), d.getMonth(), d.getDate());
    if (candidate < from) candidate.setFullYear(from.getFullYear() + 1);
    return candidate;
  }
  if (d >= from) return d;
  // Past one-off: keep it evaluable only while an "after" reminder could still be due.
  // daysBetween(from, d) is negative once d is past; it must not have dropped below minLead.
  const graceDays = minLead < 0 ? -minLead : 0;
  return daysBetween(from, d) >= -graceDays ? d : null;
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

// Exported for tests (spec §8 risk 4): the timezone/occurrence math is reused VERBATIM in shape.
export { occurrenceFor, daysBetween, todayInZone, leadPhrase, ymd };
