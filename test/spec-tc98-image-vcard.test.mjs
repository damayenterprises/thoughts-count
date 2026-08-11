// TC-98 / TC-100 — unit tests for the media→person extractor's PURE pieces: the vCard parser and
// the image-extract schema normalization. No network, no DB, no key needed (the multimodal Claude
// call itself is exercised live by the Validator with a real screenshot). Run:
//   node test/spec-tc98-image-vcard.test.mjs
import assert from "node:assert";
import { parseVCard, normalizeExtracted } from "../netlify/functions/_extract_image.mjs";

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

t("BDAY full date → YYYY-MM-DD; partial/no-year → null", () => {
  const a = parseVCard("BEGIN:VCARD\nFN:A\nBDAY:1990-06-15\nEND:VCARD").people[0];
  assert.equal(a.birthday, "1990-06-15");
  const b = parseVCard("BEGIN:VCARD\nFN:B\nBDAY:19900615\nEND:VCARD").people[0];
  assert.equal(b.birthday, "1990-06-15");
  const c = parseVCard("BEGIN:VCARD\nFN:C\nBDAY:--06-15\nEND:VCARD").people[0];
  assert.equal(c.birthday, null); // never guess a year
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
