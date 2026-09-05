// Thoughts Count — tiny authenticated "who am I" check for the browser.
// Given the caller's Supabase JWT (Authorization: Bearer <token>), returns two flags:
//   admin   — may see the internal analytics dashboard (shows the in-app link).
//   insider — you or JC. The client uses this to self-mark the browser as a test
//             session so insider traffic drops out of the real-visitor counts.
// The email allowlists stay server-side (never in the public client JS). The dashboard
// endpoint re-checks admin independently, so this is a UI hint, not the security boundary.

import { requireUser, isAdminEmail, json } from "./_supabase.mjs";
import { isTestEmail, logEvent } from "./_analytics.mjs";

export default async (req) => {
  const u = await requireUser(req);
  // Signed-out / invalid token → neither. Never an error the UI has to handle.
  if (u.error) return json(200, { admin: false, insider: false });
  const admin = isAdminEmail(u.email);
  const insider = admin || isTestEmail(u.email); // admins are insiders too

  // Server-verified insider exclusion (David 2026-09-05): the moment a session AUTHENTICATES as an
  // insider (you/JC), stamp its sid so the WHOLE session drops out of real-traffic metrics —
  // independent of the browser's tc_test flag (which can miss the first pre-detection page view).
  // The marker is logged test:false ON PURPOSE so it survives the analytics test/bot filter and
  // reaches computeSummary, where realVisitorStats/dailySeries remove every sid carrying insider.
  // The insider decision is made HERE from the verified JWT email, never trusted from the client.
  if (insider) {
    try {
      const sid = (new URL(req.url).searchParams.get("sid") || "").slice(0, 40);
      if (sid) await logEvent("session_identified", { sid, insider: true }, { test: false });
    } catch (e) { /* analytics must never break the UI hint */ }
  }
  return json(200, { admin, insider });
};
