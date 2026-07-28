// Thoughts Count — smart contact import (pro). The make-or-break experience: drop in
// ANY file — any column names, any order, no template — and it just works. The browser
// parses the file, sniffs the obvious columns, asks the server to resolve only the
// ambiguous ones, shows a one-glance preview, commits through the dedup core, and
// carries any genuine duplicates into a one-tap review. The user never gets homework.
//
// Launched by roster.js: openImport({ sb, onComplete }). Uses the passed Supabase client
// for RLS-safe reads and its JWT for the authenticated import endpoints.

import Papa from "https://esm.sh/papaparse@5.4.1";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Canonical fields + the friendly labels shown in the override dropdown.
const FIELD_OPTIONS = [
  { v: "name", label: "Full name" },
  { v: "first_name", label: "First name" },
  { v: "last_name", label: "Last name" },
  { v: "email", label: "Email" },
  { v: "phone", label: "Phone" },
  { v: "relationship", label: "Relationship / type" },
  { v: "notes", label: "Notes" },
  { v: "location", label: "Location" },
  { v: "key_date:birthday", label: "Birthday" },
  { v: "key_date:work_anniversary", label: "Work anniversary" },
  { v: "key_date:closing", label: "Closing / client since" },
  { v: "key_date:custom", label: "Other important date" },
  { v: "ignore", label: "Don't import this column" },
];

let SB = null, onDone = null;
let state = null; // { headers, rows, samples, mapping:{i->fieldValue}, filename }

export function openImport({ sb, onComplete } = {}) {
  SB = sb;
  onDone = onComplete || (() => {});
  ensureScrim();
  show(pickView());
  wirePick();
  openScrim();
}

async function token() {
  const { data } = await SB.auth.getSession();
  return data?.session?.access_token || null;
}

/* ---------------- overlay ---------------- */
function ensureScrim() {
  if (document.getElementById("tcImportScrim")) return;
  const m = document.createElement("div");
  m.className = "scrim tc-import-scrim";
  m.id = "tcImportScrim";
  m.innerHTML = `<div class="panel"><div class="panel-head tc-imp-head">
      <div class="brand"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="#7d8a68" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M12 20s-7-4.2-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7-2.7c1.4 1.9.9 4.4-.6 6.2"/><circle cx="17.5" cy="15.5" r="2.4" fill="none" stroke="#c28a63" stroke-width="1.6"/></svg> Import contacts</div>
      <button class="close" id="tcImpClose" aria-label="Close">✕</button>
    </div><div id="tcImpBody"></div></div>`;
  document.body.appendChild(m);
  m.addEventListener("click", (e) => { if (e.target === m) closeScrim(); });
  m.querySelector("#tcImpClose").onclick = closeScrim;
}
function openScrim() { document.getElementById("tcImportScrim").classList.add("open"); document.body.style.overflow = "hidden"; }
function closeScrim() { const m = document.getElementById("tcImportScrim"); if (m) m.classList.remove("open"); document.body.style.overflow = ""; }
const body = () => document.getElementById("tcImpBody");
function show(html) { body().innerHTML = html; }

/* ---------------- step 1: pick a file ---------------- */
function pickView() {
  return `<div class="panel-body">
    <div class="q-eyebrow">Your book of business</div>
    <h2 class="q-title" style="margin-bottom:4px;">Bring your people in</h2>
    <p class="q-help">Drop in a file from anywhere — a CRM export, a spreadsheet, your contacts. Any columns, any order. We'll figure out the rest.</p>
    <label class="tc-drop" id="tcDrop">
      <input type="file" id="tcFile" accept=".csv,text/csv,.txt" hidden />
      <div class="tc-drop-ic">＋</div>
      <div class="tc-drop-main">Choose a CSV file</div>
      <div class="tc-drop-sub">or drag it here · no template needed, we map the columns for you</div>
    </label>
    <div class="k-msg" id="tcImpMsg"></div>
  </div>`;
}

function wirePick() {
  const drop = body().querySelector("#tcDrop");
  const file = body().querySelector("#tcFile");
  file.onchange = () => file.files[0] && handleFile(file.files[0]);
  ["dragenter", "dragover"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (ev) => { const f = ev.dataTransfer?.files?.[0]; if (f) handleFile(f); });
}

function msg(text, cls = "") { const m = body().querySelector("#tcImpMsg"); if (m) { m.className = "k-msg " + cls; m.textContent = text; } }

function handleFile(file) {
  msg("Reading your file…");
  Papa.parse(file, {
    header: true,
    skipEmptyLines: "greedy",
    complete: async (res) => {
      const rows = (res.data || []).filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== ""));
      const headers = (res.meta?.fields || []).map((h) => String(h ?? "").trim());
      if (!headers.length || !rows.length) { msg("That file looked empty — try another export.", "bad"); return; }
      state = { headers, rows, filename: file.name, mapping: {} };
      await analyze();
    },
    error: () => msg("We couldn't read that file. A .csv export works best.", "bad"),
  });
}

/* ---------------- client heuristics (pre-filter; server is authoritative) ---------------- */
// Mirrors import-analyze.mjs so obvious columns resolve instantly and only the genuine
// remainder's sample values ever leave the browser.
function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|[a-z]{3,9}\.?\s+\d{1,2},?\s+\d{2,4})$/i;
const PHONE_RE = /^[+(]?[\d][\d\s().\-]{6,}$/;

function headerRule(h) {
  if (h.includes("email") || h === "mail") return { field: "email" };
  if (h.includes("mobile") || h.includes("cell") || h.includes("phone") || h.includes("telephone")) return { field: "phone" };
  if (h.includes("firstname") || h === "fname" || h.includes("givenname")) return { field: "first_name" };
  if (h.includes("lastname") || h === "lname" || h.includes("surname") || h.includes("familyname")) return { field: "last_name" };
  if (h === "name" || h.includes("fullname") || h.includes("contactname") || h.includes("clientname") || h.includes("displayname")) return { field: "name" };
  if (h.includes("birthday") || h.includes("birthdate") || h === "dob" || h === "bday" || h.includes("dateofbirth")) return { field: "key_date", kind: "birthday" };
  if (h.includes("workanniversary") || h.includes("workanniv") || h.includes("startdate") || h.includes("hiredate")) return { field: "key_date", kind: "work_anniversary" };
  if (h.includes("closing") || h.includes("closedate") || h.includes("clientsince") || h.includes("customersince")) return { field: "key_date", kind: "closing" };
  if (h.includes("anniversary")) return { field: "key_date", kind: "work_anniversary" };
  if (h.includes("relationship") || h === "type" || h.includes("category") || h.includes("role") || h === "stage" || h.includes("segment")) return { field: "relationship" };
  if (h.includes("note") || h.includes("comment") || h.includes("memo") || h.includes("description")) return { field: "notes" };
  if (h.includes("address") || h === "city" || h.includes("state") || h === "zip" || h.includes("zipcode") || h.includes("postal") || h.includes("location") || h.includes("region")) return { field: "location" };
  if (h.includes("date") && !h.includes("update") && !h.includes("create")) return { field: "key_date", kind: "custom" };
  return null;
}
function sniffClient(header, samples) {
  const byHeader = headerRule(norm(header));
  if (byHeader) return { ...byHeader, confident: true };
  const sv = samples.filter((v) => String(v ?? "").trim() !== "");
  if (sv.length) {
    const frac = (p) => sv.filter(p).length / sv.length;
    if (frac((v) => EMAIL_RE.test(String(v).trim())) >= 0.6) return { field: "email", confident: true };
    if (frac((v) => PHONE_RE.test(String(v).trim()) && String(v).replace(/\D/g, "").length >= 7) >= 0.6) return { field: "phone", confident: true };
    if (frac((v) => DATE_RE.test(String(v).trim())) >= 0.6) return { field: "key_date", kind: "custom", confident: false };
  }
  return { field: "ignore", confident: false };
}
function toValue(g) { return g.field === "key_date" ? "key_date:" + (g.kind || "custom") : g.field; }
function samplesFor(i) {
  const h = state.headers[i];
  return state.rows.slice(0, 8).map((r) => r[h]).filter((v) => String(v ?? "").trim() !== "").slice(0, 5);
}

/* ---------------- step 2: analyze + preview ---------------- */
async function analyze() {
  show(`<div class="panel-body"><p class="q-help">Reading your columns…</p><div class="tc-spin"></div></div>`);
  const ambiguous = {};
  state.headers.forEach((h, i) => {
    const g = sniffClient(h, samplesFor(i));
    state.mapping[i] = toValue(g);
    if (!g.confident) ambiguous[i] = samplesFor(i);
  });

  // Ask the server about the ambiguous remainder only. Never blocks: on any failure we
  // keep our heuristic guesses and let the user adjust.
  if (Object.keys(ambiguous).length) {
    try {
      const tk = await token();
      const res = await fetch("/api/import/analyze", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + tk },
        body: JSON.stringify({ headers: state.headers, samples: ambiguous }),
      });
      if (res.ok) {
        const data = await res.json();
        const kd = new Map((data.keyDateColumns || []).map((k) => [k.colIndex, k.kind]));
        for (const [i, field] of Object.entries(data.mapping || {})) {
          if (ambiguous[i] === undefined) continue; // only override columns we flagged
          state.mapping[i] = field === "key_date" ? "key_date:" + (kd.get(+i) || "custom") : field;
        }
      }
    } catch (e) { console.error("analyze failed, using heuristics", e); }
  }
  show(previewView());
  wirePreview();
}

function fieldSelect(i) {
  const cur = state.mapping[i] || "ignore";
  const opts = FIELD_OPTIONS.map((o) => `<option value="${o.v}"${o.v === cur ? " selected" : ""}>${o.label}</option>`).join("");
  return `<select class="tc-select tc-map-sel" data-i="${i}">${opts}</select>`;
}
function previewView() {
  const n = state.rows.length;
  const rows = state.headers.map((h, i) => {
    const sv = samplesFor(i).slice(0, 3).map((v) => esc(v)).join(" · ") || "<span class='tc-mut'>—</span>";
    return `<div class="tc-map-row">
      <div class="tc-map-col"><div class="tc-map-h">${esc(h) || "<span class='tc-mut'>(unnamed)</span>"}</div><div class="tc-map-samp">${sv}</div></div>
      <div class="tc-map-arrow">→</div>
      <div class="tc-map-field">${fieldSelect(i)}</div>
    </div>`;
  }).join("");
  return `<div class="panel-body">
    <div class="q-eyebrow">A quick glance</div>
    <h2 class="q-title" style="margin-bottom:4px;">${n} contact${n === 1 ? "" : "s"} ready</h2>
    <p class="q-help">Here's how we read your columns. Change anything that looks off — most files need no changes at all.</p>
    <div class="tc-map">${rows}</div>
    <div class="nav" style="margin-top:18px;"><button class="link-btn" id="tcBack">← Choose another file</button><button class="cta" id="tcCommit">Import ${n} contact${n === 1 ? "" : "s"} →</button></div>
    <div class="k-msg" id="tcImpMsg"></div>
  </div>`;
}
function wirePreview() {
  body().querySelectorAll(".tc-map-sel").forEach((sel) => { sel.onchange = () => { state.mapping[sel.dataset.i] = sel.value; }; });
  body().querySelector("#tcBack").onclick = () => { show(pickView()); wirePick(); };
  body().querySelector("#tcCommit").onclick = commit;
}

/* ---------------- step 3: commit ---------------- */
function buildRows() {
  const map = state.mapping;
  return state.rows.map((r) => {
    const out = { key_dates: [] };
    state.headers.forEach((h, i) => {
      const f = map[i];
      const val = String(r[h] ?? "").trim();
      if (!f || f === "ignore" || val === "") return;
      if (f.startsWith("key_date:")) {
        out.key_dates.push({ kind: f.split(":")[1], date: val });
      } else {
        out[f] = val; // last non-empty column wins for a given field
      }
    });
    if (!out.key_dates.length) delete out.key_dates;
    return out;
  });
}

async function commit() {
  const rows = buildRows();
  show(`<div class="panel-body"><div class="q-eyebrow">Bringing them in</div>
    <h2 class="q-title" style="margin-bottom:6px;">Importing your contacts…</h2>
    <p class="q-help">Matching against anyone you already have, so nobody's doubled up.</p>
    <div class="tc-progress"><div class="tc-progress-bar" id="tcPbar" style="width:8%"></div></div>
    <div class="k-msg" id="tcImpMsg"></div></div>`);
  try {
    const tk = await token();
    const auth = { "content-type": "application/json", authorization: "Bearer " + tk };
    let summary;
    if (rows.length <= 200) {
      const res = await fetch("/api/import/commit", { method: "POST", headers: auth, body: JSON.stringify({ filename: state.filename, rows }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Import failed.");
      summary = await res.json();
      setBar(100);
    } else {
      const jobId = "imp_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      const res = await fetch("/api/import/commit-background", { method: "POST", headers: auth, body: JSON.stringify({ jobId, filename: state.filename, rows }) });
      if (res.status !== 202 && !res.ok) throw new Error("Import failed to start.");
      summary = await pollImport(jobId);
    }
    show(summaryView(summary));
    wireSummary(summary);
  } catch (e) {
    msg(e.message || "Something went wrong. Please try again.", "bad");
  }
}
function setBar(pct) { const b = body().querySelector("#tcPbar"); if (b) b.style.width = Math.max(8, Math.min(100, pct)) + "%"; }
async function pollImport(jobId) {
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    let rec;
    try { rec = await (await fetch("/api/import/status?job_id=" + encodeURIComponent(jobId), { cache: "no-store" })).json(); } catch { continue; }
    if (rec.status === "running" && rec.progress) setBar(Math.round((rec.progress.done / Math.max(1, rec.progress.total)) * 100));
    if (rec.status === "done") return rec.result;
    if (rec.status === "error") throw new Error(rec.error || "Import failed.");
  }
  throw new Error("That import took longer than expected. Please check your roster in a moment.");
}

/* ---------------- step 4: summary ---------------- */
function summaryView(s) {
  const bits = [];
  if (s.added) bits.push(`<b>${s.added}</b> added`);
  if (s.updated) bits.push(`<b>${s.updated}</b> already yours`);
  if (s.needs_review) bits.push(`<b>${s.needs_review}</b> to review`);
  const line = bits.length ? bits.join(" · ") : "Nothing new — you're all caught up";
  const reviewCta = s.needs_review
    ? `<button class="cta" id="tcGoReview">Review ${s.needs_review} possible duplicate${s.needs_review === 1 ? "" : "s"} →</button>`
    : `<button class="cta" id="tcDoneBtn">See my roster →</button>`;
  return `<div class="panel-body" style="text-align:center;">
    <div class="tc-check">✓</div>
    <h2 class="q-title" style="margin:10px 0 6px;">Your people are in</h2>
    <p class="q-help" style="text-align:center;">${line}.</p>
    ${s.skipped ? `<p class="tc-mut" style="font-size:13px;">${s.skipped} row${s.skipped === 1 ? "" : "s"} couldn't be read and were set aside — nothing else was held up.</p>` : ""}
    <div style="margin-top:18px;">${reviewCta}</div>
  </div>`;
}
function wireSummary(s) {
  const go = body().querySelector("#tcGoReview");
  if (go) go.onclick = () => openReview();
  const done = body().querySelector("#tcDoneBtn");
  if (done) done.onclick = () => { closeScrim(); onDone(); };
}

/* ---------------- step 5: review queue (T9) ---------------- */
async function loadCandidates() {
  const { data: cands, error } = await SB
    .from("review_candidates")
    .select("id, score, incoming, existing_person_id")
    .order("created_at", { ascending: true });
  if (error) { console.error(error); return []; }
  const ids = [...new Set((cands || []).map((c) => c.existing_person_id).filter(Boolean))];
  let byId = {};
  if (ids.length) {
    const { data: ppl } = await SB.from("people").select("id, name, relationship, primary_email, primary_phone").in("id", ids);
    byId = Object.fromEntries((ppl || []).map((p) => [p.id, p]));
  }
  return (cands || []).map((c) => ({ ...c, existing: byId[c.existing_person_id] || null }));
}

async function openReview() {
  show(`<div class="panel-body"><p class="q-help">Loading possible duplicates…</p><div class="tc-spin"></div></div>`);
  const cands = await loadCandidates();
  renderReview(cands);
}

function candLine(person, incoming) {
  const bits = [];
  const em = person ? person.primary_email : incoming.email;
  const ph = person ? person.primary_phone : incoming.phone;
  const rel = person ? person.relationship : incoming.relationship;
  if (em) bits.push(esc(em));
  if (ph) bits.push(esc(ph));
  if (rel) bits.push(esc(rel));
  return bits.length ? `<div class="tc-cand-sub">${bits.join(" · ")}</div>` : "";
}
function renderReview(cands) {
  if (!cands.length) {
    show(`<div class="panel-body" style="text-align:center;"><div class="tc-check">✓</div>
      <h2 class="q-title" style="margin:10px 0 6px;">All clear</h2>
      <p class="q-help" style="text-align:center;">No duplicates left to review.</p>
      <div style="margin-top:16px;"><button class="cta" id="tcDoneBtn">See my roster →</button></div></div>`);
    body().querySelector("#tcDoneBtn").onclick = () => { closeScrim(); onDone(); };
    return;
  }
  const cards = cands.map((c) => {
    const inc = c.incoming || {};
    return `<div class="block tc-cand" data-id="${c.id}">
      <div class="tc-cand-q">Are these the same person?</div>
      <div class="tc-cand-pair">
        <div class="tc-cand-side"><div class="tc-cand-tag">Already in your roster</div><div class="tc-cand-name">${esc(c.existing?.name || "Someone")}</div>${candLine(c.existing, inc)}</div>
        <div class="tc-cand-vs">↔</div>
        <div class="tc-cand-side"><div class="tc-cand-tag">Just imported</div><div class="tc-cand-name">${esc(inc.name || "New contact")}</div>${candLine(null, inc)}</div>
      </div>
      <div class="tc-cand-actions">
        <button class="cta ghost tc-keep" data-id="${c.id}">Different people — keep both</button>
        <button class="cta tc-merge" data-id="${c.id}">Same person — merge</button>
      </div>
      <div class="k-msg" data-msg="${c.id}"></div>
    </div>`;
  }).join("");
  show(`<div class="panel-body">
    <div class="q-eyebrow">One quick check</div>
    <h2 class="q-title" style="margin-bottom:4px;">Possible duplicates (${cands.length})</h2>
    <p class="q-help">A few names looked close to people you already have. One tap each — that's it.</p>
    ${cards}
    <div class="nav" style="margin-top:6px;"><span></span><button class="cta ghost" id="tcReviewDone">Finish for now →</button></div>
  </div>`);
  body().querySelectorAll(".tc-merge").forEach((b) => { b.onclick = () => resolve(b.dataset.id, "merge"); });
  body().querySelectorAll(".tc-keep").forEach((b) => { b.onclick = () => resolve(b.dataset.id, "keep_both"); });
  body().querySelector("#tcReviewDone").onclick = () => { closeScrim(); onDone(); };
}

async function resolve(candidateId, action) {
  const card = body().querySelector(`.tc-cand[data-id="${candidateId}"]`);
  const m = body().querySelector(`[data-msg="${candidateId}"]`);
  card.querySelectorAll("button").forEach((b) => (b.disabled = true));
  if (m) { m.className = "k-msg"; m.textContent = action === "merge" ? "Merging…" : "Keeping both…"; }
  try {
    const tk = await token();
    const res = await fetch("/api/review/resolve", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + tk },
      body: JSON.stringify({ candidate_id: candidateId, action }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't resolve that.");
    card.classList.add("tc-cand-done");
    card.style.transition = "opacity .3s ease"; card.style.opacity = "0.35";
    // When the last card is resolved, close out.
    const remaining = [...body().querySelectorAll(".tc-cand")].filter((el) => !el.classList.contains("tc-cand-done"));
    if (!remaining.length) setTimeout(() => renderReview([]), 350);
  } catch (e) {
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
    if (m) { m.className = "k-msg bad"; m.textContent = e.message || "Please try again."; }
  }
}
