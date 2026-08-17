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
//          salienceBase?, keyDateLabel?, keyDateKind?, leadDays?,
//          reminders?:[{lead_days:int,label?:string}], forceRecurs? }  // reminders → seed a situation (§4.3)
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
    return { fact: upd, superseded: false, supersededIds: [], reinforced: true, seededKeyDateId: null };
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
  // again. Multi-valued categories skip this entirely, so siblings are always kept. We RETURN the
  // ids we closed so an Undo of this capture can reopen them (else Undo would leave the person
  // with neither the new nor the prior value — silent data loss).
  let superseded = false;
  let supersededIds = [];
  if (canSupersede && priorValues.length) {
    supersededIds = priorValues.map((r) => r.id);
    const now = new Date().toISOString();
    const { error } = await supa
      .from("facts")
      .update({ valid_to: now, superseded_by: fact.id })
      .eq("user_id", userId)
      .in("id", supersededIds);
    if (error) throw error;
    superseded = true;
  }

  // A dated RECURRING/MILESTONE fact seeds a key_date (the reminder schedule layer). When the
  // capture carried user-set reminders (the "Tell Della, she remembers" loop), seed the situation
  // + its N reminders instead — seedSituation reuses maybeSeedKeyDate for the key_date and mints the
  // children (spec §4.3). No reminders ⇒ identical to the plain seed below (no auto-cadence).
  const reminders = Array.isArray(input.reminders) ? input.reminders : [];
  let seededKeyDateId, seededReminderIds = [];
  if (reminders.length) {
    const seeded = await seedSituation(supa, userId, fact, {
      reminders,
      label: input.keyDateLabel,
      recurs: input.forceRecurs,
    });
    seededKeyDateId = seeded.keyDateId;
    seededReminderIds = seeded.reminderIds;
  } else {
    seededKeyDateId = await maybeSeedKeyDate(supa, userId, fact, input);
  }

  return { fact, superseded, supersededIds, reinforced: false, seededKeyDateId, seededReminderIds };
}

// Seed a key_date from a fact, once. Idempotent on source_fact_id. Only RECURRING/MILESTONE
// facts that carry an event_date and hang on a person become a schedulable date.
async function maybeSeedKeyDate(supa, userId, fact, input) {
  if (!fact.person_id) return null;                          // household dates: out of scope here
  if (!fact.event_date) return null;
  // A situation (user set reminders on it) is a schedulable date whatever its fact_class — the
  // reminders ARE the intent. Otherwise, only RECURRING/MILESTONE facts become key_dates (as today).
  const isSituation = input.keyDateKind === "situation";
  if (!isSituation && fact.fact_class !== "RECURRING" && fact.fact_class !== "MILESTONE") return null;

  const { data: already } = await supa
    .from("key_dates").select("id").eq("user_id", userId).eq("source_fact_id", fact.id).maybeSingle();
  if (already) return already.id;

  const recurs = input.forceRecurs !== undefined ? !!input.forceRecurs : fact.fact_class === "RECURRING";
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

// seedSituation — the "Tell Della, she remembers" seed helper (spec §4.3). A situation is a rich
// key_date (kind='situation' when reminders are set) linked to the fact that carries its context,
// with N situation_reminders children — many custom-timed reminders per date. Strictly additive:
//   • With reminders → seed/upgrade the key_date to kind='situation' and mint the reminders.
//   • Without reminders → identical to today's maybeSeedKeyDate (a plain dated key_date), so a note
//     with an event_date but NO user-set timing NEVER grows a reminder (della-situational-no-formula).
//
// Idempotent on BOTH axes:
//   • the key_date is idempotent on source_fact_id (maybeSeedKeyDate already is), and
//   • each reminder is idempotent on (key_date_id, lead_days) so a re-confirm never dupes.
//
// Degrades gracefully: if situation_reminders doesn't exist yet (pre-migration), the reminder
// inserts fail softly and we return the key_date with an empty reminderIds — legacy behavior, so
// the branch is safe to preview before the migration is applied.
//
//   seedSituation(supa, userId, fact, { reminders:[{lead_days:int,label?:string}], label?, recurs? })
//     → { keyDateId, reminderIds }
export async function seedSituation(supa, userId, fact, { reminders, label, recurs } = {}) {
  const list = Array.isArray(reminders) ? reminders : [];

  // 1) Seed (or find) the underlying key_date. When reminders are present the situation kind is
  //    authoritative; carry the caller's label through. recurs override lets a caller mark a
  //    recurring situation even off a MILESTONE-classed fact (default = the fact's own recurrence).
  const seedInput = {};
  if (label) seedInput.keyDateLabel = label;
  if (list.length) seedInput.keyDateKind = "situation";
  if (recurs !== undefined) seedInput.forceRecurs = recurs;
  const keyDateId = await maybeSeedKeyDate(supa, userId, fact, seedInput);
  if (!keyDateId) return { keyDateId: null, reminderIds: [] };

  if (!list.length) return { keyDateId, reminderIds: [] };

  // 2) Mint the reminders, idempotent on (key_date_id, lead_days). Read existing offsets first so a
  //    re-confirm of the same situation never duplicates a reminder. Dedup the incoming list on
  //    lead_days too (the user can't have two reminders at the same offset).
  const reminderIds = [];
  try {
    const { data: existing, error: exErr } = await supa
      .from("situation_reminders")
      .select("id, lead_days")
      .eq("user_id", userId)
      .eq("key_date_id", keyDateId);
    if (exErr) throw exErr;

    const byLead = new Map();
    for (const r of existing || []) byLead.set(Number(r.lead_days), r.id);

    const seenIncoming = new Set();
    for (const r of list) {
      const lead = Number(r?.lead_days);
      if (!Number.isFinite(lead)) continue;                 // never seed a reminder without a real offset
      if (seenIncoming.has(lead)) continue;
      seenIncoming.add(lead);
      if (byLead.has(lead)) { reminderIds.push(byLead.get(lead)); continue; }  // already present → reuse
      // TC capture-loop (seam 5): preserve the USER'S OWN phrasing on the persisted reminder. The
      // capture path carries the timing as `phrase` ("a week before her birthday"); use it as the
      // reminder label so the nudge copy can echo how THEY said it. An explicit `label` still wins.
      const rawLabel = r?.label != null ? r.label : r?.phrase;
      const insLabel = rawLabel != null ? String(rawLabel).trim() || null : null;
      const { data: ins, error: insErr } = await supa
        .from("situation_reminders")
        .insert({ user_id: userId, key_date_id: keyDateId, lead_days: lead, label: insLabel, active: true })
        .select("id").single();
      if (insErr) throw insErr;
      byLead.set(lead, ins.id);
      reminderIds.push(ins.id);
    }
  } catch (e) {
    // Missing table (pre-migration) or any reminder write failure ⇒ degrade to legacy: the key_date
    // still fires at its own lead_days. Never fail the whole capture over reminders.
    console.error("seedSituation reminders", e?.message || e);
    return { keyDateId, reminderIds: [] };
  }

  return { keyDateId, reminderIds };
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

// Reverse a supersession: reopen a fact that a now-undone capture had closed, restoring it as the
// current value (valid_to → null, unlink superseded_by). Used by capture Undo so reverting a
// Level-A save that replaced a single-valued attribute puts the PRIOR value back, instead of
// leaving the person with neither. Never resurrects a user-deleted fact (deleted_at guard).
export async function reopenFact(supa, userId, factId) {
  const { error } = await supa
    .from("facts")
    .update({ valid_to: null, superseded_by: null })
    .eq("id", factId).eq("user_id", userId).is("deleted_at", null);
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
