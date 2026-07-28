// Thoughts Count — the dedup core. ONE code path that every contact ingestion runs
// through: smart CSV commit today, Follow Up Boss backfill/webhook tomorrow. Whatever
// the source, a row lands here and converges into a single deduplicated person.
//
// The promise this file keeps (TC-38 brief §5.0 + strong-dedup):
//   • Re-uploading the same file changes nothing and asks nothing (idempotent).
//   • A person seen via two sources (CSV + FUB) collapses to ONE record.
//   • Deterministic matches (email / E.164 phone) auto-merge; fuzzy name matches only
//     ever PROPOSE (a review candidate) — never a silent merge.
//   • We never clobber data the user curated in-app; field-merge fills gaps.
//
// Routing per row:
//   1. Same natural key already imported from this source  → idempotent no-op update.
//   2. An existing identifier (email/phone) matches         → converge: field-merge.
//   3. A fuzzy name match in the ambiguous band             → review candidate (hold).
//   4. Nothing matches                                      → insert a new person.

import crypto from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";

// Fuzzy band: below LOW we treat as "no match" (insert new); at/above HIGH a name-only
// match is still not trusted enough to auto-merge (deterministic identifiers do that),
// so anything >= LOW that isn't an identifier match becomes a one-tap review candidate.
const FUZZY_LOW = 0.4;

// ---------- normalization ----------

export function normalizeEmail(raw) {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

// Coerce to E.164 assuming US when no country code is present (realtor beachhead is US).
// Never throws; unparseable numbers return null so the row still loads without a phone.
export function normalizePhone(raw, region = "US") {
  if (!raw) return null;
  try {
    const p = parsePhoneNumberFromString(String(raw).trim(), region);
    return p && p.isValid() ? p.number : null; // .number is E.164, e.g. +15555550123
  } catch {
    return null;
  }
}

// Tolerant date coercion → 'YYYY-MM-DD' or null. Handles ISO, US M/D/Y, and textual
// dates. Two-digit years pivot at 30 (00–30 → 2000s, 31–99 → 1900s) — right for the
// birthday/anniversary dates this feature carries. Never throws, never rejects a row.
export function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // ISO first.
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);

  // US-style M/D/Y or M-D-Y (also D.M.Y with dots is uncommon in US sources; skip).
  m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
  if (m) {
    let [, mo, da, yr] = m;
    return iso(pivotYear(+yr), +mo, +da);
  }

  // Month-name forms: "Jan 5, 1990", "5 January 1990", "January 5 1990".
  const parsed = Date.parse(s.replace(/(\d)(st|nd|rd|th)/gi, "$1"));
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

function pivotYear(yr) {
  if (yr >= 100) return yr;
  return yr <= 30 ? 2000 + yr : 1900 + yr;
}
function iso(y, mo, da) {
  if (!y || !mo || !da || mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(da)}`;
}

// Collapse whitespace, keep the user's casing. Blank → null.
export function normalizeName(raw) {
  if (!raw) return null;
  const v = String(raw).replace(/\s+/g, " ").trim();
  return v || null;
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// ---------- row shaping ----------

// Turn a mapped row into canonical, normalized fields plus the identifier set and the
// natural key. `row` is the post-mapping object: { name, first_name, last_name, email,
// phone, relationship, notes, location, key_dates?: [{kind,label,date,recurs}] }.
export function normalizeRow(row = {}) {
  const email = normalizeEmail(row.email);
  const phone = normalizePhone(row.phone);
  let name = normalizeName(row.name);
  if (!name) {
    const combined = [row.first_name, row.last_name].map((x) => normalizeName(x)).filter(Boolean).join(" ");
    name = normalizeName(combined);
  }
  // A person needs *some* label. Fall back to the email local-part, then the phone.
  if (!name) name = email ? email.split("@")[0] : phone || "Unknown contact";

  const key_dates = Array.isArray(row.key_dates)
    ? row.key_dates
        .map((kd) => ({
          kind: kd.kind || "custom",
          label: normalizeName(kd.label) || labelForKind(kd.kind),
          event_date: normalizeDate(kd.date ?? kd.event_date),
          recurs: kd.recurs ?? isRecurringKind(kd.kind),
        }))
        .filter((kd) => kd.event_date)
    : [];

  const identifiers = [];
  if (email) identifiers.push({ type: "email", value: email });
  if (phone) identifiers.push({ type: "phone", value: phone });

  return {
    name,
    email,
    phone,
    relationship: normalizeName(row.relationship),
    notes: row.notes ? String(row.notes).trim() : null,
    location: normalizeName(row.location),
    key_dates,
    identifiers,
    natural_key: naturalKey({ email, phone, name }),
  };
}

// The stable per-source fingerprint that makes re-uploads idempotent. Best available
// identifier wins so an edited-but-same-person row still re-matches: email > phone > name.
export function naturalKey({ email, phone, name }) {
  if (email) return sha256("email:" + email);
  if (phone) return sha256("phone:" + phone);
  return sha256("name:" + (name || "").toLowerCase());
}

function isRecurringKind(kind) {
  return kind === "birthday" || kind === "work_anniversary" || kind === "closing";
}
function labelForKind(kind) {
  return (
    { birthday: "Birthday", work_anniversary: "Work anniversary", closing: "Closing anniversary" }[kind] ||
    "Key date"
  );
}

// ---------- batch runner ----------

// Run a whole mapped file through the dedup core. Creates the import_batches row,
// ingests every row (one bad row NEVER blocks the batch — we carry the error), and
// returns the summary. Shared by the inline and background commit endpoints.
// `onProgress(done, total)` is optional (background path reports it to Blobs).
export async function runImport({ supa, userId, filename, rows, source = "csv", onProgress = null }) {
  const { data: batch, error: bErr } = await supa
    .from("import_batches")
    .insert({ user_id: userId, filename: filename || null })
    .select("id")
    .single();
  if (bErr) throw bErr;
  const batchId = batch.id;

  let added = 0, updated = 0, needs_review = 0, skipped = 0;
  const total = rows.length;
  for (let i = 0; i < total; i++) {
    try {
      const r = await upsertPerson({ supa, userId, row: rows[i], source, batchId });
      if (r.action === "inserted") added++;
      else if (r.action === "updated" || r.action === "unchanged") updated++;
      else if (r.action === "review") needs_review++;
    } catch (err) {
      // Carry the error — the user never gets homework. Log and keep going.
      skipped++;
      console.error(`import row ${i} failed`, err?.message || err);
    }
    if (onProgress && (i % 25 === 0 || i === total - 1)) {
      try { await onProgress(i + 1, total); } catch {}
    }
  }

  await supa
    .from("import_batches")
    .update({ added, updated, needs_review })
    .eq("user_id", userId)
    .eq("id", batchId);

  return { batch_id: batchId, added, updated, needs_review, skipped };
}

// ---------- the upsert ----------

// Ingest one row. `supa` is a service-role client; `userId` is the VERIFIED caller.
// Returns { action: 'inserted'|'updated'|'review', personId?, candidateId? }.
export async function upsertPerson({ supa, userId, row, source = "csv", batchId = null, contactKind = "contact" }) {
  const n = normalizeRow(row);

  // 1) Idempotency: have we already imported this exact natural key from this source?
  {
    const { data: cs } = await supa
      .from("contact_sources")
      .select("person_id")
      .eq("user_id", userId)
      .eq("source", source)
      .eq("natural_key", n.natural_key)
      .maybeSingle();
    if (cs?.person_id) {
      await mergeIntoPerson(supa, userId, cs.person_id, n);
      await touchSource(supa, userId, cs.person_id, source, { natural_key: n.natural_key });
      return { action: "updated", personId: cs.person_id };
    }
  }

  // 2) Deterministic convergence: does any existing identifier (email/phone) match?
  const existingId = await matchByIdentifier(supa, userId, n.identifiers);
  if (existingId) {
    await mergeIntoPerson(supa, userId, existingId, n);
    await addIdentifiers(supa, userId, existingId, n.identifiers);
    await touchSource(supa, userId, existingId, source, { natural_key: n.natural_key });
    return { action: "updated", personId: existingId };
  }

  // 3) Fuzzy name match → propose only. Hold the incoming row for a one-tap decision;
  //    do NOT create a duplicate person (T6 resolves it: merge or keep-both).
  const fuzzy = await fuzzyMatch(supa, userId, n.name);
  if (fuzzy) {
    // Idempotency: if we already proposed this same pair, don't ask twice on re-upload.
    const { data: existingRc } = await supa
      .from("review_candidates")
      .select("id")
      .eq("user_id", userId)
      .eq("existing_person_id", fuzzy.person_id)
      .eq("incoming->>natural_key", n.natural_key)
      .maybeSingle();
    if (existingRc?.id) {
      return { action: "unchanged", personId: fuzzy.person_id, candidateId: existingRc.id };
    }
    const { data: rc } = await supa
      .from("review_candidates")
      .insert({
        user_id: userId,
        batch_id: batchId,
        existing_person_id: fuzzy.person_id,
        incoming: { ...n, source },
        score: fuzzy.score,
      })
      .select("id")
      .single();
    return { action: "review", personId: fuzzy.person_id, candidateId: rc?.id };
  }

  // 4) No match → insert a fresh person, its identifiers, its source row, its key dates.
  const { data: person, error: insErr } = await supa
    .from("people")
    .insert({
      user_id: userId,
      name: n.name,
      contact_kind: contactKind,
      relationship: n.relationship,
      notes: n.notes,
      location: n.location,
      primary_email: n.email,
      primary_phone: n.phone,
    })
    .select("id")
    .single();
  if (insErr) throw insErr;

  await addIdentifiers(supa, userId, person.id, n.identifiers);
  await touchSource(supa, userId, person.id, source, { natural_key: n.natural_key });
  await upsertKeyDates(supa, userId, person.id, n.key_dates);
  return { action: "inserted", personId: person.id };
}

// Field-merge into an existing person: fill empty fields, never clobber a curated note.
// (Full per-field provenance — "app-native edits route to review" — needs a provenance
// column not in this migration; flagged to David. For now: fill-empties is the safe floor
// that guarantees a same-file re-upload changes nothing.)
async function mergeIntoPerson(supa, userId, personId, n) {
  const { data: cur } = await supa
    .from("people")
    .select("name, relationship, notes, location, primary_email, primary_phone")
    .eq("user_id", userId)
    .eq("id", personId)
    .single();
  if (!cur) return;

  const patch = {};
  const fill = (field, val) => {
    if (val && !(cur[field] && String(cur[field]).trim())) patch[field] = val;
  };
  fill("relationship", n.relationship);
  fill("notes", n.notes); // only fills when empty — never overwrites a curated note
  fill("location", n.location);
  fill("primary_email", n.email);
  fill("primary_phone", n.phone);
  // Prefer a fuller name (e.g. "Jane Q. Smith" over "Jane") but don't shrink one.
  if (n.name && n.name.length > (cur.name || "").length) patch.name = n.name;

  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    await supa.from("people").update(patch).eq("user_id", userId).eq("id", personId);
  }
  await addIdentifiers(supa, userId, personId, n.identifiers);
  await upsertKeyDates(supa, userId, personId, n.key_dates);
}

// Store every identifier ever seen (idempotent), so edited re-uploads re-match.
async function addIdentifiers(supa, userId, personId, identifiers) {
  if (!identifiers?.length) return;
  const rows = identifiers.map((i) => ({ user_id: userId, person_id: personId, type: i.type, value: i.value }));
  await supa.from("identifiers").upsert(rows, { onConflict: "user_id,type,value", ignoreDuplicates: true });
}

async function matchByIdentifier(supa, userId, identifiers) {
  if (!identifiers?.length) return null;
  const ors = identifiers.map((i) => `and(type.eq.${i.type},value.eq.${i.value})`).join(",");
  const { data } = await supa
    .from("identifiers")
    .select("person_id")
    .eq("user_id", userId)
    .or(ors)
    .limit(1);
  return data?.[0]?.person_id || null;
}

async function fuzzyMatch(supa, userId, name) {
  if (!name) return null;
  const { data, error } = await supa.rpc("tc38_fuzzy_person_match", {
    p_user_id: userId,
    p_name: name,
    p_threshold: FUZZY_LOW,
  });
  if (error || !data?.length) return null;
  return data[0]; // { person_id, name, score }
}

// Provenance + idempotency row per source. Upserts on the source's natural key so a
// re-import short-circuits at step 1 next time.
async function touchSource(supa, userId, personId, source, { natural_key = null, external_id = null }) {
  await supa.from("contact_sources").upsert(
    {
      user_id: userId,
      person_id: personId,
      source,
      natural_key,
      external_id,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: natural_key ? "user_id,source,natural_key" : "user_id,source,external_id" }
  );
}

// Attach key dates to a person without duplicating: skip any (kind,event_date) it already
// has. These feed the existing nudge engine across the whole roster.
export async function upsertKeyDates(supa, userId, personId, keyDates) {
  if (!keyDates?.length) return;
  const { data: existing } = await supa
    .from("key_dates")
    .select("kind, event_date")
    .eq("user_id", userId)
    .eq("person_id", personId);
  const seen = new Set((existing || []).map((k) => `${k.kind}|${k.event_date}`));
  const rows = keyDates
    .filter((kd) => kd.event_date && !seen.has(`${kd.kind}|${kd.event_date}`))
    .map((kd) => ({
      user_id: userId,
      person_id: personId,
      label: kd.label,
      kind: kd.kind || "custom",
      event_date: kd.event_date,
      recurs: !!kd.recurs,
    }));
  if (rows.length) await supa.from("key_dates").insert(rows);
}
