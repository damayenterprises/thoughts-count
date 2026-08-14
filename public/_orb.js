// Thoughts Count — Della's "Inner Weather" presence orb.
//
// REBRAND colorway (TC-75): a warm living nebula in a sphere — a warm RED-CORAL heart
// core (#ef4136, echoes the logo heart) breathing inside thoughtful BLUE "inner weather"
// (brand #118ab9), with an earthy-amber bridge so she never goes clinical/LED.
// Rendered on <canvas> (like Lantern was) so hues truly BLEND, not stack — NO white glow.
// Engine/logic untouched; only the pigment palette, base wash, heart bloom + vignette
// COLOR VALUES were re-authored per Design-System v2 §7.
//
// This is the PRODUCTION port of the approved prototype (public/orb.html on branch
// orb-prototype, tip 798bb77): Inner Weather, life:"energetic", with the calmed Speaking
// state. The nebula engine (makePigments, stateFactors incl. the energetic multipliers +
// calmed Speaking, the draw loop, the throttle, the prefers-reduced-motion still frame,
// the visibilitychange pause) is reused VERBATIM — the demo scaffolding (state buttons,
// click-to-cycle, multi-orb sweep, mini-home preview) is dropped.
//
// Added for production lifecycle:
//   • destroy()  — cancels rAF + removes the listeners it added (no leaks on teardown).
//   • IntersectionObserver — pauses the loop when the orb scrolls off-screen / is covered,
//     so it never burns a phone battery drawing something nobody can see.
//   • visibilitychange pause — kept from the prototype.
//
// Usage (index.html hero):
//   import { mountOrb } from '/_orb.js';
//   window.TCOrb = mountOrb(stageEl, { life: 'energetic' });   // stageEl = the .stage
//   window.TCOrb.setState('listening' | 'thinking' | 'speaking' | 'idle');
//
// The canvas reads the stage's data-state attribute fresh each frame (the prototype
// pattern), so setState just flips the attribute — no per-frame subscription.

// Pigment palette (REBRAND §7) — blue "inner weather" around a warm red-coral heart,
// with an earthy-amber bridge so it stays human.
//   col = saturated core of the pigment,  edge = same hue fading to transparent
function makePigments() {
  return [
    // red-coral HEART anchor — biased to center, the emotional anchor (echoes the logo)
    { col:[239,90,80],   edge:[200,64,58],  a:0.72, ox: 0.00, oy: 0.08, rx: 0.64, ry: 0.10, sp: 0.22, ph: 0.0, warm:true },
    // amber bridge — keeps the warm→cool transition human, never clinical
    { col:[236,150,110], edge:[206,120,84], a:0.52, ox: 0.10, oy: -0.06, rx: 0.50, ry: 0.14, sp: 0.30, ph: 1.6, warm:true },
    // brand blue
    { col:[45,150,196],  edge:[24,112,150], a:0.56, ox:-0.34, oy: 0.16, rx: 0.58, ry: 0.20, sp: 0.26, ph: 2.4 },
    { col:[120,190,214], edge:[80,150,182], a:0.52, ox: 0.30, oy: 0.24, rx: 0.54, ry: 0.18, sp: 0.24, ph: 3.6 }, // sky/teal
    // deep blue rim
    { col:[70,138,180],  edge:[40,100,140], a:0.48, ox:-0.20, oy:-0.28, rx: 0.52, ry: 0.22, sp: 0.29, ph: 4.7 },
    { col:[240,170,150], edge:[214,132,116], a:0.42, ox: 0.24, oy:-0.22, rx: 0.48, ry: 0.20, sp: 0.20, ph: 5.9 }  // warm blush light
  ];
}

// per-state feel. speed = drift+pulse rate, warm = clay intensity,
// pull = how much pigments gather toward center, breath = body-color pulse depth.
function stateFactors(state, life) {
  var f;
  if (state === "listening")      f = { speed: 0.6,  warm: 0.9,  pull: 0.34, breath: 0.05 };
  else if (state === "thinking")  f = { speed: 0.7,  warm: 1.0,  pull: 0.20, breath: 0.06 };
  else if (state === "speaking")  f = { speed: 1.3,  warm: 1.15, pull: -0.02, breath: 0.10 };
  else                            f = { speed: 1.0,  warm: 1.02, pull: 0.06, breath: 0.09 }; // idle
  if (life === "energetic") { f.speed *= 1.55; f.breath *= 1.35; f.warm *= 1.04; }
  return f;
}

/**
 * Mount the living orb onto a stage element that contains `.orbIW canvas`.
 * @param {HTMLElement} stageEl  the `.stage` element (carries data-state / data-life)
 * @param {{life?: 'energetic'|'alive'}} [opts]
 * @returns {{ setState: (s:string)=>void, destroy: ()=>void }}
 */
export function mountOrb(stageEl, opts) {
  opts = opts || {};
  if (!stageEl) return { setState: function(){}, destroy: function(){} };

  var canvas = stageEl.querySelector(".orbIW canvas");
  if (!canvas) return { setState: function(){}, destroy: function(){} };

  // life comes from the option first, then the stage attribute, then the calmer default.
  var life = opts.life || stageEl.getAttribute("data-life") || "alive";
  stageEl.setAttribute("data-life", life);
  if (!stageEl.getAttribute("data-state")) stageEl.setAttribute("data-state", "idle");

  var ctx = canvas.getContext("2d");

  // ---- retina crispness (FIX 3): size the backing store to CSS px × devicePixelRatio.
  //   The canvas is displayed at ~200 CSS px but was hard-coded to a 240 backing store, so on
  //   DPR 2–3 phones it upscaled and softened. We measure the CSS box, multiply by a capped
  //   DPR, and scale the drawing context so ALL geometry below stays in CSS px (unchanged).
  var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  // CSS size: prefer the laid-out box; fall back to the authored 240 if not yet laid out.
  var cssW = Math.round(canvas.clientWidth || canvas.width || 240);
  var cssH = Math.round(canvas.clientHeight || canvas.height || 240);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 1 unit == 1 CSS px
  // geometry derived from CSS px so the nebula looks identical, just sharper.
  var W = cssW, H = cssH, cx = W / 2, cy = H / 2, R = W / 2;
  var pig = makePigments();
  var state = "idle";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a.toFixed(3) + ")"; }

  function draw(t, sf) {
    var time = t * 0.001;
    // slow universal breath (heartbeat/lungs) — one shared phase so the whole
    // orb swells together; depth from state.
    var breath = Math.sin(time * (state === "speaking" ? 1.7 : 1.05) * (life === "energetic" ? 1.3 : 1));
    var breathAmt = 1 + breath * sf.breath;

    // ---- base wash: a soft green->blue COLOR field (never white) ----
    //   FIX 2 (warmth): the cool wash used to fill the whole disc at full opacity and
    //   drown the clay heart. Center is now warmer + more saturated green and the cool
    //   blue is pushed toward the rim, so the warm bloom below reads through at rest.
    ctx.globalCompositeOperation = "source-over";
    var base = ctx.createRadialGradient(cx, cy * 0.86, R * 0.05, cx, cy, R);
    base.addColorStop(0.0, "rgba(244,196,168,1)");   // warm amber center (lets the red heart read through)
    base.addColorStop(0.55, "rgba(150,190,206,1)");  // warm→blue bridge
    base.addColorStop(1.0, "rgba(64,132,176,1)");    // deep brand-blue rim
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // clip to circle so pigments stay inside a clean sphere
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();

    // ---- pigments drift + fold on lissajous paths, gather toward center by pull ----
    for (var i = 0; i < pig.length; i++) {
      var p = pig[i];
      var tt = time * p.sp * sf.speed + p.ph;
      var orbit = 1 - sf.pull * (p.warm ? 0.4 : 1); // pull shrinks the orbit
      var bx = cx + Math.cos(tt) * p.ox * R * 1.3 * orbit + Math.sin(tt * 0.7) * R * 0.09;
      var by = cy + Math.sin(tt * 1.15) * p.oy * R * 1.3 * orbit + Math.cos(tt * 0.6) * R * 0.09;
      // pigment radius folds a little over time (living, not rigid) + breath
      var rad = (p.rx + Math.sin(tt * 1.3 + i) * p.ry) * R * breathAmt;
      var alpha = p.warm ? Math.min(0.8, p.a * sf.warm) : p.a;
      var g = ctx.createRadialGradient(bx, by, 0, bx, by, rad);
      g.addColorStop(0.0, rgba(p.col, alpha));
      g.addColorStop(0.6, rgba(p.edge, alpha * 0.5));
      g.addColorStop(1.0, rgba(p.edge, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, rad, 0, Math.PI * 2); ctx.fill();
    }

    // ---- warm clay center bloom: keeps the heart terracotta, glowing through
    //      the cool weather. Drawn in warm COLOR (no white). Breathes + follows
    //      state warmth, and wanders gently so it never sits perfectly still. ----
    var hx = cx + Math.sin(time * 0.9 + 1.3) * R * 0.05;
    var hy = cy + R * 0.04 + Math.cos(time * 0.8) * R * 0.04;
    var heartR = R * (0.62 + breath * sf.breath * 0.5);
    // FIX 2: warmer at REST — the clay heart was too transparent once composited over the
    //   cool wash, so she read pale. Push the idle alpha up and deepen the terracotta.
    var heartA = Math.min(0.82, 0.56 * sf.warm + breath * 0.06);
    var wb = ctx.createRadialGradient(hx, hy, 0, hx, hy, heartR);
    wb.addColorStop(0.0, rgba([239,92,82], heartA));
    wb.addColorStop(0.45, rgba([214,72,64], heartA * 0.58));
    wb.addColorStop(1.0, rgba([214,72,64], 0));
    ctx.fillStyle = wb;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // ---- colored rim vignette for a spherical read (NOT a white sheen) ----
    //   FIX 4b: deepened + reaching a touch further in so the sphere separates from the
    //   near-identical page background instead of dissolving into it. Still subtle/on-brand.
    //   §7: the orb now sits ON the blue hero panel — deepen the rim a touch (0.34→0.38)
    //   so the sphere separates from the panel instead of dissolving into it.
    //   iter-2: +4% (0.38→0.42) so the edge stays defined against the ambient living
    //   blue weather (and remains crisp on the solid panel too).
    var vg = ctx.createRadialGradient(cx, cy * 0.9, R * 0.5, cx, cy, R);
    vg.addColorStop(0, "rgba(30,44,58,0)");
    vg.addColorStop(0.82, "rgba(30,44,58,0.14)");
    vg.addColorStop(1, "rgba(30,44,58,0.42)");
    ctx.fillStyle = vg;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  // pull current state fresh each frame (cheap)
  function currentSF() { state = stageEl.getAttribute("data-state") || "idle"; return stateFactors(state, life); }

  // ---- reduced motion: one calm, warm still frame, then stop. No loop, no listeners. ----
  if (reduce) {
    draw(1600, { speed: 1, warm: 1.02, pull: 0.06, breath: 0 });
    return {
      setState: function (s) { if (s) stageEl.setAttribute("data-state", s); },
      destroy: function () {}
    };
  }

  // hero throttle ~30fps (prototype "big" stage was 33ms).
  var minInterval = 33;
  var last = 0;
  var rafId = 0;
  var running = false;
  var tabVisible = !document.hidden;

  function frame(now) {
    rafId = 0;
    if (!running) return;
    if (now - last >= minInterval) { draw(now, currentSF()); last = now; }
    rafId = requestAnimationFrame(frame);
  }

  // start() ONLY starts the rAF loop. It does NOT gate on visibility — that was the P0:
  //   on mount the orb was below the fold, IntersectionObserver reported onScreen=false,
  //   and start() bailed before ever requesting a frame, so the canvas stayed transparent
  //   forever (and scroll-in didn't reliably revive it). Visibility now only PAUSES an
  //   already-running loop (see onVis / IO below); it can never block the initial start.
  function start() {
    if (running) return;
    if (!tabVisible) return; // a truly hidden tab shouldn't burn rAF; it resumes on onVis
    running = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    // don't reset `last` to 0 — that's fine; first frame draws immediately.
    last = 0;
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  // pause when the tab is hidden — save battery. Resume when it comes back.
  function onVis() {
    tabVisible = !document.hidden;
    if (tabVisible) start(); else stop();
  }
  document.addEventListener("visibilitychange", onVis);

  // pause when the orb is scrolled fully off-screen (below the fold / behind an overlay),
  // resume when it scrolls back in. This ONLY pauses/resumes the animation loop — a paused
  // orb keeps its last painted (non-transparent) frame on screen, so it's never blank.
  var io = null;
  if ("IntersectionObserver" in window) {
    io = new IntersectionObserver(function (entries) {
      var e = entries[0];
      var onScreen = !!(e && e.isIntersecting);
      if (onScreen) start(); else stop();
    }, { threshold: 0.01 });
    io.observe(stageEl);
  }

  // FIX 1: paint at least one full frame IMMEDIATELY on mount, unconditionally, regardless
  //   of fold position — so she is NEVER blank on load even before the loop schedules /
  //   even if she's below the fold. Then start the animation loop.
  draw(performance.now(), currentSF());
  start();

  return {
    setState: function (s) {
      if (!s) return;
      stageEl.setAttribute("data-state", s);
    },
    destroy: function () {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      if (io) { io.disconnect(); io = null; }
    }
  };
}
