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
import { writeFactsToPerson } from "./_capture.mjs";
import { deleteFact, reopenFact } from "./_memory.mjs";

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
          personId = await createPerson(supa, userId, name, body?.contactKind);
        }

        const { writtenIds: factIds, supersededIds } = await writeFactsToPerson(supa, userId, personId, facts, cap.source || "typed", cap.raw_text || "");
        await supa.from("captures").update({
          status: "confirmed",
          proposed_person_id: personId,
          parsed: { ...(cap.parsed || {}), written_fact_ids: factIds, superseded_fact_ids: supersededIds },
          resolved_at: new Date().toISOString(),
        }).eq("user_id", userId).eq("id", captureId);

        const person = await getPerson(supa, userId, personId);
        return json(200, { ok: true, status: "confirmed", personId, personName: person?.name || null, factIds, count: factIds.length, message: `Saved to ${firstName(person?.name)}` });
      }

      default:
        return json(400, { error: "Unknown action." });
    }
  } catch (err) {
    console.error("capture-resolve failed", action, err);
    return json(500, { error: err.message || "We couldn't do that just now. Please try again." });
  }
};

async function getPerson(supa, userId, personId) {
  const { data } = await supa.from("people").select("id, name").eq("user_id", userId).eq("id", personId).is("deleted_at", null).maybeSingle();
  return data || null;
}

// Create a person the user just confirmed adding from a capture. contact_kind mirrors where the
// capture came from: 'contact' (book of business / roster) or 'personal' (the intimate circle).
async function createPerson(supa, userId, name, contactKind) {
  const kind = contactKind === "contact" ? "contact" : "personal";
  const { data, error } = await supa.from("people").insert({ user_id: userId, name, contact_kind: kind }).select("id").single();
  if (error) throw error;
  return data.id;
}
