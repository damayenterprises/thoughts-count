// Thoughts Count — TC-117 "Della circles back" PURE selection logic.
//
// The deterministic heart of the check-back feature, factored out of companion.js so it can be
// unit-tested offline (no browser globals, no Supabase, no localStorage, no network here). The
// session throttle (localStorage), the plan_checkins read (Supabase), and the post-conversation
// emit (network) stay in companion.js; this module only decides, given already-loaded data,
// WHETHER and HOW Della circles back.
//
// SIGNAL IS A PURE BYPRODUCT (Council G3): the fire rate and eligibility windows below are tuned
// for how the check-back FEELS to the user ONLY — NEVER to increase the volume of the plan_outcome
// signal. Any future change to CHECKBACK_RATE_A or the windows must be justified by user-experience
// quality, never by "we need more outcome data."

// Tunable constants (David can adjust these without a code hunt).
export const MIN_ELAPSED_DAYS = 10;         // a plan must be old enough that an outcome can exist
export const MAX_ELAPSED_DAYS = 120;        // don't resurrect ancient history
export const GRIEF_FRESH_DAYS = 21;         // fresh grief → total silence, no check-back of any kind
export const PER_PERSON_COOLDOWN_DAYS = 30; // don't circle back on the same person too soon
export const CHECKBACK_RATE_A = 0.25;       // START at the low end; tune UP only on real reactions (NOT for signal)
export const MECH_B_RATE = 0.05;            // Mechanism B is rarer still, and only when A didn't fire

// Client mirror of _analytics.mjs's valence keyword sets. KEEP IN SYNC with
// netlify/functions/_analytics.mjs (HARD / CELEBRATION / GRATITUDE). A tiny client copy avoids a
// server round-trip at save time; this shared comment is the sync contract.
const CB_HARD = ["died", "death", "passed", "loss", "lost", "funeral", "grief", "grieving", "cancer", "diagnos", "sick", "illness", "hospice", "surgery", "hospital", "divorce", "breakup", "broke up", "split", "laid off", "layoff", "fired", "job loss", "unemploy", "miscarriage", "hard week", "hard time", "struggl", "depress", "anxiet", "burnout", "injur"];
const CB_CELEBRATION = ["baby", "born", "birth", "pregn", "expecting", "wedding", "engag", "married", "marry", "promot", "new job", "new role", "graduat", "retire", "anniversar", "birthday", "housewarm", "congrat", "award", "milestone", "first day"];
const CB_GRATITUDE = ["thank", "grateful", "apprecia", "just because", "thinking of you", "miss you"];

// Client mirror of classifyValence(). Returns celebration | hard_time | gratitude | other |
// unspecified. Conservative: any HARD keyword wins first, so the grief guard errs safe.
export function classifyValenceLite(text) {
  const s = String(text || "").toLowerCase();
  if (!s.trim()) return "unspecified";
  if (CB_HARD.some((k) => s.includes(k))) return "hard_time";
  if (CB_CELEBRATION.some((k) => s.includes(k))) return "celebration";
  if (CB_GRATITUDE.some((k) => s.includes(k))) return "gratitude";
  return "other";
}

// The stored valence for a plan when migration 009 is applied; otherwise re-derive it live
// (lossy but never crashes). Conservative fallback keeps the grief guard safe pre-migration.
export function planValence(plan) {
  const stored = plan && typeof plan.valence === "string" ? plan.valence.trim() : "";
  if (stored) return stored;
  return classifyValenceLite((plan && (plan.occasion || plan.plan_title)) || "");
}

// Days between an ISO/date string and `now` (floored). NaN-safe → returns Infinity so an
// unparseable date is treated as "too old to check back on" (never eligible).
export function daysSince(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return Math.floor((now - t) / 86400000);
}

// A coarse, human "when" phrase for a plan's age — advisory prompt sugar only.
export function whenPhraseFor(days) {
  if (days <= 14) return "a couple weeks ago";
  if (days <= 45) return "last month";
  if (days <= 75) return "a couple months ago";
  return "a while back";
}

// Coarse outcome word-read (Mechanism A non-grief only). Phase-1 client-side read of how the user
// described how it went. NEVER surfaced to the user — a SILENT aggregate only. Phase 2 may replace
// with a model-emitted field. Returns "went_well" | "fell_flat" | "unclear".
const CB_POSITIVE = ["loved", "love", "cried", "happy", "thrilled", "great", "perfect", "wonderful", "amazing", "meant a lot", "so glad", "touched", "smiled", "laughed", "went well", "hit", "beautiful", "grateful", "appreciated", "best", "made their", "made her", "made his", "lit up"];
const CB_NEGATIVE = ["didn't", "did not", "never", "awkward", "fell through", "fell flat", "flopped", "canceled", "cancelled", "too late", "missed", "forgot", "no response", "ignored", "worse", "wrong", "regret", "backfired", "upset", "hurt"];
export function readOutcome(text) {
  const s = String(text || "").toLowerCase();
  if (!s.trim()) return "unclear";
  const neg = CB_NEGATIVE.some((k) => s.includes(k));
  const pos = CB_POSITIVE.some((k) => s.includes(k));
  if (pos && !neg) return "went_well";
  if (neg && !pos) return "fell_flat";
  return "unclear"; // mixed, or nothing recognizable
}

// pickCheckback(person, opts) → at most ONE of:
//   { mechanism:"A", plan_id, occasion, valence, grief_care_only, when_phrase } | { mechanism:"B" } | null
// opts:
//   checkins:{ askedPlanIds:Set, lastAskedForPlan:Map(id->ms), outcomeForPlan?:Map } — from loadCheckins()
//   sessionUsed:boolean  — the per-session throttle result (companion reads localStorage)
//   rng:()=>number       — injectable for tests (default Math.random)
//   now:number           — injectable clock (default Date.now)
// Fail-open: ANY error → null (byte-identical to today).
export function pickCheckback(person, opts = {}) {
  try {
    // Session throttle first — the cheapest gate; caps A+B combined across the whole day.
    if (opts.sessionUsed) return null;
    const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const checkins = opts.checkins || {};
    const askedPlanIds = checkins.askedPlanIds instanceof Set ? checkins.askedPlanIds : new Set();
    const lastAskedForPlan = checkins.lastAskedForPlan instanceof Map ? checkins.lastAskedForPlan : new Map();

    const plans = Array.isArray(person && person.saved_plans) ? person.saved_plans : [];

    // Per-person cooldown: if ANY of this person's plans was asked within the window, skip A.
    const cutoffMs = now - PER_PERSON_COOLDOWN_DAYS * 86400000;
    let inCooldown = false;
    for (const p of plans) {
      const ms = p && p.id ? lastAskedForPlan.get(p.id) : undefined;
      if (Number.isFinite(ms) && ms >= cutoffMs) { inCooldown = true; break; }
    }

    // Build the eligible set for Mechanism A.
    const eligible = [];
    if (!inCooldown) {
      for (const p of plans) {
        if (!p || !p.id) continue;
        if (askedPlanIds.has(p.id)) continue;                 // already asked, never re-ask
        const age = daysSince(p.created_at, now);
        if (age < MIN_ELAPSED_DAYS || age > MAX_ELAPSED_DAYS) continue;
        const valence = planValence(p);
        const isHard = valence === "hard_time";
        if (isHard && age < GRIEF_FRESH_DAYS) continue;       // fresh grief → total silence
        eligible.push({
          plan_id: p.id,
          occasion: String(p.occasion || p.plan_title || "").trim(),
          valence,
          grief_care_only: isHard, // aged hard-time → care-only shape, zero outcome signal
          when_phrase: whenPhraseFor(age),
          _age: age,
        });
      }
    }

    // Mechanism A: pick the MOST-RECENT eligible plan, then gate on the conservative fire rate.
    if (eligible.length) {
      eligible.sort((a, b) => a._age - b._age); // youngest (smallest age) first = most recent
      if (rng() < CHECKBACK_RATE_A) {
        const pick = eligible[0];
        return {
          mechanism: "A",
          plan_id: pick.plan_id,
          occasion: pick.occasion,
          valence: pick.valence,
          grief_care_only: pick.grief_care_only,
          when_phrase: pick.when_phrase,
        };
      }
    }

    // Mechanism B: only when A did NOT fire, rarer still, prompt-only (emits no signal in Phase 1).
    if (rng() < MECH_B_RATE) return { mechanism: "B" };

    return null;
  } catch (e) { return null; }
}
