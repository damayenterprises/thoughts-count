// Thoughts Count — the on-site "A daily thought" (WP-3).
//
// Serves TODAY's approved daily reflection for the site to render as a small, quiet,
// non-blocking note in Della's voice.
//
// SOURCE CHANGE (2026-08-26, MOS↔TC Supabase split): daily_reflections used to live
// in the SHARED Marketing-OS table inside THIS project's database, read here directly
// via the service client. After the split it lives in the Marketing OS's OWN database,
// so we read today's approved line through the MOS public API (an API call, not a
// shared table) — endpoint /api/daily-thought, which returns the SAME { line, author,
// day } contract this function has always emitted.
//
// Degrade gracefully at every edge: MOS unreachable, a timeout, an empty/pending day,
// or any error ALL return { line: null } (HTTP 200) so the site simply renders nothing.
// This function must NEVER 500 the page.

import { recordThought } from "./_thoughts.mjs";

const MOS_DAILY_THOUGHT = "https://damay-marketing-os.netlify.app/api/daily-thought?app=thoughts-count";
const TIMEOUT_MS = 5000;

export default async () => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let data;
    try {
      const r = await fetch(MOS_DAILY_THOUGHT, { signal: ctrl.signal });
      if (!r.ok) return json({ line: null });
      data = await r.json();
    } finally {
      clearTimeout(t);
    }
    if (!data || !data.line || !String(data.line).trim()) return json({ line: null });
    const line = String(data.line).trim();
    // TC-179: opportunistically archive today's approved line so the /thoughts/ hub compounds. Idempotent
    // by day, fail-soft. Not awaited-critical — never let capture delay or break the home-bar response.
    recordThought({ line, author: data.author, day: data.day }).catch(() => {});
    return json({
      line,
      author: data.author || null,
      day: data.day || null,
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
