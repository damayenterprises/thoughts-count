// Thoughts Count — image→person extractor (TC-98, Phase 1b). The multimodal sibling of
// _capture.mjs's text extractor: one Claude call reads a screenshot/photo (a DM, a profile
// header, a phone contact card, a texted message) and returns the PEOPLE literally visible in
// it, in a clean structured shape the capture pipeline can resolve. It also owns a tiny, no-
// dependency vCard parser so the ONE media→person endpoint (capture-image.mjs) can turn a
// shared .vcf into the SAME ExtractedPerson shape without a second brain.
//
// Design rules (mirrors _capture.mjs EXACTLY — reuse the posture, never fork it):
//   • claude-sonnet-4-6, temperature 0, tool_choice FORCED to a schema (same as extract()).
//   • The model is multimodal — it reads DM/profile/contact-card layouts directly. NO separate
//     OCR dependency (the Architect's rule); the image is passed as a base64 content block.
//   • Trust posture is identical to EXTRACT_SYSTEM: never invent a name/email/date; emit only
//     what is literally visible; empty over guessed; a relative merely MENTIONED is a note/
//     subject on the visible person, never a new person; a group thread → ambiguous_multi_person
//     with each person listed, NEVER an auto-pick.
//   • This module does NO resolution and NO writes — it only reads pixels/text into structure.
//     capture-image.mjs funnels every ExtractedPerson through the existing resolvePerson/extract/
//     preview/confirm pipeline, so there is zero parallel resolve-or-write logic here.

import { getEnv } from "./_email.mjs";
import { BDAY_SENTINEL_YEAR } from "./_capture.mjs";

const MODEL = "claude-sonnet-4-6";

// The images we accept. Kept small + explicit so a junk/oversized upload never costs a model
// call (capture-image.mjs guards on this list before we ever reach the API).
export const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const EXTRACTED_PERSON_ITEM = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description:
        "The person's name, EXACTLY as it appears (a display name, an @handle without the @, a contact-card name). Never invent or normalize a name. Empty string if no name is visible for this person.",
    },
    name_confidence: {
      type: "number",
      description: "0..1 — how sure you are you read the name correctly (lower for a stylized handle, a partial crop, low contrast).",
    },
    relationship_hint: {
      type: "string",
      description:
        "How the user seems to know this person, ONLY if the image itself says so (a contact-card label like \"Mom\", a bio line like \"my coach\"). Empty if not shown — never guess a relationship.",
    },
    identifiers: {
      type: "array",
      description: "Contact details LITERALLY visible for this person (an email address, a phone number). Empty if none is shown. Never fabricate one.",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["email", "phone"], description: "email or phone." },
          value: { type: "string", description: "The exact value as shown." },
        },
        required: ["type", "value"],
      },
    },
    birthday: {
      type: "string",
      description: "The person's birthday if clearly visible (e.g. a contact-card birthday field): as YYYY-MM-DD when a full date with a year is shown, or as --MM-DD when only a month+day are shown (no year). Otherwise null. Never infer a day, month, or year.",
    },
    location_hint: {
      type: "string",
      description: "A city/place tied to this person if the image shows one (a profile location, an area code you should NOT guess a city from). Empty if none.",
    },
    notes: {
      type: "array",
      description:
        "Short, plain things worth remembering that are literally stated in/about this image for THIS person — a message they sent, a bio detail, a life event named. Each a brief phrase. A relative MENTIONED here (\"my sister just had a baby\") stays a NOTE, never a new person. Empty if nothing durable.",
      items: { type: "string" },
    },
    source_kind: {
      type: "string",
      enum: ["dm", "profile", "contact_card", "text_thread", "other"],
      description: "What kind of screen this is: a direct-message chat, a social profile header, a phone contact card, a texting thread, or other.",
    },
    confidence: {
      type: "number",
      description: "0..1 — overall confidence this is a real person the user means to add (not, say, a business account or a UI label misread as a name).",
    },
  },
  required: ["name", "source_kind"],
};

const EXTRACT_IMAGE_SCHEMA = {
  type: "object",
  properties: {
    people: {
      type: "array",
      description:
        "Every distinct real PERSON literally visible in the image. Usually one (a DM with one person, one contact card). A group thread has several — list each, and set ambiguous_multi_person. Return an empty array if no person is identifiable.",
      items: EXTRACTED_PERSON_ITEM,
    },
    ambiguous_multi_person: {
      type: "boolean",
      description: "True when TWO OR MORE distinct people appear (a group chat, a thread with several senders). Signals the caller to confirm each separately and NEVER auto-batch a group.",
    },
  },
  required: ["people"],
};

const EXTRACT_IMAGE_SYSTEM = `You look at ONE screenshot or photo a thoughtful person captured about someone they care about — a direct-message chat, a social-media profile, a phone contact card, or a texting thread — and turn the people literally visible in it into clean, structured records for a relationship companion's memory. You are the eyes behind that memory, not a chatbot. Be faithful to exactly what is shown; never invent.

You can read the layout directly (no transcription tool needed): a chat header names who the conversation is with; a profile shows a display name/@handle and sometimes a bio, location, birthday; a contact card shows a name, phone, email, and labeled fields.

Rules:
- Emit ONLY what is literally visible. Never invent or complete a name, email, phone, birthday, or location. Prefer an empty field over a guess.
- The person to add is the OTHER party — the one the user is talking to / looking at — not the user themselves. If the user's own name/handle is visible (e.g. the account header), do not return the user as a person to add.
- A relative or friend merely MENTIONED in a message ("my mom is visiting", "Eli started school") is a NOTE about the visible person, never their own person record.
- Only set birthday when a full, unambiguous date is shown. Only include an identifier (email/phone) that is actually printed on screen.
- If TWO OR MORE distinct people appear (a group chat, a multi-sender thread), set ambiguous_multi_person:true and list each person separately. NEVER pick one for the user.
- If nothing identifiable is present (a meme, a landscape, unreadable), return an empty people array.

Always respond by calling the extract_people tool.`;

// Run the multimodal model on ONE image. Returns { people:[ExtractedPerson], ambiguous_multi_person }
// — a normalized, trusted structure — or throws a friendly error. `rosterNames` (the caller's
// existing roster read) is passed as a light spelling/vocabulary nudge, EXACTLY like transcribe.mjs
// biases Whisper, so a name lands on the spelling the user already saved. Best-effort bias only:
// an empty roster just runs unbiased. NEVER trust a client-supplied roster — the caller derives it
// server-side from the verified token.
export async function extractPersonFromImage(base64, mime, { rosterNames = [] } = {}) {
  const data = String(base64 || "").trim();
  if (!data) return { people: [], ambiguous_multi_person: false };
  const media_type = ALLOWED_IMAGE_MIMES.includes(mime) ? mime : "image/jpeg";

  const apiKey = getEnv("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("extraction is not configured");

  const rosterLine =
    Array.isArray(rosterNames) && rosterNames.length
      ? `\n\nNames the user already saved, spelled their way (use these spellings if you see one of these people): ${rosterNames.slice(0, 60).join(", ")}.`
      : "";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      temperature: 0,
      system: EXTRACT_IMAGE_SYSTEM,
      tools: [{ name: "extract_people", description: "Return the people literally visible in the image.", input_schema: EXTRACT_IMAGE_SCHEMA }],
      tool_choice: { type: "tool", name: "extract_people" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type, data } },
            { type: "text", text: `Read this image and return the person (or people) visible in it.${rosterLine}` },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("extract-image anthropic error", res.status, detail.slice(0, 300));
    throw new Error("We couldn't read that image just now. Please try again.");
  }
  const body = await res.json();
  const toolUse = (body.content || []).find((b) => b.type === "tool_use");
  return normalizeExtracted(toolUse?.input || {});
}

// Coerce the model output into clean, trusted ExtractedPerson[]. Drops people with no usable name
// (nothing to resolve on), clamps confidences, keeps only well-formed identifiers, and only accepts
// a birthday that is a real YYYY-MM-DD (never a partial the model guessed a day onto).
export function normalizeExtracted(input) {
  const raw = Array.isArray(input.people) ? input.people : [];
  const people = [];
  for (const p of raw) {
    const name = String(p.name || "").trim();
    if (!name) continue; // no name → nothing for resolvePerson to work with; skip (never guess one)
    const identifiers = Array.isArray(p.identifiers)
      ? p.identifiers
          .map((i) => ({ type: i.type === "phone" ? "phone" : "email", value: String(i.value || "").trim() }))
          .filter((i) => i.value)
      : [];
    // TC-112: accept a full birthday, or a year-less month+day (normBday maps "--MM-DD" to the
    // sentinel year so it seeds a RECURRING yearly key_date without a bogus year).
    const birthday = normBday(String(p.birthday || ""));
    const notes = Array.isArray(p.notes) ? p.notes.map((n) => String(n || "").trim()).filter(Boolean) : [];
    const source_kind = ["dm", "profile", "contact_card", "text_thread", "other"].includes(p.source_kind) ? p.source_kind : "other";
    people.push({
      name,
      name_confidence: clamp01(p.name_confidence, 0.9),
      relationship_hint: String(p.relationship_hint || "").trim(),
      identifiers,
      birthday,
      location_hint: String(p.location_hint || "").trim(),
      notes,
      source_kind,
      confidence: clamp01(p.confidence, 0.9),
    });
  }
  return { people, ambiguous_multi_person: !!input.ambiguous_multi_person || people.length > 1 };
}

function clamp01(v, dflt) {
  return typeof v === "number" ? Math.max(0, Math.min(1, v)) : dflt;
}

// ──────────────────────────────────────────────────────────────────────────────────────────
//  vCard (.vcf) → ExtractedPerson  (TC-100 — a tiny parser, NO new dependency)
// ──────────────────────────────────────────────────────────────────────────────────────────

// Parse ONE vCard's text into the SAME ExtractedPerson shape the image path emits, so a shared
// .vcf funnels through the identical resolvePerson strong-key (email/phone) dedup + preview/confirm
// pipeline. Deliberately small: it reads the fields that map to a person we remember (FN/N for the
// name, EMAIL, TEL, BDAY, ORG/TITLE/NOTE as notes) and ignores everything else. Handles the common
// real-world shapes phones export — folded (continuation) lines, TYPE params, and a leading BOM —
// without a library. Returns { people:[ExtractedPerson], ambiguous_multi_person } so the caller
// treats vCard and image output identically. A multi-card file (rare on a single share) lists each.
export function parseVCard(text) {
  const cards = splitCards(String(text || ""));
  const people = [];
  for (const card of cards) {
    const person = cardToPerson(card);
    if (person) people.push(person);
  }
  return { people, ambiguous_multi_person: people.length > 1 };
}

// Split a file into BEGIN:VCARD…END:VCARD blocks and UNFOLD RFC-6350 continuation lines (a line
// beginning with a space or tab continues the previous line). Strips a UTF-8 BOM if present.
function splitCards(text) {
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = clean.split("\n");
  const lines = [];
  for (const ln of rawLines) {
    if (/^[ \t]/.test(ln) && lines.length) lines[lines.length - 1] += ln.replace(/^[ \t]/, "");
    else lines.push(ln);
  }
  const cards = [];
  let cur = null;
  for (const ln of lines) {
    if (/^BEGIN:VCARD/i.test(ln)) cur = [];
    else if (/^END:VCARD/i.test(ln)) { if (cur) cards.push(cur); cur = null; }
    else if (cur) cur.push(ln);
  }
  return cards;
}

function cardToPerson(cardLines) {
  let fn = "", nStructured = "";
  const identifiers = [];
  let birthday = null;
  const noteBits = [];

  for (const ln of cardLines) {
    const colon = ln.indexOf(":");
    if (colon < 0) continue;
    const rawKey = ln.slice(0, colon);
    const value = decodeVValue(ln.slice(colon + 1).trim());
    const key = rawKey.split(";")[0].trim().toUpperCase().replace(/^ITEM\d+\./, "");
    if (!value) continue;

    if (key === "FN") fn = value;
    else if (key === "N") nStructured = nToName(value);
    else if (key === "EMAIL") pushId(identifiers, "email", value);
    else if (key === "TEL") pushId(identifiers, "phone", value);
    else if (key === "BDAY") { const b = normBday(value); if (b) birthday = b; }
    else if (key === "ORG") noteBits.push(`works at ${value.replace(/;+$/, "").replace(/;/g, ", ")}`);
    else if (key === "TITLE") noteBits.push(value);
    else if (key === "NOTE") noteBits.push(value);
  }

  const name = (fn || nStructured || "").trim();
  if (!name) return null; // no name → nothing to resolve on; skip (mirrors the image path)
  return {
    name,
    name_confidence: 1,
    relationship_hint: "",
    identifiers,
    birthday,
    location_hint: "",
    notes: noteBits.filter(Boolean),
    source_kind: "contact_card",
    confidence: 1,
  };
}

// "Last;First;Middle;Prefix;Suffix" → "First Last" (fall back to whatever tokens are present).
function nToName(v) {
  const parts = v.split(";").map((s) => s.trim());
  const [last = "", first = "", middle = ""] = parts;
  return [first, middle, last].filter(Boolean).join(" ").trim();
}

// Accept a full birthday (YYYY-MM-DD or YYYYMMDD) OR a year-less vCard birthday (--MM-DD / --MMDD,
// RFC 6350 §4.3.4). TC-112: a year-less birthday is stored as a RECURRING key_date under a sentinel
// year (BDAY_SENTINEL_YEAR) so it fires yearly and never shows a bogus year — we still never GUESS a
// year; the sentinel is a non-displayed placeholder the rendering layer strips.
function normBday(v) {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^--(\d{2})-?(\d{2})$/); // year-less: "--06-15" or "--0615"
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31) {
    return `${BDAY_SENTINEL_YEAR}-${m[1]}-${m[2]}`;
  }
  return null;
}

function pushId(list, type, value) {
  const v = String(value || "").trim();
  if (v && !list.some((i) => i.type === type && i.value.toLowerCase() === v.toLowerCase())) list.push({ type, value: v });
}

// Minimal value decode: unescape the RFC-6350 backslash escapes phones commonly emit (\n \, \; \\).
// (We do NOT attempt QUOTED-PRINTABLE/base64 photo blobs — those fields aren't ones we keep.)
function decodeVValue(v) {
  return String(v || "").replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}
