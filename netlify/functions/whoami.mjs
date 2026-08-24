// Thoughts Count — tiny authenticated "who am I" check for the browser.
// Given the caller's Supabase JWT (Authorization: Bearer <token>), returns whether
// they're an admin. Used by the companion UI to decide whether to show the in-app
// "Admin dashboard" link — the admin email allowlist stays server-side (never in the
// public client JS). The dashboard endpoint enforces the same gate independently, so
// this is a UI hint only, not the security boundary.

import { requireAdmin, json } from "./_supabase.mjs";

export default async (req) => {
  const admin = await requireAdmin(req);
  // Non-admins (and signed-out callers) simply aren't admins — never an error the UI has
  // to handle. A real misconfig (503) still reports admin:false so the link stays hidden.
  return json(200, { admin: !admin.error });
};
