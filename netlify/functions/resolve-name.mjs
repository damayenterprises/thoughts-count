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
import { resolvePerson, recognizableDetail } from "./_capture.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const auth = await requireUser(req);
  if (auth.error) return json(auth.status, { error: auth.error });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }
  const name = String(body?.name || "").trim();
  if (!name) return json(400, { error: "No name to look up." });

  const supa = serviceClient();
  const userId = auth.userId;

  try {
    // TC-91: voice/typed name resolution — opt into the first-name fallback so a bare spoken first
    // name ("Jon") surfaces an existing fuller-named saved person ("John Miller") as a confirm/pick
    // candidate the trigram RPC alone would miss. Still read-only; still never a silent attach.
    const r = await resolvePerson(supa, userId, name, { fallbackFirstName: true });

    // A single confident match (Level A + a proposed person). Enrich with the saved person's
    // canonical name AND a recognizable detail (relationship / location / most recent fact) so the
    // caller can say "Marc — your friend in Denver?" and the user can catch a wrong-identity match
    // BEFORE any note is written. `hasDetail:false` tells the caller to fall back to the clear
    // "the <Name> you already have?" framing rather than a bare name (TC-89 refinement).
    // A single match to confirm: either a confident RPC match (Level A) OR a single TC-91 first-name
    // fallback hit (Level B + fallback flag — a homophone guess like "Jon"→saved "John Miller"). Both
    // render the same confirm-WHO "same person?" card; NEITHER writes anything here (read-only) and the
    // fallback still requires the user to confirm before capture-resolve attaches — never a silent write.
    if (r.proposedPersonId && (r.level === "A" || r.fallback)) {
      const person = await getPerson(supa, userId, r.proposedPersonId);
      if (person) {
        const { detail, hasDetail } = await recognizableDetail(supa, userId, person.id);
        return json(200, { kind: "match", person: { id: person.id, name: person.name, detail, hasDetail }, evidence: r.evidence || "" });
      }
      // Proposed person vanished (tombstoned between reads) → treat as no match.
    }

    // Several same-name people, nothing to tell them apart → let the user pick (never a guess).
    // Attach a recognizable detail per candidate so the pick list distinguishes real humans, not
    // just repeats the same name on every button.
    if (Array.isArray(r.candidates) && r.candidates.length) {
      const candidates = await Promise.all(
        r.candidates.map(async (c) => {
          const { detail, hasDetail } = await recognizableDetail(supa, userId, c.id);
          return { id: c.id, name: c.name, location: c.location || "", detail, hasDetail };
        })
      );
      return json(200, { kind: "ambiguous", candidates, evidence: r.evidence || "" });
    }

    // No saved person matches this name.
    return json(200, { kind: "none", evidence: r.evidence || "" });
  } catch (err) {
    console.error("resolve-name failed", err);
    return json(500, { error: err.message || "We couldn't look that up just now." });
  }
};

async function getPerson(supa, userId, personId) {
  const { data } = await supa.from("people").select("id, name").eq("user_id", userId).eq("id", personId).is("deleted_at", null).maybeSingle();
  return data || null;
}
