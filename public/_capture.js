// Thoughts Count — client helpers for the capture lifecycle (TC-50, spec §5/§6).
//
// Three surfaces, shared by the personal companion AND the pro roster so capture behaves
// identically in both:
//   • Quick capture ("Note something") — the DEFAULT door (spec §5): type a free note, we read
//     it and resolve who it's about. Confident → saved now with a glanceable, undoable toast
//     (Level A). Ambiguous/unknown → it waits in "To review" (Level B), nothing guessed.
//   • The To-Review surface — a plain list of what's waiting, each with Confirm / Assign to
//     someone else / Discard, one tap each.
//   • The person-card add box routes through the SAME engine but context-locked (see _memory.js),
//     so it's always Level A on that person.
//
// Principle 4 (spec §7): only warm, plain language is ever shown — never fact_class / confidence
// / salience. The server sends the plain-language evidence; we just render it.

import { mountInlineMic, ensureInlineMicStyles } from "/_inline-mic.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "them";

// Hand-drawn brand icons (stroke style; no emoji). Inherit color via currentColor.
const _svg = (paths, sz, stroke = "currentColor") =>
  `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:0 0 auto;">${paths}</svg>`;
const xSvg = (sz = 16, stroke = "currentColor") => _svg(`<path d="M6 6l12 12M18 6L6 18"/>`, sz, stroke);
const checkSvg = (sz = 16, stroke = "currentColor") => _svg(`<path d="M5 13l4 4L19 7"/>`, sz, stroke);

/* ---------------- network ---------------- */

async function post(sb, path, body) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong. Please try again.");
  return json;
}

export function captureExtract(sb, { rawText, lockedPersonId = null, source = "typed", preview = false }) {
  return post(sb, "/api/capture/extract", { rawText, lockedPersonId, source, preview });
}
export function captureResolve(sb, { captureId, action, personId = null, newPersonName = null, contactKind = null }) {
  return post(sb, "/api/capture/resolve", { captureId, action, personId, newPersonName, contactKind });
}
// TC-89 — resolve a bare NAME against the user's people, writing nothing. Returns
// { kind:'match'|'ambiguous'|'none', person?, candidates?, evidence }. Used to re-check a
// corrected name on a confirm card, and to lock onto a spoken existing person.
export function resolveName(sb, name) {
  return post(sb, "/api/resolve-name", { name });
}

// TC-98/TC-100 — add a person from a SCREENSHOT/PHOTO (multimodal read) or a shared .vcf. Both
// funnel through the same server endpoint, which reads the media into ExtractedPerson[] and returns
// the SAME preview shape the typed/voice door emits (one preview per detected person). Writes
// nothing — the user confirms each via captureResolve, exactly like To-Review.
//   { previews: [ { kind:'add'|'update'|'pick', captureId, personId?, personName?, personDetail,
//                   personHasDetail, personHint, relationshipHint, birthday, facts, candidates,
//                   count, source_kind } ], ambiguousMultiPerson }
export function captureImageB64(sb, { image, mime }) {
  return post(sb, "/api/capture/image", { image, mime });
}
export function captureVcard(sb, { vcard }) {
  return post(sb, "/api/capture/image", { vcard });
}

/* ---------------- reads (RLS-scoped anon) ---------------- */

// How many captures are waiting in To-Review (drives the front-door badge).
export async function pendingCount(sb) {
  const { count, error } = await sb.from("captures").select("id", { count: "exact", head: true }).eq("status", "pending");
  if (error) { console.error("pendingCount", error); return 0; }
  return count || 0;
}
export async function loadPending(sb) {
  const { data, error } = await sb
    .from("captures")
    .select("id,raw_text,match_evidence,proposed_person_id,parsed,created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) { console.error("loadPending", error); return []; }
  return data || [];
}

/* ---------------- styles (injected once) ---------------- */

function ensureStyles() {
  ensureInlineMicStyles(); // inline-mic rules available before index CSS parses
  if (document.getElementById("tcCaptureCss")) return;
  const s = document.createElement("style");
  s.id = "tcCaptureCss";
  s.textContent = `
  .tc-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(12px);z-index:2147483000;
    background:#3c4634;color:#f4f1e9;padding:12px 16px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.22);
    display:flex;align-items:center;gap:12px;font:inherit;font-size:.95rem;opacity:0;transition:opacity .18s,transform .18s;max-width:min(92vw,440px);}
  .tc-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
  .tc-toast b{font-weight:600;}
  .tc-toast .tc-toast-undo{background:none;border:none;color:#e7c9a9;font:inherit;font-weight:600;cursor:pointer;text-decoration:underline;padding:0;}
  .tc-qc{margin:12px 0;}
  .tc-qc-row{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap;}
  .tc-qc-row input{flex:1 1 140px;min-width:0;}
  .tc-qc-row .tc-qc-save{flex:0 0 auto;}
  .tc-qc-hint{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;color:#5f6c4c;
    background:#eef2e6;border:1px solid #dde5cf;border-radius:10px;padding:8px 10px;font-size:.84rem;margin-bottom:8px;}
  .tc-qc-hint button{background:none;border:none;color:#7a7466;cursor:pointer;font:inherit;font-size:1rem;line-height:1;padding:0 2px;}
  .tc-review-item{border:1px solid #e5e0d4;border-radius:12px;padding:12px 14px;margin-bottom:10px;background:#fffdf8;}
  .tc-review-heard{font-style:italic;color:#4a4636;}
  .tc-review-who{color:#7a7466;font-size:.9rem;margin:6px 0 10px;}
  .tc-review-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
  .tc-review-assign{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
  .tc-review-assign .tc-rv-sel{flex:1 1 160px;min-width:0;}
  .tc-review-empty{color:#7a7466;text-align:center;padding:18px 0;}
  .tc-badge-dot{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;
    border-radius:9px;background:#c28a63;color:#fff;font-size:.72rem;font-weight:700;margin-left:6px;}
  @keyframes tcFlash{0%{background:#fbf4e6;box-shadow:0 0 0 2px #e7c9a9 inset;}100%{background:transparent;box-shadow:none;}}
  .tc-flash{animation:tcFlash 1.8s ease-out 1;border-radius:12px;}
  `;
  document.head.appendChild(s);
}

/* ---------------- Level-A toast (with Undo) ---------------- */

let toastTimer = null;
export function showToast(message, { undoLabel = "Undo", onUndo = null } = {}) {
  ensureStyles();
  document.querySelectorAll(".tc-toast").forEach((t) => t.remove());
  if (toastTimer) clearTimeout(toastTimer);
  const el = document.createElement("div");
  el.className = "tc-toast";
  el.innerHTML = `<span style="display:inline-flex;align-items:center;gap:7px;"><b>${esc(message)}</b>${checkSvg(15, "currentColor")}</span>${onUndo ? `<button class="tc-toast-undo">${esc(undoLabel)}</button>` : ""}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  const dismiss = () => { el.classList.remove("show"); setTimeout(() => el.remove(), 220); };
  if (onUndo) el.querySelector(".tc-toast-undo").onclick = async () => { dismiss(); try { await onUndo(); } catch (e) { console.error("undo failed", e); } };
  toastTimer = setTimeout(dismiss, 6500);
}

// Render the result of a quick capture as EXACTLY ONE toast (never two — a second showToast
// removes the first). A Level-A save gets the undoable toast (the trust safety net on the only
// no-review write path); if there's nothing confident, we say it's waiting in To-Review.
function announceResult(sb, result, onChange) {
  const caps = (result && result.captures) || [];
  const a = caps.filter((c) => c.level === "A");
  const b = caps.filter((c) => c.level === "B");
  if (a.length) {
    const who = a.length === 1 ? a[0].evidence : `Saved to ${a.length} people`;
    const tail = b.length ? ` · ${b.length} to review` : "";
    showToast(who + tail, {
      onUndo: async () => {
        for (const c of a) { try { await captureResolve(sb, { captureId: c.captureId, action: "undo" }); } catch (e) { console.error(e); } }
        if (onChange) onChange();
      },
    });
  } else if (b.length) {
    showToast(`Added to your “To review” list`, {});
  }
}

/* ---------------- one-time hint + card highlight (shared by both hosts) ---------------- */

const HINT_KEY = "tc_qc_hint_seen";
// The first time the quick-capture appears (once the user has someone saved), show a gentle,
// dismissible tip so its purpose is obvious. Returns "" once dismissed.
export function qcHintHtml() {
  if (localStorage.getItem(HINT_KEY)) return "";
  return `<div class="tc-qc-hint" id="tcQcHint"><span>Tip: jot anything about someone here — “Maria just started a new job” — and we'll file it to the right person.</span><button class="tc-qc-hint-x" aria-label="Dismiss" style="display:inline-flex;align-items:center;">${xSvg(15, "currentColor")}</button></div>`;
}
export function wireQcHint(root) {
  const x = (root || document).querySelector("#tcQcHint .tc-qc-hint-x");
  if (x) x.onclick = () => { localStorage.setItem(HINT_KEY, "1"); const h = (root || document).querySelector("#tcQcHint"); if (h) h.remove(); };
}
// Scroll a just-saved/created person's card into view and briefly flash it, so the user sees
// where their capture landed (UX gate: confirm shows its result, no reload).
export function flashCard(el) {
  if (!el) return;
  try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { el.scrollIntoView(); }
  el.classList.remove("tc-flash");
  void el.offsetWidth; // restart the animation if it was already applied
  el.classList.add("tc-flash");
  setTimeout(() => el.classList.remove("tc-flash"), 2000);
}

/* ---------------- Quick capture ("Note something") ---------------- */

// Mount the default capture door into a container. `contactKind` decides where a brand-new
// person would be created ('personal' | 'contact'). onChange() runs after any capture so the
// host can refresh the To-Review badge and any visible cards.
export function mountQuickCapture(container, sb, { contactKind = "personal", onChange = null, placeholder } = {}) {
  ensureStyles();
  const ph = placeholder || "Jot a quick note";
  container.innerHTML = `
    <div class="tc-qc">
      <div class="tc-qc-row">
        <input type="text" class="tc-qc-input" placeholder="${esc(ph)}" autocomplete="off" />
        <button class="cta tc-qc-save">Note it</button>
      </div>
      <div class="k-msg tc-qc-msg"></div>
    </div>`;
  const input = container.querySelector(".tc-qc-input");
  const btn = container.querySelector(".tc-qc-save");
  // Voice = the inline mic inside the note box (capture mode → calm home overlay + confirm flow).
  mountInlineMic(input, { mode: "capture", onSaved: () => { if (onChange) onChange(); }, ariaLabel: "Note something by voice" });
  const msg = container.querySelector(".tc-qc-msg");
  const setMsg = (t, bad) => { msg.className = "k-msg tc-qc-msg" + (bad ? " bad" : ""); msg.textContent = t || ""; };

  const submit = async () => {
    const text = (input.value || "").trim();
    if (!text) { input.focus(); return; }
    btn.disabled = true; setMsg("Reading…");
    try {
      const result = await captureExtract(sb, { rawText: text, source: "typed" });
      if (!result.captures?.length) { setMsg(result.message || "Nothing to save there yet.", false); btn.disabled = false; return; }
      input.value = ""; setMsg("");
      announceResult(sb, result, onChange);
      if (onChange) onChange();
    } catch (e) { setMsg(e.message, true); }
    btn.disabled = false;
  };
  btn.onclick = submit;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
}

/* ---------------- To-Review surface ---------------- */

// Render the waiting captures with one-tap Confirm / Assign / Discard. `people` is the host's
// already-loaded list (used to name the proposed person and to power reassignment). onResolved()
// runs after any item is cleared so the host can refresh badge + cards.
export function mountToReview(container, sb, { people = [], contactKind = "personal", onResolved = null } = {}) {
  ensureStyles();
  const nameOf = (id) => (people.find((p) => p.id === id) || {}).name || "";

  async function refresh() {
    const items = await loadPending(sb);
    render(items);
  }

  function render(items) {
    if (!items.length) {
      container.innerHTML = `<div class="tc-review-empty">Nothing to review — you're all caught up.</div>`;
      return;
    }
    container.innerHTML = items.map((it) => {
      const hint = it.parsed?.person_hint || "";
      const candidates = Array.isArray(it.parsed?.candidates) ? it.parsed.candidates : [];
      let actions;
      if (candidates.length) {
        // Ambiguous same-name capture: the user MUST pick which person — never a defaulted guess.
        actions = candidates
          .map((c) => `<button class="cta tc-rv-pick" data-cid="${it.id}" data-pid="${c.id}">${esc(c.name)}${c.location ? ` · ${esc(c.location)}` : ""}</button>`)
          .join("") + `<button class="link-btn tc-rv-discard" data-cid="${it.id}">Discard</button>`;
      } else {
        const proposedName = it.proposed_person_id ? nameOf(it.proposed_person_id) : "";
        const confirmLabel = it.proposed_person_id
          ? `Confirm${proposedName ? ` — ${esc(firstName(proposedName))}` : ""}`
          : `Confirm — add ${esc(firstName(hint) || "them")}`;
        actions = `
            <button class="cta tc-rv-confirm" data-cid="${it.id}">${confirmLabel}</button>
            <button class="link-btn tc-rv-assign" data-cid="${it.id}">Assign to someone else</button>
            <button class="link-btn tc-rv-discard" data-cid="${it.id}">Discard</button>`;
      }
      return `
        <div class="tc-review-item" data-cid="${it.id}">
          <div class="tc-review-heard">“${esc(it.raw_text || "")}”</div>
          <div class="tc-review-who">${esc(it.match_evidence || "Who is this about?")}</div>
          <div class="tc-review-acts">${actions}</div>
          <div class="tc-rv-assignbox" hidden></div>
          <div class="k-msg tc-rv-msg"></div>
        </div>`;
    }).join("");
    wire(items);
  }

  function wire(items) {
    container.querySelectorAll(".tc-review-item").forEach((el) => {
      const cid = el.dataset.cid;
      const msg = el.querySelector(".tc-rv-msg");
      const setMsg = (t, bad) => { msg.className = "k-msg tc-rv-msg" + (bad ? " bad" : ""); msg.textContent = t || ""; };
      // Run an action, refresh the list, and (for a save) show a confirmation toast + hand the
      // result to the host so it can surface the new/updated card immediately (no reload).
      const act = async (fn, { save = true } = {}) => {
        try {
          setMsg("Saving…");
          const res = await fn();
          await refresh();
          if (save && res && res.ok && res.status === "confirmed") {
            showToast(res.message || (res.personName ? `Saved to ${firstName(res.personName)}` : "Saved"), {});
          }
          if (onResolved) onResolved(res || null);
        } catch (e) { setMsg(e.message, true); }
      };

      const confirmBtn = el.querySelector(".tc-rv-confirm");
      if (confirmBtn) confirmBtn.onclick = () => act(() => captureResolve(sb, { captureId: cid, action: "confirm", contactKind }));
      // Ambiguous same-name capture: each candidate button attaches to THAT specific person.
      el.querySelectorAll(".tc-rv-pick").forEach((b) => { b.onclick = () => act(() => captureResolve(sb, { captureId: cid, action: "reassign", personId: b.dataset.pid })); });
      el.querySelector(".tc-rv-discard").onclick = () => act(() => captureResolve(sb, { captureId: cid, action: "discard" }), { save: false });
      const assignBtn = el.querySelector(".tc-rv-assign");
      if (assignBtn) assignBtn.onclick = () => {
        const box = el.querySelector(".tc-rv-assignbox");
        if (!box.hidden) { box.hidden = true; return; }
        const opts = people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
        box.innerHTML = `<div class="tc-review-assign">
            <select class="tc-select tc-rv-sel">${opts || `<option value="">No one to pick yet</option>`}</select>
            <button class="cta tc-rv-assignsave">Save to them</button>
          </div>`;
        box.hidden = false;
        box.querySelector(".tc-rv-assignsave").onclick = () => {
          const pid = box.querySelector(".tc-rv-sel").value;
          if (!pid) { setMsg("Pick a person first.", true); return; }
          act(() => captureResolve(sb, { captureId: cid, action: "reassign", personId: pid }));
        };
      };
    });
  }

  refresh();
  return { refresh };
}

/* ---------------- Add from a screenshot / photo / .vcf (TC-98 / TC-100 / TC-101) ---------------- */

// Client-side downscale: a phone photo can be many MB — well over the request-body ceiling. Draw it
// onto a canvas capped at MAX_DIM on the long edge and re-encode as JPEG, so what we base64 stays
// small AND still legible for the multimodal read. Screenshots (already small) pass through nearly
// untouched. Returns { base64, mime }. Falls back to the original bytes if canvas isn't available.
const MAX_IMAGE_DIM = 1600;
const JPEG_QUALITY = 0.85;

async function fileToDownscaledBase64(file) {
  const rawB64 = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || "").split(",")[1] || "");
    fr.onerror = () => rej(new Error("We couldn't read that file."));
    fr.readAsDataURL(file);
  });
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(w, h || 1));
    if (scale >= 1) { URL.revokeObjectURL(url); return { base64: rawB64, mime: file.type || "image/jpeg" }; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    URL.revokeObjectURL(url);
    return { base64: dataUrl.split(",")[1] || rawB64, mime: "image/jpeg" };
  } catch (e) {
    console.error("downscale failed, sending original", e);
    return { base64: rawB64, mime: file.type || "image/jpeg" };
  }
}

// Read a .vcf as text (small; no downscale).
function fileToText(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || ""));
    fr.onerror = () => rej(new Error("We couldn't read that file."));
    fr.readAsText(file);
  });
}

const isVcard = (file) => /vcard/i.test(file.type || "") || /\.vcf$/i.test(file.name || "");

// Send a picked FILE (image or .vcf) to the shared endpoint and return the previews. Downscales an
// image first; parses a .vcf as text server-side. The caller renders each preview as a confirm card.
export async function captureFromFile(sb, file) {
  if (!file) return { previews: [] };
  if (isVcard(file)) {
    const vcard = await fileToText(file);
    return captureVcard(sb, { vcard });
  }
  const { base64, mime } = await fileToDownscaledBase64(file);
  return captureImageB64(sb, { image: base64, mime });
}

// Extra styles for the tap-to-edit confirm card (reuses the review-item shell + toast/flash above).
function ensureImportStyles() {
  ensureStyles();
  if (document.getElementById("tcImportCss")) return;
  const s = document.createElement("style");
  s.id = "tcImportCss";
  s.textContent = `
  .tc-imp-card{border:1px solid #e5e0d4;border-radius:12px;padding:14px;margin:12px 0;background:#fffdf8;}
  .tc-imp-eyebrow{color:#7a7466;font-size:.82rem;margin-bottom:8px;}
  .tc-imp-field{margin-bottom:10px;}
  .tc-imp-field label{display:block;color:#5f6c4c;font-size:.8rem;margin-bottom:3px;}
  .tc-imp-field input{width:100%;box-sizing:border-box;}
  .tc-imp-who{color:#7a7466;font-size:.88rem;margin:2px 0 10px;}
  .tc-imp-facts{color:#4a4636;font-size:.9rem;margin:2px 0 10px;padding-left:16px;}
  .tc-imp-facts li{margin:2px 0;}
  .tc-imp-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:4px;}
  .tc-imp-cands{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px;}
  `;
  document.head.appendChild(s);
}

const factLine = (f) => {
  if (f.relation === "birthday" || (f.fact_class === "RECURRING" && /birthday/i.test(f.object || ""))) {
    return f.event_date ? `Birthday · ${esc(f.event_date)}` : "Birthday";
  }
  const subj = f.subject && f.subject !== "self" ? `${esc(f.subject)}: ` : "";
  return subj + esc(f.object || "");
};

// Render ONE preview (from captureFromFile) as a tap-to-EDIT confirm card. Each detected field —
// name, relationship, birthday — is an editable input pre-filled from the extraction. Editing the
// NAME re-runs resolveName so a spelling fix re-checks dedup BEFORE save (a corrected name that now
// matches an existing person flips the card to "update them"). On confirm we call the SAME
// captureResolve the To-Review surface uses; nothing new is invented here. `onConfirmed(result,
// { relationship })` lets the host persist an edited relationship on a brand-new person (the server
// createPerson sets name only) and refresh its cards. Returns nothing; renders into `container`.
export function renderImportConfirm(container, sb, preview, { contactKind = "personal", onConfirmed = null, onDismiss = null } = {}) {
  ensureImportStyles();
  // A mutable copy of the resolution state so a name edit can flip add↔update↔pick.
  let state = {
    kind: preview.kind,
    captureId: preview.captureId,
    personId: preview.personId || null,
    personName: preview.personName || null,
    candidates: Array.isArray(preview.candidates) ? preview.candidates : [],
    evidence: preview.evidence || "",
  };
  const facts = Array.isArray(preview.facts) ? preview.facts : [];

  const card = document.createElement("div");
  card.className = "tc-imp-card";
  container.appendChild(card);

  function whoLine() {
    if (state.kind === "update" && state.personName) {
      const d = preview.personHasDetail && preview.personDetail ? ` (${esc(preview.personDetail)})` : "";
      return `Looks like <b>${esc(state.personName)}</b>${d} — already in your people. We'll add this to them.`;
    }
    if (state.kind === "pick" && state.candidates.length) {
      return `There's more than one match — tap the right person, or keep the name to add someone new.`;
    }
    return `New to your people — we'll add them.`;
  }

  function draw() {
    const src = ({ dm: "a direct message", profile: "a profile", contact_card: "a contact card", text_thread: "a message" }[preview.source_kind]) || "what you shared";
    const bday = (facts.find((f) => f.relation === "birthday" || (f.fact_class === "RECURRING" && f.event_date)) || {}).event_date || preview.birthday || "";
    const otherFacts = facts.filter((f) => !(f.relation === "birthday" || (f.fact_class === "RECURRING" && f.event_date)));
    const cands = state.kind === "pick"
      ? `<div class="tc-imp-cands">${state.candidates.map((c) => `<button class="cta tc-imp-pick" data-pid="${c.id}">${esc(c.name)}${c.location ? ` · ${esc(c.location)}` : ""}</button>`).join("")}</div>`
      : "";
    card.innerHTML = `
      <div class="tc-imp-eyebrow">Found from ${src} — check it over</div>
      <div class="tc-imp-field"><label>Name</label><input type="text" class="tc-imp-name" value="${esc(preview.personHint || state.personName || "")}" autocomplete="off" /></div>
      <div class="tc-imp-field"><label>Who they are to you</label><input type="text" class="tc-imp-rel" value="${esc(preview.relationshipHint || "")}" placeholder="e.g. a friend, someone I manage" autocomplete="off" /></div>
      <div class="tc-imp-field"><label>Birthday (optional)</label><input type="date" class="tc-imp-bday" value="${esc(bday)}" /></div>
      <div class="tc-imp-who">${whoLine()}</div>
      ${cands}
      ${otherFacts.length ? `<ul class="tc-imp-facts">${otherFacts.map((f) => `<li>${factLine(f)}</li>`).join("")}</ul>` : ""}
      <div class="tc-imp-acts">
        <button class="cta tc-imp-confirm">${state.kind === "update" ? "Add to them →" : "Add them →"}</button>
        <button class="link-btn tc-imp-discard">Not now</button>
      </div>
      <div class="k-msg tc-imp-msg"></div>`;
    wire();
  }

  function wire() {
    const nameEl = card.querySelector(".tc-imp-name");
    const relEl = card.querySelector(".tc-imp-rel");
    const bdayEl = card.querySelector(".tc-imp-bday");
    const msg = card.querySelector(".tc-imp-msg");
    const setMsg = (t, bad) => { msg.className = "k-msg tc-imp-msg" + (bad ? " bad" : ""); msg.textContent = t || ""; };

    // Editing the NAME re-checks dedup: a corrected spelling that now matches an existing person
    // flips this card to "update them" (never a silent duplicate). Runs on blur/change, best-effort.
    let lastName = nameEl.value.trim();
    nameEl.onchange = async () => {
      const nm = nameEl.value.trim();
      if (!nm || nm === lastName) return;
      lastName = nm;
      try {
        const r = await resolveName(sb, nm);
        if (r.kind === "match" && r.person) {
          state.kind = "update"; state.personId = r.person.id; state.personName = r.person.name; state.candidates = [];
          preview.personDetail = r.person.detail || ""; preview.personHasDetail = !!r.person.hasDetail;
        } else if (r.kind === "ambiguous" && Array.isArray(r.candidates) && r.candidates.length) {
          state.kind = "pick"; state.personId = null; state.personName = null; state.candidates = r.candidates;
        } else {
          state.kind = "add"; state.personId = null; state.personName = null; state.candidates = [];
        }
        // Preserve the user's typed relationship/birthday across the redraw.
        const keepRel = relEl.value, keepBday = bdayEl.value;
        preview.personHint = nm; preview.relationshipHint = keepRel; if (keepBday) preview.birthday = keepBday;
        draw();
      } catch (e) { console.error("re-resolve name", e); }
    };

    // Confirm → the SAME captureResolve the To-Review surface uses. For a brand-new person we pass
    // the edited name as newPersonName; for an update/pick we pass the chosen personId. An edited
    // relationship is applied by the host after confirm (server createPerson sets name only).
    const doConfirm = async (personId) => {
      const nm = nameEl.value.trim();
      if (!nm && !personId) { setMsg("A name helps us make it personal.", true); nameEl.focus(); return; }
      setMsg("Saving…");
      try {
        const res = await captureResolve(sb, {
          captureId: state.captureId,
          action: personId ? "reassign" : "confirm",
          personId: personId || state.personId || null,
          newPersonName: personId || state.personId ? null : nm,
          contactKind,
        });
        card.remove();
        showToast(res.message || (res.personName ? `Saved to ${firstName(res.personName)}` : "Saved"), {});
        if (onConfirmed) await onConfirmed(res || null, { relationship: relEl.value.trim(), isNew: !(personId || state.personId) });
      } catch (e) { setMsg(e.message, true); }
    };

    card.querySelector(".tc-imp-confirm").onclick = () => doConfirm(null);
    card.querySelectorAll(".tc-imp-pick").forEach((b) => { b.onclick = () => doConfirm(b.dataset.pid); });
    card.querySelector(".tc-imp-discard").onclick = async () => {
      try { await captureResolve(sb, { captureId: state.captureId, action: "discard" }); } catch (e) { console.error(e); }
      card.remove();
      if (onDismiss) onDismiss();
    };
  }

  draw();
}
