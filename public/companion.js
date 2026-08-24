// Thoughts Count — companion layer: passwordless sign-in, a home for the people
// who matter (with their key dates), and "save this plan to a person". Loads
// lazily and stays completely dormant if Supabase isn't configured, so the core
// plan flow is never affected.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatKeyDate, isPartialDate } from "/_dates.js";
import { loadFactsFor, loadPersonFacts, mountNoticed, mountPersonDelete, exportUserData, createNote, noticedList } from "/_memory.js";
import { mountQuickCapture, mountToReview, pendingCount, qcHintHtml, wireQcHint, flashCard, captureExtract, captureResolve, resolveName, captureFromFile, renderImportConfirm, transcribeAudioFile } from "/_capture.js";
import { mountInlineMic } from "/_inline-mic.js";
import { mountReminders, remindersSummary, addReminder, ensureReminderStyles, offsetPhrase } from "/_reminders.js";
// Expose the ONE offset→phrase vocabulary to the non-module conversation-capture handler in
// index.html (cvHandleCapture), so its "I'll nudge you a week before" confirmation reuses the exact
// same wording as the reminders editor rather than a parallel copy. Read-only helper, safe on window.
try { window.TCReminderPhrase = { offsetPhrase, remindersSummary }; } catch (e) {}
import { pickCheckback as pickCheckbackPure, classifyValenceLite, planValence, readOutcome } from "/_checkback.js";
import { GUIDED_STEPS, makeGuidedState, stepAt, advance, back as guidedBack, isDone as guidedIsDone, canFinish as guidedCanFinish, answersToDraft } from "/_guided.js";

let reviewCount = 0;   // captures waiting in To-Review (TC-50)
let reviewOpen = false; // keep the To-Review panel open across confirms
let voiceAudience = "everyone"; // voice front-door gate (TC-60): everyone | signedin | members

let sb = null, user = null;
let accessToken = null; // current session token, so gated voice endpoints can verify the caller

// The single place that decides if voice UI should show for this user (TC-60).
// "everyone" → always; "signedin" → needs an account; "members" → account + Pro.
// (True Pro enforcement is the client stub until the paid flag / TC-40 lands; the
// server also enforces this on the voice endpoints so the client check is just UX.)
function voiceAllowed() {
  if (voiceAudience === "signedin") return !!user;
  if (voiceAudience === "members") return !!user && !!(window.TCRoster && window.TCRoster.isPro && window.TCRoster.isPro());
  return true;
}
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "them";

/* ============================================================================
 * TC-117 — Della circles back "how did that go?" (client selector + helpers)
 * ============================================================================
 * The DETERMINISTIC selection logic lives in the pure, unit-tested module
 * /_checkback.js (imported at the top). This section holds the IMPURE parts that
 * belong next to the plan data + Supabase reads: the localStorage session throttle,
 * the plan_checkins read, and the post-conversation emit. The server (converse.mjs
 * checkbackBlock) only ever receives an advisory ctx.checkback and shapes prose from
 * it — it never decides WHEN, and never writes.
 *
 * DORMANT-SAFE: reads of the not-yet-migrated plan_checkins table and the not-yet-
 * migrated saved_plans.valence column both degrade gracefully (treated as "no check-back
 * this turn / no stored valence"), so the whole feature is a no-op until David applies
 * migrations 008/009.
 */

/* ---- per-SESSION global throttle (UX blocking finding) --------------------
 * At most ONE check-back — Mechanism A or B, combined — across a whole session/day,
 * no matter how many people the user opens. Prevents "quizzing down the roster."
 * Keyed by calendar date in localStorage; the authoritative per-PERSON cooldown still
 * lives server-side in plan_checkins. */
const CB_SESSION_KEY = "tc_checkback_day";
function todayKey() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function checkbackUsedThisSession() {
  try { return localStorage.getItem(CB_SESSION_KEY) === todayKey(); } catch (e) { return false; }
}
function markCheckbackUsedThisSession() {
  try { localStorage.setItem(CB_SESSION_KEY, todayKey()); } catch (e) { /* storage blocked → throttle just falls back to per-person cooldown */ }
}

/* ---- already-asked + per-person cooldown (cross-device, authoritative) -----
 * One bulk read of the user's plan_checkins on home load. Returns:
 *   { askedPlanIds:Set, lastAskedForPlan:Map(saved_plan_id -> ms), outcomeForPlan:Map, tableMissing:bool }
 * DORMANT-SAFE: if the table doesn't exist yet (pre-migration), returns tableMissing:true so
 * pickCheckback treats the WHOLE feature as inert (returns null) until David applies 008 — the
 * authoritative "already-asked"/cooldown store isn't there, so we must not circle back at all.
 * Any other error → empty (fail-open, also null-producing). */
async function loadCheckins() {
  const empty = { askedPlanIds: new Set(), lastAskedForPlan: new Map(), outcomeForPlan: new Map() };
  if (!sb || !user) return empty;
  try {
    const { data, error } = await sb
      .from("plan_checkins")
      .select("saved_plan_id,asked_at,outcome")
      .order("asked_at", { ascending: false });
    if (error) {
      // "relation does not exist" (PG 42P01 / PostgREST PGRST205) = pre-migration → inert.
      const code = String(error.code || "");
      const msg = String(error.message || "").toLowerCase();
      if (code === "42P01" || code === "PGRST205" || /does not exist|could not find the table/.test(msg)) {
        return { ...empty, tableMissing: true };
      }
      return empty; // any other read error → fail-open (also yields null from pickCheckback)
    }
    if (!Array.isArray(data)) return empty;
    const askedPlanIds = new Set();
    const lastAskedForPlan = new Map();
    const outcomeForPlan = new Map(); // saved_plan_id -> latest non-null outcome (compounding feed)
    for (const r of data) {
      if (r.saved_plan_id) {
        askedPlanIds.add(r.saved_plan_id);
        const ms = Date.parse(r.asked_at);
        if (Number.isFinite(ms) && (!lastAskedForPlan.has(r.saved_plan_id) || ms > lastAskedForPlan.get(r.saved_plan_id))) {
          lastAskedForPlan.set(r.saved_plan_id, ms);
        }
        // data is ordered newest-first, so the first non-null outcome we see is the latest.
        if (r.outcome && !outcomeForPlan.has(r.saved_plan_id)) outcomeForPlan.set(r.saved_plan_id, r.outcome);
      }
    }
    return { askedPlanIds, lastAskedForPlan, outcomeForPlan };
  } catch (e) { return empty; }
}

/* ---- the selector (thin wrapper over the pure /_checkback.js module) --------
 * The deterministic logic lives in /_checkback.js (unit-tested offline). Here we just feed
 * it the impure inputs: the localStorage session throttle result. Returns at most ONE of
 * { mechanism:"A", ... } | { mechanism:"B" } | null. */
function pickCheckback(person, opts = {}) {
  return pickCheckbackPure(person, { ...opts, sessionUsed: checkbackUsedThisSession() });
}

/* ---- post-conversation emit (Task 8) ---------------------------------------
 * Called AFTER a check-back conversation, fire-and-forget. `cb` is the ctx.checkback that
 * actually fired; `userText` is the user's own turns (for the coarse outcome read); `bucket`
 * is the plan's stored non-identifying bucket (occasion/valence/relationship/budget_band).
 *
 * Mechanism A, non-grief → post ONE plan_outcome (SILENT — no UI artifact, §6b) AND a
 *   plan_checkin { mechanism:"A", outcome }.
 * Grief-care-only A, or Mechanism B → post ONLY plan_checkin { outcome:null }, NEVER a
 *   plan_outcome (§3). This function is the guard that makes grief emit zero signal.
 * Everything is best-effort and swallows errors, so it can never affect the plan/conversation. */
async function emitCheckbackOutcome({ cb, userText, bucket } = {}) {
  try {
    if (!cb || typeof cb !== "object") return;
    const mechanism = cb.mechanism === "A" || cb.mechanism === "B" ? cb.mechanism : null;
    if (!mechanism) return;
    // Mark the session throttle the moment a check-back actually fired (belt + suspenders with
    // the server per-person cooldown), so a second person opened today can't be quizzed too.
    markCheckbackUsedThisSession();

    const isGriefA = mechanism === "A" && !!cb.grief_care_only;
    const signalEligible = mechanism === "A" && !isGriefA; // ONLY non-grief A emits a signal
    const outcome = signalEligible ? readOutcome(userText) : null;

    // (1) SILENT outcome signal — non-grief Mechanism A only. Coarse, bucketed, non-identifying.
    if (signalEligible) {
      try {
        const sid = (window && window.__tcSid) || undefined;
        const test = !!(window && window.__tcTest);
        const payload = JSON.stringify({ event: "plan_outcome", outcome, bucket: bucket || {}, sid, test });
        if (navigator.sendBeacon) navigator.sendBeacon("/api/feedback", new Blob([payload], { type: "application/json" }));
        else fetch("/api/feedback", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: payload });
      } catch (e) { /* signal is best-effort */ }
    }

    // (2) Bookkeeping — always (so the outcome/cooldown is authoritative cross-device). For grief
    // and Mechanism B, outcome is null (the server also forces this). saved_plan_id only for A.
    try {
      if (sb && user && accessToken) {
        await fetch("/api/plan-checkin", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + accessToken },
          body: JSON.stringify({ saved_plan_id: mechanism === "A" ? (cb.plan_id || null) : null, mechanism, outcome }),
        });
      }
    } catch (e) { /* bookkeeping is best-effort; dormant-safe server no-ops pre-migration */ }
  } catch (e) { /* fail-open */ }
}

/* ---------------- pending voice request (TC-62) ---------------------------------
 * When an anon user speaks and chooses to REMEMBER a person, we can't run the
 * (RLS-locked) capture engine until they have an account. So we hold the raw
 * transcript on THEIR device across the magic-link email round-trip and resume
 * the remember flow when they return signed in. Client-only, same-device, their
 * own words — never pooled, never server-side (Option 1). One-shot read + 30-min TTL. */
const PENDING_VOICE_KEY = "tc_pending_voice";
const PENDING_VOICE_TTL_MS = 30 * 60 * 1000; // magic links are short-lived
function stashPendingVoice({ intent, transcript }) {
  try {
    if (!intent || !transcript) return;
    localStorage.setItem(PENDING_VOICE_KEY, JSON.stringify({ v: 1, intent, transcript, ts: Date.now() }));
  } catch (e) { /* storage blocked/full → resume just won't fire; never throw */ }
}
function clearPendingVoice() { try { localStorage.removeItem(PENDING_VOICE_KEY); } catch (e) {} }
// Read once, then delete. Returns null if missing, stale, wrong version, or malformed.
function consumePendingVoice() {
  let raw = null;
  try { raw = localStorage.getItem(PENDING_VOICE_KEY); } catch (e) { return null; }
  if (!raw) return null;
  clearPendingVoice();
  try {
    const p = JSON.parse(raw);
    if (!p || p.v !== 1 || !p.transcript || !p.ts) return null;
    if (Date.now() - p.ts > PENDING_VOICE_TTL_MS) return null;
    return p;
  } catch (e) { return null; }
}

// Hand-drawn brand icons (24×24, fill:none, stroke-width 1.6, round caps/joins) so the
// companion UI never uses emoji. `stroke` defaults to currentColor so an icon inherits its
// button's text color (e.g. #fff on a filled-clay CTA). `sz` is pixel size.
const svgWrap = (paths, sz = 16, stroke = "currentColor") =>
  `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:0 0 auto;">`
  + paths + `</svg>`;
// Brand heart accent (24×24, mono, inherits button text color via currentColor).
const heartSvg = (sz = 16, stroke = "currentColor") =>
  svgWrap(`<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z"/>`, sz, stroke);
const listSvg = (sz = 16, stroke = "currentColor") => svgWrap(`<path d="M4 6h16M4 12h16M4 18h16"/>`, sz, stroke);
const plusSvg = (sz = 16, stroke = "currentColor") => svgWrap(`<path d="M12 5v14M5 12h14"/>`, sz, stroke);
const xSvg = (sz = 16, stroke = "currentColor") => svgWrap(`<path d="M6 6l12 12M18 6L6 18"/>`, sz, stroke);
const checkSvg = (sz = 16, stroke = "currentColor") => svgWrap(`<path d="M5 13l4 4L19 7"/>`, sz, stroke);
const chatSvg = (sz = 16, stroke = "currentColor") => svgWrap(`<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5z"/>`, sz, stroke);

// Launch the plan flow for a saved person, handing the intake their remembered memory so the
// plan reads what we've noticed (not a notes blob) and step 3 pre-fills from it (TC-49). Facts
// are re-read fresh so a note just added on the card is included.
async function showUpFor(p) {
  if (!p) return;
  try { p.noticed = noticedList(await loadPersonFacts(sb, p.id)); }
  catch (e) { console.error("noticed load failed", e); p.noticed = noticedList(p.facts || []); }
  if (window.openFlowForPerson) window.openFlowForPerson(p);
}

// TC-66 Phase 3a: open the memory-aware conversation about a saved person. Same fresh-facts
// read as showUpFor so a note just added is included; saved_plans came with the bulk load and
// carry the prior-plans digest the client assembles. Reads are RLS-scoped to the user's own
// session — no server auth here (that belongs to 3b / write-back).
async function talkItThrough(p) {
  if (!p) return;
  try { p.noticed = noticedList(await loadPersonFacts(sb, p.id)); }
  catch (e) { console.error("noticed load failed", e); p.noticed = noticedList(p.facts || []); }
  if (window.openConverseForPerson) window.openConverseForPerson(p);
  else if (window.openConverse) window.openConverse(p);
}

// TC-66 Phase 3b: persist what the user shared in a memory-aware conversation back to the
// KNOWN saved person it was about, so continuity compounds. The conversation code calls this
// AFTER the plan kicks off; it must never block or break that (fire-and-forget, fail-open).
//   personId — flowPerson.id (a known saved person; conversation guards anonymous/home out)
//   rawText  — the user's OWN turns, joined (role==='user'); her replies are guidance, not facts
// Writes go ONLY through the authenticated /api/capture/extract (requireUser + service role +
// server-side ownership check on lockedPersonId): a foreign/bogus id 404s, and a foreign write
// is impossible. On the Level-A auto-save we surface a subtle, undoable toast so it's
// visible-not-silent without cluttering the plan the user is now looking at.
async function rememberFromConversation(personId, rawText) {
  // Guard: only a signed-in user with a live client + a real person + real text ever writes.
  if (!sb || !user || !personId) return null;
  const text = String(rawText || "").trim();
  if (!text) return null;
  const result = await captureExtract(sb, { rawText: text, lockedPersonId: personId, source: "conversation" });
  // A locked capture is always Level A when it finds durable facts; if it found nothing, stay
  // silent (no toast) — the conversation was chit-chat with nothing worth remembering.
  const a = ((result && result.captures) || []).filter((c) => c.level === "A");
  if (a.length) {
    // TC-66 (UX): the conversation path no longer uses the global bottom toast (too far from the
    // dialogue / easy to miss). Instead we surface a slim, sage-tinted inline confirmation band
    // pinned at the TOP of her plan — right where the user's eyes land. Coordination note: this
    // write fires non-blocking AFTER generate() kicks off, and the extract usually resolves BEFORE
    // the ~30s plan renders — so there's no plan DOM to inject into yet. We stash a pending
    // confirmation; renderPlan() (index.html) injects the band once the plan exists. The rare
    // case (plan already showing when we resolve) injects immediately. Undo stays wired to the
    // same captureResolve(...,'undo') the toast used. Her voice, not the server evidence string.
    const fn = a[0].personName ? firstName(a[0].personName) : "them";
    // Undo = the exact same path the toast used: resolve each saved capture with action "undo".
    const undo = async () => {
      for (const c of a) { try { await captureResolve(sb, { captureId: c.captureId, action: "undo" }); } catch (e) { console.error("conversation memory undo failed", e); } }
    };
    const inject = window.tcInjectRememberBand;
    if (typeof inject === "function") inject({ firstName: fn, undo });
  }
  return result;
}

const KINDS = [
  { v: "birthday", label: "Birthday", recurs: true },
  { v: "work_anniversary", label: "Work anniversary", recurs: true },
  { v: "moment", label: "A one-time reminder to reach out", recurs: false },
  // A "situation" is a hard/tender stretch to check in AROUND (a surgery, chemo, a move, a loss) —
  // it can carry several nudges (before, day-of, after), unlike a plain single-nudge date.
  { v: "situation", label: "A situation to check in around", recurs: false },
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
  // orb-home: single-source HER_NAME (from _persona.mjs via public-config) to the hero orb.
  // Set this BEFORE any early return so the name shows even when Supabase isn't configured.
  if (cfg && cfg.herName) {
    window.__HER_NAME = cfg.herName;
    try { window.dispatchEvent(new Event("tc-her-name")); } catch (e) {}
  }
  if (!cfg || !cfg.enabled) return;
  voiceAudience = cfg.voiceAudience || "everyone";

  // Did this page load actually come from a magic-link email? (Capture before the
  // client processes and strips the URL.) Only then should we auto-open "Your People".
  let fromMagicLink = /[#&](access_token|refresh_token)=/.test(location.hash) || /[?&]code=/.test(location.search);

  sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const { data } = await sb.auth.getSession();
  user = data?.session?.user || null;
  accessToken = data?.session?.access_token || null;

  sb.auth.onAuthStateChange((evt, session) => {
    user = session?.user || null;
    accessToken = session?.access_token || null;
    renderAuthBtn();
    // TC-81: any sign-out (button, expiry, other tab) clears the device-local recovered plan.
    if (evt === "SIGNED_OUT") {
      try { window.tcClearLastPlan && window.tcClearLastPlan(); window.tcRefreshLastPlanAffordance && window.tcRefreshLastPlanAffordance(); } catch (e) {}
      // TC-90: privacy — release the shared session mic (stop tracks + close AudioContext) on a
      // shared-device sign-out so the next person doesn't inherit a live mic. Re-acquires on demand.
      try { window.micSession && window.micSession.releaseAll(); } catch (e) {}
    }
    // On a genuine magic-link return, close the sign-in modal and land on the MAIN
    // page (TC-92). We no longer force-open "Your People" on login — the top-bar
    // "People I care about" control is one click into the list when the user chooses.
    // Supabase re-fires SIGNED_IN on session restore and tab refocus, so we consume
    // the flag after the first handling.
    if (evt === "SIGNED_IN" && fromMagicLink) {
      fromMagicLink = false;
      routeAfterSignIn();
    }
  });

  ensureModal();
  mountAuthBtn();
  renderAuthBtn();

  window.TCCompanion = {
    isSignedIn: () => !!user, mountSaveToPerson, openHome, openSignIn, refreshAuthBtn: renderAuthBtn,
    voiceAllowed, voiceAudience: () => voiceAudience, authToken: () => accessToken,
    // TC-62: anon "remember" → safekeeping sign-in that holds the spoken request
    // across the magic-link round-trip.
    promptSignInToRemember,
    // Voice "remember a person" bridge (TC-61 slice 2). Preview = extract + resolve, write
    // nothing; confirm = write. factsToText renders facts in the same plain words the app uses.
    capturePreview: (rawText) => captureExtract(sb, { rawText, source: "voice", preview: true }),
    // Person-card voice note: identity is known, so preview targets that one person.
    capturePreviewLocked: (personId, rawText) => captureExtract(sb, { rawText, lockedPersonId: personId, source: "voice", preview: true }),
    captureConfirm: ({ captureId, personId = null, newPersonName = null }) => captureResolve(sb, { captureId, action: "confirm", personId, newPersonName }),
    // TC-89: resolve a corrected/spoken NAME against the roster, writing nothing (re-check on
    // confirm-card edit; lock onto a spoken existing person). Signed-out → no-op.
    resolveName: (name) => (user ? resolveName(sb, name) : Promise.resolve({ kind: "none" })),
    // TC-89: the personal circle ordered MOST-RECENTLY-ENGAGED first (for the "…about someone
    // you know" picker: recent people are the common one-tap case; type-to-filter covers the rest).
    listPeopleForVoice,
    factsToText: (facts) => noticedList(facts),
    openPerson: (personId) => openHome(),
    // TC-66 Phase 3b: write-back from a memory-aware conversation. Rides the EXISTING
    // authenticated capture pipeline (requireUser + service role + ownership check), locked
    // to the known saved person the conversation is about — so it's always Level-A auto-save
    // with insertFact's dedup/supersession, no new write surface. Signed-out → no-op (guard).
    rememberFromConversation,
    // TC-117: the "circle back" selector + its post-conversation emit, surfaced for index.html.
    //  loadCheckins()               — one bulk read of plan_checkins (dormant-safe → empty pre-migration)
    //  pickCheckback(person, opts)  — at most ONE {A|B}|null, all restraint enforced here
    //  markCheckbackUsed()          — set the per-session throttle once a check-back actually fired
    //  emitCheckbackOutcome(...)    — SILENT signal + bookkeeping after a check-back conversation
    //  planValence(plan)            — stored (post-009) or derived valence for the compounding digest
    loadCheckins,
    pickCheckback,
    markCheckbackUsed: markCheckbackUsedThisSession,
    emitCheckbackOutcome,
    planValence,
  };
  // Voice UI (e.g. the dictation mic) may have rendered before the gate resolved —
  // let the page re-check now that we know the audience + sign-in state.
  try { window.dispatchEvent(new Event("tc-voice-gate-ready")); } catch (e) {}
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
    const rosterBtn = pro ? `<button class="tc-authbtn ghost" id="tcRosterBtn" style="margin-right:8px;display:inline-flex;align-items:center;gap:6px;">${listSvg(16)}<span>My roster</span></button>` : "";
    slot.innerHTML = rosterBtn + `<button class="tc-authbtn" id="tcHomeBtn" style="display:inline-flex;align-items:center;gap:6px;">${heartSvg(16, "currentColor")}<span>People I care about</span></button>`;
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
        <div class="brand brand-mark-wordmark">
          <svg viewBox="0 0 250 250" width="24" height="24" aria-hidden="true"><path fill="#118ab9" d="M30.84,247.61c-1.22,0-2.42-.54-3.34-1.57-1.36-1.51-1.87-3.82-1.31-5.92l9.28-34.68C14.07,182.85,2.33,153.46,2.33,122.3,2.33,55.3,57.27.8,124.8.8s122.47,54.5,122.47,121.5-54.94,121.5-122.47,121.5c-19.29,0-38.44-4.55-55.53-13.17l-36.69,16.6c-.57.26-1.16.38-1.74.38ZM69.39,218.66c.68,0,1.35.17,1.99.5,16.31,8.59,34.78,13.13,53.42,13.13,62.16,0,112.73-49.34,112.73-110S186.96,12.3,124.8,12.3,12.07,61.65,12.07,122.3c0,28.9,11.42,56.2,32.16,76.89,1.5,1.5,2.09,3.92,1.5,6.13l-7.2,26.9,29.12-13.18c.56-.25,1.15-.38,1.74-.38Z"/><path fill="#ef4136" d="M148.18,75.95c-7.61,0-15.23,2.92-21.04,8.75l-2.35,2.36-2.35-2.36c-5.81-5.83-13.42-8.75-21.03-8.75-7.62,0-15.23,2.92-21.04,8.76l-.42.43c-11.62,11.67-11.62,30.59,0,42.27l2.35,2.36,5.15,5.18,37.34,37.52,42.5-42.7,2.35-2.36c11.61-11.67,11.61-30.6,0-42.27l-.43-.43c-5.81-5.83-13.42-8.75-21.04-8.75h0Z"/></svg>
          Thoughts Count
        </div>
        <button class="close" id="tcModalClose" aria-label="Close">${xSvg(18)}</button>
      </div>
      <div id="tcModalBody"></div>
      <div class="panel-foot" style="padding:10px 20px 14px;text-align:center;font-size:12.5px;color:var(--ink-soft,#6b6f76);border-top:1px solid rgba(0,0,0,.06);">
        Need help? <a href="mailto:care@thoughtscount.com" id="tcModalContact" style="color:var(--tc-blue,#118ab9);font-weight:600;">Contact us</a>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
  m.querySelector("#tcModalClose").onclick = closeModal;
  // Open the shared contact form (prefilled with the signed-in email) instead of a bare mailto,
  // so help reaches us even without a desktop mail app. Falls back to the mailto href if the
  // global isn't available for any reason.
  const mc = m.querySelector("#tcModalContact");
  if (mc) mc.addEventListener("click", (e) => {
    if (typeof window.tcOpenContact === "function") { e.preventDefault(); window.tcOpenContact((user && user.email) || "", "account"); }
  });
}
function openModal() { ensureModal(); document.getElementById("tcModal").classList.add("open"); document.body.style.overflow = "hidden"; }
function closeModal() { const m = document.getElementById("tcModal"); if (m) m.classList.remove("open"); document.body.style.overflow = ""; }
const modalBody = () => document.getElementById("tcModalBody");

// TC-94: the shared post-sign-in routing, called by BOTH the magic-link return (onAuthStateChange,
// gated on fromMagicLink) AND the typed-code verify path (which has NO tokens in the URL, so that
// gate is false for it). Factoring it here means the two paths can never drift:
//   • pending "remember" (TC-62) → close the modal, resume that exact request, land on "[Name] is
//     on your list".
//   • otherwise → just close the modal and stay on the MAIN page (TC-92 — do NOT auto-open People).
function routeAfterSignIn() {
  const pend = consumePendingVoice();
  if (pend && pend.intent === "remember" && pend.transcript && window.tcResumeRemember) {
    closeModal();
    try { window.tcTrack && window.tcTrack("voice_remember_resumed"); } catch (e) {}
    window.tcResumeRemember(pend.transcript);
    return;
  }
  closeModal();
}

/* ---------------- sign in ---------------- */
function openSignIn() {
  openModal();
  modalBody().innerHTML = `
    <div class="panel-body">
      <div class="q-eyebrow">Welcome</div>
      <h2 class="q-title">Keep the people who matter close</h2>
      <p class="q-help">Save the people you care about, their important dates, and your plans, and we'll gently remind you before each one. Just your email, no password.</p>
      <input type="email" id="tcEmail" placeholder="you@email.com" autocomplete="email" />
      <div class="nav" style="justify-content:center;"><button class="cta" id="tcSendLink">Email me a sign-in link →</button></div>
      <div class="k-msg" id="tcAuthMsg"></div>
      <div class="k-privacy">We use your email only for this. No password, no sharing, no spam.</div>
    </div>`;
  const emailEl = modalBody().querySelector("#tcEmail");
  emailEl.focus();
  const send = async () => {
    const email = (emailEl.value || "").trim();
    const msg = modalBody().querySelector("#tcAuthMsg");
    const btn = modalBody().querySelector("#tcSendLink");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.className = "k-msg bad"; msg.textContent = "Please enter a valid email address."; return; }
    btn.disabled = true; msg.className = "k-msg"; msg.textContent = "Sending your link...";
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
    if (error) { console.warn("signInWithOtp", error.message); btn.disabled = false; msg.className = "k-msg bad"; msg.textContent = "Could not send the link. Please try again in a moment."; return; }
    renderCheckInbox(email);
  };
  modalBody().querySelector("#tcSendLink").onclick = send;
  emailEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
}

// A clean, inviting confirmation after a sign-in email is sent. TC-94: this now LEADS with the
// typed code (the whole point of the ticket — a home-screen-app user can sign in in-place, no Safari
// hop), while keeping the link as the secondary option. The same email carries both an 8-digit code
// and a link. On verify success we run routeAfterSignIn() EXPLICITLY, because the magic-link routing
// in onAuthStateChange is gated on fromMagicLink, which is false for a typed code (no URL tokens).
// opts.note appends a small extra line (TC-62 safekeeping: "open on this device");
// opts.onRetry overrides the "use a different email" handler (default: openSignIn).
function renderCheckInbox(email, opts = {}) {
  const noteHtml = opts.note
    ? `<p class="tc-help-sm" style="text-align:center;max-width:34ch;margin:0 auto 16px;color:var(--tc-ink,#2c2a26);">${opts.noteHtml || esc(opts.note)}</p>` : "";
  modalBody().innerHTML = `
    <div class="panel-body" style="text-align:center;">
      <div class="tc-sent-badge" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none" stroke="#118ab9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="8" y="13" width="32" height="22" rx="3"/><path d="M9 15l15 11 15-11"/>
          <circle cx="37" cy="34" r="7" fill="#e3f0f6" stroke="#118ab9"/><path d="M34 34l2 2 4-4" stroke="#118ab9"/>
        </svg>
      </div>
      <h2 class="q-title" style="margin-top:14px;">Check your email</h2>
      <p class="q-help" style="max-width:36ch;margin-left:auto;margin-right:auto;">We just sent a code to <b>${esc(email)}</b>. Enter it here to sign in. No password to remember.</p>
      ${noteHtml}
      <div class="tc-code-wrap" style="max-width:22ch;margin:16px auto 6px;">
        <input type="text" id="tcCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="Enter your code" style="text-align:center;font-size:18px;" />
      </div>
      <div class="nav" style="justify-content:center;"><button class="cta" id="tcVerifyCode" style="min-width:180px;justify-content:center;">Sign me in</button></div>
      <div class="k-msg" id="tcCodeMsg" style="text-align:center;"></div>
      <p class="tc-help-sm" style="text-align:center;max-width:36ch;margin:14px auto 8px;">Prefer the link? The email also has one, and it opens right back here.</p>
      <button class="link-btn" id="tcInboxDone" style="padding:0 2px;">Close and use the link instead</button>
      <div class="k-privacy" style="margin-top:16px;">Didn't see it? Check spam, or <button class="link-btn tc-inbox-retry" style="padding:0 2px;">use a different email</button>.</div>
    </div>`;
  const codeEl = modalBody().querySelector("#tcCode");
  const msg = modalBody().querySelector("#tcCodeMsg");
  const btn = modalBody().querySelector("#tcVerifyCode");
  if (codeEl) { try { codeEl.focus(); } catch (e) {} }
  // TC-94: keep the TYPED digits pleasantly spaced, but DON'T apply letter-spacing to the
  // placeholder — at letter-spacing:3px inside a narrow centered box the placeholder overflowed
  // and clipped ("Enter your cod") on a ~360px phone. Toggle the spacing on only when there's a value.
  if (codeEl) {
    const applyCodeSpacing = () => { codeEl.style.letterSpacing = codeEl.value ? "6px" : ""; };
    codeEl.addEventListener("input", applyCodeSpacing);
    applyCodeSpacing();
  }
  const verify = async () => {
    const token = (codeEl.value || "").replace(/\s+/g, "").trim();
    if (!/^\d{6,8}$/.test(token)) { msg.className = "k-msg bad"; msg.textContent = "That code should be the digits from your email."; return; }
    btn.disabled = true; msg.className = "k-msg"; msg.textContent = "Signing you in...";
    // type:"email" verifies BOTH a returning-user sign-in OTP and a new-user signup OTP.
    const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
    if (error) { console.warn("verifyOtp", error.message); btn.disabled = false; msg.className = "k-msg bad"; msg.textContent = "That code didn't work. Check it and try again, or request a new one."; return; }
    // Signed in IN THIS CONTEXT (no Safari hop). onAuthStateChange won't route this (no URL tokens),
    // so run the shared routing explicitly — identical to the magic-link path.
    try { window.tcTrack && window.tcTrack("signin_code_verified"); } catch (e) {}
    routeAfterSignIn();
  };
  if (btn) btn.onclick = verify;
  if (codeEl) codeEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); verify(); } });
  modalBody().querySelector("#tcInboxDone").onclick = closeModal;
  modalBody().querySelector(".tc-inbox-retry").onclick = opts.onRetry || openSignIn;
}

/* ---------------- safekeeping sign-in (TC-62) ------------------------------------
 * An anon user spoke and chose to REMEMBER a person. We don't wall the mic — we
 * invite sign-in *at this moment* as SAFEKEEPING (not a gate), reflect their words
 * back warmly, and never dead-end: they can always "just make my plan instead".
 * On send we stash the transcript so the magic-link return resumes the remember. */
function promptSignInToRemember(transcript) {
  const t = String(transcript || "").trim();
  if (!t) { openSignIn(); return; }
  try { window.tcTrack && window.tcTrack("voice_remember_signin_prompted"); } catch (e) {}
  openModal();
  modalBody().innerHTML = `
    <div class="panel-body">
      <div class="q-eyebrow">Let me hold onto that</div>
      <h2 class="q-title">Keep them close</h2>
      <p class="q-help">I've got what you said. Sign in with just your email and I'll keep this person, and the dates that matter to them, safe, and gently remind you before each one. No password.</p>
      <blockquote style="font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:16.5px;line-height:1.5;color:var(--tc-ink,#2c2a26);border-left:3px solid var(--tc-blue,#118ab9);margin:14px 0 16px;padding:2px 0 2px 14px;text-align:left;">“${esc(t)}”</blockquote>
      <input type="email" id="tcEmail" placeholder="you@email.com" autocomplete="email" />
      <div class="nav"><span></span><button class="cta" id="tcSendLink">Email me a link to keep them →</button></div>
      <div class="k-msg" id="tcAuthMsg"></div>
      <div style="text-align:center;margin-top:14px;"><button class="link-btn" id="tcRememberDecline">Just make my plan instead →</button></div>
      <div class="k-privacy" style="margin-top:12px;">We use your email only for this. No password, no sharing, no spam.</div>
    </div>`;
  const emailEl = modalBody().querySelector("#tcEmail");
  emailEl.focus();
  const send = async () => {
    const email = (emailEl.value || "").trim();
    const msg = modalBody().querySelector("#tcAuthMsg");
    const btn = modalBody().querySelector("#tcSendLink");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.className = "k-msg bad"; msg.textContent = "Please enter a valid email address."; return; }
    btn.disabled = true; msg.className = "k-msg"; msg.textContent = "Sending your link...";
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
    if (error) { console.warn("signInWithOtp", error.message); btn.disabled = false; msg.className = "k-msg bad"; msg.textContent = "Could not send the link. Please try again in a moment."; return; }
    // Hold the request on THIS device so the magic-link return resumes it (Option 1).
    stashPendingVoice({ intent: "remember", transcript: t });
    try { window.tcTrack && window.tcTrack("voice_remember_signin_sent"); } catch (e) {}
    renderCheckInbox(email, {
      note: "Open the link on this device to pick up right where you left off.",
      noteHtml: "Open the link on <b>this device</b> to pick up right where you left off.",
      onRetry: () => promptSignInToRemember(t),
    });
  };
  modalBody().querySelector("#tcSendLink").onclick = send;
  emailEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
  // Never a dead-end: decline still delivers the one-off plan (guardrail).
  modalBody().querySelector("#tcRememberDecline").onclick = () => {
    clearPendingVoice();
    try { window.tcTrack && window.tcTrack("voice_remember_declined_to_plan"); } catch (e) {}
    closeModal();
    if (window.startPlanFromText) window.startPlanFromText(t);
  };
}

/* ---------------- data ---------------- */
async function loadPeople() {
  // Personal circle ONLY — never the book-of-business roster (TC-46 Fix 1). The roster
  // (roster.js) shows contact_kind='contact'; this intimate list must stay personal, or
  // an import would flood "People I care about" with every client. contact_kind is NOT
  // NULL DEFAULT 'personal', so a plain equality is correct (no legacy NULLs exist).
  // A situation (kind='situation') carries several nudges in the child situation_reminders table.
  // We fetch them nested (no extra round-trip). DEGRADE GRACEFULLY: if that table isn't migrated
  // yet PostgREST errors the whole embed, so on a schema/relationship error we retry the exact
  // legacy select WITHOUT the nested reminders — situations then render as plain dates (spec §6).
  const KD_WITH_REM = "key_dates(id,label,kind,event_date,date_precision,recurs,lead_days,situation_reminders(id,key_date_id,lead_days,label,active))";
  const KD_PLAIN = "key_dates(id,label,kind,event_date,date_precision,recurs,lead_days)";
  const SEL = (kd) => `id,name,relationship,notes,location,created_at,${kd},saved_plans(id,plan_title,occasion,created_at,plan)`;
  const runSelect = (kd) => sb
    .from("people")
    .select(SEL(kd))
    .eq("contact_kind", "personal")
    .is("deleted_at", null) // hard-deleted people (TC-49) never reappear in any read
    .order("created_at", { ascending: true });
  let { data, error } = await runSelect(KD_WITH_REM);
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (/situation_reminders|relationship|schema cache|does not exist/.test(msg)) {
      ({ data, error } = await runSelect(KD_PLAIN)); // pre-migration: no situation nudges yet
    }
  }
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
// TC-89 — the personal circle for the voice "…about someone you know" picker, ordered
// MOST-RECENTLY-ENGAGED first. A flat A-Z list doesn't scale (a user may have 100+ people);
// recent-first puts the common case one tap away, and the picker's type-to-filter + say-a-name
// cover everyone else. Recency = the newest of {a saved plan, a noticed fact, the person's own
// created_at} — a cheap client-side proxy (no schema change, no migration) for "last touched".
// Returns [{ id, name, relationship, location, detail, recency }] newest-first.
// `detail` is a recognizable fallback (relationship -> location -> most recent noticed fact)
// so a picker row is never a bare name for someone whose only distinguishing info is a fact
// (TC-89 FIX #4). p.facts is loaded newest-first, so noticedList(...)[0] is the latest fact.
async function listPeopleForVoice() {
  if (!user) return [];
  const people = await loadPeople();
  const ts = (s) => { const n = s ? Date.parse(s) : NaN; return Number.isFinite(n) ? n : 0; };
  const recencyOf = (p) => {
    let r = ts(p.created_at);
    for (const f of (p.facts || [])) r = Math.max(r, ts(f.created_at));
    for (const pl of (p.saved_plans || [])) r = Math.max(r, ts(pl.created_at));
    return r;
  };
  const detailOf = (p) => {
    if (p.relationship) return p.relationship;
    if (p.location) return p.location;
    const fact = noticedList(p.facts || [])[0];
    return fact ? String(fact).trim() : "";
  };
  return people
    .map((p) => ({ id: p.id, name: p.name, relationship: p.relationship || "", location: p.location || "", detail: detailOf(p), recency: recencyOf(p) }))
    .sort((a, b) => b.recency - a.recency);
}
async function addPerson(p) {
  const { data, error } = await sb.from("people").insert({ user_id: user.id, ...p }).select().single();
  if (error) throw error;
  return data;
}
async function addKeyDate(personId, d) {
  // Return the inserted row so callers that then seed child rows (a situation's reminders) have its
  // id. .select().single() is additive — existing callers ignore the return value, so behavior for
  // them is unchanged.
  const { data, error } = await sb.from("key_dates").insert({ user_id: user.id, person_id: personId, ...d }).select().single();
  if (error) throw error;
  return data;
}
async function savePlan(personId, plan, occasion) {
  // TC-117: classify + store the plan's valence ONCE at save time, so the grief guard reads a
  // stored SAFETY control instead of a lossy re-derivation later. DORMANT-SAFE: the valence
  // column is a proposed migration (009) not yet applied. Writing it before then would fail
  // with "column does not exist" (PG 42703) and lose the whole plan — so we try WITH valence
  // and, on that specific pre-migration error, retry the exact legacy insert WITHOUT it. Once
  // 009 is applied the first insert succeeds and valence is stored going forward.
  const base = { user_id: user.id, person_id: personId, plan_title: plan.plan_title || "", occasion: occasion || "", plan };
  const valence = classifyValenceLite(occasion || plan.plan_title || "");
  const { error } = await sb.from("saved_plans").insert({ ...base, valence });
  if (error) {
    if (error.code === "42703" || /valence/i.test(error.message || "")) {
      const retry = await sb.from("saved_plans").insert(base); // pre-migration: legacy write, unchanged
      if (retry.error) throw retry.error;
      return;
    }
    throw error;
  }
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
    if (chars.length > 70) label = chars.slice(0, 67).join("").trimEnd() + "...";
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
  reviewOpen = false; // a fresh open of "People I care about" starts with the review panel closed
  modalBody().innerHTML = `<div class="panel-body"><p class="q-help">Loading your people...</p></div>`;
  const people = await loadPeople();
  try { reviewCount = await pendingCount(sb); } catch { reviewCount = 0; }
  renderHome(people);
}

/* ---------------- quick capture + To-Review (TC-50) ---------------- */
// Reload the whole "Your People" home from the DB (people + review count) and re-render, so a
// capture's new fact / new person shows immediately — no manual reload (UX gate). `highlightId`
// flashes the affected card so the user sees where it landed.
async function reloadHome(opts = {}) {
  try { reviewCount = await pendingCount(sb); } catch {}
  renderHome(await loadPeople(), opts);
}
// The quick-capture ("Note something") door + the To-Review toggle/panel. Only shown once the
// user has someone saved — the empty state leads with "Add someone" (progressive disclosure).
function captureStripHtml(people) {
  if (!people.length) return "";
  return `<div class="tc-capstrip">
      ${qcHintHtml()}
      <div class="tc-qc-mount"></div>
      <button class="link-btn tc-review-toggle" id="tcReviewToggle">To review${reviewCount ? `<span class="tc-badge-dot">${reviewCount}</span>` : ""}</button>
      <div class="tc-review-panel" id="tcReviewPanel" hidden style="margin-top:10px;"></div>
    </div>`;
}
function reviewToggleHtml() {
  return `To review${reviewCount ? `<span class="tc-badge-dot">${reviewCount}</span>` : ""}`;
}
function wireCaptureStrip(people) {
  wireQcHint(modalBody());
  const qc = modalBody().querySelector(".tc-qc-mount");
  // A quick capture just wrote a fact (Level A) or queued one (Level B) — reload so it shows.
  if (qc) mountQuickCapture(qc, sb, { contactKind: "personal", onChange: () => reloadHome() });
  const toggle = modalBody().querySelector("#tcReviewToggle");
  const panel = modalBody().querySelector("#tcReviewPanel");
  if (!toggle || !panel) return;
  const openPanel = () => {
    reviewOpen = true; panel.hidden = false;
    mountToReview(panel, sb, {
      people, contactKind: "personal",
      // After a confirm/reassign: refresh the badge, and reload the home so the new/updated card
      // appears + flashes — while keeping the review panel open for any remaining items.
      onResolved: (res) => reloadHome({ highlightId: res && res.personId, keepReviewOpen: true }),
    });
  };
  toggle.onclick = () => { if (panel.hidden) openPanel(); else { reviewOpen = false; panel.hidden = true; } };
  if (reviewOpen && reviewCount) openPanel(); // survive a reloadHome mid-review
}

// The bare date row (label · when) for a key date. Situations reuse this exact row markup — the
// only difference is a nudges summary + an inline editor mount that personCard adds beneath it.
function dateRowHtml(d) {
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

// One key date, rendered for a person card. A NON-situation date renders exactly as it always has
// (no regression). A situation (kind='situation') renders the same row PLUS a plain-language line of
// its nudges ("nudges: 3 days before, day of") and an inline editor mount for add/retime/remove.
function dateLine(d) {
  if (d.kind !== "situation") return dateRowHtml(d);
  const summary = remindersSummary(d.situation_reminders);
  const nudges = summary
    ? `<div class="tc-sit-nudges">Nudges: ${esc(summary)}</div>`
    : `<div class="tc-sit-nudges tc-sit-nudges-empty">No nudges yet.</div>`;
  return `
    <div class="tc-sit" data-kdid="${d.id}">
      ${dateRowHtml(d)}
      ${nudges}
      <div class="tc-rem-mount" data-kdid="${d.id}"></div>
    </div>`;
}

function personCard(p) {
  const sp = p.saved_plans || [];
  const savedHtml = sp.length ? `<div class="tc-savedplans"><div class="tc-sp-label">Plans you've made</div>${
    sp.map((x) => `<button class="tc-sp-row" data-pid="${p.id}" data-spid="${x.id}">${esc(x.plan_title || x.occasion || "A plan")}</button>`).join("")
  }</div>` : "";
  // The standalone next-date pill was dropped (visual-polish punch list): the sorted date rows
  // below already lead with the soonest date and each carries its own "· in N days" hint, so the
  // pill only duplicated the first row.
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
      <div class="tc-dates">${dates.map(dateLine).join("") || `<div class="tc-empty">No dates yet. Add one so we can gently remind you.</div>`}</div>
      <button class="tc-add-date link-btn" data-pid="${p.id}">+ Add a date or reminder</button>
      <div class="tc-noticed-mount" data-pid="${p.id}"></div>
      ${savedHtml}
      <button class="cta tc-showup" data-pid="${p.id}">${heartSvg(16, "currentColor")}<span>Help me show up for ${esc(firstName(p.name))}</span></button>
      <button class="cta ghost tc-talk" data-pid="${p.id}" style="width:100%;justify-content:center;margin-top:8px;">${chatSvg(16, "currentColor")}<span>Talk it through</span></button>
      <div class="tc-persondel-mount" data-pid="${p.id}"></div>
    </div>`;
}

function renderHome(people, opts = {}) {
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
      <input type="text" id="tcSearch" placeholder="Search your people..." autocomplete="off" />
      <select id="tcSort" class="tc-select">
        <option value="next">Sort: next date</option>
        <option value="alpha">Sort: name (A-Z)</option>
        <option value="recent">Sort: recently added</option>
      </select>
    </div>` : "";

  modalBody().innerHTML = `
    <div class="panel-body">
      <div class="q-eyebrow">Welcome back</div>
      <h2 class="q-title" style="margin-bottom:10px;">People I care about</h2>
      <div class="tc-promise">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        <span class="tc-promise-txt">We'll <b>gently nudge you before every date that matters</b>: birthdays, anniversaries, hard days, so you're always ready to show up.</span>
      </div>
      <p class="tc-account">Signed in as ${email} · <button class="link-btn tc-export">Export my data</button> · <button class="link-btn tc-signout">Sign out</button></p>
      <div style="height:14px"></div>
      ${comingUp}
      ${captureStripHtml(people)}
      <!-- TC-116: the Add affordance is pinned to the TOP of the People surface (above the
           search/sort controls and the list) so adding someone never means scrolling past
           everyone. The manual/import form expands in place, still at the top. -->
      <button class="cta ghost tc-addtoggle" id="tcAddToggle" style="width:100%;justify-content:center;margin-top:6px;">${plusSvg(16, "currentColor")}<span>Add someone</span></button>
      <div class="block tc-addwrap" id="tcAddForm" style="display:none;">
        <h4><span class="ic">${plusSvg(17, "var(--sage-deep)")}</span>Add someone</h4>

        <!-- TC-98/TC-100/TC-101 — faster ways to add someone, all funnel through the same
             extract → resolve → confirm pipeline as typing. UX fix: these fast doors LEAD the
             Add-someone lane (top, no scroll) so a user discovers them before the manual form. -->
        <div class="tc-add-more">
          <!-- TC-107: the calmest door — a guided, one-question-at-a-time add for the timid /
               first-time / accessibility case. It leads the lane (a hesitant user should find it
               first) but does NOT replace the fast doors below; it layers over the SAME
               extract → resolve → confirm brain. -->
          <button class="cta ghost" id="np_guided_btn" type="button" style="width:100%;justify-content:center;">Add one gentle question at a time</button>
          <p class="tc-help-sm" style="margin:6px 0 14px;">New here, or would rather take it slow? We'll ask one small thing at a time, and you can skip anything.</p>
          <div id="np_guided_out"></div>

          <!-- 1c/1d: a screenshot/photo of a DM/profile/contact card, or a shared .vcf.
               TC-99: on mobile, "Take a photo" opens the camera directly (capture=environment) so a
               user can shoot a business card / invite / card / obituary in front of them; the library
               button keeps the desktop file/screenshot/.vcf path. Both route to the SAME handler. -->
          <button class="cta ghost" id="np_camera_btn" type="button" style="width:100%;justify-content:center;">Take a photo</button>
          <input type="file" id="np_camera_file" accept="image/*" capture="environment" style="display:none;" />
          <button class="cta ghost" id="np_photo_btn" type="button" style="width:100%;justify-content:center;margin-top:8px;">Add from a screenshot or photo</button>
          <input type="file" id="np_photo_file" accept="image/*,.vcf,text/vcard" style="display:none;" />
          <p class="tc-help-sm" style="margin:6px 0 0;">A business card, an invitation, a card, a text, a profile, or a saved contact. We'll read who it's about and let you confirm.</p>

          <!-- TC-106: add from a VOICE MEMO. Upload a recording that describes someone; we transcribe
               it and run the SAME read-who-it's-about pipeline as talking or pasting, then you confirm.
               On mobile the picker surfaces the phone's saved voice memos / audio. -->
          <button class="cta ghost" id="np_audio_btn" type="button" style="width:100%;justify-content:center;margin-top:8px;">Add from a voice memo</button>
          <input type="file" id="np_audio_file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.webm" style="display:none;" />
          <p class="tc-help-sm" style="margin:6px 0 0;">Record or share a memo about them and we'll listen, pull out who it's about, and let you confirm.</p>

          <!-- 1a: paste a bio / anything about them -->
          <textarea id="np_paste" placeholder="Or paste something about them: a bio, a message, a note, or a screenshot, and we'll pull out who it's about" style="margin-top:12px;min-height:72px;"></textarea>
          <div class="nav" style="justify-content:flex-end;"><button class="cta ghost" id="np_paste_go" type="button">Read it →</button></div>

          <!-- confirm cards (tap-to-edit) render here -->
          <div id="np_import_out"></div>
          <div class="k-msg" id="np_import_msg"></div>
        </div>

        <!-- Manual "type it in yourself" fallback, presented below the fast doors. -->
        <div style="border-top:1px solid var(--line);margin:16px 0 12px;"></div>
        <p class="tc-help-sm" style="margin:0 0 10px;">Or type it in yourself:</p>
        <input type="text" id="np_name" placeholder="Their name" />
        <input type="text" id="np_rel" placeholder="Who they are to you (e.g. someone I manage)" style="margin-top:10px;" />
        <textarea id="np_notes" placeholder="Anything worth remembering about them (optional)" style="margin-top:10px;min-height:72px;"></textarea>
        <div class="nav"><button class="link-btn" id="np_cancel">Cancel</button><button class="cta" id="np_save">Add them →</button></div>
        <div class="k-msg" id="np_msg"></div>
      </div>
      ${controls}
      <div id="tcPeopleList"></div>
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
      ? (view.length ? view.map(personCard).join("") : `<div class="tc-empty" style="padding:10px 0;text-align:center;">No one matches "${esc(query)}".</div>`)
      : `<div class="tc-empty" style="padding:8px 0 14px;text-align:center;">No one saved yet. Add the first person who matters to you: a friend, a teammate, someone you manage.</div>`;
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
    // Situation reminders (spec §6) — each situation row gets an inline add/retime/remove editor,
    // seeded from the nested situation_reminders loaded with the person. On change we re-render the
    // whole home so the row's "Nudges: …" summary stays in step (cheap; the personal circle is small).
    listEl().querySelectorAll(".tc-rem-mount").forEach((el) => {
      const p = people.find((x) => x.id === el.closest(".block")?.dataset.pid);
      const kd = p && (p.key_dates || []).find((k) => k.id === el.dataset.kdid);
      if (kd) mountReminders(el, sb, kd, {
        reminders: kd.situation_reminders || [],
        onChange: async () => renderHome(await loadPeople()),
      });
    });
    // Whole-person hard-delete (TC-49) — on removal, refresh the home so the card disappears.
    listEl().querySelectorAll(".tc-persondel-mount").forEach((el) => {
      const p = people.find((x) => x.id === el.dataset.pid);
      if (p) mountPersonDelete(el, sb, p, { onDeleted: async () => renderHome(await loadPeople()) });
    });
    listEl().querySelectorAll(".tc-showup").forEach((btn) => {
      btn.onclick = () => { const p = people.find((x) => x.id === btn.dataset.pid); closeModal(); showUpFor(p); };
    });
    // TC-66 Phase 3a: "Talk it through" opens the memory-aware conversation about this person.
    listEl().querySelectorAll(".tc-talk").forEach((btn) => {
      btn.onclick = () => { const p = people.find((x) => x.id === btn.dataset.pid); closeModal(); talkItThrough(p); };
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
  wireCaptureStrip(people);
  if (opts.highlightId) {
    const card = listEl().querySelector(`.block[data-pid="${opts.highlightId}"]`);
    if (card) flashCard(card);
  }

  modalBody().querySelector(".tc-signout").onclick = async () => {
    await sb.auth.signOut();
    // TC-81: privacy — a device-local recovered plan must not survive a sign-out (shared device).
    try { window.tcClearLastPlan && window.tcClearLastPlan(); window.tcRefreshLastPlanAffordance && window.tcRefreshLastPlanAffordance(); } catch (e) {}
    closeModal();
  };
  const exportBtn = modalBody().querySelector(".tc-export");
  if (exportBtn) exportBtn.onclick = async () => {
    exportBtn.disabled = true; const prev = exportBtn.textContent; exportBtn.textContent = "Preparing...";
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
  // Don't auto-focus the manual name field: it now sits below the fast doors, and focusing it
  // would scroll those doors out of view — the opposite of leading with them.
  const showAdd = (on) => { addForm.style.display = on ? "" : "none"; addToggle.style.display = on ? "none" : ""; };
  addToggle.onclick = () => showAdd(true);
  // Voice on the add-someone fields = the inline mic inside each box (dictation → in-place
  // record/transcribe/append via window.toggleMic). Mounts no-op if voice isn't available.
  const npName = modalBody().querySelector("#np_name");
  const npRel = modalBody().querySelector("#np_rel");
  const npNotes = modalBody().querySelector("#np_notes");
  if (npName) mountInlineMic(npName, { mode: "dictation", ariaLabel: "Say their name" });
  if (npRel) mountInlineMic(npRel, { mode: "dictation", ariaLabel: "Say who they are to you" });
  if (npNotes) mountInlineMic(npNotes, { mode: "dictation", ariaLabel: "Say something worth remembering" });
  modalBody().querySelector("#np_cancel").onclick = () => showAdd(false);
  if (!people.length) showAdd(true); // first-run: don't hide the only action
  modalBody().querySelector("#np_save").onclick = async () => {
    const name = modalBody().querySelector("#np_name").value.trim();
    const msg = modalBody().querySelector("#np_msg");
    if (!name) { msg.className = "k-msg bad"; msg.textContent = "A name helps us make it personal."; return; }
    msg.className = "k-msg"; msg.textContent = "Saving...";
    try {
      // The "anything worth remembering" field is the on-ramp to the ONE memory store — it
      // becomes this person's first noticed item, not a separate people.notes blob (TC-49).
      const firstNote = modalBody().querySelector("#np_notes").value.trim();
      const person = await addPerson({ name, relationship: modalBody().querySelector("#np_rel").value.trim() || null });
      if (firstNote) { try { await createNote(sb, person.id, firstNote); } catch (e) { console.error("first note failed", e); } }
      renderHome(await loadPeople());
    } catch (e) { console.warn("add person failed", e); msg.className = "k-msg bad"; msg.textContent = "Could not save. Please try again."; }
  };

  // ── TC-98/TC-100/TC-101: import doors (screenshot/photo, .vcf, paste). Each returns previews that
  //    render as tap-to-edit confirm cards; confirming routes through the SAME captureResolve. On a
  //    NEW person we persist the edited relationship (server createPerson sets name only), then refresh
  //    the home so the new/updated card appears — no reload. ──
  const importOut = modalBody().querySelector("#np_import_out");
  const importMsg = modalBody().querySelector("#np_import_msg");
  const setImportMsg = (t, bad) => { if (!importMsg) return; importMsg.className = "k-msg" + (bad ? " bad" : ""); importMsg.textContent = t || ""; };

  const onConfirmed = async (res, { relationship, relChanged, isNew, birthday, event, reminders } = {}) => {
    // Persist the edited "who they are to you" — the server createPerson/resolve sets name only and
    // ignores relationship, so the client honors it here. New person: write whatever they entered.
    // Existing person (update card): write ONLY when the user actually set/changed the field, so we
    // never overwrite an existing relationship with a blank or stale prefill.
    const shouldWriteRel = res && res.ok && res.personId && (isNew ? !!relationship : (relChanged && !!relationship));
    if (shouldWriteRel) {
      try { await sb.from("people").update({ relationship }).eq("id", res.personId).eq("user_id", user.id); }
      catch (e) { console.error("set relationship on person", e); }
    }
    // TC-112: the confirm card returns a birthday only when the user added/edited one the extraction
    // didn't already seed. Write it as a labeled RECURRING "Birthday" key_date (recurs from the parse:
    // a year-less birthday recurs yearly; a full date with a year does not). Deduped on label+date so
    // re-confirming can't pile up duplicates.
    if (res && res.ok && res.personId && birthday && birthday.event_date) {
      try {
        const { data: existing } = await sb.from("key_dates")
          .select("id").eq("person_id", res.personId).eq("label", "Birthday").eq("event_date", birthday.event_date);
        if (!existing || !existing.length) {
          await addKeyDate(res.personId, { label: "Birthday", kind: "birthday", event_date: birthday.event_date, recurs: !!birthday.recurs, lead_days: 7 });
        }
      } catch (e) { console.error("set birthday key_date", e); }
    }
    // TC-99: the confirm card returns `event` only when the user added/edited a non-birthday occasion
    // (a wedding, a graduation) the extraction didn't already seed. Write it as a labeled key_date —
    // recurring for a year-less date, one-time for a full date. Needs a real date to be a key_date;
    // an occasion with no date (e.g. an obituary's dateless loss) stays as the audit note only.
    // Deduped on label+date so re-confirming can't pile up duplicates.
    // A situation carries several nudges (spec §4.2): when the confirm card returned `reminders`, this
    // event is a situation — write it as kind='situation' and seed the chosen nudges into
    // situation_reminders. Otherwise it's a plain occasion, written exactly as before. DORMANT-SAFE:
    // seeding is best-effort, so a missing situation_reminders table never blocks the key_date write.
    const hasReminders = Array.isArray(reminders); // present (even if []) only for a situation confirm
    if (res && res.ok && res.personId && event && event.event_date) {
      try {
        const label = (event.label || "A date to remember").slice(0, 120);
        const { data: existing } = await sb.from("key_dates")
          .select("id").eq("person_id", res.personId).eq("label", label).eq("event_date", event.event_date);
        let kdId = existing && existing.length ? existing[0].id : null;
        if (!kdId) {
          const kind = hasReminders ? "situation" : (event.recurs ? "custom" : "moment");
          // A situation is one-time (recurs:false); its lead_days is unused (child reminders carry timing).
          const kd = await addKeyDate(res.personId, {
            label, kind, event_date: event.event_date,
            recurs: hasReminders ? false : !!event.recurs, lead_days: hasReminders ? 0 : 7,
          });
          kdId = kd?.id || null;
        }
        if (hasReminders && kdId) {
          for (const r of reminders) {
            try { await addReminder(sb, kdId, r.lead_days); }
            catch (e) { console.error("seed situation reminder (confirm card)", e); }
          }
        }
      } catch (e) { console.error("set event key_date", e); }
    } else if (res && res.ok && res.personId && hasReminders && reminders.length && res.situationKeyDateId) {
      // CONTRACT (see summary): if WP-B seeds the situation key_date server-side and echoes its id as
      // res.situationKeyDateId (with NO editable `event` on the card), seed the user's chip edits onto it.
      for (const r of reminders) {
        try { await addReminder(sb, res.situationKeyDateId, r.lead_days); }
        catch (e) { console.error("seed situation reminder (server-seeded kd)", e); }
      }
    }
    renderHome(await loadPeople(), { highlightId: res?.personId });
  };

  // TC-114: a NEW import action (a new paste / a new screenshot) REPLACES the previous un-confirmed
  // preview card(s) — starting a fresh add without confirming the last one must not stack cards.
  // Call this ONCE at the start of each separate user action, before rendering that action's batch;
  // a single result with MULTIPLE people still renders one card per person (that batch is intentional).
  // TC-99 (UX): the working state must land RIGHT WHERE THE USER JUST TAPPED, not below the doors
  // (David: "I had to look even harder to find it"). So it's an opaque panel laid directly OVER the
  // fast-doors block (.tc-add-more) — it momentarily REPLACES "Take a photo / Add a photo" with the
  // lantern, then lifts the instant the confirm card (or an error) is ready. clearImportCards also
  // removes it, so every existing resolve/error path tears it down for free.
  const importDoors = () => modalBody().querySelector(".tc-add-more");
  const clearImportCards = () => {
    if (importOut) importOut.innerHTML = "";
    const ov = importDoors()?.querySelector(".tc-imp-working");
    if (ov) ov.remove();
  };

  const showImportWorking = (heading = "Reading who this is about...") => {
    clearImportCards();
    setImportMsg("");
    const doors = importDoors();
    if (!doors) return;
    doors.style.position = "relative";
    const ov = document.createElement("div");
    ov.className = "tc-imp-working loading";
    ov.setAttribute("role", "status");
    ov.setAttribute("aria-live", "polite");
    ov.style.cssText = "position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px;background:#fffdf8;border-radius:14px;padding:20px;";
    ov.innerHTML = `
      <svg class="lantern" viewBox="0 0 120 130" aria-hidden="true" style="width:96px;height:auto;">
        <circle class="glow" cx="60" cy="62" r="52" fill="#ffe7b8"/>
        <path d="M40 40a255 255 0 0 1 40 0" fill="none"/>
        <path d="M42 46a20 20 0 0 1 36 0V96H42Z" fill="#fff9ee" stroke="#cda074" stroke-width="4"/>
        <line x1="60" y1="28" x2="60" y2="96" stroke="#cda074" stroke-width="3"/>
        <line x1="42" y1="66" x2="78" y2="66" stroke="#cda074" stroke-width="3"/>
        <circle cx="60" cy="66" r="10" fill="#ffd691"/>
      </svg>
      <p class="big" style="margin:0;">${heading}</p>
      <p class="lines" style="margin:0;">Give me a moment. I'll pull out who it's for and let you look it over.</p>`;
    doors.appendChild(ov);
    if (doors.scrollIntoView) doors.scrollIntoView({ block: "nearest" });
  };

  const renderPreviews = (result) => {
    const previews = (result && result.previews) || [];
    if (!previews.length) { clearImportCards(); setImportMsg(result?.message || "We couldn't find a person in that. Try a clearer screenshot.", false); return; }
    clearImportCards(); // tear down the working screen before the confirm card(s) render in its place
    if (result.ambiguousMultiPerson && previews.length > 1) setImportMsg("Looks like more than one person, confirm each below.", false);
    else setImportMsg("");
    for (const pv of previews) renderImportConfirm(importOut, sb, pv, { contactKind: "personal", onConfirmed, onDismiss: () => setImportMsg("") });
  };

  // The extract/transcribe calls can hang under a slow network or a stuck server; without a ceiling
  // the full-screen working overlay would cover the add-doors forever with no escape. Race every
  // import call against a timeout so a hang tears the overlay down with a warm retry message.
  const IMPORT_TIMEOUT_MS = 30000;
  const withTimeout = (promise, ms = IMPORT_TIMEOUT_MS) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);

  // TC-113: route an image (from the file picker OR a clipboard/drag-drop paste) through the SAME
  // image extractor + confirm card. Clears any prior un-confirmed card first (TC-114).
  const importImageFile = async (file, busyEl) => {
    if (!file) return;
    showImportWorking();
    if (busyEl) busyEl.disabled = true;
    try { renderPreviews(await withTimeout(captureFromFile(sb, file))); }
    catch (e) { console.warn("import image failed", e); clearImportCards(); setImportMsg("We couldn't read that file. Please try again.", true); }
    if (busyEl) busyEl.disabled = false;
  };

  const photoBtn = modalBody().querySelector("#np_photo_btn");
  const photoFile = modalBody().querySelector("#np_photo_file");
  if (photoBtn && photoFile) {
    photoBtn.onclick = () => photoFile.click();
    photoFile.onchange = async () => {
      const file = photoFile.files && photoFile.files[0];
      await importImageFile(file, photoBtn);
      photoFile.value = "";
    };
  }

  // TC-99: the camera door — same handler, a mobile-camera-first input. On desktop this simply
  // opens the file picker (browsers ignore `capture` when there's no camera), so it degrades safely.
  const cameraBtn = modalBody().querySelector("#np_camera_btn");
  const cameraFile = modalBody().querySelector("#np_camera_file");
  if (cameraBtn && cameraFile) {
    cameraBtn.onclick = () => cameraFile.click();
    cameraFile.onchange = async () => {
      const file = cameraFile.files && cameraFile.files[0];
      await importImageFile(file, cameraBtn);
      cameraFile.value = "";
    };
  }

  // TC-101/TC-106: run FREE TEXT (a pasted bio OR a transcribed voice memo) through the LIVE
  // capture-extract in preview mode → the SAME confirm card as typing/voice. ONE place so the paste
  // door and the voice-memo door share identical extract → resolve → confirm wiring (no parallel
  // path). source_kind only tags provenance on the preview; the pipeline is the same.
  const renderTextPreviews = async (text, { sourceKind }) => {
    const result = await withTimeout(captureExtract(sb, { rawText: text, source: "typed", preview: true }));
    const previews = (result.captures || []).map((c) => ({ ...c, personHint: c.personHint || c.personName || "", relationshipHint: "", source_kind: sourceKind }));
    if (!previews.length) { clearImportCards(); setImportMsg(result.message || "Nothing to add there yet.", false); return false; }
    clearImportCards(); // tear down the working overlay before the confirm card(s) render in its place
    for (const pv of previews) renderImportConfirm(importOut, sb, pv, { contactKind: "personal", onConfirmed, onDismiss: () => setImportMsg("") });
    return true;
  };

  // TC-106: the voice-memo door. Transcribe the uploaded/shared audio (server-side Whisper, key never
  // touches the client), then funnel the transcript through the SAME text pipeline above. Clears any
  // prior un-confirmed card first (TC-114). Guards mime/size client-side too (transcribeAudioFile).
  const importAudioFile = async (file, busyEl) => {
    if (!file) return;
    // TC-99 working-state, over the doors — up for the WHOLE wait (transcribe, then extract), the
    // longest of any door. renderTextPreviews tears it down when the confirm card is ready.
    showImportWorking("Listening to your memo...");
    if (busyEl) busyEl.disabled = true;
    try {
      const text = await withTimeout(transcribeAudioFile(sb, file));
      if (!text) { clearImportCards(); setImportMsg("We couldn't catch anything in that memo. Try again, or type it.", false); }
      else { await renderTextPreviews(text, { sourceKind: "voice_memo" }); }
    } catch (e) { console.warn("import audio failed", e); clearImportCards(); setImportMsg("We couldn't read that recording. Please try again.", true); }
    if (busyEl) busyEl.disabled = false;
  };

  const audioBtn = modalBody().querySelector("#np_audio_btn");
  const audioFile = modalBody().querySelector("#np_audio_file");
  if (audioBtn && audioFile) {
    audioBtn.onclick = () => audioFile.click();
    audioFile.onchange = async () => {
      const file = audioFile.files && audioFile.files[0];
      await importAudioFile(file, audioBtn);
      audioFile.value = "";
    };
  }

  const pasteEl = modalBody().querySelector("#np_paste");
  const pasteGo = modalBody().querySelector("#np_paste_go");
  if (pasteEl) mountInlineMic(pasteEl, { mode: "dictation", ariaLabel: "Say something about them" });

  // TC-113: catch a screenshot pasted (Ctrl/Cmd-V) or dragged INTO the paste box. If the clipboard
  // carries an image → route the bytes to the image extractor (same as the file picker). If it's
  // text → let the normal text-paste behavior stand (the textarea fills; "Read it →" reads it).
  const imageFromDataTransfer = (dt) => {
    if (!dt) return null;
    const items = dt.items ? Array.from(dt.items) : [];
    for (const it of items) { if (it.kind === "file" && it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) return f; } }
    const files = dt.files ? Array.from(dt.files) : [];
    for (const f of files) { if (f.type && f.type.startsWith("image/")) return f; }
    return null;
  };
  if (pasteEl) {
    pasteEl.addEventListener("paste", (e) => {
      const img = imageFromDataTransfer(e.clipboardData);
      if (img) { e.preventDefault(); importImageFile(img, pasteGo); } // image → image path; else text-paste stands
    });
    pasteEl.addEventListener("dragover", (e) => { if (imageFromDataTransfer(e.dataTransfer)) e.preventDefault(); });
    pasteEl.addEventListener("drop", (e) => {
      const img = imageFromDataTransfer(e.dataTransfer);
      if (img) { e.preventDefault(); importImageFile(img, pasteGo); }
    });
  }

  if (pasteGo && pasteEl) {
    pasteGo.onclick = async () => {
      const text = (pasteEl.value || "").trim();
      if (!text) { pasteEl.focus(); return; }
      showImportWorking(); pasteGo.disabled = true; // TC-114/TC-99: replaces the prior card with the working screen
      try {
        // The LIVE capture-extract in preview mode → the SAME confirm card (shared helper), so a typed
        // paste and a transcribed voice memo travel the identical extract → resolve → confirm path.
        const shown = await renderTextPreviews(text, { sourceKind: "text_thread" });
        if (shown) pasteEl.value = "";
      } catch (e) { console.warn("import paste failed", e); clearImportCards(); setImportMsg("We couldn't read that. Please try again.", true); }
      pasteGo.disabled = false;
    };
  }

  // ── TC-107: guided one-question-at-a-time add. The calmest, lowest-pressure door. It renders
  //    INTO #np_guided_out (taking over the add lane's other doors while it runs), asks one small
  //    thing at a time (every step but the name skippable), and on finish funnels the collected
  //    answers through the SAME captureExtract(preview) → renderImportConfirm → captureResolve →
  //    onConfirmed path as the paste door. No parallel writer; the confirm card still resolves WHICH
  //    person against the roster (dedup) and confirms before any save. ──
  const guidedOut = modalBody().querySelector("#np_guided_out");
  const guidedBtn = modalBody().querySelector("#np_guided_btn");
  if (guidedBtn && guidedOut) {
    guidedBtn.onclick = () => {
      // TC-107 (UX): the whole point of the calmest door is a single question with nothing else
      // competing. So while the guided flow runs, hide the rest of the add-lane (the guided help
      // line, every fast door after it, and the manual "type it in yourself" form) and restore
      // them on close. The guided card stands alone.
      const addWrap = guidedOut.closest(".tc-add-more");
      const toHide = [];
      if (guidedBtn.nextElementSibling) toHide.push(guidedBtn.nextElementSibling); // the guided help line
      for (let n = guidedOut.nextElementSibling; n; n = n.nextElementSibling) toHide.push(n); // fast doors after the guided flow
      if (addWrap) for (let m = addWrap.nextElementSibling; m; m = m.nextElementSibling) toHide.push(m); // manual form below the lane
      const restore = toHide.map((el) => [el, el.style.display]);
      toHide.forEach((el) => { el.style.display = "none"; });
      guidedBtn.style.display = "none";
      startGuidedAdd(guidedOut, {
        onConfirmed,
        // Finishing (a confirmed save reloads the whole home via onConfirmed) or cancelling both
        // restore the entry button AND the doors/form we hid, so the lane is whole again.
        onClose: () => {
          guidedOut.innerHTML = "";
          guidedBtn.style.display = "";
          restore.forEach(([el, d]) => { el.style.display = d; });
        },
      });
    };
  }
}

// TC-107 — drive the guided flow inside `container`. Renders one question per screen (single focused
// input, with the shared inline mic for the voice path), Skip/Continue/Back, and on finish assembles
// the answers into a draft that runs through captureExtract(preview) and renders the SAME confirm
// card everything else uses. `onConfirmed` is renderHome's shared save-and-reload callback;
// `onClose` restores the entry button.
function startGuidedAdd(container, { onConfirmed, onClose } = {}) {
  const answers = {};
  let state = makeGuidedState(GUIDED_STEPS);

  const finish = async () => {
    const draft = answersToDraft(answers);
    // No name → nothing to save. Send the user back to the first question rather than dead-ending.
    if (!draft) { state = makeGuidedState(GUIDED_STEPS); render(); return; }
    container.innerHTML = `
      <div class="tc-guided" role="group" aria-label="Adding someone">
        <div class="q-eyebrow">One at a time</div>
        <h2 class="q-title" style="font-size:22px;">Let's make sure this is right.</h2>
        <p class="tc-help-sm" id="tcGuidedMsg">Reading it over...</p>
      </div>`;
    const msg = container.querySelector("#tcGuidedMsg");
    try {
      // The SAME extraction/dedup brain the paste door uses. preview:true writes nothing; it resolves
      // WHICH person (existing/ambiguous/new) so the confirm card can never make a silent duplicate.
      const result = await captureExtract(sb, { rawText: draft.rawText, source: "typed", preview: true });
      const cap = (result.captures || [])[0];
      if (!cap) {
        // The extractor found no person (extremely unlikely with a leading name). Fall back to the
        // structured answers so a guided add still confirms — the card resolves the name on its own.
        renderGuidedConfirm({ personHint: draft.prefill.name });
        return;
      }
      // Pre-fill the confirm card from what the user typed directly in the guided flow. The user's
      // answers are authoritative over anything re-derived: name, relationship, and birthday all seed
      // the editable fields, so they just check and save.
      const bday = draft.prefill.birthday || cap.birthday || "";
      renderGuidedConfirm({
        ...cap,
        personHint: cap.personHint || cap.personName || draft.prefill.name,
        relationshipHint: draft.prefill.relationship || "",
        birthday: bday,
      });
    } catch (e) {
      if (msg) { console.warn("save failed", e); msg.className = "k-msg bad"; msg.textContent = "Something went wrong. Please try again."; }
    }
  };

  const renderGuidedConfirm = (preview) => {
    container.innerHTML = `<div class="tc-guided"><div class="q-eyebrow">One at a time</div><h2 class="q-title" style="font-size:22px;">Here's who you're adding.</h2><p class="tc-help-sm">Check anything over, then save. You can still change a field.</p><div id="tcGuidedConfirmOut"></div></div>`;
    const out = container.querySelector("#tcGuidedConfirmOut");
    renderImportConfirm(out, sb, preview, {
      contactKind: "personal",
      // On save, onConfirmed reloads the whole home (the new card flashes) — that unmounts this
      // guided container. On dismiss ("Not now"), just close back to the entry button.
      onConfirmed: async (res, meta) => { if (onConfirmed) await onConfirmed(res, meta); },
      onDismiss: () => { if (onClose) onClose(); },
    });
  };

  const render = () => {
    if (guidedIsDone(state)) { finish(); return; }
    const s = stepAt(state);
    const total = GUIDED_STEPS.length;
    const answered = String(answers[s.key] || "").trim();
    // Progress: a calm "N of 4". The name step Continue is only enabled with a value (it's the one
    // soft requirement); every other step offers Skip and Continue works empty too.
    const canContinue = s.optional || !!answered || guidedCanFinish(answers);
    const isLast = state.idx === total - 1;
    container.innerHTML = `
      <div class="tc-guided" role="group" aria-label="Adding someone, ${s.title}">
        <div class="q-eyebrow">${esc(s.eyebrow)} · ${state.idx + 1} of ${total}</div>
        <h2 class="q-title" style="font-size:22px;">${esc(s.title)}</h2>
        <p class="tc-help-sm" style="margin:2px 0 12px;">${esc(s.help)}</p>
        <input type="text" id="tcGuidedInput" placeholder="${esc(s.placeholder)}" autocomplete="off" value="${esc(answered)}" />
        <div class="nav" style="margin-top:14px;align-items:center;">
          <div style="display:flex;gap:12px;align-items:center;">
            ${state.idx > 0 ? `<button class="link-btn" id="tcGuidedBack" type="button">Back</button>` : `<button class="link-btn" id="tcGuidedCancel" type="button">Cancel</button>`}
            ${s.optional ? `<button class="link-btn" id="tcGuidedSkip" type="button">Skip</button>` : ""}
          </div>
          <button class="cta" id="tcGuidedNext" type="button"${canContinue ? "" : " disabled"}>${isLast ? "Add them →" : "Continue →"}</button>
        </div>
        <div class="k-msg" id="tcGuidedMsg"></div>
      </div>`;
    const input = container.querySelector("#tcGuidedInput");
    const nextBtn = container.querySelector("#tcGuidedNext");
    // Voice path: the SAME inline mic used everywhere else (dictation into the focused field), so the
    // guided door speaks in one voice with the fast doors. No new mic engine.
    mountInlineMic(input, { mode: "dictation", ariaLabel: s.title });
    // Keep Continue in step with whether the name has been given (the only enable-gated step).
    const syncNext = () => { if (!s.optional && nextBtn) nextBtn.disabled = !input.value.trim(); };
    input.addEventListener("input", syncNext);
    setTimeout(() => { try { input.focus(); } catch (e) {} }, 0);

    const commitAndAdvance = (value) => { answers[s.key] = value; state = advance(state); render(); };
    nextBtn.onclick = () => {
      const v = input.value.trim();
      if (!s.optional && !v) { input.focus(); return; }
      commitAndAdvance(v);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (!nextBtn.disabled) nextBtn.onclick(); } });
    const skipBtn = container.querySelector("#tcGuidedSkip");
    if (skipBtn) skipBtn.onclick = () => { answers[s.key] = ""; state = advance(state); render(); };
    const backBtn = container.querySelector("#tcGuidedBack");
    if (backBtn) backBtn.onclick = () => { answers[s.key] = input.value.trim(); state = guidedBack(state); render(); };
    const cancelBtn = container.querySelector("#tcGuidedCancel");
    if (cancelBtn) cancelBtn.onclick = () => { if (onClose) onClose(); };
  };

  render();
}

// The starter nudges a NEW situation offers (spec §4.2 / §6): chips the user toggles on. DEFAULT is
// UNSELECTED — no auto-cadence; the user chooses whatever timing (if any) they want. Each chip is a
// signed lead_days (positive=before, 0=day-of, negative=after), seeded into situation_reminders on save.
const SITUATION_STARTER_NUDGES = [
  { lead_days: 3, label: "3 days before" },
  { lead_days: 0, label: "Day of" },
  { lead_days: -1, label: "The day after" },
  { lead_days: -7, label: "A week after" },
];

function openAddDate(personId) {
  ensureReminderStyles(); // situation-nudge chip + row styles available before this form renders
  const kindOpts = KINDS.map((k) => `<option value="${k.v}">${k.label}</option>`).join("");
  const leadOpts = LEADS.map((l) => `<option value="${l.v}"${l.v === 7 ? " selected" : ""}>${l.label}</option>`).join("");
  const nudgeChips = SITUATION_STARTER_NUDGES
    .map((n) => `<button type="button" class="tc-nudge-chip" data-lead="${n.lead_days}" aria-pressed="false">${n.label}</button>`).join("");
  const box = document.createElement("div");
  box.className = "block tc-addwrap";
  box.innerHTML = `
    <h4>Add a date or reminder</h4>
    <p class="tc-help-sm">A recurring date like a birthday, a one-time nudge to reach out, or a situation to check in around.</p>
    <select id="kd_kind" class="tc-select">${kindOpts}</select>
    <input type="text" id="kd_label" placeholder="Label (e.g. Birthday, or 'Marcus's chemo')" style="margin-top:10px;" />
    <input type="date" id="kd_date" style="margin-top:10px;" />
    <label class="k-remind" id="kd_recurs_wrap" style="margin-top:10px;"><input type="checkbox" id="kd_recurs" checked /> Happens every year</label>
    <!-- Plain date: a single lead time. -->
    <div id="kd_lead_wrap">
      <label class="tc-field-label" for="kd_lead">Remind me</label>
      <select id="kd_lead" class="tc-select">${leadOpts}</select>
    </div>
    <!-- Situation: several nudges around the day (before / day-of / after). None on by default. -->
    <div id="kd_nudge_wrap" style="display:none;">
      <label class="tc-field-label">Nudge me around it</label>
      <p class="tc-help-sm" style="margin:2px 0 8px;">Pick when you'd like a gentle nudge. You can change these anytime, or add none for now.</p>
      <div class="tc-nudge-chips">${nudgeChips}</div>
    </div>
    <div class="nav"><button class="link-btn" id="kd_cancel">Cancel</button><button class="cta" id="kd_save">Save →</button></div>
    <div class="k-msg" id="kd_msg"></div>`;
  const card = modalBody().querySelector(`.block[data-pid="${personId}"]`);
  card.appendChild(box);
  const kindEl = box.querySelector("#kd_kind"), labelEl = box.querySelector("#kd_label"), recEl = box.querySelector("#kd_recurs"), leadEl = box.querySelector("#kd_lead");
  const recWrap = box.querySelector("#kd_recurs_wrap"), leadWrap = box.querySelector("#kd_lead_wrap"), nudgeWrap = box.querySelector("#kd_nudge_wrap");
  const syncKind = () => {
    const k = KINDS.find((x) => x.v === kindEl.value);
    const isSituation = k?.v === "situation";
    if (k && k.v !== "custom" && k.v !== "moment" && !isSituation) labelEl.value = k.label;
    // A situation is a one-time stretch, so it never "happens every year" — hide recurrence + the
    // single lead select, and reveal the several-nudge chip picker instead.
    recEl.checked = !isSituation && !!k?.recurs;
    recWrap.style.display = isSituation ? "none" : "";
    leadWrap.style.display = isSituation ? "none" : "";
    nudgeWrap.style.display = isSituation ? "" : "none";
  };
  syncKind(); kindEl.onchange = syncKind;
  // Toggle a starter nudge chip on/off (spec §4.2: chips, default off, add/remove).
  box.querySelectorAll(".tc-nudge-chip").forEach((chip) => {
    chip.onclick = () => {
      const on = chip.getAttribute("aria-pressed") === "true";
      chip.setAttribute("aria-pressed", on ? "false" : "true");
      chip.classList.toggle("is-on", !on);
    };
  });
  box.querySelector("#kd_cancel").onclick = () => box.remove();
  box.querySelector("#kd_save").onclick = async () => {
    const msg = box.querySelector("#kd_msg");
    const label = labelEl.value.trim(), event_date = box.querySelector("#kd_date").value;
    if (!label || !event_date) { msg.className = "k-msg bad"; msg.textContent = "A label and a date are both needed."; return; }
    const isSituation = kindEl.value === "situation";
    msg.className = "k-msg"; msg.textContent = "Saving...";
    try {
      if (isSituation) {
        // A situation is one-time (recurs:false); its lead_days field is unused (the child
        // situation_reminders carry the timing). Seed the chosen starter nudges after insert.
        const kd = await addKeyDate(personId, { label, kind: "situation", event_date, recurs: false, lead_days: 0 });
        const chosen = [...box.querySelectorAll('.tc-nudge-chip[aria-pressed="true"]')].map((c) => Number(c.dataset.lead));
        for (const lead of chosen) {
          try { await addReminder(sb, kd.id, lead); }
          catch (e) { console.error("seed situation reminder failed", e); } // best-effort; the situation still saved
        }
      } else {
        await addKeyDate(personId, { label, kind: kindEl.value, event_date, recurs: recEl.checked, lead_days: Number(leadEl.value) });
      }
      renderHome(await loadPeople());
    }
    catch (e) { console.warn("save failed", e); msg.className = "k-msg bad"; msg.textContent = "Could not save. Please try again."; }
  };
}

/* ---------------- save a plan to a person (called from the plan screen) ---------------- */
async function mountSaveToPerson(stageEl, plan) {
  if (!sb) return;
  // TC-71: the save-to-a-person option lives INSIDE the single unified "Keep this plan"
  // card, as a second way to save (under an "or" divider) — not a separate card. Fall
  // back to appending after the email card if the mount point isn't present.
  const anchor = stageEl.querySelector("#savePersonMount") || stageEl.querySelector(".keep");
  const card = document.createElement("div");
  card.className = "keep-way keep-way-person";
  const ctx = window.__tcAnswers || {};
  const recipient = (ctx.name || "").trim();
  const occasion = (plan.plan_title || "").trim();
  const divider = `<div class="keep-or"><span>or</span></div>`;

  if (!user) {
    card.innerHTML = `
      ${divider}
      <div class="keep-way-label">Save it to People I care about</div>
      <p class="k-sub" style="margin-top:2px;">Sign in with just your email to save this plan and get a gentle nudge before ${recipient ? esc(recipient) : "their"} important dates.</p>
      <button class="cta" id="tcSaveSignin">Sign in to save →</button>`;
    mountInto(card, anchor, stageEl);
    card.querySelector("#tcSaveSignin").onclick = openSignIn;
    return;
  }

  const people = await loadPeople();
  const opts = people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  const followups = (plan.follow_up || []).filter((f) => Number.isFinite(f.days_from_now) && f.days_from_now > 0);
  const followupOpt = followups.length ? `
    <label class="k-remind" style="margin-top:12px;"><input type="checkbox" id="tcRemindFollow" checked /> Also remind me to follow through. We'll gently nudge you the morning each of this plan's ${followups.length} "keep showing up" date${followups.length > 1 ? "s" : ""} arrives</label>` : "";
  card.innerHTML = `
    ${divider}
    <div class="keep-way-label">Save it to People I care about</div>
    <p class="k-sub" style="margin-top:2px;">Save it to ${recipient ? esc(recipient) : "someone"} in your People I care about, and we'll remind you at just the right time to follow through.</p>
    <select id="tcPersonSel" class="tc-select">
      <option value="__new">+ New person${recipient ? `: ${esc(recipient)}` : ""}</option>
      ${opts}
    </select>
    <input type="text" id="tcNewName" placeholder="Their name" value="${esc(recipient)}" style="margin-top:10px;" />
    ${followupOpt}
    <div class="nav"><span></span><button class="cta" id="tcSavePlan">Save to my people →</button></div>
    <div class="k-msg" id="tcSaveMsg"></div>`;
  mountInto(card, anchor, stageEl);

  const sel = card.querySelector("#tcPersonSel"), nameEl = card.querySelector("#tcNewName");
  // If this plan was started from a saved person, save straight back to them.
  const flowId = window.__tcFlowPersonId;
  if (flowId && [...sel.options].some((o) => o.value === flowId)) sel.value = flowId;
  const syncSel = () => { nameEl.style.display = sel.value === "__new" ? "block" : "none"; };
  syncSel(); sel.onchange = syncSel;

  card.querySelector("#tcSavePlan").onclick = async () => {
    const msg = card.querySelector("#tcSaveMsg");
    msg.className = "k-msg"; msg.textContent = "Saving...";
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
      // TC-81: saved to a person → this plan is kept → no "keep it anywhere" nudge on close.
      try { window.__tcMarkPlanSaved && window.__tcMarkPlanSaved(); } catch (e) {}
      let reminderCount = 0;
      const wantFollow = card.querySelector("#tcRemindFollow");
      if (wantFollow && wantFollow.checked) {
        reminderCount = await addPlanFollowups(personId, plan);
      }
      msg.className = "k-msg ok";
      msg.textContent = reminderCount
        ? `Saved. We'll nudge you on ${reminderCount} date${reminderCount > 1 ? "s" : ""} to follow through. Find them under "People I care about".`
        : "Saved. Open \"People I care about\" to add their dates and turn on reminders.";
      card.querySelector("#tcSavePlan").innerHTML = `${checkSvg(16, "currentColor")}<span>Saved</span>`;
      card.querySelector("#tcSavePlan").style.cssText += ";display:inline-flex;align-items:center;gap:8px;justify-content:center;";
      card.querySelector("#tcSavePlan").disabled = true;
    } catch (e) { console.warn("save plan failed", e); msg.className = "k-msg bad"; msg.textContent = "Could not save. Please try again."; }
  };
}
// TC-71: prefer to place the save-to-person block INSIDE the unified card's mount point
// (#savePersonMount); otherwise fall back to inserting it right after the email card.
function mountInto(card, anchor, stageEl) {
  if (anchor && anchor.id === "savePersonMount") { anchor.appendChild(card); return; }
  if (anchor && anchor.parentNode) { anchor.parentNode.insertBefore(card, anchor.nextSibling); return; }
  stageEl.appendChild(card);
}
