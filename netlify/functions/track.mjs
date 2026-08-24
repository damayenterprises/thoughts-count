// Thoughts Count — client funnel event ingest.
// Receives lightweight, non-identifying events from the browser (page_view,
// intake_start, plan_viewed) and records them. No cookies, no personal data —
// just an anonymous random session id so we can follow one visit through the funnel.

import { logEvent, isBot, classifySource } from "./_analytics.mjs";

const ALLOWED = new Set(["page_view", "intake_start", "plan_viewed", "plan_saved", "chip_click", "voice_turn_latency"]);

// TC voice-latency: the per-leg timings (ms) the client records for one spoken turn. Each is a
// bounded non-negative integer — never free text, never identifying. This is the "actuals" record
// of the dead-silence a user feels between finishing speaking and hearing Della's first word.
const LATENCY_FIELDS = ["eot_ms", "transcribe_ms", "converse_ms", "tts_ms", "gap_ms", "felt_ms"];
const LATENCY_MAX_MS = 120000; // sanity ceiling; anything larger is a stuck turn, not a real gap

export default async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 405 });
  let body;
  try { body = await req.json(); } catch { return new Response("ok", { status: 200 }); }

  const event = String(body?.event || "");
  if (!ALLOWED.has(event)) return new Response("ok", { status: 200 });

  // Voice-latency has its own compact, numeric-only shape (no referrer/source classification).
  if (event === "voice_turn_latency") {
    const props = { sid: safe(body?.sid, 40) };
    for (const f of LATENCY_FIELDS) {
      const n = Number(body?.[f]);
      if (Number.isFinite(n) && n >= 0 && n <= LATENCY_MAX_MS) props[f] = Math.round(n);
    }
    const turns = Number(body?.turns);
    if (Number.isFinite(turns) && turns >= 0 && turns <= 500) props.turns = Math.round(turns);
    const bot = isBot(req.headers.get("user-agent"));
    await logEvent(event, props, { test: !!body?.test, bot });
    return new Response("ok", { status: 200 });
  }

  const ref = safe(body?.ref, 80); // referrer host (set by the client)
  const { channel, source } = classifySource(ref, { source: body?.utm_source, medium: body?.utm_medium });

  const props = {
    sid: safe(body?.sid, 40),
    page: safe(body?.page, 80),
    ref,
    channel,
    source: safe(source, 60),
    campaign: safe(body?.utm_campaign, 60),
    content: safe(body?.utm_content, 60), // which ad creative (e.g. with_cta / no_cta) — per-creative learning
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
