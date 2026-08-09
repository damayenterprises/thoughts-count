// Thoughts Count — capture intake (TC-50, spec §5/§6). The typed door's first stop: take what
// the user typed, read it (extract), figure out who it's about (resolve), and either save it now
// with a glanceable, undoable confirm (Level A) or set it aside in To-Review (Level B). Nothing
// is ever silent, and an ambiguous person is NEVER guessed.
//
//   POST { rawText, lockedPersonId?, source? }
//   → { captures: [ { level, personId?, personName?, captureId?, factIds?, count, evidence } ] }
//
// lockedPersonId = context-lock (the add box lived on Maria's card): identity is certain, so we
// skip resolution entirely and every fact is Level A on that person.

import { requireUser, serviceClient, json } from "./_supabase.mjs";
import { extract, resolve, writeFactsToPerson, recognizableDetail } from "./_capture.mjs";

const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "them";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const auth = await requireUser(req);
  if (auth.error) return json(auth.status, { error: auth.error });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }
  const rawText = String(body?.rawText || "").trim();
  const lockedPersonId = body?.lockedPersonId || null;
  const source = ["voice", "scan", "email", "typed", "import", "conversation"].includes(body?.source) ? body.source : "typed";
  // Preview mode (voice front door, TC-61): extract + resolve WHO but write NOTHING —
  // return the proposed action so the caller can confirm before we save (voice's
  // confirm-before-save bar). The held pending capture is then written by capture-resolve.
  const preview = !!body?.preview;
  if (!rawText) return json(400, { error: "Type something worth remembering first." });

  const supa = serviceClient();
  const userId = auth.userId;

  try {
    // If a note is locked to a person, verify they exist BEFORE spending an extract call —
    // a bogus/foreign id then 404s deterministically without a wasted model round-trip.
    let lockedPerson = null;
    if (lockedPersonId) {
      lockedPerson = await getPerson(supa, userId, lockedPersonId);
      if (!lockedPerson) return json(404, { error: "We couldn't find that person." });
    }

    const parsed = await extract(rawText, { lockedPersonId });
    if (!parsed.facts.length) {
      return json(200, { captures: [], message: "Nothing to save there yet — try naming what happened or what you noticed." });
    }

    // ── Context-lock + preview: identity is certain (a note spoken on someone's card),
    // so return an "update" proposal for that person — write nothing until confirm. ──
    if (lockedPersonId && preview) {
      const person = lockedPerson;
      const cap = await insertCapture(supa, userId, {
        raw_text: rawText, source, status: "pending", context_locked: true,
        proposed_person_id: lockedPersonId, match_confidence: 1, match_evidence: `for ${person.name}`,
        parsed: { facts: parsed.facts, person_hint: person.name, candidates: [] },
      });
      return json(200, {
        captures: [{ preview: true, kind: "update", captureId: cap.id, personId: lockedPersonId, personName: person.name, facts: parsed.facts, candidates: [], count: parsed.facts.length }],
      });
    }

    // ── Context-lock: identity is certain, so every fact is Level A on that one person. ──
    if (lockedPersonId && !preview) {
      const person = lockedPerson;
      const { writtenIds: factIds, supersededIds } = await writeFactsToPerson(supa, userId, lockedPersonId, parsed.facts, source, rawText);
      const cap = await insertCapture(supa, userId, {
        raw_text: rawText, source, status: "confirmed", context_locked: true,
        proposed_person_id: lockedPersonId, match_confidence: 1, match_evidence: `saved to ${person.name}`,
        parsed: { facts: parsed.facts, written_fact_ids: factIds, superseded_fact_ids: supersededIds }, resolved_at: new Date().toISOString(),
      });
      return json(200, {
        captures: [{ level: "A", personId: lockedPersonId, personName: person.name, captureId: cap.id, factIds, count: factIds.length, evidence: `Saved to ${firstName(person.name)}` }],
      });
    }

    // ── Quick capture (default): resolve WHO before writing anything. ──
    const { groups } = await resolve(userId, parsed, supa);
    const results = [];
    for (const g of groups) {
      const r = g.resolution;

      // ── Preview: write nothing. Hold a pending capture + describe the proposed action
      // (add a new person / update an existing one / pick among look-alikes) so the voice
      // confirm card can show it. capture-resolve later writes it on confirm. ──
      if (preview) {
        const existing = r.level === "A" && r.proposedPersonId ? await getPerson(supa, userId, r.proposedPersonId) : null;
        const cap = await insertCapture(supa, userId, {
          raw_text: rawText, source, status: "pending", context_locked: false,
          proposed_person_id: existing ? existing.id : (r.proposedPersonId || null),
          match_confidence: r.confidence, match_evidence: r.evidence,
          parsed: { facts: g.facts, person_hint: g.personHint, location_hint: parsed.location_hint || "", candidates: r.candidates || [] },
        });
        const kind = existing ? "update" : ((r.candidates && r.candidates.length) ? "pick" : "add");
        // TC-89 refinement: when a spoken/typed name RESOLVED to an existing saved person, name
        // them back on the confirm card with a recognizable detail (relationship / location / most
        // recent fact) + a "someone else" escape, so a wrong-identity match ("a different Marc") is
        // caught before we write. hasDetail:false → the card uses the "the Marc you already have?"
        // fallback framing. Only fetched for the update (existing-person) case.
        let personDetail = "", personHasDetail = false;
        if (existing) {
          const d = await recognizableDetail(supa, userId, existing.id);
          personDetail = d.detail; personHasDetail = d.hasDetail;
        }
        results.push({
          preview: true, kind, captureId: cap.id,
          personId: existing ? existing.id : null,
          personName: existing ? existing.name : null,
          personDetail, personHasDetail,
          personHint: g.personHint || null,
          facts: g.facts, candidates: r.candidates || [], evidence: r.evidence, count: g.facts.length,
        });
        continue;
      }

      // Level A requires a still-live proposed person. resolvePerson already excludes tombstoned
      // people, but we re-check here (defense in depth) and fall through to To-Review if it's gone.
      const person = r.level === "A" && r.proposedPersonId ? await getPerson(supa, userId, r.proposedPersonId) : null;
      if (r.level === "A" && person) {
        const { writtenIds: factIds, supersededIds } = await writeFactsToPerson(supa, userId, person.id, g.facts, source, rawText);
        const cap = await insertCapture(supa, userId, {
          raw_text: rawText, source, status: "confirmed", context_locked: false,
          proposed_person_id: person.id, match_confidence: r.confidence, match_evidence: r.evidence,
          parsed: { facts: g.facts, person_hint: g.personHint, written_fact_ids: factIds, superseded_fact_ids: supersededIds }, resolved_at: new Date().toISOString(),
        });
        results.push({ level: "A", personId: person.id, personName: person.name, captureId: cap.id, factIds, count: factIds.length, evidence: `Saved to ${firstName(person.name)}` });
      } else {
        // Level B — hold it in To-Review. Nothing is written to a person yet. For an ambiguous
        // same-name capture we carry the candidate list so the user picks the right one (never a
        // defaulted guess).
        const cap = await insertCapture(supa, userId, {
          raw_text: rawText, source, status: "pending", context_locked: false,
          proposed_person_id: r.proposedPersonId || null, match_confidence: r.confidence, match_evidence: r.evidence,
          parsed: { facts: g.facts, person_hint: g.personHint, location_hint: parsed.location_hint || "", candidates: r.candidates || [] },
        });
        results.push({ level: "B", captureId: cap.id, personName: g.personHint || null, count: g.facts.length, evidence: r.evidence });
      }
    }
    return json(200, { captures: results });
  } catch (err) {
    console.error("capture-extract failed", err);
    return json(500, { error: err.message || "We couldn't save that just now. Please try again." });
  }
};

async function getPerson(supa, userId, personId) {
  const { data } = await supa.from("people").select("id, name").eq("user_id", userId).eq("id", personId).is("deleted_at", null).maybeSingle();
  return data || null;
}

async function insertCapture(supa, userId, row) {
  const { data, error } = await supa.from("captures").insert({ user_id: userId, ...row }).select("id, status, proposed_person_id, match_evidence, parsed").single();
  if (error) throw error;
  return data;
}
