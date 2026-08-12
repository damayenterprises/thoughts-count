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
import { formatMonthDay, parseBirthdayInput, isYearlessBirthday } from "/_dates.js";

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
  .tc-imp-card{border:1px solid var(--line);border-radius:18px;padding:14px;margin:12px 0;background:var(--cloud);}
  .tc-imp-eyebrow{color:var(--ink-soft);font-size:.82rem;margin-bottom:8px;}
  .tc-imp-field{margin-bottom:10px;}
  .tc-imp-field label{display:block;color:var(--sage-deep);font-size:.8rem;margin-bottom:3px;}
  .tc-imp-field input{width:100%;box-sizing:border-box;}
  .tc-imp-who{color:var(--ink-soft);font-size:.88rem;margin:2px 0 10px;}
  .tc-imp-facts{color:var(--ink);font-size:.9rem;margin:2px 0 10px;padding-left:16px;}
  .tc-imp-facts li{margin:2px 0;}
  .tc-imp-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end;margin-top:4px;}
  .tc-imp-cands{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px;}
  /* Lighter candidate-picker idiom (sage-outline chips), so choosing an existing person reads
     lighter than the distinct ghost "Add someone new →" action — no clay primary competing. */
  .tc-imp-pick{appearance:none;background:transparent;border:1.5px solid var(--sage);color:var(--sage-deep);font:inherit;font-weight:600;font-size:.9rem;padding:8px 14px;border-radius:999px;cursor:pointer;transition:background .12s,border-color .12s,color .12s;}
  .tc-imp-pick:hover,.tc-imp-pick:focus-visible{background:var(--mist);border-color:var(--sage-deep);outline:none;}
  .tc-imp-pick:active,.tc-imp-pick.is-selected{background:var(--sage-deep);border-color:var(--sage-deep);color:#fff;}
  `;
  document.head.appendChild(s);
}

// TC-99: title-case an occasion for the editable field ("wedding" → "Wedding", "baby's arrival" →
// "Baby's Arrival"). Plain, no AI tells.
// Capitalize only the FIRST letter, so a printed name inside an occasion stays intact:
// "wedding" -> "Wedding", but "loss of Robert Hale" -> "Loss of Robert Hale" (never "Loss Of Robert Hale").
const capFirst = (s) => { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };

// TC-99: render an event date for the confirm field. A full ISO date shows with its year
// ("2027-06-15" → "June 15, 2027"); a year-less/sentinel date drops the year ("June 15"); a value
// that's already free text (kept across a re-resolve) is shown verbatim. null/empty → "".
function formatEventDate(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s; // already human text the user typed/kept
  const md = formatMonthDay(s); // "June 15" (also drops the sentinel year)
  if (!md) return s;
  return isYearlessBirthday(s) ? md : `${md}, ${m[1]}`;
}

const factLine = (f) => {
  if (f.relation === "birthday" || (f.fact_class === "RECURRING" && /birthday/i.test(f.object || ""))) {
    // TC-112: show a warm "June 15" (year dropped for a year-less/recurring birthday), never a raw
    // ISO string or a bogus sentinel year.
    const md = formatMonthDay(f.event_date);
    return md ? `Birthday · ${esc(md)}` : "Birthday";
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

  // TC-99: is this an obituary? The confirm copy stays quiet and asks who they're showing up for,
  // never celebratory, never auto-picking the deceased or a survivor.
  const isObituary = preview.source_kind === "obituary";
  // The artifact's event (a wedding date, a birth date, a loss), if one was read. A plain recurring
  // birthday is already handled by the Birthday field below, so the dedicated Occasion field only
  // shows for a NON-birthday event (a wedding, a graduation, a loss).
  const ev = preview.event && (preview.event.occasion || preview.event.date) ? preview.event : null;
  const evIsBirthday = ev && ev.recurring && /\bbirthday\b/i.test(ev.occasion || "");
  const showOccasion = ev && !evIsBirthday;

  function whoLine() {
    if (isObituary) {
      // Gentle, plain condolence framing. The deceased is NEVER surfaced as a card — the people here
      // are the living someone left behind. This asks the user to keep whoever they're showing up
      // for. No cheer, no auto-pick, and never an invitation to add the person who passed.
      return `This looks like an obituary. Keep the person you want to show up for. Take your time.`;
    }
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
    const src = ({
      dm: "a direct message", profile: "a profile", contact_card: "a contact card", text_thread: "a message",
      business_card: "a business card", invitation: "an invitation", save_the_date: "a save-the-date",
      greeting_card: "a card", announcement: "an announcement", obituary: "an obituary",
    }[preview.source_kind]) || "what you shared";
    // TC-112: pre-fill an editable month+day birthday. The extracted event_date may be full
    // (YYYY-MM-DD) or year-less (sentinel year) — either way we show a warm "June 15" the user can
    // edit or type fresh. preview.birthday holds a value the user kept across a name re-resolve.
    const bdayRaw = (facts.find((f) => f.relation === "birthday" || (f.fact_class === "RECURRING" && f.event_date)) || {}).event_date || preview.birthday || "";
    const bday = /^\d{4}-\d{2}-\d{2}$/.test(bdayRaw) ? formatMonthDay(bdayRaw) : String(bdayRaw || "");
    // Hide from the plain fact list: the birthday (its own field) AND the event we surface as the
    // editable Occasion field (a MILESTONE/RECURRING dated fact) so it never shows twice.
    const otherFacts = facts.filter((f) =>
      !(f.relation === "birthday" || (f.fact_class === "RECURRING" && f.event_date) || (showOccasion && f.event_date && (f.fact_class === "MILESTONE" || f.fact_class === "RECURRING"))));
    const isPick = state.kind === "pick";
    // On a "pick" card the candidate picks are the primary filled actions; the "add someone new"
    // button (the confirm) is a fundamentally different action, so we de-emphasize it to a ghost
    // secondary — matching how the To-Review surface separates candidate picks from other actions.
    const cands = isPick
      ? `<div class="tc-imp-cands">${state.candidates.map((c) => `<button class="cta tc-imp-pick" data-pid="${c.id}">${esc(c.name)}${c.location ? ` · ${esc(c.location)}` : ""}</button>`).join("")}</div>`
      : "";
    const confirmClass = isPick ? "cta ghost tc-imp-confirm tc-imp-addnew" : "cta tc-imp-confirm";
    // TC-99: gentler confirm verb on an obituary (never "Add them"). The default add/update stays.
    const confirmLabel = isPick
      ? "Add someone new →"
      : (isObituary ? "Keep them →" : (state.kind === "update" ? "Add to them →" : "Add them →"));
    const eyebrow = isObituary ? `Read from ${src}. Take your time.` : `Found from ${src} — check it over`;
    // TC-99: for a non-birthday event (a wedding, a graduation, a loss) show an editable Occasion +
    // date the user can accept or fix. A year-less date shows as "June 15" (no bogus year); a full
    // date shows as "June 15, 2027". The date field is plain text so the user can type either.
    const evOccasion = showOccasion ? String(ev.occasion || "") : "";
    const evDateText = showOccasion ? formatEventDate(ev.date) : "";
    // TC-99 (UX): on an obituary the occasion is quiet context (a loss), not something to wordsmith —
    // show it read-only, and only show a Date if one was actually printed (never an empty, celebratory-
    // looking date field on the most sensitive path). Other events (a wedding) stay fully editable.
    const showEvDate = showOccasion && (!isObituary || !!evDateText);
    const occInput = isObituary
      ? `<input type="text" class="tc-imp-occ" value="${esc(capFirst(evOccasion))}" readonly aria-readonly="true" tabindex="-1" />`
      : `<input type="text" class="tc-imp-occ" value="${esc(capFirst(evOccasion))}" placeholder="e.g. Wedding" autocomplete="off" />`;
    const occasionField = showOccasion ? `
      <div class="tc-imp-field"><label>Occasion</label>${occInput}</div>
      ${showEvDate ? `<div class="tc-imp-field"><label>Date (optional)</label><input type="text" class="tc-imp-occdate" value="${esc(evDateText)}" placeholder="${isObituary ? "" : "e.g. June 15, 2027"}" autocomplete="off" inputmode="text" /></div>` : ""}` : "";
    card.innerHTML = `
      <div class="tc-imp-eyebrow">${eyebrow}</div>
      <div class="tc-imp-field"><label>Name</label><input type="text" class="tc-imp-name" value="${esc(preview.personHint || state.personName || "")}" autocomplete="off" /></div>
      <div class="tc-imp-field"><label>Who they are to you</label><input type="text" class="tc-imp-rel" value="${esc(preview.relationshipHint || "")}" placeholder="e.g. a friend, someone I manage" autocomplete="off" /></div>
      ${showOccasion ? "" : `<div class="tc-imp-field"><label>Birthday (optional)</label><input type="text" class="tc-imp-bday" value="${esc(bday)}" placeholder="e.g. June 15 (year optional)" autocomplete="off" inputmode="text" /></div>`}
      ${occasionField}
      <div class="tc-imp-who">${whoLine()}</div>
      ${cands}
      ${otherFacts.length ? `<ul class="tc-imp-facts">${otherFacts.map((f) => `<li>${factLine(f)}</li>`).join("")}</ul>` : ""}
      <div class="tc-imp-acts">
        <button class="link-btn tc-imp-discard">Not now</button>
        <button class="${confirmClass}">${confirmLabel}</button>
      </div>
      <div class="k-msg tc-imp-msg"></div>`;
    wire();
  }

  function wire() {
    const nameEl = card.querySelector(".tc-imp-name");
    const relEl = card.querySelector(".tc-imp-rel");
    const bdayEl = card.querySelector(".tc-imp-bday"); // absent when the Occasion field replaces it
    const occEl = card.querySelector(".tc-imp-occ");
    const occDateEl = card.querySelector(".tc-imp-occdate");
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
        // Preserve the user's typed relationship/birthday across the redraw (birthday kept as the
        // text the user sees, e.g. "June 15" — draw() shows it back verbatim).
        const keepRel = relEl.value, keepBday = bdayEl ? bdayEl.value.trim() : "";
        preview.personHint = nm; preview.relationshipHint = keepRel; if (keepBday) preview.birthday = keepBday;
        // TC-99: keep an edited occasion/date across the name re-resolve too.
        if (occEl) preview.event = { ...(preview.event || {}), occasion: occEl.value.trim(), date: occDateEl ? occDateEl.value.trim() : (preview.event?.date || null) };
        draw();
      } catch (e) { console.error("re-resolve name", e); }
    };

    // The relationship value at draw time — so the host can tell an intentional set/change from an
    // untouched prefill and never clobber an existing person's relationship with a stale value.
    const relInitial = relEl.value.trim();

    // TC-112: the birthday the extraction already seeded as a fact (a key_date is written for it by
    // captureResolve). We only ask the host to persist a birthday when the field carries one that the
    // extraction did NOT already seed (user added or edited it) — so we never double-write.
    const bdayFact = facts.find((f) => f.relation === "birthday" || (f.fact_class === "RECURRING" && f.event_date));
    const bdayExtracted = bdayFact?.event_date || null; // full or sentinel ISO, or null

    // TC-99: the NON-birthday event the extraction already seeded (a wedding/loss key_date written by
    // captureResolve). Like the birthday, we only ask the host to write an event key_date when the
    // user edited the occasion or date on the card (so we never double-write the seeded one). The
    // seeded label/date come from the MILESTONE/RECURRING dated fact.
    const evFact = showOccasion
      ? facts.find((f) => f.event_date && (f.fact_class === "MILESTONE" || f.fact_class === "RECURRING"))
      : null;
    const evLabelExtracted = evFact ? String(evFact.object || "").trim() : "";
    const evDateExtracted = evFact?.event_date || null;
    const evRecursExtracted = evFact?.fact_class === "RECURRING";

    // Confirm → the SAME captureResolve the To-Review surface uses. For a brand-new person we pass
    // the edited name as newPersonName; for an update/pick we pass the chosen personId. An edited
    // relationship is applied by the host after confirm (server createPerson sets name only; on an
    // update the server ignores relationship entirely) — the host honors it when the user changed it.
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
        const relNow = relEl.value.trim();
        // TC-112: parse the birthday field ("June 15" / "June 15, 1990" / "6/15" / ISO). If it
        // resolves to a date the extraction did NOT already seed, hand it to the host to write as a
        // recurring key_date. { event_date, recurs } or null. (Absent when the Occasion field is shown.)
        const bdayNow = bdayEl ? parseBirthdayInput(bdayEl.value) : null;
        const bdayChanged = (bdayNow?.event_date || null) !== bdayExtracted;
        // TC-99: the Occasion + date. Parse the date the same way as the birthday (accepts a year-less
        // "June 15" → sentinel/recurring, or a full "June 15, 2027" → one-time). Hand the event to the
        // host ONLY when the user changed the label or the date, so the seeded key_date isn't doubled.
        let event = null;
        if (showOccasion) {
          const occLabel = (occEl?.value || "").trim();
          const occDate = occDateEl ? parseBirthdayInput(occDateEl.value) : null;
          const dateNow = occDate?.event_date || null;
          const changed = occLabel !== evLabelExtracted || dateNow !== evDateExtracted;
          // recurs: keep the extracted intent unless the user typed a full year (one-time) vs a
          // year-less date (recurring), which parseBirthdayInput already encodes in occDate.recurs.
          if (changed && (occLabel || dateNow)) {
            event = { label: occLabel || "A date to remember", event_date: dateNow, recurs: occDate ? occDate.recurs : evRecursExtracted };
          }
        }
        if (onConfirmed) await onConfirmed(res || null, {
          relationship: relNow,
          relChanged: relNow !== relInitial,
          isNew: !(personId || state.personId),
          birthday: bdayChanged ? bdayNow : null,
          event,
        });
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
