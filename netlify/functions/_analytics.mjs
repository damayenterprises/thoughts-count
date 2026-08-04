// Thoughts Count — privacy-first analytics core.
//
// What this captures: the funnel (landed → started → plan generated → emailed/saved)
// plus anonymized "what people need" signal (occasion, valence, relationship, budget,
// whether a gift fit). What it NEVER captures: names, raw stories, or any free text
// someone typed. Everything is bucketed into fixed categories. Emails are stored only
// as a one-way hash (for a unique-visitor count), never in the clear.
//
// Test exclusion: events flagged test:true — agent/dev sessions and known test emails —
// are recorded with test:true so they can always be filtered out of real counts.

import { getStore } from "@netlify/blobs";

// Insiders (founder + partner) and test addresses — always excluded from real-user
// counts so the unique-email growth read reflects only outside people.
export const TEST_EMAILS = new Set([
  "dmay3232@gmail.com",
  "dmay3@cox.net",
  "david@damayenterprises.com",
  "cowartjd@gmail.com", // partner on this endeavor
]);

const STORE = "analytics";

// ---- write one event ----------------------------------------------------
export async function logEvent(event, props = {}, opts = {}) {
  try {
    const store = getStore(STORE);
    const now = new Date();
    const ymd = ymdOf(now);
    const rand = (globalThis.crypto?.randomUUID?.() || String(now.getTime())).slice(0, 8);
    const key = `${ymd}/${now.getTime()}-${rand}`;
    await store.setJSON(key, {
      event,
      t: now.toISOString(),
      ymd,
      test: !!opts.test,
      bot: !!opts.bot,
      ...props,
    });
  } catch (err) {
    // Analytics must never break the user flow.
    console.error("analytics logEvent failed", event, err);
  }
}

// ---- read + aggregate (shared by the summary endpoint and weekly digest) ----
export async function loadAllEvents(store) {
  const events = [];
  let cursor;
  do {
    const page = await store.list({ cursor });
    cursor = page.cursor;
    for (const b of page.blobs || []) {
      try {
        const rec = await store.get(b.key, { type: "json" });
        if (rec) events.push(rec);
      } catch { /* skip unreadable */ }
    }
  } while (cursor);
  return events;
}

// Aggregate a list of (already test-filtered) events into the report shape.
// Utilization counts include everyone real (you + JC = insiders). "Growth" numbers
// (unique external emails) exclude insiders; insider activity is surfaced separately.
export function computeSummary(events) {
  const byEvent = tally(events.map((e) => e.event));
  const uniqueVisitors = new Set(events.map((e) => e.sid).filter(Boolean)).size;
  const emailEvents = events.filter((e) => e.event === "email_submitted");
  const externalEmails = new Set(
    emailEvents.filter((e) => !e.insider).map((e) => e.emailHash).filter(Boolean)
  ).size;
  const teamEmails = new Set(
    emailEvents.filter((e) => e.insider).map((e) => e.emailHash).filter(Boolean)
  ).size;
  const plans = events.filter((e) => e.event === "plan_generated");
  const views = events.filter((e) => e.event === "page_view");
  const rate = (a, b) => (b ? +((a / b) * 100).toFixed(1) : null);

  // Loop 2 (TC-58): plan-quality feedback. Up/down rate comes from `plan_feedback`;
  // the optional "what was off" reason is its own `plan_feedback_reason` event so a
  // reason refinement never double-counts a downvote.
  const feedback = events.filter((e) => e.event === "plan_feedback");
  const reasonEvents = events.filter((e) => e.event === "plan_feedback_reason");
  const up = feedback.filter((e) => e.helpful === true).length;
  const down = feedback.filter((e) => e.helpful === false).length;
  const byOcc = {};
  for (const e of feedback) {
    const k = e.occasion || "unspecified";
    const b = byOcc[k] || (byOcc[k] = { yes: 0, no: 0 });
    if (e.helpful === true) b.yes += 1;
    else if (e.helpful === false) b.no += 1;
  }
  const helpfulness = {
    responses: feedback.length,
    helpful_yes: up,
    helpful_no: down,
    helpful_rate_pct: rate(up, up + down),
    by_occasion: Object.fromEntries(
      Object.entries(byOcc)
        .map(([k, v]) => [k, { ...v, rate_pct: rate(v.yes, v.yes + v.no) }])
        .sort((a, b) => (b[1].yes + b[1].no) - (a[1].yes + a[1].no))
    ),
    down_reasons: tally(reasonEvents.map((e) => e.reason)),
  };
  const funnel = {
    visitors: uniqueVisitors,               // distinct sessions (real people)
    page_views: byEvent.page_view || 0,     // total loads (a reload counts again)
    intake_starts: byEvent.intake_start || 0,
    plans_generated: byEvent.plan_generated || 0,
    plans_viewed: byEvent.plan_viewed || 0,
    emails_submitted: byEvent.email_submitted || 0, // utilization (includes team)
    unique_emails: externalEmails,                  // growth (external only)
    team_emails: teamEmails,                         // you + JC, for visibility
    reminders_sent: byEvent.reminder_sent || 0,
    plans_saved_to_account: byEvent.plan_saved || 0,
  };
  return {
    total_events: events.length,
    unique_visitors: uniqueVisitors,
    funnel,
    conversion: {
      landed_to_started_pct: rate(funnel.intake_starts, funnel.visitors),
      started_to_plan_pct: rate(funnel.plans_generated, funnel.intake_starts),
      plan_to_email_pct: rate(funnel.emails_submitted, funnel.plans_generated),
    },
    traffic: {
      by_channel: tally(views.map((e) => e.channel)),
      top_sources: tally(views.filter((e) => e.source && e.source !== "direct" && e.source !== "internal").map((e) => e.source)),
      landing_pages: tally(views.map((e) => e.page).filter(Boolean)),
    },
    what_people_need: {
      valence: tally(plans.map((e) => e.valence)),
      occasion: tally(plans.map((e) => e.occasion)),
      relationship: tally(plans.map((e) => e.relationship)),
      budget_band: tally(plans.map((e) => e.budget_band)),
      wanted_local_ideas: plans.filter((e) => e.has_location).length,
      gift_fit_rate_pct: rate(plans.filter((e) => e.gift_fit).length, plans.length),
    },
    helpfulness,
    by_day: tally(events.map((e) => e.ymd)),
  };
}

export function tally(arr) {
  const out = {};
  for (const v of arr) {
    if (v == null || v === "") continue;
    out[v] = (out[v] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

// ---- helpers ------------------------------------------------------------
export function ymdOf(d) {
  return d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
}

// One-way, truncated hash so we can count unique emails without storing them.
export async function hashEmail(email) {
  try {
    const data = new TextEncoder().encode(String(email).trim().toLowerCase());
    const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  } catch {
    return "";
  }
}

export function isTestEmail(email) {
  return TEST_EMAILS.has(String(email || "").trim().toLowerCase());
}

// ---- bot detection + traffic-source classification ----------------------
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|preview|whatsapp|telegram|slackbot|discord|twitterbot|linkedinbot|pinterest|headless|lighthouse|phantom|puppeteer|playwright|python-requests|curl|wget|axios|go-http|okhttp|netlify|uptime|pingdom|gtmetrix|ahrefs|semrush|dotbot|mj12|dataprovider|petalbot|yandex|applebot|amazonbot|gptbot|ccbot|claudebot|bytespider/i;

export function isBot(userAgent) {
  const ua = String(userAgent || "").trim();
  if (!ua) return true; // real browsers always send a UA; blank = non-human
  return BOT_RE.test(ua);
}

// Classify where a visit came from into a channel + a named source.
// refHost = the referrer's hostname (or ""), utm = {source, medium}.
export function classifySource(refHost, utm = {}) {
  const usrc = String(utm.source || "").trim().toLowerCase();
  const umed = String(utm.medium || "").trim().toLowerCase();
  if (usrc) {
    let channel = "Referral";
    if (/cpc|ppc|paid|ads?/.test(umed)) channel = "Paid";
    else if (/social/.test(umed)) channel = "Social";
    else if (/email|newsletter/.test(umed)) channel = "Email";
    else if (/organic|search/.test(umed)) channel = "Organic Search";
    return { channel, source: usrc };
  }
  const h = String(refHost || "").trim().toLowerCase().replace(/^www\./, "");
  if (!h) return { channel: "Direct", source: "direct" };
  if (/thoughtscount\.com|thoughts-count\.netlify\.app/.test(h)) return { channel: "Internal", source: "internal" };

  const table = [
    ["Organic Search", "Google", /(^|\.)google\./],
    ["Organic Search", "Bing", /(^|\.)bing\./],
    ["Organic Search", "DuckDuckGo", /duckduckgo\./],
    ["Organic Search", "Yahoo", /(^|\.)(yahoo|search\.yahoo)\./],
    ["Organic Search", "Ecosia", /ecosia\./],
    ["Organic Search", "Brave", /search\.brave\./],
    ["AI", "ChatGPT", /chat\.openai\.com|chatgpt\.com|openai\./],
    ["AI", "Perplexity", /perplexity\./],
    ["AI", "Gemini", /gemini\.google|bard\.google/],
    ["AI", "Claude", /claude\.ai|anthropic\./],
    ["AI", "Copilot", /copilot\.microsoft|bing\.com\/chat/],
    ["AI", "You.com", /you\.com/],
    ["AI", "Poe", /poe\.com/],
    ["Social", "Facebook", /facebook\.|fb\.com|fb\.me|l\.facebook/],
    ["Social", "Instagram", /instagram\.|l\.instagram/],
    ["Social", "X/Twitter", /twitter\.|t\.co|x\.com/],
    ["Social", "Reddit", /reddit\.|redd\.it/],
    ["Social", "Pinterest", /pinterest\.|pin\.it/],
    ["Social", "TikTok", /tiktok\./],
    ["Social", "LinkedIn", /linkedin\.|lnkd\.in/],
    ["Social", "YouTube", /youtube\.|youtu\.be/],
    ["Social", "Threads", /threads\.net/],
  ];
  for (const [channel, source, re] of table) {
    if (re.test(h)) return { channel, source };
  }
  return { channel: "Referral", source: h };
}

// ---- anonymized intake classification (server-side, non-identifying) ----
const CELEBRATION = ["baby", "born", "birth", "pregn", "expecting", "wedding", "engag", "married", "marry", "promot", "new job", "new role", "graduat", "retire", "anniversar", "birthday", "housewarm", "congrat", "award", "milestone", "first day"];
const HARD = ["died", "death", "passed", "loss", "lost", "funeral", "grief", "grieving", "cancer", "diagnos", "sick", "illness", "hospice", "surgery", "hospital", "divorce", "breakup", "broke up", "split", "laid off", "layoff", "fired", "job loss", "unemploy", "miscarriage", "hard week", "hard time", "struggl", "depress", "anxiet", "burnout", "injur"];
const GRATITUDE = ["thank", "grateful", "apprecia", "just because", "thinking of you", "miss you"];

export function classifyValence(momentText) {
  const s = String(momentText || "").toLowerCase();
  if (!s.trim()) return "unspecified";
  if (HARD.some((k) => s.includes(k))) return "hard_time";
  if (CELEBRATION.some((k) => s.includes(k))) return "celebration";
  if (GRATITUDE.some((k) => s.includes(k))) return "gratitude";
  return "other";
}

// Order matters: classifyOccasion returns the FIRST matching label. Keep more-specific
// keys ahead of substrings they contain (TC-59 fixes):
//  - `birthday` MUST precede `new_baby` ("birthday" contains "birth").
//  - `anniversary` MUST precede `wedding_engagement` ("wedding anniversary" contains "wedding").
const OCCASION_MAP = [
  ["birthday", ["birthday", "turning "]],
  ["new_baby", ["baby", "born", "birth", "pregn", "expecting", "newborn"]],
  ["anniversary", ["anniversar"]],
  ["wedding_engagement", ["wedding", "engag", "married", "marry", "bride", "groom"]],
  ["new_job_promotion", ["new job", "new role", "promot", "first day", "career", "hired"]],
  ["graduation", ["graduat", "diploma", "commencement"]],
  ["retirement", ["retire"]],
  ["bereavement", ["died", "death", "passed", "loss of", "lost ", "funeral", "grief", "grieving"]],
  ["illness_diagnosis", ["cancer", "diagnos", "sick", "illness", "hospice", "surgery", "hospital", "injur"]],
  ["job_loss", ["laid off", "layoff", "fired", "job loss", "unemploy", "lost his job", "lost her job", "lost their job"]],
  ["breakup_divorce", ["divorce", "breakup", "broke up", "split"]],
  ["thank_you", ["thank", "grateful", "apprecia"]],
  ["encouragement", ["hard week", "hard time", "struggl", "depress", "anxiet", "burnout", "just because", "thinking of you"]],
];

export function classifyOccasion(momentText) {
  const s = String(momentText || "").toLowerCase();
  if (!s.trim()) return "unspecified";
  for (const [label, keys] of OCCASION_MAP) {
    if (keys.some((k) => s.includes(k))) return label;
  }
  return "other";
}

const REL_MAP = [
  ["partner", ["spouse", "husband", "wife", "partner", "boyfriend", "girlfriend", "fiance", "fianc"]],
  ["family", ["mom", "mother", "dad", "father", "sister", "brother", "son", "daughter", "parent", "grandm", "grandp", "aunt", "uncle", "cousin", "sibling", "in-law", "family", "niece", "nephew", "stepm", "stepd"]],
  ["friend", ["friend", "bestie", "buddy", "pal"]],
  ["coworker", ["coworker", "co-worker", "colleague", "boss", "employee", "teammate", "manager", "client", "work "]],
  ["neighbor_acquaintance", ["neighbor", "neighbour", "acquaintance"]],
];

export function classifyRelationship(relText) {
  const s = String(relText || "").toLowerCase();
  if (!s.trim()) return "unspecified";
  for (const [label, keys] of REL_MAP) {
    if (keys.some((k) => s.includes(k))) return label;
  }
  return "other";
}

// Coarse budget band from the free-text time/budget field. Non-identifying.
export function budgetBand(constraintsText) {
  const s = String(constraintsText || "").toLowerCase();
  if (!s.trim()) return "unspecified";
  if (/no budget|money.?s not|not about money|any amount|whatever it takes/.test(s)) return "no_limit";
  const nums = (s.match(/\$?\s?(\d{1,4})/g) || []).map((m) => parseInt(m.replace(/[^\d]/g, ""), 10)).filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return "unspecified";
  const max = Math.max(...nums);
  if (max < 25) return "under_25";
  if (max < 75) return "25_75";
  if (max < 150) return "75_150";
  return "over_150";
}

// ---- Loop 2 (TC-58): plan-quality feedback --------------------------------
// The "bucket" is the non-identifying retrieval key for a plan — the same four
// coarse labels plan_generated already logs. We derive it here so the same code
// tags a generated plan and validates a feedback echo from the browser.

export function bucketOf(a = {}) {
  return {
    occasion: classifyOccasion(a.moment),
    valence: classifyValence(a.moment),
    relationship: classifyRelationship(a.relationship),
    budget_band: budgetBand(a.constraints),
  };
}

// Valid label sets, derived from the classifier maps so they can't drift. Used to
// whitelist the bucket the browser echoes back with feedback — a client can only
// ever send one of these coarse, non-identifying labels, never free text.
export const VALID_OCCASION = new Set([...OCCASION_MAP.map((x) => x[0]), "other", "unspecified"]);
export const VALID_VALENCE = new Set(["hard_time", "celebration", "gratitude", "other", "unspecified"]);
export const VALID_RELATIONSHIP = new Set([...REL_MAP.map((x) => x[0]), "other", "unspecified"]);
export const VALID_BUDGET = new Set(["unspecified", "no_limit", "under_25", "25_75", "75_150", "over_150"]);

// The only reasons a downvote may carry. Fixed enum — never free text (TC-34 guardrail).
export const FEEDBACK_REASONS = new Set(["too_generic", "wrong_tone", "ideas_didnt_fit", "other"]);

// Keep only recognized bucket labels; drop anything else so a tampered/stale client
// can't pollute the store with arbitrary values.
export function sanitizeBucket(b = {}) {
  const pick = (set, v) => (set.has(v) ? v : undefined);
  const out = {
    occasion: pick(VALID_OCCASION, b.occasion),
    valence: pick(VALID_VALENCE, b.valence),
    relationship: pick(VALID_RELATIONSHIP, b.relationship),
    budget_band: pick(VALID_BUDGET, b.budget_band),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
