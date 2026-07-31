// Thoughts Count — the memory engine (spec §3/§4). Server-side only; every call takes a
// service-role client plus a JWT-verified userId, and scopes every row to that user.
//
// This is the "temporal rules, not LLM-at-recall" layer:
//   • Deterministic supersession: a new fact sharing (person/household, subject, relation)
//     with a DIFFERENT value structurally retires the old one (closes valid_to, links
//     superseded_by). Same value → reinforce confidence, never duplicate.
//   • surface_until defaults by class — episodes fade from proactive nudges, durables never.
//   • A RECURRING/MILESTONE fact with an event_date seeds a key_date (the schedule layer),
//     linked by source_fact_id so it stays idempotent and cascades on delete.
//   • User hard-delete (deleted_at) is absolute and OVERRIDES system-retire (spec §4).
//
// Engine vocabulary (fact_class, confidence, salience, supersede) lives ONLY here and in
// the rows — spec principle 4 forbids it reaching any UI.

// How long an episode keeps surfacing in proactive nudges before it goes quiet (but stays
// in the timeline). The spec splits EPISODIC into health(~21d) and life(~90d); the enum is
// a single EPISODIC, so a caller (the Phase-2 extractor) may pass an explicit window; the
// default here is the longer, safer life window.
const SURFACE_DAYS = { EPISODIC: 90, MILESTONE: 14 };

const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

// The soft window past which an episode stops nudging. DURABLE/RECURRING/PREFERENCE never
// fade (null). A caller may override with an explicit surfaceUntil (already a YYYY-MM-DD) or
// a surfaceDays count (e.g. an extractor that knows this is a health episode → 21).
function surfaceUntilFor(factClass, eventDate, { surfaceUntil, surfaceDays } = {}) {
  if (surfaceUntil !== undefined) return surfaceUntil; // explicit caller value wins (incl. null)
  const days = surfaceDays != null ? surfaceDays : SURFACE_DAYS[factClass];
  if (days == null) return null;
  const base = eventDate ? new Date(eventDate + "T00:00:00") : new Date();
  base.setDate(base.getDate() + days);
  return ymd(base);
}

// Insert a fact, applying deterministic supersession. Returns { fact, superseded, reinforced,
// seededKeyDateId }.
//
// input: { personId? | householdId? (exactly one), subject, relation, object, factClass?,
//          source, provenance?, confidence?, eventDate?, rawText?, surfaceUntil?, surfaceDays?,
//          salienceBase?, keyDateLabel?, keyDateKind?, leadDays? }
export async function insertFact(supa, userId, input) {
  const personId = input.personId || null;
  const householdId = input.householdId || null;
  if (!!personId === !!householdId) throw new Error("insertFact: attach to exactly one of personId or householdId");
  const subject = String(input.subject || "").trim();
  const relation = String(input.relation || "").trim();
  const object = String(input.object || "").trim();
  if (!subject || !relation || !object) throw new Error("insertFact: subject, relation and object are required");
  if (!input.source) throw new Error("insertFact: a source is required (no fact is stored without provenance)");

  const factClass = input.factClass || "DURABLE";
  const confidence = input.confidence != null ? input.confidence : 1.0;

  // Find the current OPEN fact on the same (owner-object, subject, relation), if any.
  const scopeCol = personId ? "person_id" : "household_id";
  const scopeVal = personId || householdId;
  const { data: openRows, error: selErr } = await supa
    .from("facts")
    .select("id, object, confidence")
    .eq("user_id", userId)
    .eq(scopeCol, scopeVal)
    .eq("subject", subject)
    .eq("relation", relation)
    .is("valid_to", null)
    .is("deleted_at", null);
  if (selErr) throw selErr;
  const existing = (openRows || [])[0] || null;

  // Same value already on file → reinforce confidence, don't duplicate (spec §3).
  if (existing && norm(existing.object) === norm(object)) {
    const bumped = Math.min(1, (existing.confidence || 0) + 0.05);
    const { data: upd, error } = await supa
      .from("facts").update({ confidence: bumped }).eq("id", existing.id).eq("user_id", userId).select().single();
    if (error) throw error;
    return { fact: upd, superseded: false, reinforced: true, seededKeyDateId: null };
  }

  const surface_until = surfaceUntilFor(factClass, input.eventDate || null, input);
  const { data: fact, error: insErr } = await supa
    .from("facts")
    .insert({
      user_id: userId,
      person_id: personId,
      household_id: householdId,
      subject, relation, object,
      fact_class: factClass,
      raw_text: input.rawText || null,
      source: input.source,
      provenance: input.provenance || "user_stated",
      confidence,
      event_date: input.eventDate || null,
      surface_until,
      salience_base: input.salienceBase != null ? input.salienceBase : 1.0,
    })
    .select().single();
  if (insErr) throw insErr;

  // Retire the prior value: close it and link forward. It stays in the timeline (visible in
  // history) but never appears in active reads or nudges again.
  let superseded = false;
  if (existing) {
    const { error } = await supa
      .from("facts")
      .update({ valid_to: new Date().toISOString(), superseded_by: fact.id })
      .eq("id", existing.id).eq("user_id", userId);
    if (error) throw error;
    superseded = true;
  }

  // A dated RECURRING/MILESTONE fact seeds a key_date (the reminder schedule layer).
  const seededKeyDateId = await maybeSeedKeyDate(supa, userId, fact, input);

  return { fact, superseded, reinforced: false, seededKeyDateId };
}

// Seed a key_date from a fact, once. Idempotent on source_fact_id. Only RECURRING/MILESTONE
// facts that carry an event_date and hang on a person become a schedulable date.
async function maybeSeedKeyDate(supa, userId, fact, input) {
  if (!fact.person_id) return null;                          // household dates: out of scope here
  if (!fact.event_date) return null;
  if (fact.fact_class !== "RECURRING" && fact.fact_class !== "MILESTONE") return null;

  const { data: already } = await supa
    .from("key_dates").select("id").eq("user_id", userId).eq("source_fact_id", fact.id).maybeSingle();
  if (already) return already.id;

  const recurs = fact.fact_class === "RECURRING";
  let label = (input.keyDateLabel || fact.object || "A date to remember").trim();
  const chars = Array.from(label);
  if (chars.length > 70) label = chars.slice(0, 67).join("").trimEnd() + "…";
  const kind = input.keyDateKind || (recurs ? "custom" : "moment");
  const lead_days = input.leadDays != null ? input.leadDays : 7;

  const { data: kd, error } = await supa
    .from("key_dates")
    .insert({ user_id: userId, person_id: fact.person_id, label, kind, event_date: fact.event_date, recurs, lead_days, source_fact_id: fact.id })
    .select("id").single();
  if (error) throw error;
  return kd.id;
}

// Correct a fact in place (fix a name/typo). A correction is NOT a supersession — it edits
// the existing value rather than retiring it. Scoped to the owner and to live rows.
export async function updateFact(supa, userId, factId, patch) {
  const fields = {};
  if (patch.object != null) fields.object = String(patch.object).trim();
  if (patch.subject != null) fields.subject = String(patch.subject).trim();
  if (patch.relation != null) fields.relation = String(patch.relation).trim();
  if (patch.eventDate !== undefined) fields.event_date = patch.eventDate || null;
  if (!Object.keys(fields).length) throw new Error("updateFact: nothing to update");
  const { data, error } = await supa
    .from("facts").update(fields)
    .eq("id", factId).eq("user_id", userId).is("deleted_at", null)
    .select().single();
  if (error) throw error;
  return data;
}

// User hard-delete of a single fact (spec §4). Absolute: sets deleted_at (excluded from
// every read and nudge) and removes any key_date this fact seeded, so the reminder stops too.
export async function deleteFact(supa, userId, factId) {
  const { error: kdErr } = await supa
    .from("key_dates").delete().eq("user_id", userId).eq("source_fact_id", factId);
  if (kdErr) throw kdErr;
  const { error } = await supa
    .from("facts").update({ deleted_at: new Date().toISOString() })
    .eq("id", factId).eq("user_id", userId);
  if (error) throw error;
  return { ok: true };
}

// User hard-delete of a whole person (spec §4). Tombstones the person (deleted_at) so every
// read and nudge excludes them; their facts/dates ride along hidden and get purged on the
// normal backup cycle. Overrides any system-retire hygiene.
export async function deletePerson(supa, userId, personId) {
  const { error } = await supa
    .from("people").update({ deleted_at: new Date().toISOString() })
    .eq("id", personId).eq("user_id", userId);
  if (error) throw error;
  return { ok: true };
}
