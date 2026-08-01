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
// Relation key for the single-valued check: lowercase, and treat spaces/hyphens as underscores
// so "health status" / "health-status" / "health_status" all match.
const normRel = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/[\s-]+/g, "_");

// Relations that hold ONE current value per subject — a new value legitimately replaces (retires)
// the old one (spec §3 supersession: "sick" → "recovered", "moved to Denver"). EVERYTHING NOT in
// this set is treated as multi-valued and is APPENDED, never allowed to erase a sibling — the
// direct fix for "a second hobby/allergy silently wiped the first" (bias to split, principle 7).
// Kept deliberately tight: when unsure whether an attribute is single-valued, leave it out.
const SINGLE_VALUED_RELATIONS = new Set([
  // one current health/medical status
  "health_status", "health", "medical_status",
  // one current job / employer
  "job", "occupation", "employer", "employment", "workplace", "current_job",
  // one current place they live
  "location", "home", "hometown", "residence", "address", "city", "lives_in", "based_in",
  // one current relationship status
  "marital_status", "relationship_status",
  // one birthday
  "birthday", "date_of_birth", "dob",
]);
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

  // Reinforce vs supersede — two DIFFERENT behaviors, and keeping them apart is a trust rule:
  //   • Reinforce: saving the SAME value again just bumps confidence — never a duplicate row.
  //     Applies to every structured relation (all except free-form notes), so repeats never pile
  //     up even for multi-valued categories.
  //   • Supersede: a NEW value on the same (subject, relation) retires the old one ONLY when the
  //     relation is genuinely SINGLE-VALUED (one current job / city / health status / marital
  //     status). Multi-valued categories — hobby, allergy, interest, preference, food, pet, note,
  //     and any relation we don't explicitly recognize — NEVER retire a sibling: a person can
  //     love hiking AND tennis, be allergic to shellfish AND peanuts. Silently erasing one of
  //     those is exactly the data loss the trust contract forbids (spec principle 7 — bias to
  //     split, never auto-merge/erase). When in doubt, keep both.
  const canSupersede = relation !== "note" && SINGLE_VALUED_RELATIONS.has(normRel(relation));
  const scopeCol = personId ? "person_id" : "household_id";
  const scopeVal = personId || householdId;

  let sameValue = null;
  const priorValues = []; // different-valued open facts on this (subject, relation) — retired ONLY if single-valued
  if (relation !== "note") {
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
    for (const r of openRows || []) {
      if (norm(r.object) === norm(object)) sameValue = r;
      else priorValues.push(r);
    }
  }

  // Same value already on file → reinforce confidence, don't duplicate (spec §3). This runs for
  // every category, so re-saving "loves hiking" or "allergic to shellfish" never dupes it.
  if (sameValue) {
    const bumped = Math.min(1, (sameValue.confidence || 0) + 0.05);
    const { data: upd, error } = await supa
      .from("facts").update({ confidence: bumped }).eq("id", sameValue.id).eq("user_id", userId).select().single();
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

  // Retire the prior value(s) ONLY for single-valued attributes — close them and link forward.
  // They stay in the timeline (visible in history) but never appear in active reads or nudges
  // again. Multi-valued categories skip this entirely, so siblings are always kept.
  let superseded = false;
  if (canSupersede && priorValues.length) {
    const now = new Date().toISOString();
    const { error } = await supa
      .from("facts")
      .update({ valid_to: now, superseded_by: fact.id })
      .eq("user_id", userId)
      .in("id", priorValues.map((r) => r.id));
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
