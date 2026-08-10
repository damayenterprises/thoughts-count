// Thoughts Count — resolve a bare NAME against the signed-in user's people, writing NOTHING
// (TC-89). Two callers, one job — "does this name already belong to someone I've saved?":
//
//   • T2 re-check-after-edit: when a user fixes the name on a voice confirm card, we re-run
//     resolution on the corrected spelling. If it now matches a saved person, the card offers
//     "that matches your saved Candace — same person?" (attach) instead of silently creating a dup.
//   • T4 say-a-name front door: the user says a name to start a note about an existing person;
//     we resolve the spoken (roster-biased) name to lock onto the right person, or offer the
//     small pick list / offer to add them.
//
//   POST { name }  → { kind: 'match' | 'ambiguous' | 'none', person?, candidates?, evidence }
//
// This is a READ-ONLY resolver: it reuses the SAME deterministic engine as capture (resolvePerson
// → _names.mjs) so its verdict matches what a real capture would do — no new matching logic, no
// writes, no pending capture created. Requires auth (you must HAVE people to match against).

import { requireUser, serviceClient, json } from "./_supabase.mjs";
import { resolveNameShaped } from "./_capture.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const auth = await requireUser(req);
  if (auth.error) return json(auth.status, { error: auth.error });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }
  const name = String(body?.name || "").trim();
  if (!name) return json(400, { error: "No name to look up." });

  try {
    // TC-93: the resolve verdict + the confirm/pick shape now live in ONE shared function
    // (resolveNameShaped in _capture.mjs) that this endpoint AND the converse `resolve_person`
    // tool both call, so their behavior can never drift. It runs the SAME deterministic engine
    // (resolvePerson → _names.mjs) with the voice/typed first-name fallback opted in, enriches each
    // result with a recognizable detail, and writes NOTHING (read-only; the confirm-WHO UI + the
    // authenticated capture-resolve remain the only write path — never a silent attach).
    const shaped = await resolveNameShaped(serviceClient(), auth.userId, name);
    return json(200, shaped);
  } catch (err) {
    console.error("resolve-name failed", err);
    return json(500, { error: err.message || "We couldn't look that up just now." });
  }
};
