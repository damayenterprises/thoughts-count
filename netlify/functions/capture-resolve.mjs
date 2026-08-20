// Thoughts Count — resolve a capture from the To-Review surface (TC-50, spec §6). The user's
// one-tap verdict on a pending item: confirm it (to the proposed person, a reassigned person, or
// a brand-new person), or discard it. Also powers Undo on a just-saved Level-A capture.
//
//   POST { captureId, action: 'confirm' | 'reassign' | 'discard' | 'undo', personId?, newPersonName?, contactKind? }
//
// Guarantees:
//   • Nothing is written to a person until the user confirms (Level B held nothing).
//   • Re-confirm is idempotent — a confirmed capture never writes its facts twice.
//   • Reassign attaches to whoever the user picked (bias-to-split: the engine never merges).

import { requireUser, serviceClient, json } from "./_supabase.mjs";
import { writeFactsToPerson, normalizeReminders } from "./_capture.mjs";
import { deleteFact, reopenFact } from "./_memory.mjs";
import { splitNameRelationship, normalizeRelationshipWord } from "./_names.mjs";

const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "them";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const auth = await requireUser(req);
  if (auth.error) return json(auth.status, { error: auth.error });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }
  const captureId = body?.captureId;
  const action = body?.action;
  if (!captureId) return json(400, { error: "Missing capture." });

  const supa = serviceClient();
  const userId = auth.userId;

  try {
    const { data: cap } = await supa
      .from("captures")
      .select("id, status, source, raw_text, proposed_person_id, parsed, context_locked")
      .eq("user_id", userId).eq("id", captureId).maybeSingle();
    if (!cap) return json(404, { error: "That item was already handled." });

    const facts = Array.isArray(cap.parsed?.facts) ? cap.parsed.facts : [];

    switch (action) {
      case "discard": {
        if (cap.status === "pending") {
          await supa.from("captures").update({ status: "discarded", resolved_at: new Date().toISOString() }).eq("user_id", userId).eq("id", captureId);
        }
        return json(200, { ok: true, status: "discarded" });
      }

      case "undo": {
        // Undo a Level-A save: remove the facts it wrote AND restore any single-valued prior value
        // it retired — otherwise "Undo" would leave the person with neither the new nor the old
        // value (silent data loss). Idempotent.
        if (cap.status === "confirmed") {
          const ids = Array.isArray(cap.parsed?.written_fact_ids) ? cap.parsed.written_fact_ids : [];
          for (const fid of ids) { try { await deleteFact(supa, userId, fid); } catch (e) { console.error("undo delete fact", e); } }
          const retired = Array.isArray(cap.parsed?.superseded_fact_ids) ? cap.parsed.superseded_fact_ids : [];
          for (const fid of retired) { try { await reopenFact(supa, userId, fid); } catch (e) { console.error("undo reopen fact", e); } }
          await supa.from("captures").update({ status: "discarded", resolved_at: new Date().toISOString() }).eq("user_id", userId).eq("id", captureId);
        }
        return json(200, { ok: true, status: "discarded" });
      }

      case "confirm":
      case "reassign": {
        // Idempotency: a capture that was already confirmed must not write its facts again.
        if (cap.status === "confirmed") {
          return json(200, { ok: true, status: "confirmed", personId: cap.proposed_person_id, factIds: cap.parsed?.written_fact_ids || [], alreadyConfirmed: true });
        }
        if (cap.status === "discarded") return json(200, { ok: true, status: "discarded", noop: true });

        // Decide the target person: an explicit pick (reassign / a chosen candidate) wins, else the
        // engine's proposal, else create the named new person. An EXISTING target must still be
        // live — a person can be removed between capture and confirm; never write to a tombstone.
        let personId = null;
        if (body?.personId) {
          if (!(await getPerson(supa, userId, body.personId))) return json(404, { error: "We couldn't find that person." });
          personId = body.personId;
        } else if (cap.proposed_person_id) {
          if (!(await getPerson(supa, userId, cap.proposed_person_id))) return json(409, { error: "That person was removed — assign this to someone else." });
          personId = cap.proposed_person_id;
        } else {
          const name = String(body?.newPersonName || cap.parsed?.person_hint || "").trim();
          if (!name) return json(400, { error: "Choose who this is about." });
          // TC-136 follow-up: the relationship the extractor captured for this named person ("my
          // neighbor Dave" → "neighbor"), held on the capture. Passed so createPerson sets it on the
          // NEW person. Only used when the user didn't type a fresh name (an explicit newPersonName is
          // a deliberate rename and carries no relationship of its own).
          const relHint = body?.newPersonName ? "" : String(cap.parsed?.person_relationship || "").trim();
          personId = await createPerson(supa, userId, name, body?.contactKind, relHint);
        }

        // TC-109: persist any detected email/phone into `identifiers` so a later import of the same
        // contact resolves by strong key (an UPDATE), not a duplicate. Idempotent on the table's
        // unique (user_id, type, value). Best-effort — a failed identifier write never blocks the save.
        await writeIdentifiers(supa, userId, personId, cap.parsed?.identifiers);

        // TC capture-loop (§4.2, seam 1): honor the user's EDITED reminder set from the confirm card.
        // The confirm card lets the user add/remove nudge chips before saving; when the body carries a
        // `reminders` array it is AUTHORITATIVE — override the reminders on every event-bearing fact so
        // the auto-seed (writeFactsToPerson→insertFact→seedSituation) persists EXACTLY that set,
        // removals included. Absent body.reminders ⇒ keep whatever the capture already carried (no
        // change). An empty array is a deliberate "no nudges" and clears them (never an auto-cadence).
        const factsToWrite = applyEditedReminders(facts, body?.reminders);

        const { writtenIds: factIds, supersededIds, writtenFacts } = await writeFactsToPerson(supa, userId, personId, factsToWrite, cap.source || "typed", cap.raw_text || "");

        // TC capture-loop (§4.3, seam 2): the situation's key_date was auto-seeded by insertFact for the
        // event-bearing fact that carried reminders. Echo its id so the confirm card's client can attach
        // any FURTHER chip edits to the right situation without a re-resolve. Best-effort read — a null
        // (no dated/reminder fact, or pre-migration) is fine and never blocks the save.
        const situationKeyDateId = await situationKeyDateFor(supa, userId, writtenFacts);

        await supa.from("captures").update({
          status: "confirmed",
          proposed_person_id: personId,
          parsed: { ...(cap.parsed || {}), written_fact_ids: factIds, superseded_fact_ids: supersededIds },
          resolved_at: new Date().toISOString(),
        }).eq("user_id", userId).eq("id", captureId);

        const person = await getPerson(supa, userId, personId);
        return json(200, { ok: true, status: "confirmed", personId, personName: person?.name || null, factIds, count: factIds.length, situationKeyDateId, message: `Saved to ${firstName(person?.name)}` });
      }

      default:
        return json(400, { error: "Unknown action." });
    }
  } catch (err) {
    console.error("capture-resolve failed", action, err);
    return json(500, { error: err.message || "We couldn't do that just now. Please try again." });
  }
};

// TC-109: write the confirmed person's email/phone identifiers so strong-key dedup can catch a
// future re-import. Mirrors the identifiers schema (user_id, person_id, type, value) with its unique
// (user_id, type, value) — we upsert with ignoreDuplicates so a value already tied to this (or
// another) person never errors or moves. Values are stored as the extractor emitted them, matching
// what resolvePerson()'s strongKeyMatch compares against. Best-effort; never throws to the caller.
async function writeIdentifiers(supa, userId, personId, identifiers) {
  const list = Array.isArray(identifiers) ? identifiers : [];
  const rows = [];
  const seen = new Set();
  for (const id of list) {
    const type = id?.type === "phone" ? "phone" : id?.type === "email" ? "email" : null;
    const value = String(id?.value || "").trim();
    if (!type || !value) continue;
    const key = `${type} ${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ user_id: userId, person_id: personId, type, value });
  }
  if (!rows.length) return;
  try {
    const { error } = await supa
      .from("identifiers")
      .upsert(rows, { onConflict: "user_id,type,value", ignoreDuplicates: true });
    if (error) console.error("writeIdentifiers", error);
  } catch (e) { console.error("writeIdentifiers", e); }
}

// TC capture-loop (seam 1): apply the confirm card's EDITED reminder set to the facts about to be
// written. The user edits nudges on the event-bearing fact(s) (a situation carries a real date to
// lead from); we override THEIR reminders so the auto-seed persists exactly the edited list —
// including removals (an empty edited set clears the nudges). Undated facts never carry reminders, so
// they're untouched. Returns a shallow copy; never mutates the caller's array. When body.reminders is
// absent (undefined) we return the facts unchanged (the capture keeps whatever it already had).
function applyEditedReminders(facts, edited) {
  if (!Array.isArray(edited)) return facts;
  const clean = normalizeReminders(edited); // trusts only well-formed user-set offsets (never fabricates)
  return (facts || []).map((f) => (f && f.event_date ? { ...f, reminders: clean } : f));
}

// TC capture-loop (seam 2): find the situation's key_date id after a write. insertFact seeds a
// key_date (idempotent on source_fact_id) for the event-bearing fact that carried reminders; we read
// it back by source_fact_id so the client can attach further chip edits. Prefers a dated fact that
// carried reminders; returns null when there's no such date (or the table isn't seeded). Best-effort.
async function situationKeyDateFor(supa, userId, writtenFacts) {
  const list = Array.isArray(writtenFacts) ? writtenFacts : [];
  // The fact a situation hangs off of: it has both a real event_date and user-set reminders.
  const target =
    list.find((f) => f?.id && f?.event_date && Array.isArray(f.reminders) && f.reminders.length) ||
    list.find((f) => f?.id && f?.event_date) ||
    null;
  if (!target) return null;
  try {
    const { data } = await supa
      .from("key_dates").select("id").eq("user_id", userId).eq("source_fact_id", target.id).maybeSingle();
    return data?.id || null;
  } catch (e) { console.error("situationKeyDateFor", e); return null; }
}

async function getPerson(supa, userId, personId) {
  const { data } = await supa.from("people").select("id, name").eq("user_id", userId).eq("id", personId).is("deleted_at", null).maybeSingle();
  return data || null;
}

// Create a person the user just confirmed adding from a capture. contact_kind mirrors where the
// capture came from: 'contact' (book of business / roster) or 'personal' (the intimate circle).
//
// TC-136 follow-up: relationship is now captured at EXTRACTION ("my neighbor Dave" → person_hint
// "Dave" + person_relationship "neighbor"), so createPerson sets people.relationship from that clean
// `relHint` (already validated to the known vocabulary by normalizeRelationshipWord; re-validated
// here as a belt). splitNameRelationship stays as the BELT-AND-SUSPENDERS FALLBACK for the older
// shape where the model lumped the descriptor into the name ("my neighbor Tom" → "Tom, neighbor" or
// "neighbor Tom"): it peels a CLEAR leading "my/the <rel> <Name>" or trailing "<Name>, <rel>" so
// people.name is the proper name. Conservative throughout: a bare ambiguous name (no "my", no comma,
// no stated relationship — e.g. "Uncle Bob", "Sarah") is left exactly as-is with NO relationship, and
// the split fallback ONLY runs when the extracted relHint is empty (never overrides what was captured).
export async function createPerson(supa, userId, name, contactKind, relHint) {
  const kind = contactKind === "contact" ? "contact" : "personal";
  const { name: cleanName, relationship: splitRel } = splitNameRelationship(name);
  // Prefer the relationship the extractor captured; fall back to a name-embedded descriptor only when
  // that's empty. Both are conservative + validated, so we never invent one from a bare proper name.
  const relationship = normalizeRelationshipWord(relHint) || splitRel;
  const row = { user_id: userId, name: cleanName || name, contact_kind: kind };
  if (relationship) row.relationship = relationship;
  const { data, error } = await supa.from("people").insert(row).select("id").single();
  if (error) throw error;
  return data.id;
}
