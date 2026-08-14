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
import { mountNoticed, mountPersonDelete, exportUserData, loadPersonFacts, noticedList } from "/_memory.js";
import { mountQuickCapture, mountToReview, pendingCount, qcHintHtml, wireQcHint, flashCard } from "/_capture.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "them";
const PAGE = 25;

let sb = null, user = null;
let people = [], query = "", sortBy = "next", page = 0;
let reviewCount = 0;      // captures waiting in To-Review (TC-50)
let reviewOpen = false;   // keep the To-Review panel open across confirms
let highlightId = null;   // a just-saved/created person to flash on the next render

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
      <div class="brand brand-mark-wordmark"><svg viewBox="0 0 250 250" width="24" height="24" aria-hidden="true"><path fill="#118ab9" d="M30.84,247.61c-1.22,0-2.42-.54-3.34-1.57-1.36-1.51-1.87-3.82-1.31-5.92l9.28-34.68C14.07,182.85,2.33,153.46,2.33,122.3,2.33,55.3,57.27.8,124.8.8s122.47,54.5,122.47,121.5-54.94,121.5-122.47,121.5c-19.29,0-38.44-4.55-55.53-13.17l-36.69,16.6c-.57.26-1.16.38-1.74.38ZM69.39,218.66c.68,0,1.35.17,1.99.5,16.31,8.59,34.78,13.13,53.42,13.13,62.16,0,112.73-49.34,112.73-110S186.96,12.3,124.8,12.3,12.07,61.65,12.07,122.3c0,28.9,11.42,56.2,32.16,76.89,1.5,1.5,2.09,3.92,1.5,6.13l-7.2,26.9,29.12-13.18c.56-.25,1.15-.38,1.74-.38Z"/><path fill="#ef4136" d="M148.18,75.95c-7.61,0-15.23,2.92-21.04,8.75l-2.35,2.36-2.35-2.36c-5.81-5.83-13.42-8.75-21.03-8.75-7.62,0-15.23,2.92-21.04,8.76l-.42.43c-11.62,11.67-11.62,30.59,0,42.27l2.35,2.36,5.15,5.18,37.34,37.52,42.5-42.7,2.35-2.36c11.61-11.67,11.61-30.6,0-42.27l-.43-.43c-5.81-5.83-13.42-8.75-21.04-8.75h0Z"/></svg> My roster</div>
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
  reviewOpen = false; // a fresh open starts with the review panel closed
  ensureScrim(); openScrim();
  body().innerHTML = `<div class="panel-body"><p class="q-help">Loading your roster...</p><div class="tc-spin"></div></div>`;
  await reload();
}
async function reload() {
  const { data, error } = await sb
    .from("people")
    .select("id,name,relationship,notes,location,created_at,contact_kind,primary_email,primary_phone,key_dates(id,label,kind,event_date,date_precision,recurs,lead_days)")
    .eq("contact_kind", "contact")
    .is("deleted_at", null) // hard-deleted people (TC-49) never reappear in any read
    .order("created_at", { ascending: false });
  if (error) { console.error(error); body().innerHTML = `<div class="panel-body"><p class="k-msg bad">We couldn't load your roster. Please try again.</p></div>`; return; }
  people = data || [];
  try { reviewCount = await pendingCount(sb); } catch { reviewCount = 0; }
  page = 0;
  render();
}

/* ---------- quick capture + To-Review (TC-50) ---------- */
// Shown once there's a roster (the empty state leads with Import — progressive disclosure).
function captureStripHtml() {
  return `<div class="tc-capstrip" style="margin-top:14px;">
      ${qcHintHtml()}
      <div class="tc-qc-mount"></div>
      <button class="link-btn tc-review-toggle" id="tcReviewToggle">To review${reviewCount ? `<span class="tc-badge-dot">${reviewCount}</span>` : ""}</button>
      <div class="tc-review-panel" id="tcReviewPanel" hidden style="margin-top:10px;"></div>
    </div>`;
}
function wireCaptureStrip() {
  wireQcHint(body());
  const qc = body().querySelector(".tc-qc-mount");
  // A quick capture wrote/queued a note — reload so the fact/new person shows immediately.
  if (qc) mountQuickCapture(qc, sb, { contactKind: "contact", onChange: () => reload() });
  const toggle = body().querySelector("#tcReviewToggle");
  const panel = body().querySelector("#tcReviewPanel");
  if (!toggle || !panel) return;
  const openPanel = () => {
    reviewOpen = true; panel.hidden = false;
    mountToReview(panel, sb, {
      people, contactKind: "contact",
      // After confirm/reassign: reload so the new/updated row appears + flashes, panel stays open.
      onResolved: (res) => { highlightId = res && res.personId; reload(); },
    });
  };
  toggle.onclick = () => { if (panel.hidden) openPanel(); else { reviewOpen = false; panel.hidden = true; } };
  if (reviewOpen && reviewCount) openPanel(); // survive a reload mid-review
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
        <button class="tc-authbtn ghost" id="tcExportBtn">Export my data</button>
        <button class="tc-authbtn" id="tcImportBtn">＋ Import contacts</button>
      </div>
    </div>`;

  if (!total) {
    // Empty roster: lead with Import as the single hero action (progressive disclosure) — no
    // quick-capture until there are people to file notes onto.
    body().innerHTML = head + `<div class="tc-empty" style="padding:26px 0;text-align:center;">
        <p class="q-help" style="text-align:center;">No one here yet. Import a CSV from any CRM or spreadsheet, and we'll map the columns and dedupe for you.</p>
        <button class="cta" id="tcImportBtn2">＋ Import your contacts</button>
      </div></div>`;
    body().querySelector("#tcImportBtn").onclick = launchImport;
    body().querySelector("#tcImportBtn2").onclick = launchImport;
    wireExport();
    return;
  }

  const controls = `<div class="tc-controls" style="margin-top:14px;">
      <input type="text" id="tcRosSearch" placeholder="Search your roster..." autocomplete="off" value="${esc(query)}" />
      <select id="tcRosSort" class="tc-select">
        <option value="next"${sortBy === "next" ? " selected" : ""}>Sort: next date</option>
        <option value="alpha"${sortBy === "alpha" ? " selected" : ""}>Sort: name (A-Z)</option>
        <option value="recent"${sortBy === "recent" ? " selected" : ""}>Sort: recently added</option>
      </select>
    </div>`;

  const rows = slice.map(rowHtml).join("") || `<div class="tc-empty" style="padding:16px 0;">No one matches "${esc(query)}".</div>`;
  const pager = pages > 1 ? `<div class="tc-pager">
      <button class="link-btn" id="tcPrev"${page === 0 ? " disabled" : ""}>← Prev</button>
      <span class="tc-pager-mid">Page ${page + 1} of ${pages}</span>
      <button class="link-btn" id="tcNext"${page >= pages - 1 ? " disabled" : ""}>Next →</button>
    </div>` : "";

  body().innerHTML = head + captureStripHtml() + controls + `<div id="tcRosList" class="tc-ros-list">${rows}</div>` + pager + `</div>`;

  body().querySelector("#tcImportBtn").onclick = launchImport;
  wireExport();
  wireCaptureStrip();
  const searchEl = body().querySelector("#tcRosSearch");
  if (searchEl) searchEl.oninput = () => { query = searchEl.value; page = 0; render(); const s = body().querySelector("#tcRosSearch"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } };
  const sortEl = body().querySelector("#tcRosSort");
  if (sortEl) sortEl.onchange = () => { sortBy = sortEl.value; page = 0; render(); };
  const prev = body().querySelector("#tcPrev"); if (prev) prev.onclick = () => { if (page > 0) { page--; render(); } };
  const next = body().querySelector("#tcNext"); if (next) next.onclick = () => { page++; render(); };
  wireRows();
  if (highlightId) {
    const row = body().querySelector(`.tc-ros-row[data-id="${highlightId}"]`);
    if (row) flashCard(row);
    highlightId = null;
  }
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

// "Export my data" (TC-49) — the user owns their memory and can take it any time.
function wireExport() {
  const btn = body().querySelector("#tcExportBtn");
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true; const prev = btn.textContent; btn.textContent = "Preparing...";
    try { await exportUserData(sb, user); } catch (e) { console.error("export failed", e); }
    btn.disabled = false; btn.textContent = prev;
  };
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
        // A one-time date already in the past shows its real date (e.g. "Apr 2, 2019") — the
        // same value the companion view shows — instead of a vague "past". Recurring → "yearly".
        const when = soon != null ? whenLabel(occ, soon)
          : (d.recurs ? "yearly" : new Date(d.event_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));
        return `<div class="tc-date-row"><span>${esc(d.label)}</span><span class="tc-date-when">${esc(when)}</span></div>`;
      }).join("")
    : `<div class="tc-empty">No dates yet.</div>`;
  const contact = [p.primary_email, p.primary_phone].filter(Boolean).map(esc).join(" · ");
  el.innerHTML = `
    ${contact ? `<div class="tc-ros-contact">${contact}</div>` : ""}
    <div class="tc-dates">${dateHtml}</div>
    <div class="tc-noticed-mount"></div>
    <button class="cta tc-ros-showup" data-id="${p.id}">♡ Help me show up for ${esc(firstName(p.name))}</button>
    <div class="tc-persondel-mount"></div>`;
  el.hidden = false;
  rowEl?.classList.add("open");
  el.querySelector(".tc-ros-showup").onclick = async () => {
    const person = people.find((x) => x.id === id);
    // Hand the plan their remembered memory (TC-49) so recorded facts inform the plan and
    // step 3 pre-fills from what we've noticed, not a notes blob.
    try { if (person) person.noticed = noticedList(await loadPersonFacts(sb, person.id)); } catch (e) { console.error("noticed load failed", e); }
    closeScrim();
    if (window.openFlowForPerson) window.openFlowForPerson(person);
  };
  // "Things you've noticed" (TC-49) — loaded lazily per person on expand (the roster can be
  // hundreds of people, so we never bulk-fetch facts here).
  mountNoticed(el.querySelector(".tc-noticed-mount"), sb, p);
  // Whole-person hard-delete (TC-49) — on removal, reload the roster so the row disappears.
  mountPersonDelete(el.querySelector(".tc-persondel-mount"), sb, p, { onDeleted: () => reload() });
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
  note.className = "k-msg"; note.textContent = "Follow Up Boss sync is coming soon. For now, export a CSV and import it here.";
}
