// TC-98 / TC-100 — unit tests for the media→person extractor's PURE pieces: the vCard parser and
// the image-extract schema normalization. No network, no DB, no key needed (the multimodal Claude
// call itself is exercised live by the Validator with a real screenshot). Run:
//   node test/spec-tc98-image-vcard.test.mjs
import assert from "node:assert";
import { parseVCard, normalizeExtracted, normEvent } from "../netlify/functions/_extract_image.mjs";

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name} — ${e.message}`); } }

console.log("# parseVCard — basic contact card");
t("name from FN, email+phone as identifiers", () => {
  const { people } = parseVCard(
    "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Maria Edmond\r\nEMAIL;TYPE=INTERNET:maria@example.com\r\nTEL;TYPE=CELL:+13125551234\r\nEND:VCARD\r\n"
  );
  assert.equal(people.length, 1);
  assert.equal(people[0].name, "Maria Edmond");
  assert.equal(people[0].source_kind, "contact_card");
  const emails = people[0].identifiers.filter((i) => i.type === "email").map((i) => i.value);
  const phones = people[0].identifiers.filter((i) => i.type === "phone").map((i) => i.value);
  assert.deepEqual(emails, ["maria@example.com"]);
  assert.deepEqual(phones, ["+13125551234"]);
});

t("name falls back to N when FN absent (First Last order)", () => {
  const { people } = parseVCard("BEGIN:VCARD\nN:Smith;Bill;;;\nEND:VCARD");
  assert.equal(people[0].name, "Bill Smith");
});

t("BDAY full date → YYYY-MM-DD; year-less → sentinel-year recurring (TC-112)", () => {
  const a = parseVCard("BEGIN:VCARD\nFN:A\nBDAY:1990-06-15\nEND:VCARD").people[0];
  assert.equal(a.birthday, "1990-06-15");
  const b = parseVCard("BEGIN:VCARD\nFN:B\nBDAY:19900615\nEND:VCARD").people[0];
  assert.equal(b.birthday, "1990-06-15");
  // TC-112: a year-less vCard BDAY (--MM-DD / --MMDD) is kept as a RECURRING birthday under the
  // sentinel year (never displayed) so it seeds a yearly key_date. We still never GUESS a real year.
  const c = parseVCard("BEGIN:VCARD\nFN:C\nBDAY:--06-15\nEND:VCARD").people[0];
  assert.equal(c.birthday, "0004-06-15");
  const d = parseVCard("BEGIN:VCARD\nFN:D\nBDAY:--0615\nEND:VCARD").people[0];
  assert.equal(d.birthday, "0004-06-15");
  const e = parseVCard("BEGIN:VCARD\nFN:E\nBDAY:garbage\nEND:VCARD").people[0];
  assert.equal(e.birthday, null);
});

t("ORG/TITLE/NOTE become notes", () => {
  const p = parseVCard("BEGIN:VCARD\nFN:C\nORG:Acme Inc\nTITLE:Engineer\nNOTE:met at the conference\nEND:VCARD").people[0];
  assert.ok(p.notes.some((n) => /Acme/.test(n)));
  assert.ok(p.notes.includes("Engineer"));
  assert.ok(p.notes.includes("met at the conference"));
});

t("folded (continuation) lines are unfolded", () => {
  // RFC-6350: a leading space continues the previous line.
  const p = parseVCard("BEGIN:VCARD\nFN:Long\nNOTE:this is a very\n  long folded note\nEND:VCARD").people[0];
  assert.ok(/very long folded note/.test(p.notes[0]));
});

t("BOM + CRLF tolerated", () => {
  const { people } = parseVCard("﻿BEGIN:VCARD\r\nFN:Bom Test\r\nEND:VCARD\r\n");
  assert.equal(people[0].name, "Bom Test");
});

t("escaped commas/semicolons decoded", () => {
  const p = parseVCard("BEGIN:VCARD\nFN:D\nNOTE:hi\\, there\\; friend\nEND:VCARD").people[0];
  assert.equal(p.notes[0], "hi, there; friend");
});

t("multi-card file → one person each + ambiguous_multi_person", () => {
  const r = parseVCard("BEGIN:VCARD\nFN:One\nEND:VCARD\nBEGIN:VCARD\nFN:Two\nEND:VCARD");
  assert.equal(r.people.length, 2);
  assert.equal(r.ambiguous_multi_person, true);
});

t("no-name card is skipped (nothing to resolve on)", () => {
  const r = parseVCard("BEGIN:VCARD\nEMAIL:x@y.com\nEND:VCARD");
  assert.equal(r.people.length, 0);
});

t("duplicate identifier de-duped case-insensitively", () => {
  const p = parseVCard("BEGIN:VCARD\nFN:E\nEMAIL:a@b.com\nEMAIL;TYPE=HOME:A@B.com\nEND:VCARD").people[0];
  assert.equal(p.identifiers.filter((i) => i.type === "email").length, 1);
});

console.log("\n# normalizeExtracted — image schema handling");
t("drops a person with no name; keeps a named one", () => {
  const { people } = normalizeExtracted({ people: [{ name: "" }, { name: "Jon", source_kind: "dm" }] });
  assert.equal(people.length, 1);
  assert.equal(people[0].name, "Jon");
});

t("only a real YYYY-MM-DD birthday survives", () => {
  const p = normalizeExtracted({ people: [{ name: "A", birthday: "June 5" }, { name: "B", birthday: "2001-03-04" }] });
  assert.equal(p.people[0].birthday, null);
  assert.equal(p.people[1].birthday, "2001-03-04");
});

t("identifiers coerced to email/phone and empties dropped", () => {
  const p = normalizeExtracted({ people: [{ name: "A", identifiers: [{ type: "phone", value: "555" }, { type: "weird", value: "z@z.com" }, { type: "email", value: "" }] }] });
  assert.deepEqual(p.people[0].identifiers, [{ type: "phone", value: "555" }, { type: "email", value: "z@z.com" }]);
});

t("confidence clamped to 0..1; source_kind defaults to other", () => {
  const p = normalizeExtracted({ people: [{ name: "A", confidence: 5, name_confidence: -1, source_kind: "bogus" }] });
  assert.equal(p.people[0].confidence, 1);
  assert.equal(p.people[0].name_confidence, 0);
  assert.equal(p.people[0].source_kind, "other");
});

t("two people → ambiguous_multi_person forced true", () => {
  const p = normalizeExtracted({ people: [{ name: "A", source_kind: "dm" }, { name: "B", source_kind: "dm" }], ambiguous_multi_person: false });
  assert.equal(p.ambiguous_multi_person, true);
});

t("empty input → empty, non-ambiguous", () => {
  const p = normalizeExtracted({});
  assert.deepEqual(p, { people: [], ambiguous_multi_person: false });
});

console.log("\n# TC-99 — artifact source_kinds + event capture");

t("artifact source_kinds are accepted; junk falls back to other", () => {
  const kinds = ["business_card", "invitation", "save_the_date", "greeting_card", "announcement", "obituary"];
  for (const k of kinds) {
    const p = normalizeExtracted({ people: [{ name: "A", source_kind: k }] });
    assert.equal(p.people[0].source_kind, k, `expected ${k} to survive`);
  }
  const j = normalizeExtracted({ people: [{ name: "A", source_kind: "flyer" }] });
  assert.equal(j.people[0].source_kind, "other");
});

t("normEvent: null / non-object / empty → null", () => {
  assert.equal(normEvent(null), null);
  assert.equal(normEvent("wedding"), null);
  assert.equal(normEvent({}), null);
  assert.equal(normEvent({ occasion: "", date: "" }), null);
});

t("normEvent: full wedding date → one-time (recurring stays false)", () => {
  const e = normEvent({ occasion: "wedding", date: "2027-06-15", recurring: false });
  assert.deepEqual(e, { occasion: "wedding", date: "2027-06-15", recurring: false });
});

t("normEvent: year-less date → sentinel year (birthday recurs)", () => {
  const e = normEvent({ occasion: "birthday", date: "--06-15", recurring: true });
  assert.equal(e.date, "0004-06-15");
  assert.equal(e.recurring, true);
});

t("normEvent: a date the model guessed a full string onto is rejected", () => {
  const e = normEvent({ occasion: "wedding", date: "next June" });
  // no usable date, but a real occasion survives (a dateless obituary/loss keeps its label)
  assert.equal(e.date, null);
  assert.equal(e.occasion, "wedding");
});

t("normEvent: occasion-only (dateless loss) survives with null date", () => {
  const e = normEvent({ occasion: "loss of Robert Hale", date: null, recurring: false });
  assert.deepEqual(e, { occasion: "loss of Robert Hale", date: null, recurring: false });
});

t("normEvent: recurring defaults to true only for a birthday occasion", () => {
  assert.equal(normEvent({ occasion: "birthday", date: "--03-04" }).recurring, true);
  assert.equal(normEvent({ occasion: "wedding", date: "2027-03-04" }).recurring, false);
});

t("normalizeExtracted carries a clean event through; drops a junk one to null", () => {
  const r = normalizeExtracted({ people: [
    { name: "Ana & Ben", source_kind: "invitation", event: { occasion: "wedding", date: "2027-09-20", recurring: false } },
    { name: "NoEvent", source_kind: "business_card", event: { occasion: "", date: "" } },
    { name: "Bare", source_kind: "greeting_card" },
  ] });
  assert.deepEqual(r.people[0].event, { occasion: "wedding", date: "2027-09-20", recurring: false });
  assert.equal(r.people[1].event, null);
  assert.equal(r.people[2].event, null);
});

t("obituary: only living SURVIVORS are returned (never the deceased); loss rides on each survivor", () => {
  // The prompt bars the deceased from the people array — so a well-formed obituary extraction
  // is survivors only, each carrying the "loss of <deceased>" occasion as context. Two named
  // survivors force ambiguous_multi_person (never auto-pick who the user is showing up for).
  const r = normalizeExtracted({ people: [
    { name: "Mary Hale", relationship_hint: "wife", source_kind: "obituary", event: { occasion: "loss of Robert Hale", date: null, recurring: false } },
    { name: "James Hale", relationship_hint: "son", source_kind: "obituary", event: { occasion: "loss of Robert Hale", date: null, recurring: false } },
  ], ambiguous_multi_person: false });
  assert.equal(r.ambiguous_multi_person, true);
  assert.equal(r.people.length, 2);
  assert.ok(!r.people.some((p) => p.name === "Robert Hale"), "the deceased must never be a returned person");
  assert.equal(r.people[0].event.occasion, "loss of Robert Hale");
});

t("vCard person shape carries event:null (shape parity with image path)", () => {
  const p = parseVCard("BEGIN:VCARD\nFN:Zed\nEND:VCARD").people[0];
  assert.equal(p.event, null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
