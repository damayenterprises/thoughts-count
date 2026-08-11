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

// ── TC-112: year-less birthdays ("her birthday is June 15") ──────────────────────────────────
// A birthday given with no year is a RECURRING key_date that fires every year. We store it as a
// full day-precise date under a sentinel year so month/day nudging + "next occurrence" logic keep
// working untouched, and NEVER show the sentinel year to the user (recurring rows already render
// month+day only). BDAY_SENTINEL_YEAR is a leap year so Feb 29 survives; it sits far in the past so
// it can never be mistaken for a real birth year.
export const BDAY_SENTINEL_YEAR = "0004";

// Is this event_date a year-less birthday (stored under the sentinel year)?
export function isYearlessBirthday(event_date) {
  return typeof event_date === "string" && event_date.slice(0, 4) === BDAY_SENTINEL_YEAR;
}

// event_date ('YYYY-MM-DD' or '0004-MM-DD') → "June 15" for the confirm-card text input / display.
// Returns "" if not a usable date. For a year-less birthday the year is intentionally dropped.
export function formatMonthDay(event_date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(event_date || ""));
  if (!m) return "";
  const name = MONTH_NAMES[Number(m[2]) - 1];
  return name ? `${name} ${Number(m[3])}` : "";
}

// Parse what the user typed/kept in the birthday field into an event_date + whether it recurs.
// Accepts "June 15", "Jun 15", "6/15", "15 June", "1990-06-15", "06/15/1990". A year-less value
// normalizes to the sentinel year (recurs=true). Returns { event_date, recurs } or null.
export function parseBirthdayInput(str) {
  const s = String(str || "").trim();
  if (!s) return null;
  // ISO or ISO-with-sentinel already.
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    if (Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) return null;
    const mo = String(Number(m[2])).padStart(2, "0"), da = String(Number(m[3])).padStart(2, "0");
    return { event_date: `${m[1]}-${mo}-${da}`, recurs: m[1] === BDAY_SENTINEL_YEAR };
  }
  const monthIdx = (w) => MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(String(w || "").toLowerCase().slice(0, 3)));
  let mo = -1, da = 0, yr = null;
  // "June 15" / "Jun 15" / "June 15, 1990".
  m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(s);
  if (m) { mo = monthIdx(m[1]); da = Number(m[2]); yr = m[3] || null; }
  else {
    // "15 June" / "15 June 1990".
    m = /^(\d{1,2})\s+([A-Za-z]+)\.?(?:,?\s+(\d{4}))?$/.exec(s);
    if (m) { mo = monthIdx(m[2]); da = Number(m[1]); yr = m[3] || null; }
    else {
      // "6/15" or "06/15/1990" (US month/day[/year]).
      m = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/.exec(s);
      if (m) { mo = Number(m[1]) - 1; da = Number(m[2]); yr = m[3] || null; if (yr && yr.length === 2) yr = "19" + yr; }
    }
  }
  if (mo < 0 || mo > 11 || da < 1 || da > 31) return null;
  const year = yr && /^\d{4}$/.test(yr) ? yr : BDAY_SENTINEL_YEAR;
  return { event_date: `${year}-${String(mo + 1).padStart(2, "0")}-${String(da).padStart(2, "0")}`, recurs: year === BDAY_SENTINEL_YEAR };
}
