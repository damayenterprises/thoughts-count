// TC-49 — one-time migration: fold the retired people.notes field into the ONE memory store.
//
// "Things you've noticed" (facts) and the old free-text people.notes are now a single store.
// This moves every existing note in as that person's first noticed item (relation 'note',
// source 'import'), then nulls people.notes so nothing shows the same text twice.
//
// Idempotent: a person whose note already exists as a noticed item is skipped (only the
// nulling runs), so it's safe to re-run — e.g. after a future CSV import writes notes again,
// until the import path itself routes notes into the memory store (Phase 5 / TC-53).
//
// Dry run (default): prints what WOULD change, mutates nothing.
//   node --env-file=.env scripts/migrate-notes-to-facts.mjs
// Apply:
//   node --env-file=.env scripts/migrate-notes-to-facts.mjs --apply

import { serviceClient } from "../netlify/functions/_supabase.mjs";
import { insertFact } from "../netlify/functions/_memory.mjs";

const APPLY = process.argv.includes("--apply");
const supa = serviceClient();

const { data: people, error } = await supa
  .from("people")
  .select("id,user_id,name,notes,deleted_at")
  .not("notes", "is", null);
if (error) { console.error("read failed", error); process.exit(1); }

const withNotes = (people || []).filter((p) => String(p.notes || "").trim() && !p.deleted_at);
console.log(`${withNotes.length} people carry a note to migrate${APPLY ? " (APPLYING)" : " (dry run — no changes)"}\n`);

let inserted = 0, alreadyThere = 0, nulled = 0;
for (const p of withNotes) {
  const note = String(p.notes).trim();
  const { data: existing } = await supa
    .from("facts").select("id")
    .eq("user_id", p.user_id).eq("person_id", p.id).eq("relation", "note").eq("object", note)
    .is("deleted_at", null).maybeSingle();

  if (existing) { alreadyThere++; console.log(`  = ${p.name}: note already a noticed item`); }
  else {
    console.log(`  + ${p.name}: "${note.slice(0, 60)}${note.length > 60 ? "…" : ""}"`);
    if (APPLY) {
      await insertFact(supa, p.user_id, { personId: p.id, subject: "them", relation: "note", object: note, source: "import", provenance: "user_stated", factClass: "DURABLE" });
      inserted++;
    }
  }
  if (APPLY) { await supa.from("people").update({ notes: null }).eq("id", p.id); nulled++; }
}

console.log(`\n${APPLY ? "Applied" : "Would apply"}: ${APPLY ? inserted : withNotes.length - alreadyThere} new noticed items, ${alreadyThere} already present, ${APPLY ? nulled : withNotes.length} notes cleared.`);
if (!APPLY) console.log("Re-run with --apply to make these changes.");
