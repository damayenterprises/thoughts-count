// Thoughts Count — shared honest rendering for imported PARTIAL dates (TC-43).
// A partial date ("Client since 2021", "June 2020") is stored with a placeholder day/month
// flagged by date_precision. We must NEVER show a day the user didn't give, so month/year
// precision render as just what was provided. Day-precise dates return null here — each
// surface keeps its own existing full-date formatting (companion shows a date, the roster
// shows a relative "when"), so this change is additive and leaves full dates untouched.
//
// Pure string parse (no Date) so a timezone boundary can never shift the month/year.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// event_date is 'YYYY-MM-DD'. Returns "2021" / "June 2020" for partials, or null for a
// day-precise date (caller renders it as before). null-safe.
export function formatKeyDate(event_date, precision) {
  if (!event_date) return null;
  if (precision === "year") return String(event_date).slice(0, 4);
  if (precision === "month") {
    const [y, m] = String(event_date).split("-");
    const name = MONTH_NAMES[Number(m) - 1];
    return name ? `${name} ${y}` : String(event_date);
  }
  return null; // 'day' (or legacy/unknown) → use the caller's existing formatting
}

// True when a key date lacks a real day and so must never nudge or appear as "coming up".
export function isPartialDate(precision) {
  return precision === "month" || precision === "year";
}
