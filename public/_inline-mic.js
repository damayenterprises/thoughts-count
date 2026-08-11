// Thoughts Count — the ONE voice affordance: an inline microphone inside a text box.
//
// Replaces the three scattered "Speak" buttons (intake .mic-wrap, quick-capture .tc-qc-mic,
// person-card .tc-noticed-mic) with a single, consistent micro-affordance that lives at the
// edge of whatever field it's attached to. It never builds a new listening animation — the
// recording MOMENT is owned by the existing surfaces:
//   • dictation → index.html's global toggleMic (records in place, transcribes, appends text)
//   • capture   → the calm home overlay (renderHomeListening/beginHomeRecording/toProcessing)
//     driven by the existing tcVoiceRemember / tcVoiceNote helpers.
// The inline button's own idle/active/thinking/error states are a small visual echo only.
//
// Brand: hand-drawn stroke mic (window.micSvg), never emoji. Sage idle, clay accent when active.

const STYLE_ID = "tcInlineMicCss";

// The shared CSS for the inline mic. Injected once (index.html also carries these rules in its
// <style>; _capture.js and _memory.js call ensureInlineMicStyles() so module surfaces are styled
// even before index CSS parses).
const INLINE_MIC_CSS = `
.tc-imic { position: relative; display: block; }
.tc-imic > input, .tc-imic > textarea { padding-right: 48px; }
.tc-imic-btn { position: absolute; right: 6px; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0; border: none; background: transparent; color: var(--sage); border-radius: 999px; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: color .15s ease, background .15s ease, transform .12s ease; }
.tc-imic-btn svg { width: 18px; height: 18px; display: block; }
.tc-imic[data-multiline="false"] .tc-imic-btn { top: 50%; transform: translateY(-50%); }
.tc-imic[data-multiline="true"] .tc-imic-btn { top: 6px; }
.tc-imic-btn:hover { color: var(--sage-deep); background: var(--mist); }
.tc-imic-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--mist); color: var(--sage-deep); }
.tc-imic-btn[data-state="active"] { color: var(--clay-deep); background: #f6e3da; }
.tc-imic-btn[data-state="active"]::after { content: ""; position: absolute; inset: 0; border-radius: 999px; border: 1.5px solid var(--clay); opacity: .6; animation: tc-imic-pulse 1.8s ease-out infinite; }
@keyframes tc-imic-pulse { 0% { transform: scale(1); opacity: .6; } 100% { transform: scale(1.5); opacity: 0; } }
.tc-imic-btn[data-state="thinking"] { color: var(--ink-soft); pointer-events: none; }
.tc-imic-btn[data-state="error"] { color: var(--clay-deep); }
@media (prefers-reduced-motion: reduce) { .tc-imic-btn[data-state="active"]::after { animation: none !important; } }
`;

export function ensureInlineMicStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = INLINE_MIC_CSS;
  document.head.appendChild(s);
}

// Voice is truly available: audience gate open + the browser can actually record + the shared
// mic icon exists. (Mode-specific helpers are checked per-mode below.)
function voiceAvailable() {
  try {
    const gateOk = window.TCCompanion && window.TCCompanion.voiceAllowed && window.TCCompanion.voiceAllowed();
    const canRecord = navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder;
    return !!(gateOk && canRecord && typeof window.micSvg === "function");
  } catch (e) { return false; }
}

// For dictation we need a global dictation recorder; for capture we need the matching helper.
function modeReady(mode, personId) {
  if (!voiceAvailable()) return false;
  if (mode === "capture") {
    return personId != null
      ? typeof window.tcVoiceNote === "function"
      : typeof window.tcVoiceRemember === "function";
  }
  // TC-111: dictation prefers the hands-free VAD path (dictateHandsFree — same auto-stop-on-pause +
  // listening feedback as the main Della conversation); toggleMic is the legacy tap-to-stop fallback
  // so a build predating dictateHandsFree still gets a working mic.
  return typeof window.dictateHandsFree === "function" || typeof window.toggleMic === "function";
}

// Mount an inline mic on an existing <input>/<textarea>. Returns { destroy }.
export function mountInlineMic(field, opts = {}) {
  if (!field || typeof document === "undefined") return { destroy() {} };
  const {
    ariaLabel,
    mode = "dictation",
    onTranscript = null,
    personId = null,
    personName = null,
    onSaved = null,
  } = opts;
  if (!ariaLabel) { console.warn("mountInlineMic: ariaLabel is required"); return { destroy() {} }; }

  ensureInlineMicStyles();

  const isMultiline = field.tagName === "TEXTAREA";
  let wrap = null;
  let btn = null;

  function build() {
    if (btn) return; // already mounted
    if (!modeReady(mode, personId)) return; // GUARD: no mic unless voice is truly usable
    // Wrap the field (in place) so the button can be absolutely positioned at its edge.
    wrap = document.createElement("div");
    wrap.className = "tc-imic";
    wrap.setAttribute("data-multiline", isMultiline ? "true" : "false");
    field.parentNode.insertBefore(wrap, field);
    wrap.appendChild(field);

    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tc-imic-btn";
    btn.setAttribute("data-state", "idle");
    btn.setAttribute("aria-label", ariaLabel);
    btn.innerHTML = window.micSvg(18, "currentColor", "#c28a63");
    wrap.appendChild(btn);

    if (mode === "capture") {
      btn.onclick = () => {
        if (personId != null) window.tcVoiceNote(personId, personName, onSaved || (() => {}));
        else window.tcVoiceRemember(onSaved || (() => {}));
      };
    } else {
      // dictation: TC-111 — route through the hands-free VAD recorder so talking to add someone
      // feels identical to talking to Della (auto-stop on a natural pause + the listening pulse).
      // It updates the button state via data-state (setMic is null-safe here) and fires an input
      // event. Falls back to the legacy tap-to-stop toggleMic only if dictateHandsFree is absent.
      btn.onclick = () => (window.dictateHandsFree || window.toggleMic)(btn, field);
      if (typeof onTranscript === "function") {
        field.addEventListener("input", () => onTranscript(field.value), false);
      }
    }
  }

  function teardown() {
    if (!btn) return; // nothing mounted
    // Unwrap: put the field back where the wrapper is, then drop the wrapper (+ button).
    if (wrap && wrap.parentNode) {
      wrap.parentNode.insertBefore(field, wrap);
      wrap.parentNode.removeChild(wrap);
    }
    wrap = null;
    btn = null;
  }

  // Re-evaluate when the voice gate resolves/changes (mirrors index.html's .mic-wrap handler) —
  // add or remove the mic without re-rendering the field so typed text is never lost.
  function onGate() {
    if (modeReady(mode, personId)) build();
    else teardown();
  }
  window.addEventListener("tc-voice-gate-ready", onGate);

  build();

  return {
    destroy() {
      window.removeEventListener("tc-voice-gate-ready", onGate);
      teardown();
    },
  };
}

// Single source of truth: index.html (classic script) calls window.mountInlineMic; ES modules
// import it. Same function either way.
if (typeof window !== "undefined") {
  window.mountInlineMic = mountInlineMic;
  window.ensureInlineMicStyles = ensureInlineMicStyles;
}
