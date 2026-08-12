// Thoughts Count — media→person capture (TC-98 screenshot/photo add; TC-100 .vcf add). The ONE
// endpoint that owns every "add a person from a file" door: a screenshot/photo of a DM/profile/
// contact-card, OR a shared .vcf. It reads the media into ExtractedPerson[] (via _extract_image.mjs)
// and then funnels EACH person through the EXISTING capture pipeline — resolvePerson (strong-key
// email/phone dedup + fuzzy name), the existing extract() for notes→facts, and the SAME preview
// contract capture-extract.mjs emits (kind add|update|pick, a pending capture row, candidates). It
// WRITES NOTHING; capture-resolve turns a confirmed preview into real writes. So there is zero
// parallel resolution or write logic here — this is a thin front-end onto the shared brain.
//
//   POST { image: base64, mime }            → screenshot/photo path (multimodal read)
//   POST { vcard: "<text>" }  (or file:true) → .vcf path (server-side parse)
//   → { previews: [ { kind, captureId, personId?, personName?, personDetail, personHasDetail,
//                     personHint?, facts, candidates, count, source_kind } ] }   // one per person
//
// Privacy (mirrors transcribe.mjs): the image/vcard is processed in-memory for this request and
// never stored; only the structured facts the user CONFIRMS persist. All keys are server-side.

import { getStore } from "@netlify/blobs";
import { requireUser, serviceClient, json } from "./_supabase.mjs";
import { extract, resolvePerson, rosterNames, recognizableDetail } from "./_capture.mjs";
import { extractPersonFromImage, parseVCard, ALLOWED_IMAGE_MIMES } from "./_extract_image.mjs";

// Base64 of a downscaled photo stays well under Netlify's request-body ceiling; the client
// downscales large photos before upload (see _capture.js captureImage). This is the server backstop.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VCARD_CHARS = 200 * 1024;

// Same light abuse guard shape as transcribe.mjs — an authed but paid endpoint shouldn't be
// millable. Generous for real use (adding people is occasional). Never blocks on limiter failure.
const RL_LIMIT = 40;
const RL_WINDOW_MS = 10 * 60 * 1000;
async function rateLimited(req) {
  try {
    const ip = (req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim();
    if (!ip) return false;
    const store = getStore("capture-image-ratelimit");
    const now = Date.now();
    const rec = (await store.get(ip, { type: "json" })) || { count: 0, start: now };
    if (now - rec.start > RL_WINDOW_MS) { rec.count = 0; rec.start = now; }
    rec.count += 1;
    await store.setJSON(ip, rec);
    return rec.count > RL_LIMIT;
  } catch { return false; }
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const auth = await requireUser(req);
  if (auth.error) return json(auth.status || 401, { error: "Please sign in to add someone." });

  if (await rateLimited(req)) {
    return json(429, { error: "That's a lot of imports in a short time — take a breather and try again soon." });
  }

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }

  const supa = serviceClient();
  const userId = auth.userId;

  try {
    // Roster bias is derived SERVER-SIDE from the verified token (never a client value) — same
    // contract as transcribe.mjs. Best-effort: [] just means no spelling nudge.
    const roster = await rosterNames(supa, userId);

    // ── Decide which media this is and read it into the SHARED ExtractedPerson[] shape. ──
    let extracted; // { people, ambiguous_multi_person }
    let source; // capture `source` — both are on capture-extract's whitelist-adjacent set below
    if (typeof body?.vcard === "string" && body.vcard.trim()) {
      if (body.vcard.length > MAX_VCARD_CHARS) return json(413, { error: "That contact file is unusually large." });
      extracted = parseVCard(body.vcard);
      source = "import";
    } else if (typeof body?.image === "string" && body.image.trim()) {
      const b64 = body.image.trim();
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return json(400, { error: "That image didn't come through — please try again." });
      let bytes;
      try { bytes = Buffer.from(b64, "base64"); } catch { return json(400, { error: "That image didn't come through — please try again." }); }
      if (!bytes.length) return json(400, { error: "That image was empty — please try again." });
      if (bytes.length > MAX_IMAGE_BYTES) return json(413, { error: "That image is a bit large — try a smaller screenshot or photo." });
      const mime = ALLOWED_IMAGE_MIMES.includes(body?.mime) ? body.mime : "image/jpeg";
      extracted = await extractPersonFromImage(b64, mime, { rosterNames: roster });
      source = "scan";
    } else {
      return json(400, { error: "Attach a screenshot, photo, or contact file to add someone." });
    }

    const people = Array.isArray(extracted.people) ? extracted.people : [];
    if (!people.length) {
      return json(200, { previews: [], message: "We couldn't find a person in that — try a screenshot of a message, profile, or contact card." });
    }

    // ── One preview per detected person (NEVER auto-batch a group). Each person flows through the
    //    EXISTING resolve → notes-as-facts → pending-capture path so the confirm card is identical
    //    to the typed/voice preview. Nothing is written. ──
    const previews = [];
    for (const person of people) {
      const preview = await previewForPerson(supa, userId, person, source);
      previews.push(preview);
    }
    return json(200, { previews, ambiguousMultiPerson: !!extracted.ambiguous_multi_person });
  } catch (err) {
    console.error("capture-image failed", err);
    return json(500, { error: err.message || "We couldn't read that just now. Please try again." });
  }
};

// Turn ONE ExtractedPerson into the exact preview shape capture-extract.mjs emits, reusing the
// shared resolver + extractor + capture row. WRITES NOTHING.
async function previewForPerson(supa, userId, person, source) {
  const name = String(person.name || "").trim();

  // 1) WHO — reuse resolvePerson with the person's identifiers (email/phone = strong-key Level-A
  //    dedup), a location hint if the media showed one, and the voice/typed first-name fallback so a
  //    bare first name still surfaces an existing fuller-named person as a confirm-WHO candidate.
  const r = await resolvePerson(supa, userId, name, {
    identifiers: person.identifiers,
    locationHint: person.location_hint || "",
    fallbackFirstName: true,
  });

  // 2) NOTES → FACTS — run the person's notes through the EXISTING text extractor, LOCKED to this
  //    person (identity comes from resolvePerson, not the model), so notes become routable facts and
  //    a dated birthday/anniversary seeds a key_date on confirm exactly like the typed door. The
  //    detected birthday is added as an explicit RECURRING dated fact so confirm seeds a key-date.
  const facts = await notesToFacts(person);

  // 3) The proposed target: a confident match (Level A) or a single first-name fallback hit renders
  //    an "update" card; several look-alikes → a "pick"; otherwise "add" a new person. Same rules as
  //    capture-extract's preview branch.
  const singleTarget = r.proposedPersonId && (r.level === "A" || r.fallback);
  const existing = singleTarget ? await getPerson(supa, userId, r.proposedPersonId) : null;

  const cap = await insertCapture(supa, userId, {
    raw_text: rawTextFor(person),
    source,
    status: "pending",
    context_locked: false,
    proposed_person_id: existing ? existing.id : (r.proposedPersonId || null),
    match_confidence: r.confidence,
    match_evidence: r.evidence,
    parsed: {
      facts,
      person_hint: name,
      location_hint: person.location_hint || "",
      candidates: r.candidates || [],
      // Carry the detected relationship so confirm can set it on a brand-new person (capture-resolve
      // reads person_hint/facts; relationship is applied client-side via the editable confirm card).
      relationship_hint: person.relationship_hint || "",
      birthday: person.birthday || null,
      source_kind: person.source_kind || "other",
      // TC-99: carry the artifact's event so the confirm card can show + edit the occasion/date.
      event: person.event || null,
      // TC-109: carry the detected email/phone so confirm persists them into `identifiers`, arming
      // strong-key dedup — a later import of the same contact resolves to an UPDATE, not a duplicate.
      identifiers: Array.isArray(person.identifiers) ? person.identifiers : [],
    },
  });

  const kind = existing ? "update" : ((r.candidates && r.candidates.length) ? "pick" : "add");

  // Name-back detail for an existing (update) target so a wrong-identity match is caught before write.
  let personDetail = "", personHasDetail = false;
  if (existing) {
    const d = await recognizableDetail(supa, userId, existing.id);
    personDetail = d.detail; personHasDetail = d.hasDetail;
  }

  return {
    preview: true,
    kind,
    captureId: cap.id,
    personId: existing ? existing.id : null,
    personName: existing ? existing.name : null,
    personDetail,
    personHasDetail,
    personHint: name,
    relationshipHint: person.relationship_hint || "",
    birthday: person.birthday || null,
    facts,
    candidates: r.candidates || [],
    evidence: r.evidence,
    count: facts.length,
    source_kind: person.source_kind || "other",
    // TC-99: the confirm card shows the occasion + date and (for an obituary) asks who the user is
    // showing up for with quiet copy. Passed straight through; the client decides the rendering.
    event: person.event || null,
  };
}

// Notes (+ a detected birthday) → the SAME internal fact shape writeFactsToPerson consumes. Notes go
// through the existing extract() locked to this person (so subject-relative facts stay notes, never a
// new person). A detected birthday is appended as an explicit RECURRING dated fact so confirm seeds a
// key_date (capture-resolve → writeFactsToPerson already turns RECURRING/MILESTONE+date into key_dates).
async function notesToFacts(person) {
  const facts = [];
  const notesText = (person.notes || []).join(". ").trim();
  if (notesText) {
    try {
      const parsed = await extract(notesText, { lockedPersonId: "img" }); // lock → person_hint stays empty
      for (const f of parsed.facts || []) facts.push(f);
    } catch (e) { console.error("notesToFacts extract (best-effort)", e); }
  }
  if (person.birthday) {
    facts.push({
      person_hint: "",
      subject: "self",
      relation: "birthday",
      object: "Birthday",
      fact_class: "RECURRING",
      is_health: false,
      event_date: person.birthday,
      suggested_gesture: null,
      confidence: 1,
    });
  }
  // TC-99: the artifact's event → a dated fact that seeds a key_date on confirm, through the SAME
  // writeFactsToPerson path (no parallel write logic). A recurring event (a birthday on a card/baby
  // announcement) → a RECURRING "Birthday" key_date; a one-time event (a wedding date, a loss) → a
  // MILESTONE key_date labeled with the occasion. We only add it when the event carries a real date
  // (a key_date needs one) and it isn't already the birthday we seeded above. An obituary's dateless
  // "loss of <name>" occasion is carried on the preview (quiet confirm copy) rather than as a bogus
  // dated key_date. Recurrence + label come straight from the extracted event — never guessed.
  const ev = person.event;
  if (ev && ev.date && ev.date !== person.birthday) {
    const isBirthday = ev.recurring && /\bbirthday\b/i.test(ev.occasion || "");
    facts.push({
      person_hint: "",
      subject: "self",
      relation: isBirthday ? "birthday" : "event",
      object: isBirthday ? "Birthday" : eventLabel(ev.occasion),
      fact_class: ev.recurring ? "RECURRING" : "MILESTONE",
      is_health: false,
      event_date: ev.date,
      suggested_gesture: null,
      confidence: 1,
    });
  }
  return facts;
}

// A short, human, Title-cased label for an event key_date from the extracted occasion ("wedding" →
// "Wedding"; "baby's arrival" → "Baby's Arrival"). Falls back to a plain word when the occasion is
// empty. No AI tells (no em-dash/ellipsis) — a straight label the user sees on the confirm card.
function eventLabel(occasion) {
  const s = String(occasion || "").trim();
  if (!s) return "A date to remember";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// A short human-readable audit string of what we imported (stored on the capture row like the typed
// door stores raw_text). Never the raw pixels — only the structured summary.
function rawTextFor(person) {
  const bits = [person.name];
  if (person.relationship_hint) bits.push(`(${person.relationship_hint})`);
  for (const id of person.identifiers || []) bits.push(id.value);
  if (person.birthday) bits.push(`birthday ${person.birthday}`);
  if (person.event && (person.event.occasion || person.event.date)) {
    bits.push([person.event.occasion, person.event.date].filter(Boolean).join(" "));
  }
  for (const n of person.notes || []) bits.push(n);
  return bits.filter(Boolean).join(" · ");
}

async function getPerson(supa, userId, personId) {
  const { data } = await supa.from("people").select("id, name").eq("user_id", userId).eq("id", personId).is("deleted_at", null).maybeSingle();
  return data || null;
}

async function insertCapture(supa, userId, row) {
  const { data, error } = await supa.from("captures").insert({ user_id: userId, ...row }).select("id, status, proposed_person_id, match_evidence, parsed").single();
  if (error) throw error;
  return data;
}
