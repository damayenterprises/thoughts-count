// TC-38 Validator — unit tests for the pure dedup-core logic in _import.mjs.
// Pure functions only (no Supabase): normalization + natural-key + row shaping.
// Run: node test/import-core.test.mjs
import assert from "node:assert/strict";
import {
  normalizeEmail, normalizePhone, normalizeDate, normalizeName,
  naturalKey, normalizeRow, sameSurname,
} from "../netlify/functions/_import.mjs";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.error("FAIL  " + name + "\n      " + e.message); }
}

console.log("\n# normalizeEmail");
t("lowercases + trims", () => assert.equal(normalizeEmail("  Bob@Example.COM "), "bob@example.com"));
t("rejects junk", () => assert.equal(normalizeEmail("not-an-email"), null));
t("null on empty", () => assert.equal(normalizeEmail(""), null));

console.log("\n# normalizePhone (US default)");
t("US 10-digit → E.164", () => assert.equal(normalizePhone("(213) 373-4253"), "+12133734253"));
t("already E.164", () => assert.equal(normalizePhone("+12133734253"), "+12133734253"));
t("garbage → null (never throws)", () => assert.equal(normalizePhone("call me"), null));
t("too-short → null", () => assert.equal(normalizePhone("123"), null));

console.log("\n# normalizeDate");
t("ISO passthrough", () => assert.equal(normalizeDate("1990-06-05"), "1990-06-05"));
t("US M/D/Y", () => assert.equal(normalizeDate("6/5/1990"), "1990-06-05"));
t("2-digit year pivot <=30 → 2000s", () => assert.equal(normalizeDate("6/5/20"), "2020-06-05"));
t("2-digit year pivot >30 → 1900s", () => assert.equal(normalizeDate("6/5/85"), "1985-06-05"));
t("month name", () => assert.equal(normalizeDate("Jan 5, 1990"), "1990-01-05"));
t("REFUSE year-only (never fabricate a day)", () => assert.equal(normalizeDate("2021"), null));
t("REFUSE year-month", () => assert.equal(normalizeDate("2020-06"), null));
t("REFUSE month-name+year", () => assert.equal(normalizeDate("June 2020"), null));
t("invalid month → null", () => assert.equal(normalizeDate("13/40/2020"), null));

console.log("\n# naturalKey (idempotency spine: email > phone > name)");
t("email wins over phone+name", () => {
  const a = naturalKey({ email: "a@b.com", phone: "+12133734253", name: "Al" });
  const b = naturalKey({ email: "a@b.com", phone: null, name: "Different" });
  assert.equal(a, b, "same email must yield same key regardless of other fields");
});
t("phone used when no email", () => {
  const a = naturalKey({ email: null, phone: "+12133734253", name: "Al" });
  const b = naturalKey({ email: null, phone: "+12133734253", name: "Zed" });
  assert.equal(a, b);
});
t("name-only key is case-insensitive", () => {
  assert.equal(naturalKey({ name: "Jane Doe" }), naturalKey({ name: "jane doe" }));
});
t("different emails → different keys", () => {
  assert.notEqual(naturalKey({ email: "a@b.com" }), naturalKey({ email: "c@d.com" }));
});

console.log("\n# normalizeRow (shaping)");
t("builds name from first+last when no full name", () => {
  const n = normalizeRow({ first_name: "Jane", last_name: "Doe", email: "JANE@x.com" });
  assert.equal(n.name, "Jane Doe");
  assert.equal(n.email, "jane@x.com");
});
t("identifiers include normalized email+phone", () => {
  const n = normalizeRow({ name: "Al", email: "al@x.com", phone: "213-373-4253" });
  const types = n.identifiers.map((i) => i.type).sort();
  assert.deepEqual(types, ["email", "phone"]);
  assert.equal(n.identifiers.find((i) => i.type === "phone").value, "+12133734253");
});
t("falls back to email local-part for name", () => {
  assert.equal(normalizeRow({ email: "solomon@x.com" }).name, "solomon");
});
t("last resort name = 'Unknown contact'", () => {
  assert.equal(normalizeRow({ notes: "hi" }).name, "Unknown contact");
});
t("partial key_date is dropped (not fabricated)", () => {
  const n = normalizeRow({ name: "Al", key_dates: [{ kind: "birthday", date: "2021" }] });
  assert.equal(n.key_dates.length, 0);
});
t("valid key_date kept + normalized", () => {
  const n = normalizeRow({ name: "Al", key_dates: [{ kind: "birthday", date: "6/5/1990" }] });
  assert.equal(n.key_dates.length, 1);
  assert.equal(n.key_dates[0].event_date, "1990-06-05");
  assert.equal(n.key_dates[0].recurs, true);
});
t("same person, identical row → identical natural_key (re-upload idempotency)", () => {
  const row = { name: "Al", email: "AL@x.com", phone: "(213) 373-4253" };
  assert.equal(normalizeRow(row).natural_key, normalizeRow({ ...row }).natural_key);
});
t("edited non-key field keeps same natural_key (email stable)", () => {
  const a = normalizeRow({ name: "Al", email: "al@x.com", notes: "old" });
  const b = normalizeRow({ name: "Al", email: "al@x.com", notes: "new note" });
  assert.equal(a.natural_key, b.natural_key);
});

// ---- Round 2 additions ----

console.log("\n# sameSurname (identifier-poor fuzzy gate — V#1)");
// Must FLAG (same surname, genuine near-dup): review is appropriate.
t("Sara/Sarah Johnson → same surname", () => assert.equal(sameSurname("Sara Johnson", "Sarah Johnson"), true));
t("Michael/Mike Brown → same surname", () => assert.equal(sameSurname("Michael Brown", "Mike Brown"), true));
t("Jane Doe / Jane Ann Doe → same surname", () => assert.equal(sameSurname("Jane Doe", "Jane Ann Doe"), true));
// Must NOT flag (different surname → different people): kills the review flood.
t("David May vs David Kay → different surname", () => assert.equal(sameSurname("David May", "David Kay"), false));
t("Chris P vs Chris Q → single-initial surname never matches", () => assert.equal(sameSurname("Chris P", "Chris Q"), false));
t("no surname collision across different last names", () => assert.equal(sameSurname("Al Smith", "Al Jones"), false));

console.log("\n# comma-in-email (V#4 — dedup must survive RFC-legal commas)");
t("email with comma is still valid + lowercased", () => assert.equal(normalizeEmail("Weird,Name@X.com"), "weird,name@x.com"));
t("comma-email becomes an identifier (so dedup can match it)", () => {
  const n = normalizeRow({ name: "W", email: "weird,name@x.com" });
  assert.ok(n.identifiers.some((i) => i.type === "email" && i.value === "weird,name@x.com"));
});
t("comma-email natural_key is stable across re-upload", () => {
  const a = normalizeRow({ name: "W", email: "weird,name@x.com" });
  const b = normalizeRow({ name: "W", email: "Weird,Name@x.com" });
  assert.equal(a.natural_key, b.natural_key);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
