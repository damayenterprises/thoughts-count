// Thoughts Count — TC-117 "already circled back" bookkeeping.
//
//   POST { saved_plan_id?, mechanism: 'A'|'B', outcome? }
//
// One row per (person-plan, mechanism) Della has circled back on, so an outcome is never
// re-asked and the per-person cooldown survives a device switch. Authoritative across
// devices (the client's per-session throttle is separate, in localStorage).
//
// Privacy / trust: this stores NO story text and NO names — only which plan was revisited,
// by which mechanism, and (for a non-grief Mechanism-A only) a coarse outcome label. The
// endpoint FORCES outcome to null for Mechanism B and for any check-back not carrying a
// valid outcome, so a grief-care-only check-back can never record a learning signal here.
//
// DORMANT-SAFE: the plan_checkins table is a PROPOSED migration (008) not yet applied. Until
// David applies it, every insert lands on "table does not exist" and this endpoint returns a
// 200 no-op — so the deployed branch never breaks and the feature simply does nothing.

import { requireUser, serviceClient, json } from "./_supabase.mjs";
import { OUTCOME_VALUES } from "./_analytics.mjs";

// Postgres "undefined_table" — the pre-migration signal we treat as a benign no-op.
const UNDEFINED_TABLE = "42P01";
// Postgres "unique_violation" — an idempotent re-ask (reload / double-fire); also benign.
const UNIQUE_VIOLATION = "23505";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const auth = await requireUser(req);
  if (auth.error) return json(auth.status, { error: auth.error });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }

  const mechanism = body?.mechanism === "A" || body?.mechanism === "B" ? body.mechanism : null;
  if (!mechanism) return json(400, { error: "Missing mechanism." });

  const savedPlanId = body?.saved_plan_id ? String(body.saved_plan_id) : null;
  // outcome is honored ONLY for Mechanism A AND only when it's a valid label; forced null
  // otherwise. Mechanism B and grief-care-only A therefore always store outcome = null.
  const outcome =
    mechanism === "A" && OUTCOME_VALUES.has(String(body?.outcome || ""))
      ? String(body.outcome)
      : null;

  const supa = serviceClient();
  try {
    const { error } = await supa.from("plan_checkins").insert({
      user_id: auth.userId,
      saved_plan_id: savedPlanId,
      mechanism,
      outcome,
    });
    if (error) {
      // Pre-migration (table absent) or an idempotent duplicate → both are a clean no-op.
      if (error.code === UNDEFINED_TABLE || error.code === UNIQUE_VIOLATION) {
        return json(200, { ok: true, noop: true });
      }
      console.error("plan-checkin insert failed", error);
      // Never break the caller's flow over bookkeeping.
      return json(200, { ok: false });
    }
    return json(200, { ok: true });
  } catch (e) {
    console.error("plan-checkin error", e);
    return json(200, { ok: false });
  }
};
