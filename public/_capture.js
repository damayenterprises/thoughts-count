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

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "them";

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

export function captureExtract(sb, { rawText, lockedPersonId = null, source = "typed" }) {
  return post(sb, "/api/capture/extract", { rawText, lockedPersonId, source });
}
export function captureResolve(sb, { captureId, action, personId = null, newPersonName = null, contactKind = null }) {
  return post(sb, "/api/capture/resolve", { captureId, action, personId, newPersonName, contactKind });
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
  .tc-qc-row input{flex:1 1 190px;min-width:0;}
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
  el.innerHTML = `<span><b>${esc(message)}</b> ✓</span>${onUndo ? `<button class="tc-toast-undo">${esc(undoLabel)}</button>` : ""}`;
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
  return `<div class="tc-qc-hint" id="tcQcHint"><span>Tip: jot anything about someone here — “Maria just started a new job” — and we'll file it to the right person.</span><button class="tc-qc-hint-x" aria-label="Dismiss">✕</button></div>`;
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
  const ph = placeholder || "Note something — e.g. “Maria just started a new job”";
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
      const proposedName = it.proposed_person_id ? nameOf(it.proposed_person_id) : "";
      const hint = it.parsed?.person_hint || "";
      const confirmLabel = it.proposed_person_id
        ? `Confirm${proposedName ? ` — ${esc(firstName(proposedName))}` : ""}`
        : `Confirm — add ${esc(firstName(hint) || "them")}`;
      return `
        <div class="tc-review-item" data-cid="${it.id}">
          <div class="tc-review-heard">“${esc(it.raw_text || "")}”</div>
          <div class="tc-review-who">${esc(it.match_evidence || "Who is this about?")}</div>
          <div class="tc-review-acts">
            <button class="cta tc-rv-confirm" data-cid="${it.id}">${confirmLabel}</button>
            <button class="link-btn tc-rv-assign" data-cid="${it.id}">Assign to someone else</button>
            <button class="link-btn tc-rv-discard" data-cid="${it.id}">Discard</button>
          </div>
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

      el.querySelector(".tc-rv-confirm").onclick = () => act(() => captureResolve(sb, { captureId: cid, action: "confirm", contactKind }));
      el.querySelector(".tc-rv-discard").onclick = () => act(() => captureResolve(sb, { captureId: cid, action: "discard" }), { save: false });
      el.querySelector(".tc-rv-assign").onclick = () => {
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
