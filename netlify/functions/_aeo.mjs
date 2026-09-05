// Thoughts Count — TC-177 AEO citation panel (probe module).
//
// The scoreboard for our AEO work: ask the AI answer engines the real questions our guides target,
// and record whether thoughtscount.com is cited. Pairs with the reactive AI-referrer tracking in
// _analytics.mjs (which shows AI traffic that already arrived); this measures citation proactively.
//
// Two surfaces, both on keys we already have:
//   - OpenAI Responses API + web_search tool  -> ChatGPT-style answers with url citations
//   - SearchAPI (engine=google)               -> Google AI Overview + its source references
// Pure functions here (no Blobs) so the panel can be smoke-tested locally before it ships.

const OUR_HOST = "thoughtscount.com";

// The target prompts, phrased as real questions, each mapped to a guide we publish.
export const PROMPTS = [
  "what do you write in a sympathy card",
  "what to say when someone loses a parent",
  "what to say when someone loses their spouse",
  "how to comfort someone after a miscarriage",
  "what to say to someone going through a divorce",
  "what to say to a coworker who lost a loved one",
  "what to write in a wedding card",
  "how to sign a wedding card",
  "what to write in a new baby card",
  "what to write in a baby shower card",
  "what to say when someone gets engaged",
  "what to write in a graduation card",
  "what to write in a thank you card",
  "what to write in a birthday card",
  "what to say to someone who is sick",
  "what to say to someone before surgery",
  "what to say when someone loses their job",
  "what to say when someone doesn't get the job",
  "how to actually help a grieving friend",
  "what to say to someone who is depressed",
  "words of encouragement for someone going through a hard time",
  "what to say to a friend going through a breakup",
  "how to support a friend who lives far away",
  "what to write in a retirement card",
  "what to write in a housewarming card",
  "what to say to a caregiver",
  "what to write in an anniversary card",
  "what to say when someone loses a pet",
  "what to write in a farewell card for a coworker",
  "what to say to someone having a hard time",
];

function mentionsUs(anyString) {
  return new RegExp(OUR_HOST.replace(/\./g, "\\."), "i").test(String(anyString || ""));
}

// ---- OpenAI: ChatGPT-style answer with web search ----
// Returns { ok, cited, mentioned, sources:[urls], error }. `cited` = we appear in a real url citation;
// `mentioned` = our domain shows up anywhere in the answer (softer signal).
export async function probeOpenAI(prompt, { timeoutMs = 45000 } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "no OPENAI_API_KEY" };

  async function call(toolType) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          tools: [{ type: toolType }],
          tool_choice: "auto",
          input: prompt,
        }),
        signal: ctrl.signal,
      });
      const body = await r.json().catch(() => ({}));
      return { status: r.status, body };
    } finally { clearTimeout(t); }
  }

  try {
    // Newer API uses "web_search"; older previews used "web_search_preview". Try new, fall back.
    let res = await call("web_search");
    if (res.status === 400 && /web_search\b/.test(JSON.stringify(res.body))) {
      res = await call("web_search_preview");
    }
    if (res.status !== 200) {
      return { ok: false, error: `openai ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}` };
    }
    // Collect url citations from message annotations, plus a full-text mention as a soft signal.
    const sources = [];
    const out = res.body.output || [];
    for (const item of out) {
      for (const c of item.content || []) {
        for (const a of c.annotations || []) {
          if (a.url) sources.push(a.url);
        }
      }
    }
    const cited = sources.some(mentionsUs);
    const mentioned = cited || mentionsUs(JSON.stringify(res.body));
    return { ok: true, cited, mentioned, sources: sources.filter(mentionsUs) };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 160) };
  }
}

// ---- SearchAPI: Google AI Overview ----
// Returns { ok, present (an AI Overview existed for the query), cited (we're in it/its sources), error }.
export async function probeAIOverview(prompt, { timeoutMs = 30000 } = {}) {
  const key = process.env.SEARCHAPI_KEY;
  if (!key) return { ok: false, error: "no SEARCHAPI_KEY" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `https://www.searchapi.io/api/v1/search?engine=google&q=${encodeURIComponent(prompt)}&api_key=${encodeURIComponent(key)}`;
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return { ok: false, error: `searchapi ${r.status}` };
    const j = await r.json();
    const ov = j.ai_overview || null;
    const present = !!ov;
    // Cited if our domain appears anywhere in the AI Overview object (text or references).
    const cited = present && mentionsUs(JSON.stringify(ov));
    return { ok: true, present, cited };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 160) };
  } finally { clearTimeout(t); }
}

// One prompt, both engines.
export async function probePrompt(prompt) {
  const [openai, aiOverview] = await Promise.all([probeOpenAI(prompt), probeAIOverview(prompt)]);
  return { prompt, openai, aiOverview };
}
