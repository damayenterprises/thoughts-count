// Thoughts Count — companion layer: passwordless sign-in, a home for the people
// who matter (with their key dates), and "save this plan to a person". Loads
// lazily and stays completely dormant if Supabase isn't configured, so the core
// plan flow is never affected.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatKeyDate, isPartialDate } from "/_dates.js";
import { loadFactsFor, loadPersonFacts, mountNoticed, mountPersonDelete, exportUserData, createNote, noticedList } from "/_memory.js";

let sb = null, user = null;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "them";

// Launch the plan flow for a saved person, handing the intake their remembered memory so the
// plan reads what we've noticed (not a notes blob) and step 3 pre-fills from it (TC-49). Facts
// are re-read fresh so a note just added on the card is included.
async function showUpFor(p) {
  if (!p) return;
  try { p.noticed = noticedList(await loadPersonFacts(sb, p.id)); }
  catch (e) { console.error("noticed load failed", e); p.noticed = noticedList(p.facts || []); }
  if (window.openFlowForPerson) window.openFlowForPerson(p);
}

const KINDS = [
  { v: "birthday", label: "Birthday", recurs: true },
  { v: "work_anniversary", label: "Work anniversary", recurs: true },
  { v: "moment", label: "A one-time reminder to reach out", recurs: false },
  { v: "custom", label: "Something else", recurs: false },
];

// How many days before a date we can nudge. 7 stays the default.
const LEADS = [
  { v: 0, label: "On the day" },
  { v: 2, label: "2 days before" },
  { v: 7, label: "A week before" },
  { v: 14, label: "Two weeks before" },
];

/* ---------------- date helpers (mirror nudges-cron so the UI agrees with it) --- */
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
// The next time a date lands on/after today. Recurring dates roll to this/next year;
// one-offs return null once past.
function nextOccurrence(eventDate, recurs) {
  const today = startOfDay(new Date());
  const d = new Date(eventDate + "T00:00:00");
  if (!recurs) return d >= today ? d : null;
  const cand = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (cand < today) cand.setFullYear(today.getFullYear() + 1);
  return cand;
}
function daysUntil(d) { return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000); }
// Warm, human phrasing of how far out a date is.
function relativeWhen(days) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === 7) return "in a week";
  if (days === 14) return "in two weeks";
  if (days <= 30) return `in ${days} days`;
  if (days <= 60) return "in about a month";
  return "coming up";
}
// The soonest upcoming date across a person's key dates (for card summaries + the
// "coming up" strip). Returns { occ, days, label } or null.
function soonestDate(person) {
  let best = null;
  for (const kd of person.key_dates || []) {
    if (isPartialDate(kd.date_precision)) continue; // partials have no real day → never "coming up"
    const occ = nextOccurrence(kd.event_date, kd.recurs);
    if (!occ) continue;
    const days = daysUntil(occ);
    if (!best || days < best.days) best = { occ, days, label: kd.label };
  }
  return best;
}

boot();

async function boot() {
  let cfg;
  try { cfg = await (await fetch("/api/public-config", { cache: "no-store" })).json(); } catch { return; }
  if (!cfg || !cfg.enabled) return;

  // Did this page load actually come from a magic-link email? (Capture before the
  // client processes and strips the URL.) Only then should we auto-open "Your People".
  let fromMagicLink = /[#&](access_token|refresh_token)=/.test(location.hash) || /[?&]code=/.test(location.search);

  sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const { data } = await sb.auth.getSession();
  user = data?.session?.user || null;

  sb.auth.onAuthStateChange((evt, session) => {
    user = session?.user || null;
    renderAuthBtn();
    // Auto-open "Your People" ONCE, only on a genuine magic-link return. Supabase
    // re-fires SIGNED_IN on session restore and tab refocus, so we consume the flag
    // after the first open — otherwise the panel keeps popping up unbidden when the
    // user comes back to the tab from another screen.
    if (evt === "SIGNED_IN" && fromMagicLink) { fromMagicLink = false; closeModal(); openHome(); }
  });

  ensureModal();
  mountAuthBtn();
  renderAuthBtn();

  window.TCCompanion = { isSignedIn: () => !!user, mountSaveToPerson, openHome, openSignIn, refreshAuthBtn: renderAuthBtn };
}

/* ---------------- top-bar auth button ---------------- */
function mountAuthBtn() {
  let slot = document.getElementById("authSlot");
  if (!slot) { slot = document.createElement("span"); slot.id = "authSlot"; (document.querySelector(".bar") || document.body).appendChild(slot); }
}
function renderAuthBtn() {
  const slot = document.getElementById("authSlot");
  if (!slot) return;
  if (user) {
    // Pro users get a small entry point to their full book-of-business roster (TC-38).
    const pro = !!(window.TCRoster && window.TCRoster.isPro && window.TCRoster.isPro());
    const rosterBtn = pro ? `<button class="tc-authbtn ghost" id="tcRosterBtn" style="margin-right:8px;">☰ My roster</button>` : "";
    slot.innerHTML = rosterBtn + `<button class="tc-authbtn" id="tcHomeBtn">♡ People I care about</button>`;
    const rb = slot.querySelector("#tcRosterBtn");
    if (rb) rb.onclick = () => window.TCRoster.open();
    slot.querySelector("#tcHomeBtn").onclick = openHome;
  } else {
    slot.innerHTML = `<button class="tc-authbtn ghost" id="tcSignInBtn">Sign in</button>`;
    slot.querySelector("#tcSignInBtn").onclick = openSignIn;
  }
}

/* ---------------- reusable modal ---------------- */
function ensureModal() {
  if (document.getElementById("tcModal")) return;
  const m = document.createElement("div");
  m.className = "scrim";
  m.id = "tcModal";
  m.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div class="brand">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="#7d8a68" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M12 20s-7-4.2-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7-2.7c1.4 1.9.9 4.4-.6 6.2"/><circle cx="17.5" cy="15.5" r="2.4" fill="none" stroke="#c28a63" stroke-width="1.6"/></svg>
          Thoughts Count
        </div>
        <button class="close" id="tcModalClose" aria-label="Close">✕</button>
      </div>
      <div id="tcModalBody"></div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
  m.querySelector("#tcModalClose").onclick = closeModal;
}
function openModal() { ensureModal(); document.getElementById("tcModal").classList.add("open"); document.body.style.overflow = "hidden"; }
function closeModal() { const m = document.getElementById("tcModal"); if (m) m.classList.remove("open"); document.body.style.overflow = ""; }
const modalBody = () => document.getElementById("tcModalBody");

/* ---------------- sign in ---------------- */
function openSignIn() {
  openModal();
  modalBody().innerHTML = `
    <div class="panel-body">
      <div class="q-eyebrow">Welcome</div>
      <h2 class="q-title">Keep the people who matter close</h2>
      <p class="q-help">Save the people you care about, their important dates, and your plans — and we'll gently remind you before each one. Just your email, no password.</p>
      <input type="email" id="tcEmail" placeholder="you@email.com" autocomplete="email" />
      <div class="nav"><span></span><button class="cta" id="tcSendLink">Email me a sign-in link →</button></div>
      <div class="k-msg" id="tcAuthMsg"></div>
      <div class="k-privacy">We use your email only for this — no password, no sharing, no spam.</div>
    </div>`;
  const emailEl = modalBody().querySelector("#tcEmail");
  emailEl.focus();
  const send = async () => {
    const email = (emailEl.value || "").trim();
    const msg = modalBody().querySelector("#tcAuthMsg");
    const btn = modalBody().querySelector("#tcSendLink");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.className = "k-msg bad"; msg.textContent = "Please enter a valid email address."; return; }
    btn.disabled = true; msg.className = "k-msg"; msg.textContent = "Sending your link…";
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
    if (error) { btn.disabled = false; msg.className = "k-msg bad"; msg.textContent = error.message || "Could not send the link. Please try again."; return; }
    renderCheckInbox(email);
  };
  modalBody().querySelector("#tcSendLink").onclick = send;
  emailEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
}

// A clean, inviting confirmation after a sign-in link is sent — replaces the form
// entirely (no more email box) so the whole screen says "we've got it, go check".
function renderCheckInbox(email) {
  modalBody().innerHTML = `
    <div class="panel-body" style="text-align:center;">
      <div class="tc-sent-badge" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none" stroke="#7d8a68" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="8" y="13" width="32" height="22" rx="3"/><path d="M9 15l15 11 15-11"/>
          <circle cx="37" cy="34" r="7" fill="#e4ecdb" stroke="#c28a63"/><path d="M34 34l2 2 4-4" stroke="#5f6c4c"/>
        </svg>
      </div>
      <h2 class="q-title" style="margin-top:14px;">Check your inbox</h2>
      <p class="q-help" style="max-width:34ch;margin-left:auto;margin-right:auto;">We just sent a sign-in link to <b>${esc(email)}</b>. Open it from your email and you're in — no password to remember.</p>
      <p class="tc-help-sm" style="text-align:center;max-width:34ch;margin:0 auto 20px;">The link opens right back here. You can safely close this window in the meantime.</p>
      <button class="cta" id="tcInboxDone" style="min-width:180px;justify-content:center;">Got it</button>
      <div class="k-privacy" style="margin-top:16px;">Didn't see it? Check spam, or <button class="link-btn tc-inbox-retry" style="padding:0 2px;">use a different email</button>.</div>
    </div>`;
  modalBody().querySelector("#tcInboxDone").onclick = closeModal;
  modalBody().querySelector(".tc-inbox-retry").onclick = openSignIn;
}

/* ---------------- data ---------------- */
async function loadPeople() {
  // Personal circle ONLY — never the book-of-business roster (TC-46 Fix 1). The roster
  // (roster.js) shows contact_kind='contact'; this intimate list must stay personal, or
  // an import would flood "People I care about" with every client. contact_kind is NOT
  // NULL DEFAULT 'personal', so a plain equality is correct (no legacy NULLs exist).
  const { data, error } = await sb
    .from("people")
    .select("id,name,relationship,notes,location,created_at,key_dates(id,label,kind,event_date,date_precision,recurs,lead_days),saved_plans(id,plan_title,occasion,created_at,plan)")
    .eq("contact_kind", "personal")
    .is("deleted_at", null) // hard-deleted people (TC-49) never reappear in any read
    .order("created_at", { ascending: true });
  if (error) { console.error(error); return []; }
  const people = data || [];
  // Attach each person's "things you've noticed" (TC-49) in one grouped query — the personal
  // circle is small, so a single bulk read keeps the cards instant without N round-trips.
  try {
    const byPerson = await loadFactsFor(sb, people.map((p) => p.id));
    for (const p of people) p.facts = byPerson[p.id] || [];
  } catch (e) { console.error("facts load failed", e); }
  return people;
}
async function addPerson(p) {
  const { data, error } = await sb.from("people").insert({ user_id: user.id, ...p }).select().single();
  if (error) throw error;
  return data;
}
async function addKeyDate(personId, d) {
  const { error } = await sb.from("key_dates").insert({ user_id: user.id, person_id: personId, ...d });
  if (error) throw error;
}
async function savePlan(personId, plan, occasion) {
  const { error } = await sb.from("saved_plans").insert({
    user_id: user.id, person_id: personId, plan_title: plan.plan_title || "", occasion: occasion || "", plan,
  });
  if (error) throw error;
}
// Turn a plan's "keep showing up" follow-ups into real one-off reminders on the
// person, so the most useful nudges (check in in two weeks, a month, a year) are
// actually scheduled instead of living only as a calendar download. Each fires on
// its own day (lead_days 0). Best-effort: a single failure doesn't block the save.
async function addPlanFollowups(personId, plan) {
  const items = (plan.follow_up || []).filter((f) => Number.isFinite(f.days_from_now) && f.days_from_now > 0);
  // Idempotent: re-opening and re-saving the same plan must not stack duplicate
  // reminder rows. Skip any (label, date) we already have for this person.
  let seen = new Set();
  try {
    const { data: existing } = await sb.from("key_dates").select("label,event_date").eq("person_id", personId);
    seen = new Set((existing || []).map((k) => k.label + "|" + k.event_date));
  } catch (e) { console.error("follow-up dedupe lookup failed", e); }
  let count = 0;
  for (const f of items) {
    const dt = new Date(); dt.setDate(dt.getDate() + f.days_from_now);
    const event_date = ymd(dt);
    let label = String(f.gesture || f.when || "Reach out").trim();
    // Truncate by code points, not UTF-16 units, so an emoji/accent can't be cut
    // in half. Array.from splits on code points.
    const chars = Array.from(label);
    if (chars.length > 70) label = chars.slice(0, 67).join("").trimEnd() + "…";
    if (seen.has(label + "|" + event_date)) continue;
    try {
      await addKeyDate(personId, { label, kind: "moment", event_date, recurs: false, lead_days: 0 });
      seen.add(label + "|" + event_date);
      count++;
    } catch (e) { console.error("follow-up reminder insert failed", e); }
  }
  return count;
}

/* ---------------- "Your People" home ---------------- */
async function openHome() {
  if (!user) { openSignIn(); return; }
  openModal();
  modalBody().innerHTML = `<div class="panel-body"><p class="q-help">Loading your people…</p></div>`;
  const people = await loadPeople();
  renderHome(people);
}

function dateLine(d) {
  // TC-43: a partial ("2021" / "June 2020") shows only what was given — no invented day,
  // no relative-when hint (it never nudges), no "yearly".
  const partial = formatKeyDate(d.event_date, d.date_precision);
  if (partial) return `<div class="tc-date-row"><span>${esc(d.label)}</span><span class="tc-date-when">${esc(partial)}</span></div>`;
  const dt = new Date(d.event_date + "T00:00:00");
  const nice = dt.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.recurs ? {} : { year: "numeric" }) });
  const occ = nextOccurrence(d.event_date, d.recurs);
  const soon = occ ? daysUntil(occ) : null;
  const hint = (soon != null && soon <= 45) ? ` · ${relativeWhen(soon)}` : (d.recurs ? " · yearly" : "");
  return `<div class="tc-date-row"><span>${esc(d.label)}</span><span class="tc-date-when">${nice}${hint}</span></div>`;
}

function personCard(p) {
  const sp = p.saved_plans || [];
  const savedHtml = sp.length ? `<div class="tc-savedplans"><div class="tc-sp-label">Plans you've made</div>${
    sp.map((x) => `<button class="tc-sp-row" data-pid="${p.id}" data-spid="${x.id}">${esc(x.plan_title || x.occasion || "A plan")}</button>`).join("")
  }</div>` : "";
  const next = soonestDate(p);
  const nextHtml = next
    ? `<div class="tc-next"><span class="tc-next-dot"></span>${esc(next.label)} — <b>${relativeWhen(next.days)}</b></div>`
    : "";
  const dates = (p.key_dates || []).slice().sort((a, b) => {
    // Partials have no real upcoming day → sort as no-occurrence (with past/undated), so
    // they never masquerade as an imminent date among full dates.
    const oa = isPartialDate(a.date_precision) ? null : nextOccurrence(a.event_date, a.recurs);
    const ob = isPartialDate(b.date_precision) ? null : nextOccurrence(b.event_date, b.recurs);
    return (oa ? daysUntil(oa) : 9e9) - (ob ? daysUntil(ob) : 9e9);
  });
  return `
    <div class="block" data-pid="${p.id}">
      <h4 style="justify-content:space-between;margin-bottom:6px;">
        <span>${esc(p.name)}${p.relationship ? ` <span class="tc-rel">· ${esc(p.relationship)}</span>` : ""}</span>
      </h4>
      ${nextHtml}
      <div class="tc-dates">${dates.map(dateLine).join("") || `<div class="tc-empty">No dates yet — add one so we can gently remind you.</div>`}</div>
      <button class="tc-add-date link-btn" data-pid="${p.id}">+ Add a date or reminder</button>
      <div class="tc-noticed-mount" data-pid="${p.id}"></div>
      ${savedHtml}
      <button class="cta tc-showup" data-pid="${p.id}">♡ Help me show up for ${esc(firstName(p.name))}</button>
      <div class="tc-persondel-mount" data-pid="${p.id}"></div>
    </div>`;
}

function renderHome(people) {
  const email = esc(user.email || "");
  let sortBy = "next", query = "";

  // The soonest 3 upcoming dates across everyone — the most useful thing to see first.
  const upcoming = people
    .map((p) => ({ p, next: soonestDate(p) }))
    .filter((x) => x.next && x.next.days >= 0)
    .sort((a, b) => a.next.days - b.next.days)
    .slice(0, 3);
  const comingUp = upcoming.length ? `
    <div class="tc-comingup">
      <div class="tc-cu-label">Coming up</div>
      ${upcoming.map(({ p, next }) => `
        <button class="tc-cu-row" data-pid="${p.id}">
          <span class="tc-cu-when">${relativeWhen(next.days)}</span>
          <span class="tc-cu-who">${esc(firstName(p.name))} · ${esc(next.label)}</span>
          <span class="tc-cu-go">Help me show up →</span>
        </button>`).join("")}
    </div>` : "";

  const controls = people.length > 1 ? `
    <div class="tc-controls">
      <input type="text" id="tcSearch" placeholder="Search your people…" autocomplete="off" />
      <select id="tcSort" class="tc-select">
        <option value="next">Sort: next date</option>
        <option value="alpha">Sort: name (A–Z)</option>
        <option value="recent">Sort: recently added</option>
      </select>
    </div>` : "";

  modalBody().innerHTML = `
    <div class="panel-body">
      <div class="q-eyebrow">Welcome back</div>
      <h2 class="q-title" style="margin-bottom:10px;">People I care about</h2>
      <div class="tc-promise">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        <span class="tc-promise-txt">We'll <b>gently nudge you before every date that matters</b> — birthdays, anniversaries, hard days — so you're always ready to show up.</span>
      </div>
      <p class="tc-account">Signed in as ${email} · <button class="link-btn tc-export">Export my data</button> · <button class="link-btn tc-signout">Sign out</button></p>
      <div style="height:14px"></div>
      ${comingUp}
      ${controls}
      <div id="tcPeopleList"></div>
      <button class="cta ghost tc-addtoggle" id="tcAddToggle" style="width:100%;justify-content:center;margin-top:6px;">＋ Add someone</button>
      <div class="block tc-addwrap" id="tcAddForm" style="display:none;">
        <h4>Add someone</h4>
        <input type="text" id="np_name" placeholder="Their name" />
        <input type="text" id="np_rel" placeholder="Who they are to you (e.g. someone I manage)" style="margin-top:10px;" />
        <textarea id="np_notes" placeholder="Anything worth remembering about them (optional)" style="margin-top:10px;min-height:64px;"></textarea>
        <div class="nav"><button class="link-btn" id="np_cancel">Cancel</button><button class="cta" id="np_save">Add them →</button></div>
        <div class="k-msg" id="np_msg"></div>
      </div>
    </div>`;

  const listEl = () => modalBody().querySelector("#tcPeopleList");

  // Re-render just the person list for the current search + sort, without a reload.
  function renderList() {
    const q = query.trim().toLowerCase();
    let view = people.filter((p) =>
      !q || (p.name || "").toLowerCase().includes(q) || (p.relationship || "").toLowerCase().includes(q));
    if (sortBy === "alpha") view.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    else if (sortBy === "recent") view.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    else view.sort((a, b) => {
      const na = soonestDate(a), nb = soonestDate(b);
      return (na ? na.days : 9e9) - (nb ? nb.days : 9e9);
    });

    listEl().innerHTML = people.length
      ? (view.length ? view.map(personCard).join("") : `<div class="tc-empty" style="padding:10px 0;">No one matches “${esc(query)}”.</div>`)
      : `<div class="tc-empty" style="padding:8px 0 14px;">No one saved yet. Add the first person who matters to you — a friend, a teammate, someone you manage.</div>`;
    wireCards();
  }

  // (Re)attach handlers for the cards currently in the list.
  function wireCards() {
    listEl().querySelectorAll(".tc-add-date").forEach((btn) => { btn.onclick = () => openAddDate(btn.dataset.pid); });
    // "Things you've noticed" (TC-49) — read/add/edit/delete, seeded from the bulk-loaded facts.
    listEl().querySelectorAll(".tc-noticed-mount").forEach((el) => {
      const p = people.find((x) => x.id === el.dataset.pid);
      if (p) mountNoticed(el, sb, p, { facts: p.facts || [] });
    });
    // Whole-person hard-delete (TC-49) — on removal, refresh the home so the card disappears.
    listEl().querySelectorAll(".tc-persondel-mount").forEach((el) => {
      const p = people.find((x) => x.id === el.dataset.pid);
      if (p) mountPersonDelete(el, sb, p, { onDeleted: async () => renderHome(await loadPeople()) });
    });
    listEl().querySelectorAll(".tc-showup").forEach((btn) => {
      btn.onclick = () => { const p = people.find((x) => x.id === btn.dataset.pid); closeModal(); showUpFor(p); };
    });
    listEl().querySelectorAll(".tc-sp-row").forEach((btn) => {
      btn.onclick = () => {
        const p = people.find((x) => x.id === btn.dataset.pid);
        const rec = (p?.saved_plans || []).find((x) => x.id === btn.dataset.spid);
        if (rec?.plan && window.renderSavedPlan) { closeModal(); window.renderSavedPlan(rec.plan); }
      };
    });
  }

  renderList();

  modalBody().querySelector(".tc-signout").onclick = async () => { await sb.auth.signOut(); closeModal(); };
  const exportBtn = modalBody().querySelector(".tc-export");
  if (exportBtn) exportBtn.onclick = async () => {
    exportBtn.disabled = true; const prev = exportBtn.textContent; exportBtn.textContent = "Preparing…";
    try { await exportUserData(sb, user); } catch (e) { console.error("export failed", e); }
    exportBtn.disabled = false; exportBtn.textContent = prev;
  };
  const searchEl = modalBody().querySelector("#tcSearch");
  if (searchEl) searchEl.oninput = () => { query = searchEl.value; renderList(); };
  const sortEl = modalBody().querySelector("#tcSort");
  if (sortEl) sortEl.onchange = () => { sortBy = sortEl.value; renderList(); };

  // "Coming up" rows jump straight into showing up for that person.
  modalBody().querySelectorAll(".tc-cu-row").forEach((btn) => {
    btn.onclick = () => { const p = people.find((x) => x.id === btn.dataset.pid); closeModal(); showUpFor(p); };
  });

  // Add-someone: reveal the form only when asked, so browsing stays calm.
  const addForm = modalBody().querySelector("#tcAddForm");
  const addToggle = modalBody().querySelector("#tcAddToggle");
  const showAdd = (on) => { addForm.style.display = on ? "" : "none"; addToggle.style.display = on ? "none" : ""; if (on) modalBody().querySelector("#np_name").focus(); };
  addToggle.onclick = () => showAdd(true);
  modalBody().querySelector("#np_cancel").onclick = () => showAdd(false);
  if (!people.length) showAdd(true); // first-run: don't hide the only action
  modalBody().querySelector("#np_save").onclick = async () => {
    const name = modalBody().querySelector("#np_name").value.trim();
    const msg = modalBody().querySelector("#np_msg");
    if (!name) { msg.className = "k-msg bad"; msg.textContent = "A name helps us make it personal."; return; }
    msg.className = "k-msg"; msg.textContent = "Saving…";
    try {
      // The "anything worth remembering" field is the on-ramp to the ONE memory store — it
      // becomes this person's first noticed item, not a separate people.notes blob (TC-49).
      const firstNote = modalBody().querySelector("#np_notes").value.trim();
      const person = await addPerson({ name, relationship: modalBody().querySelector("#np_rel").value.trim() || null });
      if (firstNote) { try { await createNote(sb, person.id, firstNote); } catch (e) { console.error("first note failed", e); } }
      renderHome(await loadPeople());
    } catch (e) { msg.className = "k-msg bad"; msg.textContent = e.message || "Could not save. Please try again."; }
  };
}

function openAddDate(personId) {
  const kindOpts = KINDS.map((k) => `<option value="${k.v}">${k.label}</option>`).join("");
  const leadOpts = LEADS.map((l) => `<option value="${l.v}"${l.v === 7 ? " selected" : ""}>${l.label}</option>`).join("");
  const box = document.createElement("div");
  box.className = "block tc-addwrap";
  box.innerHTML = `
    <h4>Add a date or reminder</h4>
    <p class="tc-help-sm">A recurring date like a birthday, or a one-time nudge to reach out — say, to check in a few weeks from now.</p>
    <select id="kd_kind" class="tc-select">${kindOpts}</select>
    <input type="text" id="kd_label" placeholder="Label (e.g. Birthday, or “Check in after her move”)" style="margin-top:10px;" />
    <input type="date" id="kd_date" style="margin-top:10px;" />
    <label class="k-remind" style="margin-top:10px;"><input type="checkbox" id="kd_recurs" checked /> Happens every year</label>
    <label class="tc-field-label" for="kd_lead">Remind me</label>
    <select id="kd_lead" class="tc-select">${leadOpts}</select>
    <div class="nav"><button class="link-btn" id="kd_cancel">Cancel</button><button class="cta" id="kd_save">Save →</button></div>
    <div class="k-msg" id="kd_msg"></div>`;
  const card = modalBody().querySelector(`.block[data-pid="${personId}"]`);
  card.appendChild(box);
  const kindEl = box.querySelector("#kd_kind"), labelEl = box.querySelector("#kd_label"), recEl = box.querySelector("#kd_recurs"), leadEl = box.querySelector("#kd_lead");
  const syncKind = () => {
    const k = KINDS.find((x) => x.v === kindEl.value);
    if (k && k.v !== "custom" && k.v !== "moment") labelEl.value = k.label;
    recEl.checked = !!k?.recurs;
  };
  syncKind(); kindEl.onchange = syncKind;
  box.querySelector("#kd_cancel").onclick = () => box.remove();
  box.querySelector("#kd_save").onclick = async () => {
    const msg = box.querySelector("#kd_msg");
    const label = labelEl.value.trim(), event_date = box.querySelector("#kd_date").value;
    if (!label || !event_date) { msg.className = "k-msg bad"; msg.textContent = "A label and a date are both needed."; return; }
    msg.className = "k-msg"; msg.textContent = "Saving…";
    try { await addKeyDate(personId, { label, kind: kindEl.value, event_date, recurs: recEl.checked, lead_days: Number(leadEl.value) }); renderHome(await loadPeople()); }
    catch (e) { msg.className = "k-msg bad"; msg.textContent = e.message || "Could not save."; }
  };
}

/* ---------------- save a plan to a person (called from the plan screen) ---------------- */
async function mountSaveToPerson(stageEl, plan) {
  if (!sb) return;
  const anchor = stageEl.querySelector(".keep");
  const card = document.createElement("div");
  card.className = "keep tc-savecard";
  const ctx = window.__tcAnswers || {};
  const recipient = (ctx.name || "").trim();
  const occasion = (plan.plan_title || "").trim();

  if (!user) {
    card.innerHTML = `
      <h4>Want us to remember ${recipient ? esc(recipient) : "them"}?</h4>
      <p class="k-sub">Sign in with just your email to save this plan and get a gentle nudge before their important dates.</p>
      <button class="cta" id="tcSaveSignin">Sign in to save →</button>`;
    insert(card, anchor, stageEl);
    card.querySelector("#tcSaveSignin").onclick = openSignIn;
    return;
  }

  const people = await loadPeople();
  const opts = people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  const followups = (plan.follow_up || []).filter((f) => Number.isFinite(f.days_from_now) && f.days_from_now > 0);
  const followupOpt = followups.length ? `
    <label class="k-remind" style="margin-top:12px;"><input type="checkbox" id="tcRemindFollow" checked /> Also remind me to follow through — we'll gently nudge you the morning each of this plan's ${followups.length} “keep showing up” date${followups.length > 1 ? "s" : ""} arrives</label>` : "";
  card.innerHTML = `
    <h4>Keep this plan with your people</h4>
    <p class="k-sub">Save it to ${recipient ? esc(recipient) : "someone"}, and we'll remind you at just the right time to follow through.</p>
    <select id="tcPersonSel" class="tc-select">
      <option value="__new">➕ New person${recipient ? `: ${esc(recipient)}` : ""}</option>
      ${opts}
    </select>
    <input type="text" id="tcNewName" placeholder="Their name" value="${esc(recipient)}" style="margin-top:10px;" />
    ${followupOpt}
    <div class="nav"><span></span><button class="cta" id="tcSavePlan">Save to my people →</button></div>
    <div class="k-msg" id="tcSaveMsg"></div>`;
  insert(card, anchor, stageEl);

  const sel = card.querySelector("#tcPersonSel"), nameEl = card.querySelector("#tcNewName");
  // If this plan was started from a saved person, save straight back to them.
  const flowId = window.__tcFlowPersonId;
  if (flowId && [...sel.options].some((o) => o.value === flowId)) sel.value = flowId;
  const syncSel = () => { nameEl.style.display = sel.value === "__new" ? "block" : "none"; };
  syncSel(); sel.onchange = syncSel;

  card.querySelector("#tcSavePlan").onclick = async () => {
    const msg = card.querySelector("#tcSaveMsg");
    msg.className = "k-msg"; msg.textContent = "Saving…";
    try {
      let personId = sel.value;
      if (personId === "__new") {
        const nm = nameEl.value.trim();
        if (!nm) { msg.className = "k-msg bad"; msg.textContent = "A name helps us keep it personal."; return; }
        const person = await addPerson({ name: nm, relationship: (ctx.relationship || "").trim() || null, location: (ctx.location || "").trim() || null });
        personId = person.id;
        // What they told us about this person during intake becomes their first noticed item
        // (the one memory store), not a separate people.notes blob (TC-49).
        const about = (ctx.about || "").trim();
        if (about) { try { await createNote(sb, personId, about); } catch (e) { console.error("intake note failed", e); } }
      }
      await savePlan(personId, plan, occasion);
      let reminderCount = 0;
      const wantFollow = card.querySelector("#tcRemindFollow");
      if (wantFollow && wantFollow.checked) {
        reminderCount = await addPlanFollowups(personId, plan);
      }
      msg.className = "k-msg ok";
      msg.textContent = reminderCount
        ? `Saved ✓ — we'll nudge you on ${reminderCount} date${reminderCount > 1 ? "s" : ""} to follow through. Find them under “People I care about”.`
        : "Saved ✓ — open “People I care about” to add their dates and turn on reminders.";
      card.querySelector("#tcSavePlan").textContent = "Saved ✓";
      card.querySelector("#tcSavePlan").disabled = true;
    } catch (e) { msg.className = "k-msg bad"; msg.textContent = e.message || "Could not save. Please try again."; }
  };
}
function insert(card, anchor, stageEl) {
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor.nextSibling);
  else stageEl.appendChild(card);
}
