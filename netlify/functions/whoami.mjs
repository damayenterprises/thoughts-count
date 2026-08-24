// Thoughts Count — tiny authenticated "who am I" check for the browser.
// Given the caller's Supabase JWT (Authorization: Bearer <token>), returns two flags:
//   admin   — may see the internal analytics dashboard (shows the in-app link).
//   insider — you or JC. The client uses this to self-mark the browser as a test
//             session so insider traffic drops out of the real-visitor counts.
// The email allowlists stay server-side (never in the public client JS). The dashboard
// endpoint re-checks admin independently, so this is a UI hint, not the security boundary.

import { requireUser, isAdminEmail, json } from "./_supabase.mjs";
import { isTestEmail } from "./_analytics.mjs";

export default async (req) => {
  const u = await requireUser(req);
  // Signed-out / invalid token → neither. Never an error the UI has to handle.
  if (u.error) return json(200, { admin: false, insider: false });
  const admin = isAdminEmail(u.email);
  const insider = admin || isTestEmail(u.email); // admins are insiders too
  return json(200, { admin, insider });
};
