// Thoughts Count — resolve one "possible duplicate" with a single tap.
// The import holds genuinely ambiguous name-matches as review candidates rather than
// guessing. Here the user answers the one plain-language question: same person (merge)
// or different (keep both). No fields, no data entry.

import { requireUser, serviceClient, json } from "./_supabase.mjs";
import { resolveCandidate } from "./_import.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const auth = await requireUser(req);
  if (auth.error) return json(auth.status, { error: auth.error });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }
  const candidateId = body?.candidate_id;
  const action = body?.action;
  const VALID = ["merge", "keep_both", "move_to_roster", "keep_personal"];
  if (!candidateId) return json(400, { error: "Missing candidate." });
  if (!VALID.includes(action)) return json(400, { error: "Invalid action." });

  try {
    const supa = serviceClient();
    const result = await resolveCandidate({ supa, userId: auth.userId, candidateId, action });
    if (!result.ok) return json(409, { error: result.error });
    return json(200, result);
  } catch (err) {
    console.error("review-resolve failed", err);
    return json(500, { error: "We couldn't resolve that just now. Please try again." });
  }
};
