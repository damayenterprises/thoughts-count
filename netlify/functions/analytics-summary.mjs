// Thoughts Count — analytics summary (admin only).
// Reads the raw event log and returns aggregates: the funnel, unique visitors,
// unique emails, and the anonymized "what people need" breakdowns. Test/insider
// events are excluded by default (?includeTest=1 to see everything).
//
// Auth: pass ?token=<ANALYTICS_TOKEN> (or header x-analytics-token). If the env var
// isn't set, the endpoint stays locked.

import { getStore } from "@netlify/blobs";
import { getEnv } from "./_email.mjs";
import { loadAllEvents, computeSummary } from "./_analytics.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const token = req.headers.get("x-analytics-token") || url.searchParams.get("token") || "";
  const expected = getEnv("ANALYTICS_TOKEN");
  if (!expected || token !== expected) return json(401, { error: "unauthorized" });

  const includeTest = url.searchParams.get("includeTest") === "1";
  const store = getStore("analytics");
  const events = await loadAllEvents(store);
  const real = events.filter((e) => includeTest || (!e.test && !e.bot));

  // Raw per-turn latency view for dialing in the voice lags. Token-gated + non-identifying (ms + a
  // random sid + timestamp only). ?raw=voice_latency returns each turn, newest first, so we can see
  // the per-turn breakdown and drop known self-test sids by hand.
  if (url.searchParams.get("raw") === "voice_latency") {
    const legs = ["eot_ms", "transcribe_ms", "converse_ms", "tts_ms", "gap_ms", "felt_ms"];
    const turns = real
      .filter((e) => e.event === "voice_turn_latency")
      .sort((a, b) => String(b.t).localeCompare(String(a.t)))
      .map((e) => {
        const row = { t: e.t, sid: e.sid, test: !!e.test, turns: e.turns };
        for (const k of legs) if (Number.isFinite(e[k])) row[k] = e[k];
        return row;
      });
    return json(200, { generated_at: new Date().toISOString(), count: turns.length, turns });
  }

  return json(200, {
    generated_at: new Date().toISOString(),
    excluded_noise_events: includeTest ? 0 : events.length - real.length,
    ...computeSummary(real),
  });
};

function json(status, obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
