// Thoughts Count — client helpers for the relationship memory (TC-49, spec §4/§7).
//
// Shared by both person-card surfaces (companion.js = personal circle, roster.js = book of
// business) so "Things you've noticed", edit/delete, whole-person delete, and export behave
// identically in both. Reads are plain RLS-scoped anon selects; writes go through the
// authenticated /api/memory endpoint (which enforces the temporal rules server-side).
//
// Principle 4 (spec §7): the engine's vocabulary — fact class, confidence, salience,
// supersede — is NEVER shown here. The user only ever sees warm, plain language.
//
// TC-50: typed free text (the add box + the add-person on-ramp) now routes through the capture
// engine context-locked (lockedPersonId), so "loves hiking; allergic to shellfish" is read into
// the right structured facts instead of one flat note — one memory store, smarter capture.

import { captureExtract } from "/_capture.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "them";
// Subjects that are just "the person themselves" — no need to prefix the note with them.
const GENERIC_SUBJECT = new Set(["them", "they", "self", "i", "me", "you", ""]);

const normRel = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/[\s-]+/g, "_");
const cap = (s) => { s = String(s || ""); return s ? s[0].toUpperCase() + s.slice(1) : s; };
// A "bare" value is a short noun with no verb ("peanuts", "pottery") — it needs a label to make
// sense. A natural phrase ("loves hiking", "collects vintage postcards") already reads on its own,
// so we leave it untouched rather than mangle it ("Enjoys collects vintage postcards").
const VERB_START = /^(a |an |the |is|are|was|were|has|have|had|likes?|loves?|enjoys?|plays?|collects?|makes?|does|did|works?|lives?|prefers?|adopts?|adopted|starts?|started|gets?|got|moves?|moved|owns?|keeps?|goes?|volunteers?|runs?|studies|teaches|wants?|needs?|hates?|dislikes?|avoids?|speaks?|drives?|writes?|reads?)\b/i;
const isBareValue = (o) => { const w = o.trim().split(/\s+/); return w.length <= 3 && !VERB_START.test(o.trim()); };

// Turn a stored (relation, object) into a clear, plain-language line. Category facts are stored as
// bare values ("peanuts" under relation "allergy"); we label them so a glance is never ambiguous —
// an ALLERGY must never read like a mere like (spec: trust/safety). Natural-phrase objects pass
// through unchanged. Engine vocabulary is never shown (spec §7). This same helper feeds noticedList
// → the plan, so the plan also sees "Allergic to peanuts", not a bare "peanuts".
function displayObject(relation, object) {
  const rel = normRel(relation);
  const o = String(object || "").trim();
  if (!o) return o;
  if (rel === "allergy" || rel === "allergies") return /allerg/i.test(o) ? cap(o) : `Allergic to ${o}`;
  if (!isBareValue(o)) return o;
  if (rel === "hobby" || rel === "hobbies") return `Enjoys ${o}`;
  if (rel === "interest" || rel === "interests") return `Interested in ${o}`;
  if (rel === "preference" || rel === "preferences" || rel === "likes") return `Prefers ${o}`;
  if (rel === "food" || rel === "favorite_food" || rel === "drink" || rel === "favorite") return `Loves ${o}`;
  if (rel === "pet" || rel === "pets") return `Has ${o}`;
  return o;
}

// A note shown in plain language: prefix a specific subject ("dad", "daughter Ava"), but not a
// generic self-reference; a category value gets a warm label (displayObject). Engine fields
// (class/confidence) are deliberately never rendered.
function noticedLine(f) {
  const subj = String(f.subject || "").trim();
  const body = displayObject(f.relation, f.object);
  return GENERIC_SUBJECT.has(subj.toLowerCase()) ? body : `${subj} — ${body}`;
}

// The person's noticed items as plain strings — used to pre-fill the intake and to hand the
// remembered context to the plan engine (spec: recorded facts must actually inform the plan).
export function noticedList(facts) {
  return (facts || []).map(noticedLine).filter((s) => s && s.trim());
}

/* ---------------- reads (RLS-scoped anon) ---------------- */

// A person's ACTIVE, undeleted notes — exactly what the card shows (open + not hard-deleted),
// newest first.
export async function loadPersonFacts(sb, personId) {
  const { data, error } = await sb
    .from("facts")
    .select("id,subject,relation,object,event_date,created_at")
    .eq("person_id", personId)
    .is("valid_to", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) { console.error("loadPersonFacts", error); return []; }
  return data || [];
}

// Bulk load for a small set of people (the personal circle) — one query, grouped by person.
export async function loadFactsFor(sb, personIds) {
  const map = {};
  if (!personIds || !personIds.length) return map;
  const { data, error } = await sb
    .from("facts")
    .select("id,person_id,subject,relation,object,event_date,created_at")
    .in("person_id", personIds)
    .is("valid_to", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) { console.error("loadFactsFor", error); return map; }
  for (const f of data || []) (map[f.person_id] ||= []).push(f);
  return map;
}

/* ---------------- writes (authenticated /api/memory) ---------------- */

async function memoryPost(sb, body) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  const res = await fetch("/api/memory", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong. Please try again.");
  return json;
}

// Save free text about a known person through the capture engine, context-locked to them
// (TC-50). Identity is certain (we're on/creating this person), so the engine skips resolution,
// reads the text into one or more structured facts, and writes them immediately (Level A).
// Returns { saved, count, message }. If extraction is unavailable, falls back to a single
// append-only note so the box never breaks.
export async function captureNote(sb, personId, text) {
  const object = String(text || "").trim();
  if (!object) return { saved: false, count: 0 };
  try {
    const result = await captureExtract(sb, { rawText: object, lockedPersonId: personId, source: "typed" });
    const caps = result?.captures || [];
    const count = caps.reduce((n, c) => n + (c.count || 0), 0);
    if (count > 0) return { saved: true, count };
    return { saved: false, count: 0, message: result?.message || "Nothing to save there yet — try naming what you noticed." };
  } catch (e) {
    console.error("captureNote falling back to plain note", e);
    await memoryPost(sb, { op: "create_fact", personId, subject: "them", relation: "note", object, source: "typed", factClass: "DURABLE" });
    return { saved: true, count: 1, fallback: true };
  }
}

// Back-compat alias — the add-person on-ramp + intake save "the first thing you know about them".
// Same one store, now smarter (extraction). Kept as createNote so existing call sites are unchanged.
export async function createNote(sb, personId, text) {
  return captureNote(sb, personId, text);
}

/* ---------------- "Things you've noticed" (read / add / edit / delete) ---------------- */

// Mount the notes UI into an (empty) container element and keep it self-refreshing across
// add / edit / delete. opts.facts = initial rows (skips a fetch); opts.onChange = called after
// any change so the caller can refresh anything derived (counts, etc.).
export function mountNoticed(container, sb, person, opts = {}) {
  let facts = opts.facts || null;
  const onChange = typeof opts.onChange === "function" ? opts.onChange : () => {};

  async function refresh(fetch = true) {
    if (fetch || !facts) facts = await loadPersonFacts(sb, person.id);
    render();
  }

  function render() {
    const list = facts || [];
    const rows = list.length
      ? list.map((f) => `
          <div class="tc-noticed-row" data-fid="${f.id}">
            <span class="tc-noticed-txt">${esc(noticedLine(f))}</span>
            <span class="tc-noticed-tools">
              <button class="link-btn tc-noticed-edit" data-fid="${f.id}" aria-label="Edit">Edit</button>
              <button class="link-btn tc-noticed-del" data-fid="${f.id}" aria-label="Remove">Remove</button>
            </span>
          </div>`).join("")
      : `<div class="tc-empty tc-noticed-empty">Nothing noted yet — jot down anything worth remembering about ${esc(firstName(person.name))}.</div>`;

    container.innerHTML = `
      <div class="tc-noticed">
        <div class="tc-noticed-head">Things you've noticed</div>
        <div class="tc-noticed-list">${rows}</div>
        <div class="tc-noticed-add">
          <input type="text" class="tc-noticed-input" placeholder="Something worth remembering…" />
          <button class="link-btn tc-noticed-save">Add</button>
        </div>
        <div class="k-msg tc-noticed-msg"></div>
      </div>`;
    wire();
  }

  function wire() {
    const msg = container.querySelector(".tc-noticed-msg");
    const setMsg = (t, bad) => { msg.className = "k-msg tc-noticed-msg" + (bad ? " bad" : ""); msg.textContent = t || ""; };

    // Add
    const input = container.querySelector(".tc-noticed-input");
    const add = async () => {
      const text = (input.value || "").trim();
      if (!text) { input.focus(); return; }
      setMsg("Reading…");
      try {
        // Context-locked capture: reads the text into structured fact(s) on THIS person (TC-50).
        const r = await captureNote(sb, person.id, text);
        if (!r.saved) { setMsg(r.message, false); return; }
        input.value = "";
        setMsg("");
        await refresh();
        onChange();
      } catch (e) { setMsg(e.message, true); }
    };
    container.querySelector(".tc-noticed-save").onclick = add;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });

    // Edit (inline)
    container.querySelectorAll(".tc-noticed-edit").forEach((btn) => {
      btn.onclick = () => {
        const row = container.querySelector(`.tc-noticed-row[data-fid="${btn.dataset.fid}"]`);
        const f = (facts || []).find((x) => x.id === btn.dataset.fid);
        if (!row || !f) return;
        row.innerHTML = `
          <input type="text" class="tc-noticed-editinput" value="${esc(f.object)}" />
          <span class="tc-noticed-tools">
            <button class="link-btn tc-noticed-savedit">Save</button>
            <button class="link-btn tc-noticed-canceledit">Cancel</button>
          </span>`;
        const ei = row.querySelector(".tc-noticed-editinput");
        ei.focus(); ei.setSelectionRange(ei.value.length, ei.value.length);
        const save = async () => {
          const val = (ei.value || "").trim();
          if (!val) return;
          setMsg("Saving…");
          try { await memoryPost(sb, { op: "update_fact", factId: f.id, patch: { object: val } }); await refresh(); onChange(); }
          catch (e) { setMsg(e.message, true); }
        };
        row.querySelector(".tc-noticed-savedit").onclick = save;
        ei.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") render(); });
        row.querySelector(".tc-noticed-canceledit").onclick = () => render();
      };
    });

    // Delete (two-step inline confirm — no blocking browser dialog)
    container.querySelectorAll(".tc-noticed-del").forEach((btn) => {
      btn.onclick = () => {
        const row = container.querySelector(`.tc-noticed-row[data-fid="${btn.dataset.fid}"]`);
        const tools = row && row.querySelector(".tc-noticed-tools");
        if (!tools) return;
        tools.innerHTML = `<span class="tc-noticed-confirm">Remove this? <button class="link-btn tc-noticed-yes">Yes</button> · <button class="link-btn tc-noticed-no">Keep</button></span>`;
        tools.querySelector(".tc-noticed-no").onclick = () => render();
        tools.querySelector(".tc-noticed-yes").onclick = async () => {
          setMsg("Removing…");
          try { await memoryPost(sb, { op: "delete_fact", factId: btn.dataset.fid }); await refresh(); onChange(); }
          catch (e) { setMsg(e.message, true); }
        };
      };
    });
  }

  refresh(!opts.facts);
  return { refresh };
}

/* ---------------- whole-person delete (spec §4) ---------------- */

// A small, deliberately-quiet danger control: "Remove {name}" → inline "are you sure". On
// confirm, hard-deletes the person (server tombstones deleted_at → gone from every read and
// nudge) and calls onDeleted so the surface can drop the card.
export function mountPersonDelete(container, sb, person, { onDeleted } = {}) {
  const render = () => {
    container.innerHTML = `<button class="link-btn tc-person-del">Remove ${esc(firstName(person.name))} and everything saved</button><div class="k-msg tc-person-del-msg"></div>`;
    container.querySelector(".tc-person-del").onclick = () => {
      container.querySelector(".tc-person-del").outerHTML = `
        <span class="tc-person-del-confirm">Permanently remove ${esc(person.name)} and everything you've saved about them?
        <button class="link-btn tc-person-del-yes">Yes, remove</button> · <button class="link-btn tc-person-del-no">Cancel</button></span>`;
      container.querySelector(".tc-person-del-no").onclick = render;
      container.querySelector(".tc-person-del-yes").onclick = async () => {
        const msg = container.querySelector(".tc-person-del-msg");
        msg.className = "k-msg tc-person-del-msg"; msg.textContent = "Removing…";
        try { await memoryPost(sb, { op: "delete_person", personId: person.id }); if (typeof onDeleted === "function") onDeleted(); }
        catch (e) { msg.className = "k-msg tc-person-del-msg bad"; msg.textContent = e.message; render(); }
      };
    };
  };
  render();
}

/* ---------------- export (client-side gather — spec §4, never paywalled) ---------------- */

// Gather everything we hold for the signed-in user (people + their notes, dates, plans) via
// RLS-scoped reads and download it as JSON. No server endpoint needed; the user owns their
// memory and can take it any time.
export async function exportUserData(sb, user) {
  const [{ data: people }, { data: facts }, { data: dates }, { data: plans }, { data: households }] = await Promise.all([
    sb.from("people").select("id,name,relationship,location,contact_kind,household_id,created_at").is("deleted_at", null),
    sb.from("facts").select("id,person_id,household_id,subject,relation,object,event_date,valid_from,valid_to,created_at").is("deleted_at", null),
    sb.from("key_dates").select("id,person_id,label,kind,event_date,recurs,lead_days,source_fact_id"),
    sb.from("saved_plans").select("id,person_id,plan_title,occasion,plan,created_at"),
    sb.from("households").select("id,label,created_at"),
  ]);
  const payload = {
    exported_at: new Date().toISOString(),
    account: user?.email || null,
    people: people || [],
    households: households || [],
    things_you_noticed: facts || [],
    dates: dates || [],
    plans: plans || [],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `thoughts-count-my-data-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return payload;
}
