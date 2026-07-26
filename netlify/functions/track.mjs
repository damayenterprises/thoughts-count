// Thoughts Count — client funnel event ingest.
// Receives lightweight, non-identifying events from the browser (page_view,
// intake_start, plan_viewed) and records them. No cookies, no personal data —
// just an anonymous random session id so we can follow one visit through the funnel.

import { logEvent, isBot, classifySource } from "./_analytics.mjs";

const ALLOWED = new Set(["page_view", "intake_start", "plan_viewed", "plan_saved", "chip_click"]);

export default async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 405 });
  let body;
  try { body = await req.json(); } catch { return new Response("ok", { status: 200 }); }

  const event = String(body?.event || "");
  if (!ALLOWED.has(event)) return new Response("ok", { status: 200 });

  const ref = safe(body?.ref, 80); // referrer host (set by the client)
  const { channel, source } = classifySource(ref, { source: body?.utm_source, medium: body?.utm_medium });

  const props = {
    sid: safe(body?.sid, 40),
    page: safe(body?.page, 80),
    ref,
    channel,
    source: safe(source, 60),
    campaign: safe(body?.utm_campaign, 60),
    label: safe(body?.label, 60), // e.g. which quick-start chip
  };

  const bot = isBot(req.headers.get("user-agent"));
  await logEvent(event, props, { test: !!body?.test, bot });
  return new Response("ok", { status: 200 });
};

function safe(v, max) {
  if (v == null) return undefined;
  return String(v).slice(0, max);
}
