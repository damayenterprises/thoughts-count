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
import { extract, resolve, writeFactsToPerson } from "./_capture.mjs";

const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "them";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const auth = await requireUser(req);
  if (auth.error) return json(auth.status, { error: auth.error });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }
  const rawText = String(body?.rawText || "").trim();
  const lockedPersonId = body?.lockedPersonId || null;
  const source = ["voice", "scan", "email", "typed", "import"].includes(body?.source) ? body.source : "typed";
  if (!rawText) return json(400, { error: "Type something worth remembering first." });

  const supa = serviceClient();
  const userId = auth.userId;

  try {
    const parsed = await extract(rawText, { lockedPersonId });
    if (!parsed.facts.length) {
      return json(200, { captures: [], message: "Nothing to save there yet — try naming what happened or what you noticed." });
    }

    // ── Context-lock: identity is certain, so every fact is Level A on that one person. ──
    if (lockedPersonId) {
      const person = await getPerson(supa, userId, lockedPersonId);
      if (!person) return json(404, { error: "We couldn't find that person." });
      const factIds = await writeFactsToPerson(supa, userId, lockedPersonId, parsed.facts, source, rawText);
      const cap = await insertCapture(supa, userId, {
        raw_text: rawText, source, status: "confirmed", context_locked: true,
        proposed_person_id: lockedPersonId, match_confidence: 1, match_evidence: `saved to ${person.name}`,
        parsed: { facts: parsed.facts, written_fact_ids: factIds }, resolved_at: new Date().toISOString(),
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
      if (r.level === "A" && r.proposedPersonId) {
        const person = await getPerson(supa, userId, r.proposedPersonId);
        const factIds = await writeFactsToPerson(supa, userId, r.proposedPersonId, g.facts, source, rawText);
        const cap = await insertCapture(supa, userId, {
          raw_text: rawText, source, status: "confirmed", context_locked: false,
          proposed_person_id: r.proposedPersonId, match_confidence: r.confidence, match_evidence: r.evidence,
          parsed: { facts: g.facts, person_hint: g.personHint, written_fact_ids: factIds }, resolved_at: new Date().toISOString(),
        });
        results.push({ level: "A", personId: r.proposedPersonId, personName: person?.name || g.personHint, captureId: cap.id, factIds, count: factIds.length, evidence: `Saved to ${firstName(person?.name || g.personHint)}` });
      } else {
        // Level B — hold it in To-Review. Nothing is written to a person yet.
        const cap = await insertCapture(supa, userId, {
          raw_text: rawText, source, status: "pending", context_locked: false,
          proposed_person_id: r.proposedPersonId || null, match_confidence: r.confidence, match_evidence: r.evidence,
          parsed: { facts: g.facts, person_hint: g.personHint, location_hint: parsed.location_hint || "" },
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
