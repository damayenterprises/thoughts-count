// Thoughts Count — the pro roster: a dense home for a whole book of business.
//
// Deliberately NOT the intimate personal modal (that stays for the handful of people
// closest to you). A roster of hundreds needs search, sort, and paging — so it gets its
// own surface. Same underlying engine though: every row is a person, and "help me show
// up" runs the exact same plan flow. Gated on is_pro (TC-40 stub) and contact_kind.
//
// Self-boots its own Supabase client, which shares the signed-in session that
// companion.js established (supabase-js persists it in localStorage).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openImport } from "/import.js";
import { formatKeyDate, isPartialDate } from "/_dates.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "them";
const PAGE = 25;

let sb = null, user = null;
let people = [], query = "", sortBy = "next", page = 0;

/* ---------- date helpers (mirror companion.js / nudges-cron) ---------- */
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function nextOccurrence(eventDate, recurs) {
  const today = startOfDay(new Date());
  const d = new Date(eventDate + "T00:00:00");
  if (!recurs) return d >= today ? d : null;
  const cand = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (cand < today) cand.setFullYear(today.getFullYear() + 1);
  return cand;
}
function daysUntil(d) { return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000); }
// A warm, human "when". Beyond ~2 months we NAME THE MONTH instead of a flat
// "coming up", so a realtor scanning a roster can tell a date 3 months out from one
// 11 months out (TC-38 UX finding #1). Needs the occurrence date, not just the count.
function whenLabel(occ, days) {
  if (days == null) return "";
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === 7) return "in a week";
  if (days <= 30) return `in ${days} days`;
  if (days <= 60) return "in about a month";
  if (occ) {
    const now = new Date();
    const month = occ.toLocaleDateString(undefined, { month: "long" });
    if (occ.getFullYear() === now.getFullYear()) return `in ${month}`;
    if (occ.getFullYear() === now.getFullYear() + 1) return `next ${month}`;
    return `${month} ${occ.getFullYear()}`;
  }
  return "coming up";
}
function soonestDate(p) {
  let best = null;
  for (const kd of p.key_dates || []) {
    if (isPartialDate(kd.date_precision)) continue; // partials have no real day → never "coming up"
    const occ = nextOccurrence(kd.event_date, kd.recurs);
    if (!occ) continue;
    const days = daysUntil(occ);
    if (!best || days < best.days) best = { days, label: kd.label, occ };
  }
  return best;
}

/* ---------- pro gate (TC-40 stub) ---------- */
// Until billing (TC-40) lands, pro is a local flag. Add ?pro=1 to the URL to enable it
// (and ?pro=0 to turn it off) for demos and review. TC-40 replaces this with the real gate.
function syncProFromUrl() {
  const p = new URLSearchParams(location.search).get("pro");
  if (p === "1") localStorage.setItem("tc_pro", "1");
  if (p === "0") localStorage.removeItem("tc_pro");
}
export function isPro() { return localStorage.getItem("tc_pro") === "1"; }

boot();
async function boot() {
  syncProFromUrl();
  let cfg;
  try { cfg = await (await fetch("/api/public-config", { cache: "no-store" })).json(); } catch { return; }
  if (!cfg || !cfg.enabled) return;
  sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const { data } = await sb.auth.getSession();
  user = data?.session?.user || null;
  sb.auth.onAuthStateChange((_e, s) => { user = s?.user || null; if (window.TCCompanion?.refreshAuthBtn) window.TCCompanion.refreshAuthBtn(); });
  window.TCRoster = { open: openRoster, isPro };
  // Now that the pro gate is known, let the top bar show the roster entry point.
  if (window.TCCompanion?.refreshAuthBtn) window.TCCompanion.refreshAuthBtn();
}

/* ---------- overlay ---------- */
function ensureScrim() {
  if (document.getElementById("tcRosterScrim")) return;
  const m = document.createElement("div");
  m.className = "scrim tc-roster-scrim";
  m.id = "tcRosterScrim";
  m.innerHTML = `<div class="panel tc-roster-panel"><div class="panel-head tc-imp-head">
      <div class="brand"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="#7d8a68" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M12 20s-7-4.2-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7-2.7c1.4 1.9.9 4.4-.6 6.2"/><circle cx="17.5" cy="15.5" r="2.4" fill="none" stroke="#c28a63" stroke-width="1.6"/></svg> My roster</div>
      <button class="close" id="tcRosClose" aria-label="Close">✕</button>
    </div><div id="tcRosBody"></div></div>`;
  document.body.appendChild(m);
  m.addEventListener("click", (e) => { if (e.target === m) closeScrim(); });
  m.querySelector("#tcRosClose").onclick = closeScrim;
}
function openScrim() { document.getElementById("tcRosterScrim").classList.add("open"); document.body.style.overflow = "hidden"; }
function closeScrim() { const m = document.getElementById("tcRosterScrim"); if (m) m.classList.remove("open"); document.body.style.overflow = ""; }
const body = () => document.getElementById("tcRosBody");

/* ---------- open + load ---------- */
async function openRoster() {
  if (!sb) return;
  if (!user) { if (window.TCCompanion?.openSignIn) window.TCCompanion.openSignIn(); return; }
  if (!isPro()) { ensureScrim(); openScrim(); renderUpgrade(); return; }
  ensureScrim(); openScrim();
  body().innerHTML = `<div class="panel-body"><p class="q-help">Loading your roster…</p><div class="tc-spin"></div></div>`;
  await reload();
}
async function reload() {
  const { data, error } = await sb
    .from("people")
    .select("id,name,relationship,notes,location,created_at,contact_kind,primary_email,primary_phone,key_dates(id,label,kind,event_date,date_precision,recurs,lead_days)")
    .eq("contact_kind", "contact")
    .order("created_at", { ascending: false });
  if (error) { console.error(error); body().innerHTML = `<div class="panel-body"><p class="k-msg bad">We couldn't load your roster. Please try again.</p></div>`; return; }
  people = data || [];
  page = 0;
  render();
}

function renderUpgrade() {
  body().innerHTML = `<div class="panel-body" style="text-align:center;">
    <h2 class="q-title" style="margin-bottom:6px;">Your book of business, remembered</h2>
    <p class="q-help" style="text-align:center;">Bring in everyone you look after and we'll help you show up for each of them at the right moment. This is a pro feature.</p>
  </div>`;
}

/* ---------- render ---------- */
function filteredSorted() {
  const q = query.trim().toLowerCase();
  let view = people.filter((p) => !q || (p.name || "").toLowerCase().includes(q) || (p.relationship || "").toLowerCase().includes(q) || (p.primary_email || "").toLowerCase().includes(q));
  if (sortBy === "alpha") view.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  else if (sortBy === "recent") view.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  else view.sort((a, b) => { const na = soonestDate(a), nb = soonestDate(b); return (na ? na.days : 9e9) - (nb ? nb.days : 9e9); });
  return view;
}

function render() {
  const total = people.length;
  const view = filteredSorted();
  const pages = Math.max(1, Math.ceil(view.length / PAGE));
  if (page >= pages) page = pages - 1;
  const slice = view.slice(page * PAGE, page * PAGE + PAGE);

  const head = `<div class="panel-body tc-ros-body">
    <div class="tc-ros-top">
      <div><div class="q-eyebrow">Book of business</div><h2 class="q-title" style="margin:2px 0 0;">${total} ${total === 1 ? "person" : "people"}</h2></div>
      <div class="tc-ros-actions">
        <button class="tc-authbtn" id="tcImportBtn">＋ Import contacts</button>
      </div>
    </div>`;

  if (!total) {
    body().innerHTML = head + `<div class="tc-empty" style="padding:26px 0;text-align:center;">
        <p class="q-help" style="text-align:center;">No one here yet. Import a CSV from any CRM or spreadsheet — we'll map the columns and dedupe for you.</p>
        <button class="cta" id="tcImportBtn2">＋ Import your contacts</button>
      </div></div>`;
    body().querySelector("#tcImportBtn").onclick = launchImport;
    body().querySelector("#tcImportBtn2").onclick = launchImport;
    return;
  }

  const controls = `<div class="tc-controls" style="margin-top:14px;">
      <input type="text" id="tcRosSearch" placeholder="Search your roster…" autocomplete="off" value="${esc(query)}" />
      <select id="tcRosSort" class="tc-select">
        <option value="next"${sortBy === "next" ? " selected" : ""}>Sort: next date</option>
        <option value="alpha"${sortBy === "alpha" ? " selected" : ""}>Sort: name (A–Z)</option>
        <option value="recent"${sortBy === "recent" ? " selected" : ""}>Sort: recently added</option>
      </select>
    </div>`;

  const rows = slice.map(rowHtml).join("") || `<div class="tc-empty" style="padding:16px 0;">No one matches “${esc(query)}”.</div>`;
  const pager = pages > 1 ? `<div class="tc-pager">
      <button class="link-btn" id="tcPrev"${page === 0 ? " disabled" : ""}>← Prev</button>
      <span class="tc-pager-mid">Page ${page + 1} of ${pages}</span>
      <button class="link-btn" id="tcNext"${page >= pages - 1 ? " disabled" : ""}>Next →</button>
    </div>` : "";

  body().innerHTML = head + controls + `<div id="tcRosList" class="tc-ros-list">${rows}</div>` + pager + `</div>`;

  body().querySelector("#tcImportBtn").onclick = launchImport;
  const searchEl = body().querySelector("#tcRosSearch");
  if (searchEl) searchEl.oninput = () => { query = searchEl.value; page = 0; render(); const s = body().querySelector("#tcRosSearch"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } };
  const sortEl = body().querySelector("#tcRosSort");
  if (sortEl) sortEl.onchange = () => { sortBy = sortEl.value; page = 0; render(); };
  const prev = body().querySelector("#tcPrev"); if (prev) prev.onclick = () => { if (page > 0) { page--; render(); } };
  const next = body().querySelector("#tcNext"); if (next) next.onclick = () => { page++; render(); };
  wireRows();
}

function rowHtml(p) {
  const next = soonestDate(p);
  const chip = next && next.days >= 0 ? `<span class="tc-ros-chip">${esc(next.label)} · ${whenLabel(next.occ, next.days)}</span>` : "";
  const sub = [p.relationship, p.primary_email].filter(Boolean).map(esc).join(" · ");
  return `<div class="tc-ros-row" data-id="${p.id}">
      <button class="tc-ros-main" data-id="${p.id}">
        <span class="tc-ros-name">${esc(p.name)}</span>
        ${sub ? `<span class="tc-ros-sub">${sub}</span>` : ""}
      </button>
      <div class="tc-ros-right">${chip}<span class="tc-ros-caret">▾</span></div>
    </div>
    <div class="tc-ros-detail" data-detail="${p.id}" hidden></div>`;
}

function wireRows() {
  body().querySelectorAll(".tc-ros-main").forEach((btn) => { btn.onclick = () => toggleDetail(btn.dataset.id); });
}
function toggleDetail(id) {
  const el = body().querySelector(`[data-detail="${id}"]`);
  if (!el) return;
  const rowEl = body().querySelector(`.tc-ros-row[data-id="${id}"]`);
  if (!el.hidden) { el.hidden = true; rowEl?.classList.remove("open"); return; }
  const p = people.find((x) => x.id === id);
  if (!p) return;
  const dates = (p.key_dates || []).slice().sort((a, b) => {
    // Partials have no real upcoming day → sort as no-occurrence, so they never masquerade
    // as an imminent date among full dates.
    const oa = isPartialDate(a.date_precision) ? null : nextOccurrence(a.event_date, a.recurs);
    const ob = isPartialDate(b.date_precision) ? null : nextOccurrence(b.event_date, b.recurs);
    return (oa ? daysUntil(oa) : 9e9) - (ob ? daysUntil(ob) : 9e9);
  });
  const dateHtml = dates.length
    ? dates.map((d) => {
        // TC-43: partial ("2021" / "June 2020") shows only what was given — no invented day.
        const partial = formatKeyDate(d.event_date, d.date_precision);
        if (partial) return `<div class="tc-date-row"><span>${esc(d.label)}</span><span class="tc-date-when">${esc(partial)}</span></div>`;
        const occ = nextOccurrence(d.event_date, d.recurs); const soon = occ ? daysUntil(occ) : null;
        return `<div class="tc-date-row"><span>${esc(d.label)}</span><span class="tc-date-when">${soon != null ? whenLabel(occ, soon) : (d.recurs ? "yearly" : "past")}</span></div>`;
      }).join("")
    : `<div class="tc-empty">No dates yet.</div>`;
  const contact = [p.primary_email, p.primary_phone].filter(Boolean).map(esc).join(" · ");
  el.innerHTML = `
    ${contact ? `<div class="tc-ros-contact">${contact}</div>` : ""}
    ${p.notes ? `<p class="tc-ros-notes">${esc(p.notes)}</p>` : ""}
    <div class="tc-dates">${dateHtml}</div>
    <button class="cta tc-ros-showup" data-id="${p.id}">♡ Help me show up for ${esc(firstName(p.name))}</button>`;
  el.hidden = false;
  rowEl?.classList.add("open");
  el.querySelector(".tc-ros-showup").onclick = () => {
    const person = people.find((x) => x.id === id);
    closeScrim();
    if (window.openFlowForPerson) window.openFlowForPerson(person);
  };
}

/* ---------- entry points ---------- */
function launchImport() {
  openImport({ sb, onComplete: () => { openScrim(); reload(); } });
}
// DORMANT (UX finding #4): no "Connect Follow Up Boss" entry point until the FUB
// integration actually ships (S1 spike + T11–T16). Kept here so restoring the button is
// a one-line change then — re-add the header button + wire it back to fubStub.
function fubStub() {
  const actions = body().querySelector(".tc-ros-actions") || body();
  let note = body().querySelector("#tcFubNote");
  if (!note) { note = document.createElement("div"); note.id = "tcFubNote"; note.className = "k-msg"; note.style.cssText = "flex-basis:100%;text-align:right;"; actions.appendChild(note); }
  note.className = "k-msg"; note.textContent = "Follow Up Boss sync is coming soon — for now, export a CSV and import it here.";
}
