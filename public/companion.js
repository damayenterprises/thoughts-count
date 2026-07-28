// Thoughts Count — companion layer: passwordless sign-in, a home for the people
// who matter (with their key dates), and "save this plan to a person". Loads
// lazily and stays completely dormant if Supabase isn't configured, so the core
// plan flow is never affected.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let sb = null, user = null;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "them";

const KINDS = [
  { v: "birthday", label: "Birthday", recurs: true },
  { v: "work_anniversary", label: "Work anniversary", recurs: true },
  { v: "moment", label: "The moment I helped with", recurs: false },
  { v: "custom", label: "Something else", recurs: false },
];

boot();

async function boot() {
  let cfg;
  try { cfg = await (await fetch("/api/public-config", { cache: "no-store" })).json(); } catch { return; }
  if (!cfg || !cfg.enabled) return;

  // Did this page load actually come from a magic-link email? (Capture before the
  // client processes and strips the URL.) Only then should we auto-open "Your People".
  const fromMagicLink = /[#&](access_token|refresh_token)=/.test(location.hash) || /[?&]code=/.test(location.search);

  sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const { data } = await sb.auth.getSession();
  user = data?.session?.user || null;

  sb.auth.onAuthStateChange((evt, session) => {
    user = session?.user || null;
    renderAuthBtn();
    // Only auto-open "Your People" on a genuine magic-link return — NOT on the
    // SIGNED_IN that Supabase re-fires every time it restores a saved session.
    if (evt === "SIGNED_IN" && fromMagicLink) { closeModal(); openHome(); }
  });

  ensureModal();
  mountAuthBtn();
  renderAuthBtn();

  window.TCCompanion = { isSignedIn: () => !!user, mountSaveToPerson, openHome, openSignIn };
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
    slot.innerHTML = `<button class="tc-authbtn" id="tcHomeBtn">♡ People I care about</button>`;
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
  modalBody().querySelector("#tcSendLink").onclick = async () => {
    const email = (emailEl.value || "").trim();
    const msg = modalBody().querySelector("#tcAuthMsg");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.className = "k-msg bad"; msg.textContent = "Please enter a valid email address."; return; }
    msg.className = "k-msg"; msg.textContent = "Sending your link…";
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
    if (error) { msg.className = "k-msg bad"; msg.textContent = error.message || "Could not send the link. Please try again."; return; }
    msg.className = "k-msg ok"; msg.textContent = "Check your inbox — your sign-in link is on the way. You can close this and click it from your email.";
  };
}

/* ---------------- data ---------------- */
async function loadPeople() {
  const { data, error } = await sb
    .from("people")
    .select("id,name,relationship,notes,location,created_at,key_dates(id,label,kind,event_date,recurs),saved_plans(id,plan_title,occasion,created_at,plan)")
    .order("created_at", { ascending: true });
  if (error) { console.error(error); return []; }
  return data || [];
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

/* ---------------- "Your People" home ---------------- */
async function openHome() {
  if (!user) { openSignIn(); return; }
  openModal();
  modalBody().innerHTML = `<div class="panel-body"><p class="q-help">Loading your people…</p></div>`;
  const people = await loadPeople();
  renderHome(people);
}

function dateLine(d) {
  const dt = new Date(d.event_date + "T00:00:00");
  const nice = dt.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.recurs ? {} : { year: "numeric" }) });
  return `<div class="tc-date-row"><span>${esc(d.label)}</span><span class="tc-date-when">${nice}${d.recurs ? " · yearly" : ""}</span></div>`;
}

function renderHome(people) {
  const email = esc(user.email || "");
  const cards = people.length ? people.map((p) => {
    const sp = p.saved_plans || [];
    const savedHtml = sp.length ? `<div class="tc-savedplans"><div class="tc-sp-label">Plans you've made</div>${
      sp.map((x) => `<button class="tc-sp-row" data-pid="${p.id}" data-spid="${x.id}">${esc(x.plan_title || x.occasion || "A plan")}</button>`).join("")
    }</div>` : "";
    return `
    <div class="block" data-pid="${p.id}">
      <h4 style="justify-content:space-between;">
        <span>${esc(p.name)}${p.relationship ? ` <span class="tc-rel">· ${esc(p.relationship)}</span>` : ""}</span>
      </h4>
      ${p.notes ? `<p style="margin-bottom:10px;">${esc(p.notes)}</p>` : ""}
      <div class="tc-dates">${(p.key_dates || []).sort((a,b)=>a.event_date.slice(5).localeCompare(b.event_date.slice(5))).map(dateLine).join("") || `<div class="tc-empty">No key dates yet — add one so we can remind you.</div>`}</div>
      <button class="tc-add-date link-btn" data-pid="${p.id}">+ Add a date</button>
      ${savedHtml}
      <button class="cta tc-showup" data-pid="${p.id}">♡ Help me show up for ${esc(firstName(p.name))}</button>
    </div>`;
  }).join("") : `<div class="tc-empty" style="padding:8px 0 18px;">No one saved yet. Add the first person who matters to you below — a friend, a teammate, someone you manage.</div>`;

  modalBody().innerHTML = `
    <div class="panel-body">
      <div class="q-eyebrow">People I care about</div>
      <h2 class="q-title" style="margin-bottom:2px;">People who matter</h2>
      <p class="q-help">${email} · we'll nudge you a week before each date. <button class="link-btn tc-signout" style="padding:0 2px;">Sign out</button></p>
      ${cards}
      <div class="block tc-addwrap">
        <h4>Add someone</h4>
        <input type="text" id="np_name" placeholder="Their name" />
        <input type="text" id="np_rel" placeholder="Who they are to you (e.g. someone I manage)" style="margin-top:10px;" />
        <textarea id="np_notes" placeholder="Anything worth remembering about them (optional)" style="margin-top:10px;min-height:64px;"></textarea>
        <div class="nav"><span></span><button class="cta" id="np_save">Add them →</button></div>
        <div class="k-msg" id="np_msg"></div>
      </div>
    </div>`;

  modalBody().querySelector(".tc-signout").onclick = async () => { await sb.auth.signOut(); closeModal(); };
  modalBody().querySelector("#np_save").onclick = async () => {
    const name = modalBody().querySelector("#np_name").value.trim();
    const msg = modalBody().querySelector("#np_msg");
    if (!name) { msg.className = "k-msg bad"; msg.textContent = "A name helps us make it personal."; return; }
    msg.className = "k-msg"; msg.textContent = "Saving…";
    try {
      await addPerson({ name, relationship: modalBody().querySelector("#np_rel").value.trim() || null, notes: modalBody().querySelector("#np_notes").value.trim() || null });
      renderHome(await loadPeople());
    } catch (e) { msg.className = "k-msg bad"; msg.textContent = e.message || "Could not save. Please try again."; }
  };
  modalBody().querySelectorAll(".tc-add-date").forEach((btn) => { btn.onclick = () => openAddDate(btn.dataset.pid); });
  // Launch the plan flow already knowing who it's for.
  modalBody().querySelectorAll(".tc-showup").forEach((btn) => {
    btn.onclick = () => {
      const p = people.find((x) => x.id === btn.dataset.pid);
      closeModal();
      if (window.openFlowForPerson) window.openFlowForPerson(p);
    };
  });
  // Re-open a previously saved plan.
  modalBody().querySelectorAll(".tc-sp-row").forEach((btn) => {
    btn.onclick = () => {
      const p = people.find((x) => x.id === btn.dataset.pid);
      const rec = (p?.saved_plans || []).find((x) => x.id === btn.dataset.spid);
      if (rec?.plan && window.renderSavedPlan) { closeModal(); window.renderSavedPlan(rec.plan); }
    };
  });
}

function openAddDate(personId) {
  const kindOpts = KINDS.map((k) => `<option value="${k.v}">${k.label}</option>`).join("");
  const box = document.createElement("div");
  box.className = "block tc-addwrap";
  box.innerHTML = `
    <h4>Add a date</h4>
    <select id="kd_kind" class="tc-select">${kindOpts}</select>
    <input type="text" id="kd_label" placeholder="Label (e.g. Birthday, Work anniversary)" style="margin-top:10px;" />
    <input type="date" id="kd_date" style="margin-top:10px;" />
    <label class="k-remind" style="margin-top:10px;"><input type="checkbox" id="kd_recurs" checked /> Happens every year</label>
    <div class="nav"><button class="link-btn" id="kd_cancel">Cancel</button><button class="cta" id="kd_save">Save date →</button></div>
    <div class="k-msg" id="kd_msg"></div>`;
  const card = modalBody().querySelector(`.block[data-pid="${personId}"]`);
  card.appendChild(box);
  const kindEl = box.querySelector("#kd_kind"), labelEl = box.querySelector("#kd_label"), recEl = box.querySelector("#kd_recurs");
  const syncKind = () => { const k = KINDS.find((x) => x.v === kindEl.value); if (k && k.v !== "custom") labelEl.value = k.label; recEl.checked = !!k?.recurs; };
  syncKind(); kindEl.onchange = syncKind;
  box.querySelector("#kd_cancel").onclick = () => box.remove();
  box.querySelector("#kd_save").onclick = async () => {
    const msg = box.querySelector("#kd_msg");
    const label = labelEl.value.trim(), event_date = box.querySelector("#kd_date").value;
    if (!label || !event_date) { msg.className = "k-msg bad"; msg.textContent = "A label and a date are both needed."; return; }
    msg.className = "k-msg"; msg.textContent = "Saving…";
    try { await addKeyDate(personId, { label, kind: kindEl.value, event_date, recurs: recEl.checked }); renderHome(await loadPeople()); }
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
  card.innerHTML = `
    <h4>Keep this plan with your people</h4>
    <p class="k-sub">Save it to ${recipient ? esc(recipient) : "someone"}, and add their key dates so we can remind you.</p>
    <select id="tcPersonSel" class="tc-select">
      <option value="__new">➕ New person${recipient ? `: ${esc(recipient)}` : ""}</option>
      ${opts}
    </select>
    <input type="text" id="tcNewName" placeholder="Their name" value="${esc(recipient)}" style="margin-top:10px;" />
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
        const person = await addPerson({ name: nm, relationship: (ctx.relationship || "").trim() || null, notes: (ctx.about || "").trim() || null, location: (ctx.location || "").trim() || null });
        personId = person.id;
      }
      await savePlan(personId, plan, occasion);
      msg.className = "k-msg ok"; msg.textContent = "Saved ✓ — open “People I care about” to add their key dates and turn on reminders.";
      card.querySelector("#tcSavePlan").textContent = "Saved ✓";
      card.querySelector("#tcSavePlan").disabled = true;
    } catch (e) { msg.className = "k-msg bad"; msg.textContent = e.message || "Could not save. Please try again."; }
  };
}
function insert(card, anchor, stageEl) {
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor.nextSibling);
  else stageEl.appendChild(card);
}
