// Thoughts Count — the on-site "A daily thought" (WP-3).
//
// Serves TODAY's approved daily reflection for the site to render as a small, quiet,
// non-blocking note in Della's voice. Source of truth is the SHARED Marketing-OS table
// `daily_reflections` (app, day, text, author, status), which is service-role-only — the
// browser must never read it directly, so this endpoint is the single read seam.
//
// Contract (from WP-1):
//   row shape  : { app, day (YYYY-MM-DD), text, author, status:'approved' }
//   response   : { line, author, day }  — or { line: null } when there's nothing to show.
//
// Degrade gracefully at every edge: Supabase unconfigured, the table not yet migrated, an
// empty/pending day, or any query error ALL return { line: null } (HTTP 200) so the site
// simply renders nothing. This function must NEVER 500 the page.

import { serviceClient, supabaseConfigured } from "./_supabase.mjs";

const APP = "thoughts-count";
const ZONE = "America/Chicago";

export default async () => {
  // No Supabase yet → nothing to show, cleanly.
  if (!supabaseConfigured()) return json({ line: null });

  const day = ymd(todayInZone(ZONE));

  try {
    const sb = serviceClient();
    const { data, error } = await sb
      .from("daily_reflections")
      .select("text, author, day")
      .eq("app", APP)
      .eq("day", day)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();

    // A missing table (pre-migration) or any error → render nothing, never 500.
    if (error || !data || !data.text || !String(data.text).trim()) {
      return json({ line: null });
    }

    return json({
      line: String(data.text).trim(),
      author: data.author || null,
      day: data.day || day,
    });
  } catch {
    return json({ line: null });
  }
};

// Small JSON helper with a short cache — a daily line is stable for the day, but we keep
// the window short so a same-day approval/edit shows up promptly for later visitors.
function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    },
  });
}

// Midnight of "today" as seen in a given IANA timezone (copied in shape from nudges-cron.mjs
// so the site's notion of "today" matches the cron's — Central Time, DST-correct).
function todayInZone(tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t) => parts.find((x) => x.type === t).value;
  return new Date(Number(g("year")), Number(g("month")) - 1, Number(g("day")));
}
function ymd(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
