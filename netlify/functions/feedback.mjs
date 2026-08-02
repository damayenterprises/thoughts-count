// Thoughts Count — plan-quality feedback ingest (Loop 2 / TC-58).
//
// Receives a "was this helpful?" signal from the plan screen. Two single-purpose
// events so a reason refinement never double-counts a downvote:
//   plan_feedback         { helpful: bool, ...bucket }
//   plan_feedback_reason  { reason: enum, ...bucket }
//
// Privacy: like the rest of analytics, this stores ONLY the non-identifying bucket
// (occasion/valence/relationship/budget_band, whitelisted server-side) plus a fixed
// reason enum. No names, no story text, no plan content ever touches this path.

import { logEvent, isBot, sanitizeBucket, FEEDBACK_REASONS } from "./_analytics.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 405 });
  let body;
  try { body = await req.json(); } catch { return new Response("ok", { status: 200 }); }

  const kind = String(body?.event || "");
  if (kind !== "plan_feedback" && kind !== "plan_feedback_reason") {
    return new Response("ok", { status: 200 });
  }

  const bucket = sanitizeBucket(body?.bucket || {});
  const props = { sid: safe(body?.sid, 40), ...bucket };

  if (kind === "plan_feedback") {
    if (typeof body?.helpful !== "boolean") return new Response("ok", { status: 200 });
    props.helpful = body.helpful;
  } else {
    const reason = String(body?.reason || "");
    if (!FEEDBACK_REASONS.has(reason)) return new Response("ok", { status: 200 });
    props.reason = reason;
  }

  const bot = isBot(req.headers.get("user-agent"));
  await logEvent(kind, props, { test: !!body?.test, bot });
  return new Response("ok", { status: 200 });
};

function safe(v, max) {
  if (v == null) return undefined;
  return String(v).slice(0, max);
}
