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
import { sameSurname, firstNamesEquivalent, levenshtein } from "./_names.mjs";

// Re-exported so existing importers (e.g. the test harness) keep resolving it from here
// after the definition moved to _names.mjs (Spec A / A1b).
export { sameSurname };

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

  // Refuse PARTIAL dates (year-only, year+month, month-name+year). We must never invent
  // a day the user didn't provide — a fabricated "Jan 1" would become a real key date and
  // drive a nudge on a guessed anniversary (TC-38 UX finding #2). Full dates only.
  // Preserving + displaying partials (without nudging) is the Architect follow-up.
  if (/^\d{4}$/.test(s)) return null;                     // 2021
  if (/^\d{4}[-\/]\d{1,2}$/.test(s)) return null;         // 2020-06, 2020/6
  if (/^\d{1,2}[-\/]\d{4}$/.test(s)) return null;         // 6/2020
  if (/^[A-Za-z]{3,9}\.?\s+\d{4}$/.test(s)) return null;  // June 2020, Jun 2020

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

// TC-43: preserve a PARTIAL date instead of dropping it. Returns
// { value:'YYYY-MM-DD', precision:'day'|'month'|'year' } | null. We still never invent
// a day the user didn't give — partials store a placeholder (month→day 1, year→Jan 1)
// flagged by precision, so display shows only what was given ("June 2020" / "2021") and
// the nudge engine skips anything not day-precise. Truly unparseable → null (row still
// loads, never a hard failure). normalizeDate() above stays as-is for string callers.
export function normalizeDateParts(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Year only: "2021".
  let m = /^(\d{4})$/.exec(s);
  if (m) { const v = iso(+m[1], 1, 1); return v ? { value: v, precision: "year" } : null; }

  // Year + month, numeric: "2020-06", "2020/6".
  m = /^(\d{4})[-\/](\d{1,2})$/.exec(s);
  if (m) { const v = iso(+m[1], +m[2], 1); return v ? { value: v, precision: "month" } : null; }

  // Month + year, numeric: "6/2020".
  m = /^(\d{1,2})[-\/](\d{4})$/.exec(s);
  if (m) { const v = iso(+m[2], +m[1], 1); return v ? { value: v, precision: "month" } : null; }

  // Month name + year: "June 2020", "Jun 2020". Resolve the month from a static map (NOT
  // Date.parse) so a tz boundary can't shift "June 1" back into May.
  m = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = monthFromName(m[1]);
    if (mo) { const v = iso(+m[2], mo, 1); return v ? { value: v, precision: "month" } : null; }
  }

  // Full date → reuse the existing parser; partial guards there won't trip on a full date.
  const full = normalizeDate(s);
  return full ? { value: full, precision: "day" } : null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function monthFromName(w) {
  return MONTHS[String(w).slice(0, 3).toLowerCase()] || null;
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
        .map((kd) => {
          // TC-43: capture the precision so partials are preserved (not dropped) and
          // never nudge until they carry a real day.
          const parts = normalizeDateParts(kd.date ?? kd.event_date);
          return {
            kind: kd.kind || "custom",
            label: normalizeName(kd.label) || labelForKind(kd.kind),
            event_date: parts ? parts.value : null,
            date_precision: parts ? parts.precision : null,
            recurs: kd.recurs ?? isRecurringKind(kd.kind),
          };
        })
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
  const total = rows.length;
  // Coarse progress (Spec C): the phases are few now (prefetch → resolve → bulk write), so
  // report 3 checkpoints as a fraction of total. The bar surface (import.js) is unchanged.
  const bump = async (frac) => {
    if (!onProgress) return;
    try { await onProgress(Math.min(total, Math.max(1, Math.ceil(total * frac))), total); } catch {}
  };

  // Spec C (TC-45): prefetch once → resolve in memory → bulk write. IDENTICAL decisions to
  // the per-row path (upsertPerson), just batched, so a 200-contact import is a handful of
  // queries instead of hundreds of sequential round-trips. upsertPerson stays live as the
  // single-row path (review "keep both" must NOT re-run dedup — see resolveCandidate).
  const maps = await prefetch(supa, userId, source);
  await bump(0.15);

  const { counts, queues } = resolveBatch({ userId, rows, source, batchId, maps });
  await bump(0.6);

  await flushBatch(supa, queues);
  await bump(1);

  await supa
    .from("import_batches")
    .update({ added: counts.added, updated: counts.updated, needs_review: counts.needs_review })
    .eq("user_id", userId)
    .eq("id", batchId);

  return { batch_id: batchId, ...counts };
}

// ---------- Spec C bulk path: prefetch → resolve → flush (TC-45) ----------

// C1 — Prefetch. One query per table, per user: everything the resolver would otherwise
// hit the DB for row-by-row. Returns the same lookups upsertPerson uses, as in-memory maps.
async function prefetch(supa, userId, source) {
  const people = new Map();       // id → mutable person obj (fields merge/placement/fuzzy read)
  const surnames = new Map();     // surnameKey → [obj] (fuzzy candidate feeder, incl. in-batch)
  const byNaturalKey = new Map(); // natural_key → obj (source-scoped idempotency, step 1)
  const byIdentifier = new Map(); // `${type} ${value}` → obj (deterministic convergence, step 2)
  const keyDates = new Map();     // person id → Set('kind|event_date|precision')
  const proposedPairs = new Set();    // `${existing_person_id}|${natural_key}` (don't re-ask)
  const placementPending = new Set(); // person ids that already have a placement queued

  const addSurname = (obj) => {
    const k = surnameKey(obj.name);
    if (!k) return;
    const arr = surnames.get(k); if (arr) arr.push(obj); else surnames.set(k, [obj]);
  };

  const { data: ppl, error: pErr } = await supa
    .from("people")
    .select("id, name, contact_kind, kind_locked, relationship, notes, location, primary_email, primary_phone")
    .eq("user_id", userId);
  if (pErr) throw pErr;
  for (const p of ppl || []) {
    const obj = { ...p, isNew: false };
    people.set(p.id, obj);
    addSurname(obj);
  }

  const { data: ids } = await supa
    .from("identifiers").select("person_id, type, value").eq("user_id", userId);
  for (const r of ids || []) {
    const obj = people.get(r.person_id);
    if (obj) byIdentifier.set(`${r.type} ${r.value}`, obj);
  }

  const { data: srcs } = await supa
    .from("contact_sources").select("person_id, natural_key").eq("user_id", userId).eq("source", source);
  for (const r of srcs || []) {
    if (r.natural_key == null) continue;
    const obj = people.get(r.person_id);
    if (obj) byNaturalKey.set(r.natural_key, obj);
  }

  const { data: kds } = await supa
    .from("key_dates").select("person_id, kind, event_date, date_precision").eq("user_id", userId);
  for (const r of kds || []) {
    const set = keyDates.get(r.person_id) || new Set();
    set.add(`${r.kind}|${r.event_date}|${r.date_precision || "day"}`);
    keyDates.set(r.person_id, set);
  }

  const { data: rcs } = await supa
    .from("review_candidates").select("existing_person_id, incoming").eq("user_id", userId);
  for (const r of rcs || []) {
    const inc = r.incoming || {};
    if (inc._placement) { if (r.existing_person_id) placementPending.add(r.existing_person_id); }
    else if (inc.natural_key && r.existing_person_id) proposedPairs.add(`${r.existing_person_id}|${inc.natural_key}`);
  }

  return { people, surnames, byNaturalKey, byIdentifier, keyDates, proposedPairs, placementPending, addSurname };
}

// C2 — In-memory resolver. Walk every row through the SAME ordered logic as upsertPerson,
// against the prefetched maps, queuing writes instead of issuing them. Intra-batch
// convergence is automatic: each resolved row updates the maps in place, so row N sees the
// person row M (earlier in the file) just created or converged onto. Pure/synchronous — no
// I/O in the loop, which is the whole point (the old path did several round-trips per row).
function resolveBatch({ userId, rows, source, batchId, maps }) {
  const { people, surnames, byNaturalKey, byIdentifier, keyDates, proposedPairs, placementPending, addSurname } = maps;

  const newPeople = [];          // person objs for the bulk insert (shared by reference)
  const peopleUpdates = new Map(); // existing id → field-fill patch
  const identifierInserts = [];  // { person, type, value }
  const sourceUpserts = [];      // { person, source, natural_key }
  const keyDateInserts = [];     // { person, label, kind, event_date, date_precision, recurs }
  const candidateInserts = [];   // { person(existing), batch_id, incoming, score }
  const placementInserts = [];   // { person, batch_id, incoming, score }

  const counts = { added: 0, updated: 0, needs_review: 0, skipped: 0 };

  const queueIdentifiers = (obj, identifiers) => {
    for (const idf of identifiers) {
      const key = `${idf.type} ${idf.value}`;
      if (byIdentifier.has(key)) continue; // already attached to a person (prefetch or this batch)
      byIdentifier.set(key, obj);
      identifierInserts.push({ person: obj, type: idf.type, value: idf.value });
    }
  };
  const queueKeyDates = (obj, kds) => {
    if (!kds?.length) return;
    let set = keyDates.get(obj.id); if (!set) { set = new Set(); keyDates.set(obj.id, set); }
    for (const kd of kds) {
      if (!kd.event_date) continue;
      const sig = `${kd.kind}|${kd.event_date}|${kd.date_precision || "day"}`;
      if (set.has(sig)) continue;
      set.add(sig);
      keyDateInserts.push({ person: obj, label: kd.label, kind: kd.kind || "custom", event_date: kd.event_date, date_precision: kd.date_precision || "day", recurs: !!kd.recurs });
    }
  };
  const touchSourceMem = (obj, naturalKey) => {
    byNaturalKey.set(naturalKey, obj);
    sourceUpserts.push({ person: obj, source, natural_key: naturalKey });
  };
  // Field-fill mirror of mergeIntoPerson: fill empties only, never clobber a curated field.
  // Existing people record a patch (bulk UPDATE later); new people mutate in place (they're
  // inserted carrying the value, so no separate update is needed).
  const mergeMem = (obj, n) => {
    const patch = {};
    const fill = (field, val) => {
      if (val && !(obj[field] && String(obj[field]).trim())) { obj[field] = val; if (!obj.isNew) patch[field] = val; }
    };
    fill("relationship", n.relationship);
    fill("notes", n.notes);
    fill("location", n.location);
    fill("primary_email", n.email);
    fill("primary_phone", n.phone);
    fill("name", n.name);
    if (!obj.isNew && Object.keys(patch).length) {
      peopleUpdates.set(obj.id, { ...(peopleUpdates.get(obj.id) || {}), ...patch });
    }
    queueIdentifiers(obj, n.identifiers);
    queueKeyDates(obj, n.key_dates);
  };
  // Mirror of maybeFlagPlacement: a CSV row (intendedKind 'contact') that converged onto a
  // still-unlocked PERSONAL person raises a one-tap placement, once per person.
  const maybePlacement = (obj) => {
    const intendedKind = "contact";
    if (obj.kind_locked || obj.contact_kind === intendedKind) return false;
    if (placementPending.has(obj.id)) return true;
    placementPending.add(obj.id);
    placementInserts.push({ person: obj, batch_id: batchId, incoming: { _placement: true, name: obj.name, matched_kind: obj.contact_kind }, score: null });
    return true;
  };

  for (let i = 0; i < rows.length; i++) {
    try {
      const n = normalizeRow(rows[i]);

      // 1) Natural-key idempotency (this source).
      const nkHit = byNaturalKey.get(n.natural_key);
      if (nkHit) {
        mergeMem(nkHit, n);
        touchSourceMem(nkHit, n.natural_key);
        if (maybePlacement(nkHit)) counts.needs_review++; else counts.updated++;
        continue;
      }

      // 2) Deterministic identifier convergence (email/phone).
      let idHit = null;
      for (const idf of n.identifiers) { const o = byIdentifier.get(`${idf.type} ${idf.value}`); if (o) { idHit = o; break; } }
      if (idHit) {
        mergeMem(idHit, n);
        touchSourceMem(idHit, n.natural_key);
        if (maybePlacement(idHit)) counts.needs_review++; else counts.updated++;
        continue;
      }

      // 3) Fuzzy name → PROPOSE only. Candidate feeder = same-surname index (prefetched +
      //    in-batch new people), which is decision-equivalent to the RPC (every branch in
      //    pickAmbiguous requires sameSurname) and, unlike the RPC, sees in-batch rows.
      const incomingHasId = n.identifiers.length > 0;
      const candidates = fuzzyCandidates(n.name, surnames);
      const ambiguous = pickAmbiguous(n, candidates, incomingHasId);
      if (ambiguous) {
        const pairKey = `${ambiguous.person_id}|${n.natural_key}`;
        if (proposedPairs.has(pairKey)) { counts.updated++; continue; } // already proposed → unchanged
        proposedPairs.add(pairKey);
        const crossKind = ambiguous.contact_kind && ambiguous.contact_kind !== "contact";
        candidateInserts.push({
          person: ambiguous._obj,
          batch_id: batchId,
          incoming: { ...n, source, ...(crossKind ? { _crosskind: true, _matched_kind: ambiguous.contact_kind } : {}) },
          score: null, // fed from the surname index, not the trigram RPC — non-behavioral, never displayed (verified)
        });
        counts.needs_review++;
        continue;
      }

      // 4) No match → a fresh person. Client-generated id so every queued child row (and any
      //    later row that converges onto this person) references a real id with no remap.
      const obj = {
        id: crypto.randomUUID(), name: n.name, contact_kind: "contact",
        relationship: n.relationship, notes: n.notes, location: n.location,
        primary_email: n.email, primary_phone: n.phone, kind_locked: false, isNew: true,
      };
      people.set(obj.id, obj);
      addSurname(obj);
      newPeople.push(obj);
      queueIdentifiers(obj, n.identifiers);
      touchSourceMem(obj, n.natural_key);
      queueKeyDates(obj, n.key_dates);
      counts.added++;
    } catch (err) {
      // One bad row never blocks the batch (parity with the row path).
      counts.skipped++;
      console.error(`import row ${i} failed`, err?.message || err);
    }
  }

  return { counts, queues: { userId, newPeople, peopleUpdates, identifierInserts, sourceUpserts, keyDateInserts, candidateInserts, placementInserts } };
}

// Same-surname fuzzy candidates, ordered by descending name-similarity then name (parity
// guard #2: .find() in pickAmbiguous surfaces the same existing_person_id the RPC's
// score-desc order would). Rows are shaped exactly like the RPC's so pickAmbiguous is
// byte-identical across the row and bulk paths. Capped at 25 to match the RPC's limit.
function fuzzyCandidates(name, surnames) {
  if (!name) return [];
  const bucket = surnames.get(surnameKey(name));
  if (!bucket || !bucket.length) return [];
  const sim = (a, b) => { a = a.toLowerCase(); b = b.toLowerCase(); const m = Math.max(a.length, b.length) || 1; return 1 - levenshtein(a, b) / m; };
  return bucket
    .map((o) => ({ person_id: o.id, name: o.name, has_identifier: !!(o.primary_email || o.primary_phone), contact_kind: o.contact_kind, _obj: o }))
    .sort((x, y) => sim(name, y.name) - sim(name, x.name) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
    .slice(0, 25);
}

// C3 — Bulk writer. Batched inserts/upserts in FK-safe order (people → their identifiers/
// sources/key_dates → converged-existing field-fill → review candidates → placements).
// Queues are de-duped by conflict key so a single upsert never double-affects a row.
const BULK_CHUNK = 500; // stay well under PostgREST payload limits; chunk anything larger

async function insertChunks(supa, table, rows, opts) {
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    const chunk = rows.slice(i, i + BULK_CHUNK);
    const { error } = opts ? await supa.from(table).upsert(chunk, opts) : await supa.from(table).insert(chunk);
    if (error) throw error;
  }
}

async function flushBatch(supa, q) {
  const userId = q.userId;

  // 1) New people first (the FK parent). Strip in-memory-only fields to real columns.
  const peopleRows = q.newPeople.map((o) => ({
    id: o.id, user_id: userId, name: o.name, contact_kind: o.contact_kind,
    relationship: o.relationship, notes: o.notes, location: o.location,
    primary_email: o.primary_email, primary_phone: o.primary_phone, kind_locked: o.kind_locked,
  }));
  await insertChunks(supa, "people", peopleRows);

  // 2) Identifiers / contact_sources / key_dates. Dedupe by conflict key first so one
  //    upsert statement never affects the same conflict target twice.
  const idSeen = new Set();
  const idRows = [];
  for (const r of q.identifierInserts) {
    const k = `${r.type} ${r.value}`; if (idSeen.has(k)) continue; idSeen.add(k);
    idRows.push({ user_id: userId, person_id: r.person.id, type: r.type, value: r.value });
  }
  await insertChunks(supa, "identifiers", idRows, { onConflict: "user_id,type,value", ignoreDuplicates: true });

  const srcSeen = new Set();
  const srcRows = [];
  for (const r of q.sourceUpserts) {
    const k = `${r.source} ${r.natural_key}`; if (srcSeen.has(k)) continue; srcSeen.add(k);
    srcRows.push({ user_id: userId, person_id: r.person.id, source: r.source, natural_key: r.natural_key, last_seen_at: new Date().toISOString() });
  }
  await insertChunks(supa, "contact_sources", srcRows, { onConflict: "user_id,source,natural_key" });

  const kdRows = q.keyDateInserts.map((r) => ({
    user_id: userId, person_id: r.person.id, label: r.label, kind: r.kind,
    event_date: r.event_date, date_precision: r.date_precision, recurs: r.recurs,
  }));
  await insertChunks(supa, "key_dates", kdRows);

  // 3) Field-fill updates for converged EXISTING people (patch-only, mirrors mergeIntoPerson).
  //    Idempotent re-uploads produce an empty patch set → zero updates.
  const now = new Date().toISOString();
  const updates = [...q.peopleUpdates.entries()];
  for (let i = 0; i < updates.length; i += 25) {
    await Promise.all(updates.slice(i, i + 25).map(async ([id, patch]) => {
      const { error } = await supa.from("people").update({ ...patch, updated_at: now }).eq("user_id", userId).eq("id", id);
      if (error) throw error;
    }));
  }

  // 4) Review candidates (dedup + cross-kind), then placements. Both reference people(id),
  //    valid after step 1. The queues were already de-duped in memory (proposedPairs /
  //    placementPending), so "don't re-propose the same pair" + "one placement per person" hold.
  const toRc = (r) => ({ user_id: userId, batch_id: r.batch_id, existing_person_id: r.person.id, incoming: r.incoming, score: r.score });
  await insertChunks(supa, "review_candidates", q.candidateInserts.map(toRc));
  await insertChunks(supa, "review_candidates", q.placementInserts.map(toRc));
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
      const placement = await maybeFlagPlacement(supa, userId, cs.person_id, contactKind, batchId);
      return { action: "updated", personId: cs.person_id, placement };
    }
  }

  // 2) Deterministic convergence: does any existing identifier (email/phone) match?
  const existingId = await matchByIdentifier(supa, userId, n.identifiers);
  if (existingId) {
    await mergeIntoPerson(supa, userId, existingId, n);
    await addIdentifiers(supa, userId, existingId, n.identifiers);
    await touchSource(supa, userId, existingId, source, { natural_key: n.natural_key });
    const placement = await maybeFlagPlacement(supa, userId, existingId, contactKind, batchId);
    return { action: "updated", personId: existingId, placement };
  }

  // 3) Name-based review → PROPOSE only (never auto-merge, never reject, never silently
  //    duplicate). We're past step 2, so this row's email/phone matched NOBODY — it shares
  //    no identifier with anyone. We raise AT MOST ONE review candidate; the first matching
  //    reason wins, in priority order:
  //      (a) Cross-kind (TC-47): the incoming contact is name-equivalent to a PERSONAL person
  //          (someone already in the intimate circle). Converge them; the "business or
  //          personal?" placement prompt follows on merge (see resolveCandidate → A3).
  //      (b) Same-name near-dup (TC-46 Fix 2): name-equivalent to another contact, EVEN when
  //          both carry different identifiers. name-equivalence = sameSurname AND first names
  //          equivalent (exact / nickname / spelling-close) — this is the Fix-2 re-opening.
  //      (c) Existing identifier-poor rule (TC-38): at least one side has no email/phone AND
  //          surnames match — the "genuinely can't tell them apart" net (kills "David May"/
  //          "David Kay", "Chris P"/"Chris Q"; still catches "Jane Doe"/"Jane Ann Doe").
  //          Scoped to NON-personal (contact) candidates: cross-kind proposals must come only
  //          from name-equivalence (a), never bare surname — otherwise, now that the surname
  //          branch is live, every imported contact sharing a surname with a personal person
  //          (who is always id-poor) would falsely prompt "is your client the same as your
  //          family member?" (Validator R2). A legit id-poor cross-kind near-dup keeps firing
  //          via (a) (e.g. personal "Jane Doe" + "Jane Ann Doe" — same first name). (b)/(c) overlap by design.
  const incomingHasId = n.identifiers.length > 0;
  const candidates = (await fuzzyMatch(supa, userId, n.name)) || [];
  const ambiguous = pickAmbiguous(n, candidates, incomingHasId);
  if (ambiguous) {
    // Idempotency: if we already proposed this same pair, don't ask twice on re-upload.
    const { data: existingRc } = await supa
      .from("review_candidates")
      .select("id")
      .eq("user_id", userId)
      .eq("existing_person_id", ambiguous.person_id)
      .eq("incoming->>natural_key", n.natural_key)
      .maybeSingle();
    if (existingRc?.id) {
      return { action: "unchanged", personId: ambiguous.person_id, candidateId: existingRc.id };
    }
    // If the matched person lives in a DIFFERENT kind (they're already in the personal
    // circle), mark the review as cross-kind so the UI shows ONE three-way prompt
    // (keep personal / move to roster / keep both) instead of "same person?" then a
    // separate placement step. matched_kind drives the copy ("your personal people").
    const crossKind = ambiguous.contact_kind && ambiguous.contact_kind !== "contact";
    const { data: rc } = await supa
      .from("review_candidates")
      .insert({
        user_id: userId,
        batch_id: batchId,
        existing_person_id: ambiguous.person_id,
        incoming: { ...n, source, ...(crossKind ? { _crosskind: true, _matched_kind: ambiguous.contact_kind } : {}) },
        score: ambiguous.score,
      })
      .select("id")
      .single();
    return { action: "review", personId: ambiguous.person_id, candidateId: rc?.id };
  }

  // 4) No match → insert a fresh person, its identifiers, its source row, its key dates.
  const personId = await insertPerson(supa, userId, n, source, contactKind);
  return { action: "inserted", personId };
}

// Insert a brand-new person from a normalized row, plus its identifiers, source row,
// and key dates. Shared by the "no match" route and review keep-both resolution (which
// must force a new person WITHOUT re-running dedup, or it would fuzzy-match right back).
async function insertPerson(supa, userId, n, source, contactKind = "contact") {
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
  return person.id;
}

// A book-of-business import can match (by email/phone) someone already in the user's
// PERSONAL circle. We merge them into ONE person (already done by the caller), then — per
// TC-44 — ask the user where that person should live rather than silently deciding. This
// records a one-tap "placement" prompt, once per person (kind_locked remembers the answer
// so a re-import never re-asks). Returns true when a placement is pending for this person.
async function maybeFlagPlacement(supa, userId, personId, intendedKind, batchId) {
  const { data: p } = await supa
    .from("people")
    .select("name, contact_kind, kind_locked")
    .eq("user_id", userId)
    .eq("id", personId)
    .single();
  if (!p || p.kind_locked || p.contact_kind === intendedKind) return false;

  const { data: existing } = await supa
    .from("review_candidates")
    .select("id")
    .eq("user_id", userId)
    .eq("existing_person_id", personId)
    .eq("incoming->>_placement", "true")
    .maybeSingle();
  if (existing?.id) return true; // already pending — surface it, don't duplicate

  await supa.from("review_candidates").insert({
    user_id: userId,
    batch_id: batchId,
    existing_person_id: personId,
    incoming: { _placement: true, name: p.name, matched_kind: p.contact_kind },
    score: null,
  });
  return true;
}

// Resolve one review candidate. Duplicate prompts: 'merge' folds the held row into the
// matched person, 'keep_both' promotes it to its own person. Placement prompts (TC-44):
// 'move_to_roster' / 'keep_personal' set the person's contact_kind and lock it. Either
// way the prompt is cleared and re-uploads won't re-ask.
export async function resolveCandidate({ supa, userId, candidateId, action }) {
  const { data: cand } = await supa
    .from("review_candidates")
    .select("id, existing_person_id, incoming, batch_id")
    .eq("user_id", userId)
    .eq("id", candidateId)
    .maybeSingle();
  if (!cand) return { ok: false, error: "That item was already resolved." };

  const n = cand.incoming || {};

  const source = n.source || "csv";

  // Deterministic placement prompt (identifier/natural-key match already converged the two
  // records — definitely the same person, only their "home" is in question): two-way, set
  // where they live, lock it, clear the prompt.
  if (n._placement) {
    if (action !== "move_to_roster" && action !== "keep_personal") return { ok: false, error: "Unknown action." };
    const kind = action === "move_to_roster" ? "contact" : "personal";
    await supa
      .from("people")
      .update({ contact_kind: kind, kind_locked: true, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", cand.existing_person_id);
    await supa.from("review_candidates").delete().eq("user_id", userId).eq("id", candidateId);
    return { ok: true, action, personId: cand.existing_person_id };
  }

  // Cross-kind review (a book contact that name-matched someone already in the PERSONAL
  // circle — uncertain, so we never auto-merged): ONE three-way decision, resolved here in
  // a single step (no separate placement prompt). "keep both" means they're different people.
  if (n._crosskind) {
    let personId;
    if (action === "keep_both") {
      personId = await insertPerson(supa, userId, n, source, "contact");
    } else if (action === "keep_personal" || action === "move_to_roster") {
      personId = cand.existing_person_id;
      await mergeIntoPerson(supa, userId, personId, n);
      await touchSource(supa, userId, personId, source, { natural_key: n.natural_key });
      const kind = action === "move_to_roster" ? "contact" : "personal";
      await supa
        .from("people")
        .update({ contact_kind: kind, kind_locked: true, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("id", personId);
    } else {
      return { ok: false, error: "Unknown action." };
    }
    await supa.from("review_candidates").delete().eq("user_id", userId).eq("id", candidateId);
    return { ok: true, action, personId };
  }

  // Plain within-kind duplicate prompt (contact ↔ contact): merge folds the held row into
  // the matched person; keep_both promotes it to its own person.
  let personId;
  if (action === "merge") {
    personId = cand.existing_person_id;
    await mergeIntoPerson(supa, userId, personId, n);
    await touchSource(supa, userId, personId, source, { natural_key: n.natural_key });
  } else if (action === "keep_both") {
    personId = await insertPerson(supa, userId, n, source, "contact");
  } else {
    return { ok: false, error: "Unknown action." };
  }

  await supa.from("review_candidates").delete().eq("user_id", userId).eq("id", candidateId);
  return { ok: true, action, personId };
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
  fill("name", n.name); // only if the existing person has no name — never rename a curated contact

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
  // Query by exact values with a parameterized .in() (NOT a string-interpolated .or()):
  // an email/phone containing , ( ) would malform an interpolated filter and silently
  // miss the match, splitting a person into a duplicate. Values are matched exactly, then
  // we confirm the (type,value) pair to avoid an email that happens to equal a phone.
  const values = identifiers.map((i) => i.value);
  const { data } = await supa
    .from("identifiers")
    .select("person_id, type, value")
    .eq("user_id", userId)
    .in("value", values);
  if (!data?.length) return null;
  const wanted = new Set(identifiers.map((i) => `${i.type} ${i.value}`));
  const hit = data.find((r) => wanted.has(`${r.type} ${r.value}`));
  return hit?.person_id || null;
}

async function fuzzyMatch(supa, userId, name) {
  if (!name) return null;
  const { data, error } = await supa.rpc("tc38_fuzzy_person_match", {
    p_user_id: userId,
    p_name: name,
    p_threshold: FUZZY_LOW,
  });
  if (error || !data?.length) return null;
  return data; // [{ person_id, name, score, has_identifier, contact_kind }] best-first (migration 003)
}

// The step-3 decision — which (if any) fuzzy candidate this row should PROPOSE a review
// against. Extracted verbatim from upsertPerson so the row path AND the bulk path (Spec C)
// make byte-identical decisions from the same candidate shape. `candidates` are
// { person_id, name, score, has_identifier, contact_kind } in surface order (RPC: score
// desc; bulk: name-similarity desc — same tiebreak intent). The three branches, in
// priority order, ALL require sameSurname (nameEquiv folds it in; branch (c) states it) —
// which is exactly why the bulk path can feed this from a same-surname index and stay
// equivalent (Spec C / TC-45). See upsertPerson step 3 for the full reasoning per branch.
export function pickAmbiguous(n, candidates, incomingHasId) {
  const isPersonal = (c) => c.contact_kind && c.contact_kind !== "contact";
  const nameEquiv = (c) => sameSurname(n.name, c.name) && firstNamesEquivalent(n.name, c.name);
  return (
    candidates.find((c) => isPersonal(c) && nameEquiv(c)) ||                                 // (a) cross-kind
    candidates.find((c) => !isPersonal(c) && nameEquiv(c)) ||                                // (b) near-dup
    candidates.find((c) => !isPersonal(c) && (!incomingHasId || !c.has_identifier) && sameSurname(n.name, c.name)) || // (c) id-poor
    null
  );
}

// The surname bucket key — lowercased LAST whitespace-run token, the SAME rule the SQL RPC
// and JS sameSurname use (sameSurname additionally requires ≥2 chars, re-checked in
// pickAmbiguous; the index itself buckets on the bare token). This is the candidate feeder
// for the bulk path: two rows share a bucket iff they could ever be a same-surname match.
export function surnameKey(name) {
  const t = String(name || "").trim().split(/\s+/);
  return t.length ? t[t.length - 1].toLowerCase() : "";
}

// (sameSurname + firstNamesEquivalent now live in _names.mjs — imported/re-exported above.)

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

// Attach key dates to a person without duplicating: skip any (kind,event_date,precision)
// it already has. Precision is part of the dedup key (TC-43) so a placeholder "2020"
// (2020-01-01/year) and a genuine 2020-01-01/day stay distinct — the real Jan-1 date must
// keep nudging even alongside a year-only partial. These feed the roster-wide nudge engine
// (day-precise rows only — see nudges-cron).
export async function upsertKeyDates(supa, userId, personId, keyDates) {
  if (!keyDates?.length) return;
  const { data: existing } = await supa
    .from("key_dates")
    .select("kind, event_date, date_precision")
    .eq("user_id", userId)
    .eq("person_id", personId);
  const seen = new Set((existing || []).map((k) => `${k.kind}|${k.event_date}|${k.date_precision || "day"}`));
  const rows = keyDates
    .filter((kd) => kd.event_date && !seen.has(`${kd.kind}|${kd.event_date}|${kd.date_precision || "day"}`))
    .map((kd) => ({
      user_id: userId,
      person_id: personId,
      label: kd.label,
      kind: kd.kind || "custom",
      event_date: kd.event_date,
      date_precision: kd.date_precision || "day",
      recurs: !!kd.recurs,
    }));
  if (rows.length) await supa.from("key_dates").insert(rows);
}
