// Thoughts Count — background action-plan generator (Netlify v2 background function).
//
// Why a background function: a full personalized plan takes ~25-35s for the model to
// write. Netlify's synchronous functions time out at 26s (10s for streaming), so a
// normal request would fail on a live/shared link. Background functions run up to
// 15 minutes. The client kicks this off, then polls /api/plan for the result.
//
// Security model: the Anthropic API key lives ONLY here, server-side, read from the
// ANTHROPIC_API_KEY environment variable. It is never sent to the browser and can't
// be recovered by anyone the link is shared with.

import { getStore } from "@netlify/blobs";
import { logEvent, bucketOf } from "./_analytics.mjs";
import { getExemplars, buildExemplarBlock } from "./_exemplars.mjs";
import { herIdentity, HER_CHARACTER } from "./_persona.mjs";

export const MODEL = "claude-sonnet-4-6";
export const MAX_OUTPUT_TOKENS = 1800; // cost + latency guard

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    plan_title: { type: "string", description: "A short 3-6 word label for saving this plan, leading with the person's NAME if one was given, then the occasion. E.g. 'Todd Hudgens, new job', 'Mom, cancer diagnosis', 'Sarah, new baby'. If no name was given, use the relationship, e.g. 'A coworker, new job'. No quotes, no 'Thoughts Count' prefix." },
    headline: { type: "string", description: "One warm, human sentence naming the heart of THIS moment for THIS relationship. Not generic. No greeting-card cliches." },
    what_matters_most: { type: "string", description: "2-3 sentences on what this person most needs right now and the one thing to get right. Grounded in the specifics shared." },
    what_to_say: { type: "array", description: "2-3 real sentences they could actually say or write, in the user's authentic voice.", items: { type: "string" } },
    what_not_to_say: { type: "array", description: "2-3 well-meaning things to AVOID, each with a brief why.", items: { type: "string" } },
    thoughtful_actions: {
      type: "array",
      description: "3-4 concrete ideas fitted to the relationship, budget, and time. A gift is only one option among many (note, meal, showing up, a specific act). Range from free/small to larger.",
      items: {
        type: "object",
        properties: {
          action: { type: "string" },
          why_it_fits: { type: "string" },
          effort: { type: "string", description: "e.g. '5 minutes', 'an afternoon'" },
          approx_cost: { type: "string", description: "e.g. 'Free', '$0-20'. Respect the stated budget." },
        },
        required: ["action", "why_it_fits", "effort", "approx_cost"],
      },
    },
    spend_guidance: { type: "string", description: "1-2 sentences on how much to spend (if anything) for THIS relationship. It's fine to say money isn't the point." },
    gift_ideas: {
      type: "array",
      description: "0-3 specific gift ideas, INCLUDED ONLY WHEN a physical gift genuinely fits this moment and relationship. Favor unique / boutique / artisan / handmade over big-box. Respect the budget. A gift is only ever one option among many — return an empty array if a purchase isn't the right response.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "The specific gift, e.g. 'Hand-poured soy candle in a calming scent'." },
          blurb: { type: "string", description: "One short sentence on what it is / why it's lovely." },
          why_it_fits: { type: "string", description: "One sentence tying it to this person and moment." },
          price_range: { type: "string", description: "e.g. '$30–45'. Respect the stated budget." },
          category: { type: "string", enum: ["flowers","candle","food_drink","book","plant","self_care","stationery","keepsake","cozy","experience","donation","gift_card","other"], description: "Best-fit category, used to show a matching illustration. Use 'gift_card' for a gift-card idea." },
          locality: { type: "string", enum: ["online","local"], description: "'local' ONLY if a location was provided AND this idea is best sourced from a nearby business (a florist, bakery, plant nursery, comfort-meal restaurant, coffee shop, or a gift card to one of those). Otherwise 'online'." },
          search_query: { type: "string", description: "For 'online': 2-5 words to find one on a boutique marketplace, e.g. 'hand poured soy candle'. For 'local': the TYPE of nearby business to search, e.g. 'florist', 'bakery', 'coffee shop', 'bookstore' (do NOT invent a specific business name). For a local gift_card, use the business type whose card they'd love, e.g. 'coffee shop', 'restaurant', 'bookstore'." },
        },
        required: ["title", "blurb", "why_it_fits", "price_range", "category", "locality", "search_query"],
      },
    },
    follow_up: {
      type: "array",
      description: "OPTIONAL later gestures, included ONLY when a specific future moment genuinely calls for one. Often the right answer is an EMPTY array (no future follow-up needed) — that is a normal, common, correct outcome, not a gap. When a follow-up IS included, its timing must come from THIS situation's real calendar (the hard first week after a loss, the one-month mark, a due date, an interview or procedure day, an anniversary), never a default interval and never a reflexive two-week check-in. Zero is common, one is typical when a real later moment exists, more than one only when the situation truly has several. Do NOT manufacture a follow-up to fill this array.",
      items: {
        type: "object",
        properties: {
          when: { type: "string", description: "Human label for the timing, tied to a REAL moment in this situation, e.g. 'The morning of the surgery', 'A week after the funeral, when the casseroles stop', 'On the baby's due date', 'The one-year mark'. Never a generic interval like 'In two weeks'." },
          gesture: { type: "string" },
          days_from_now: { type: "integer", description: "Whole number of days from today when this follow-up should happen, so a calendar reminder can be set. Derive it from the real moment in 'when' (must match 'when'); do NOT default to 14." },
        },
        required: ["when", "gesture", "days_from_now"],
      },
    },
    closing_encouragement: { type: "string", description: "One or two sentences reassuring the user that they're already being a good friend by caring enough to think this through." },
  },
  required: ["plan_title", "headline", "what_matters_most", "what_to_say", "what_not_to_say", "thoughtful_actions", "spend_guidance", "gift_ideas", "follow_up", "closing_encouragement"],
};

export const SYSTEM_PROMPT = `${herIdentity()}

You are NOT a gift website, a greeting-card writer, or a generic chatbot. You are a thoughtful, emotionally intelligent guide. The person talking to you cares deeply and is a little afraid of getting it wrong. Your job is to replace their uncertainty with confidence.

Who you are (let this shape your voice, never state it): ${HER_CHARACTER}

Principles:
- Meet the real emotional weight of the moment. A death is not a promotion. Match your tone to what happened.
- Be specific to the details shared about this person and relationship. Never generic. Use any detail they mention (a hobby, a fear, a history). If their name is given, use it naturally where it warms the plan; if no name is given, never invent one.
- A gift is only ONE possible answer, and often not the best one. Sometimes the right move is a handwritten note, a meal, a specific act of help, or simply showing up. Honor "sometimes it's simply showing up."
- Respect the relationship's closeness. What's right for a spouse is wrong for a coworker.
- Respect the stated budget and time. Never push spending they didn't signal. It's okay to say money isn't the point.
- Be warm and human, never saccharine or clinical. Give them better words than "sorry for your loss."
- Write like a real person texting, not a document. The lines in "what to say" — and any wording the user will copy and send as their own — must look hand-typed: use plain punctuation only. NO em-dashes or en-dashes (use a comma, a period, or two short sentences instead), straight quotes and apostrophes only (never curly "smart" quotes), three plain dots for any ellipsis, and normal single spacing. Nothing that looks auto-generated.
- Be concise. Each field is 1-3 sentences or 2-4 short items — quality over volume.
- Follow-ups are OPTIONAL, not expected. Include a later follow-up ONLY when a specific future moment in THIS situation genuinely calls for one. Very often the right answer is NONE — return an empty follow_up array, and treat that as a normal, common, correct outcome, not a missing piece. Never add a follow-up just to have one.
- When you DO include a follow-up, the timing is SITUATIONAL and specific — pulled from the real calendar of this moment, and varied. Anchor it to something true: the hard first week after a loss when everyone else has moved on, the one-month mark, a due date, the day of an interview or a procedure, when a new parent resurfaces, a birthday or an anniversary. NEVER a default interval, and specifically NEVER a reflexive "in two weeks" check-in. Set days_from_now from that real moment, not from a habit of 14.
  Examples of good judgment: a friend's parent died -> a gentle note in the hard week AFTER the funeral (say ~10 days) when the casseroles stop, maybe nothing more. A coworker had a baby -> often no scheduled follow-up at all (a warm note now is enough); if anything, a check-in a few weeks in when the first help fades. A big promotion -> usually NO follow-up; the moment is the moment. A friend's minor surgery -> a text the morning OF the procedure, or the day after. A milestone birthday -> the day itself, nothing after. A divorce -> maybe a quiet check-in a month or two out when the dust settles, or none. Let the situation decide; sometimes zero, sometimes one, rarely more.
- Gift ideas: suggest them only when a physical gift truly fits. Favor unique, boutique, artisan, or handmade — not Amazon/Walmart/big-box unless a tight budget makes that the kind choice. Never let gifts overshadow the non-purchase gestures; a gift is one option among many, and often not the best one.
- Local ideas: when a location (city or ZIP) is provided AND a physical gift genuinely fits this moment, INCLUDE at least one LOCAL idea (locality "local") — flowers from a nearby florist, a treat from a local bakery, a plant from a neighborhood nursery, a comfort meal from a nearby restaurant, coffee from a neighborhood shop. Local gestures feel more personal and are the payoff for the user sharing a location, so lean into them. NEVER invent a specific business name or address — only name the TYPE of place; the app builds the "near them" map search. Mix local and online ideas as fits, but don't manufacture a gift where showing up or a note is the better answer.
- Gift cards (category "gift_card"): offer one ONLY as a single option when choosing a specific item is genuinely hard to get right — the recipient is far away, their taste is uncertain, time is very short, or letting them choose is the kindest move. HARD LIMIT: at most ONE gift_card idea in the whole plan, and never the only idea. A gift card to a NEARBY business they'd love — their neighborhood coffee shop, a favorite-type restaurant, a local bookstore — is far more thoughtful than a generic one; strongly prefer a local gift_card (locality "local") when a location is provided. For a local gift_card, the title should name the kind of place (e.g. "A gift card to a cozy local coffee shop"). For an ONLINE gift_card (no location), keep the title generic and warm (e.g. "A gift card so they can pick something they'll love") — do NOT name a specific card brand (never Visa, Amazon, Airbnb, Target, etc.); the app presents a couple of tasteful options. Keep gift cards personal, never big-box/national/transactional. NEVER suggest a gift card for grief, death, illness, or sympathy — there it reads as cold.

Always respond by calling the generate_action_plan tool. Never respond with plain text.`;

export default async (req) => {
  const store = getStore("plans");
  let jobId;

  try {
    const body = await req.json();
    jobId = body?.jobId;
    if (!jobId) return new Response("missing jobId", { status: 400 });

    const userMessage = buildUserMessage(body?.answers || {});
    if (!userMessage) {
      await store.setJSON(jobId, { status: "error", error: "Please tell us a little about the moment first." });
      return new Response("ok", { status: 202 });
    }

    // Classify the intake to its non-identifying bucket BEFORE the call so we can retrieve
    // curated craft exemplars for this kind of moment (TC-59) and inject them as few-shot
    // guidance. `a`/`bucket` are reused below for storage + analytics. No exemplars for a
    // bucket → empty block → the call is byte-identical to before (no regression).
    const a = body?.answers || {};
    const bucket = bucketOf(a);
    const exemplars = getExemplars(bucket);
    const system = SYSTEM_PROMPT + buildExemplarBlock(exemplars);

    const apiKey =
      (typeof Netlify !== "undefined" && Netlify.env?.get("ANTHROPIC_API_KEY")) ||
      process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await store.setJSON(jobId, { status: "error", error: "The server isn't configured yet (missing ANTHROPIC_API_KEY)." });
      return new Response("ok", { status: 202 });
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        tools: [{ name: "generate_action_plan", description: "Return a complete, personalized action plan for showing up in this moment.", input_schema: PLAN_SCHEMA }],
        tool_choice: { type: "tool", name: "generate_action_plan" },
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!res.ok) {
      const detail = await safeText(res);
      console.error("Anthropic API error", res.status, detail);
      await store.setJSON(jobId, { status: "error", error: "We couldn't generate a plan right now. Please try again in a moment." });
      return new Response("ok", { status: 202 });
    }

    const data = await res.json();
    const toolUse = (data.content || []).find((b) => b.type === "tool_use");
    if (!toolUse) {
      await store.setJSON(jobId, { status: "error", error: "We couldn't generate a plan right now. Please try again." });
      return new Response("ok", { status: 202 });
    }

    // Resolve "local" gift ideas into real nearby businesses (name, photo, map link).
    const location = (body?.answers?.location || "").trim();
    const placesKey =
      (typeof Netlify !== "undefined" && Netlify.env?.get("GOOGLE_PLACES_KEY")) ||
      process.env.GOOGLE_PLACES_KEY;
    if (location && placesKey) {
      await enrichLocalIdeas(toolUse.input, location, placesKey);
    }

    // Resolve "online" gift ideas into a real product (photo + direct buy link):
    // Etsy first (boutique/handmade), then Google Shopping as a fallback with all
    // big-box / national retailers filtered out. Falls back to an Etsy search link.
    const etsyKey = env("ETSY_API_KEY");
    const shoppingKey = env("SEARCHAPI_KEY");
    if (etsyKey || shoppingKey) {
      await enrichOnlineIdeas(toolUse.input, etsyKey, shoppingKey);
    }

    // TC-83: the copy the user pastes and sends as their OWN words must read hand-typed,
    // not auto-generated. The model still slips in em-dashes / curly quotes / odd spacing
    // even when prompted not to, so normalize the plan's prose to plain, human punctuation
    // before we store it (this also cleans the emailed copy, which reads the stored plan).
    // Runs AFTER enrichment so it never touches the search_query the lookups depend on;
    // URL / image / enum fields are skipped so links and categories stay byte-exact.
    try { humanizePlan(toolUse.input); } catch (e) { console.error("humanize failed", e); }

    // The plan's non-identifying bucket (occasion/valence/relationship/budget) — computed
    // above for craft-exemplar retrieval (TC-59) — is stored with the plan so the browser
    // can echo it back with feedback (TC-58) without ever re-sending raw story text.
    await store.setJSON(jobId, { status: "done", plan: toolUse.input, bucket });

    // Anonymized "what people need" signal — buckets only, never raw text/names.
    try {
      const gifts = Array.isArray(toolUse.input?.gift_ideas) ? toolUse.input.gift_ideas : [];
      await logEvent("plan_generated", {
        sid: (body?.sid || "").toString().slice(0, 40),
        ...bucket,
        has_location: !!(a.location || "").trim(),
        gift_fit: gifts.length > 0,
        gift_count: gifts.length,
        followups: Array.isArray(toolUse.input?.follow_up) ? toolUse.input.follow_up.length : 0,
        exemplars_used: !!exemplars, // TC-59 coverage: did this bucket have craft exemplars?
      }, { test: !!body?.test });
    } catch (e) { console.error("plan analytics failed", e); }

    return new Response("ok", { status: 202 });
  } catch (err) {
    console.error("generate-background error", err);
    try { if (jobId) await store.setJSON(jobId, { status: "error", error: "Something went wrong reaching our guide. Please try again." }); } catch {}
    return new Response("error", { status: 202 });
  }
};

export function buildUserMessage(a) {
  const moment = (a?.moment || "").trim();
  const relationship = (a?.relationship || "").trim();
  const name = (a?.name || "").trim();
  const about = (a?.about || "").trim();
  const voice = (a?.voice || "").trim();
  const constraints = (a?.constraints || "").trim();
  const location = (a?.location || "").trim();
  // The saved person's remembered memory (TC-49) — durable things the user noticed over time
  // (e.g. "allergic to shellfish", "loves hiking"). These must genuinely shape the plan.
  const facts = Array.isArray(a?.facts) ? a.facts.map((f) => String(f || "").trim()).filter(Boolean) : [];
  // TC-66 Phase 3a: a compact digest of what was suggested for this person before, so the
  // plan builds on prior plans instead of repeating them. Optional; absent → no change.
  const priorPlans = (a?.priorPlans || "").trim();
  if (!moment && !about && !facts.length) return null;
  const lines = [
    "Here is what I'm navigating. Please build me a complete action plan.",
    "",
    `WHAT HAPPENED: ${moment || "(not specified)"}`,
    `THEIR NAME: ${name || "(not specified — don't invent one)"}`,
    `WHO THIS PERSON IS TO ME: ${relationship || "(not specified)"}`,
    `ABOUT THEM / OUR RELATIONSHIP: ${about || "(not specified)"}`,
  ];
  if (facts.length) {
    lines.push(
      "WHAT I'VE NOTICED / THEY'VE SHARED (remembered over time — use these to make it truly personal):",
      ...facts.map((f) => `- ${f}`),
    );
  }
  if (priorPlans) {
    lines.push(
      "ALREADY SUGGESTED FOR THIS PERSON BEFORE (do NOT repeat these; build on them and go somewhere new):",
      priorPlans,
    );
  }
  lines.push(
    `WHAT FEELS AUTHENTIC TO ME: ${voice || "(not specified)"}`,
    `MY TIME & BUDGET: ${constraints || "(not specified)"}`,
    `THEIR AREA (for local ideas): ${location || "(not specified)"}`,
  );
  return lines.join("\n");
}

async function safeText(res) {
  try { return await res.text(); } catch { return "(no body)"; }
}

// TC-83: make one string read as if a person typed it on their phone. Strips the
// typographic "AI tells" that stop copy/paste from feeling authentic and human:
//   • curly/smart quotes + apostrophes → straight
//   • the ellipsis character → three plain dots
//   • number ranges joined by an en/em dash ("$30–45", "2 – 3") → a hyphen
//   • tight word compounds joined by an en-dash ("state–of–the–art") → a hyphen
//   • any other em/en dash (prose asides, usually spaced) → a comma, the most natural
//     hand-typed substitute; doubled commas from the swap are then collapsed
//   • non-breaking / thin / other unicode spaces → a normal space; runs of spaces → one
//   • a stray space left before punctuation → removed
export function humanizeText(s) {
  if (typeof s !== "string" || !s) return s;
  let t = s;
  // Strip Markdown emphasis/code the model sometimes emits — it renders as literal
  // *asterisks* / _underscores_ / `backticks`, an AI-tell in both her chat lines and plans.
  // Keep the word, drop the markers. Paired-only, and underscore is word-boundary safe so
  // it never touches identifiers like health_status.
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");                 // **bold**
  t = t.replace(/\*([^*\n]+)\*/g, "$1");                   // *italic*
  t = t.replace(/__([^_]+)__/g, "$1");                     // __bold__
  t = t.replace(/(?<![\w`])_([^_\n]+)_(?![\w])/g, "$1");   // _italic_
  t = t.replace(/`([^`\n]+)`/g, "$1");                     // `code`
  t = t.replace(/[‘’‚‛]/g, "'");        // ' ' ‚ ‛ → '
  t = t.replace(/[“”„‟]/g, '"');        // " " „ ‟ → "
  t = t.replace(/…/g, "...");                            // … → ...
  t = t.replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2");   // 30–45 → 30-45
  t = t.replace(/([A-Za-z])–([A-Za-z])/g, "$1-$2");     // word–word → word-word
  t = t.replace(/\s*[–—]+\s*/g, ", ");              // prose — aside → , aside
  t = t.replace(/[       ]/g, " "); // odd spaces → space
  t = t.replace(/,\s*,/g, ",");                               // ", ," → ","  (from the dash swap)
  t = t.replace(/[ \t]{2,}/g, " ");                          // collapse runs of spaces
  t = t.replace(/\s+([,.;:!?])/g, "$1");                     // no space before punctuation
  return t.trim();
}

// Keys whose string values must stay byte-exact — search terms the lookups use, display
// enums, and anything URL/image-shaped — so humanizing never mangles a link or a category.
const NO_HUMANIZE_KEYS = new Set([
  "search_query", "category", "locality", "url", "image", "mapsUri", "website",
  "photoName", "source", "merchant", "price", "address",
]);

// Walk the plan and humanize every prose string in place (arrays + nested objects),
// skipping the machine/URL fields above. Mutates and returns the same object.
function humanizePlan(node) {
  if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) node[i] = humanizePlan(node[i]); return node; }
  if (node && typeof node === "object") {
    for (const k of Object.keys(node)) {
      if (NO_HUMANIZE_KEYS.has(k)) continue;
      node[k] = humanizePlan(node[k]);
    }
    return node;
  }
  if (typeof node === "string") return humanizeText(node);
  return node;
}

function env(name) {
  return (typeof Netlify !== "undefined" && Netlify.env?.get(name)) || process.env[name];
}

// Big-box / national retailers to exclude from the Google Shopping fallback, so a
// fallback product still feels boutique (per the brand's "artisan, not big-box" rule).
const BIG_BOX = [
  "amazon", "walmart", "target", "best buy", "bestbuy", "ebay", "wayfair", "kohl", "macy",
  "costco", "sam's club", "samsclub", "aliexpress", "temu", "wish", "overstock", "ikea",
  "home depot", "homedepot", "lowe", "cvs", "walgreens", "michaels", "hobby lobby", "hobbylobby",
  "barnes", "nordstrom", "kmart", "sears", "newegg", "alibaba", "shein", "dollar general",
  "dollar tree", "dollartree", "bed bath", "bedbath", "williams sonoma", "crate", "pottery barn",
  "potterybarn", "anthropologie", "urban outfitters", "west elm", "world market", "container store",
  "staples", "office depot", "petco", "petsmart", "gamestop", "chewy", "qvc", "etsy",
];

function isBigBox(merchant, link) {
  const m = String(merchant || "").toLowerCase();
  const l = String(link || "").toLowerCase();
  return BIG_BOX.some((b) => m.includes(b) || l.includes(b.replace(/[^a-z]/g, "")));
}

// Pick a random item from the top `n` of an array — adds variety so the same idea
// phrase doesn't always surface the identical product.
function pickVaried(arr, n) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * Math.min(n, arr.length))];
}

// A stable identity for a resolved place, so the same business can't be attached to
// two different gift ideas in one plan (e.g. a "coffee shop" idea and a "gift card to
// a cafe" idea both landing on the same shop, which reads as a glitch).
function placeKey(p) {
  return p.id || `${p.displayName?.text || ""}|${p.formattedAddress || ""}`;
}

// From up to a handful of Google Places matches, pick the *loved* one — not just
// Google's top relevance hit. A Bayesian average pulls thinly-reviewed shops toward
// a neutral prior so a 5.0 with 3 reviews can't beat a 4.6 with 400. Prefer places
// clearing a basic quality floor; if none do, still return the best available
// (better a real business than nothing — the client has a map-search fallback too).
// `used` (optional Set) holds place keys already attached to another idea; we skip
// them and take the next-best distinct business, so two tiles never show the same shop.
function pickBestPlace(places, used) {
  if (!Array.isArray(places) || !places.length) return null;
  const PRIOR_MEAN = 4.2, PRIOR_WEIGHT = 20;
  const scored = places.map((p) => {
    const r = typeof p.rating === "number" ? p.rating : null;
    const c = typeof p.userRatingCount === "number" ? p.userRatingCount : 0;
    const score = r == null ? 0 : (r * c + PRIOR_MEAN * PRIOR_WEIGHT) / (c + PRIOR_WEIGHT);
    return { p, r, c, score };
  });
  const qualified = scored.filter((s) => s.r != null && s.r >= 4.0 && s.c >= 15);
  const pool = qualified.length ? qualified : scored;
  pool.sort((a, b) => b.score - a.score);
  for (const s of pool) {
    if (used && used.has(placeKey(s.p))) continue;
    if (used) used.add(placeKey(s.p));
    return s.p;
  }
  return null; // every good match is already used elsewhere → let the map-search fallback show
}

// For each "online" gift idea, attach a real product (photo, price, direct link).
async function enrichOnlineIdeas(plan, etsyKey, shoppingKey) {
  if (!plan || !Array.isArray(plan.gift_ideas)) return;
  // Gift cards are resolved differently (local business or a curated chooser in the
  // client) — never attach a random marketplace product to a gift-card idea.
  const online = plan.gift_ideas.filter((g) => g.locality !== "local" && g.category !== "gift_card").slice(0, 3);
  for (const g of online) {
    const q = (g.search_query || g.title || "").trim();
    if (!q) continue;
    // TC-79: don't pin a specific product to a BESPOKE/composed gift idea (a custom
    // gesture — "letterpress card + a scratch-off ticket tucked inside", a handwritten
    // note, a DIY kit — that no single real listing actually matches). Any listing we'd
    // attach mismatches the concept (the live repro: a new-job card idea linked to a box
    // of holiday cards). Skip enrichment → the client falls back to the illustration tile
    // + "find one like this →" search link. Only concrete single-item ideas get a product.
    if (isBespokeIdea(g)) continue;
    let product = null;
    // Pass the whole idea so the resolver can confirm the found listing plausibly
    // matches THIS described gift (title + price) before we ever show its photo (TC-69).
    if (etsyKey) { try { product = await etsyLookup(q, etsyKey, g); } catch (e) { console.error("etsy lookup failed", e); } }
    // Pass the whole idea so the shopping fallback can confirm the found listing plausibly
    // matches THIS described gift (keyword/kind/price) before we show its photo (TC-77).
    if (!product && shoppingKey) { try { product = await shoppingLookup(q, shoppingKey, g); } catch (e) { console.error("shopping lookup failed", e); } }
    if (product && product.image && product.url) g.product = product;
  }
}

// TC-69 confidence guard. Etsy keyword search returns loosely-related listings, so a
// "thank-you sticker set" can surface for "artisan snack bundle" and its $5.98 price
// then renders under the described gift — a trust-breaker (wrong photo AND wrong price).
// Before attaching a listing's photo/price we require it to plausibly match the idea:
//   1) meaningful keyword overlap between the idea and the listing title, and
//   2) not obviously the wrong KIND of product (a digital/printable/sticker/card item
//      when the idea describes a physical good), and
//   3) not implausibly cheap for the described physical item.
// A listing that fails is dropped (we return null → the client shows the Etsy search
// link instead). Better no photo than a mismatched one.
const STOPWORDS = new Set(["a","an","and","or","the","for","with","of","to","in","on","gift","set","idea","them","their","present","by","from"]);
// TC-79: generic filler that describes the FORMAT/packaging of a gift, not WHICH gift it is.
// Keyword overlap satisfied only by these can't confirm a match — the live repro passed the
// TC-69 guard purely on "letterpress"/"card" while the theme (new-job gesture) was wrong.
// These are stripped from the DISTINCTIVE-token comparison (they stay searchable elsewhere).
const FILLER = new Set(["letterpress","card","cards","set","sets","holiday","artisan","gift","gifts","box","boxed","pack","packs","packed","handmade","bundle","bundled","kit","kits","assorted","pcs","piece","pieces","personalized","custom","note"]);
// Words that mark a listing as a different KIND of thing than a physical, giftable object.
const WRONG_KIND = ["digital","download","downloadable","printable","print at home","print-at-home","svg","png file","clip art","clipart","template","sticker","stickers","decal","greeting card","thank you card","card set","note card","postcard","pdf","instant download"];
function tokenize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}
// TC-79: distinctive tokens only — drop generic filler so overlap must be on a
// theme-bearing word (e.g. "candle", "succulent"), not "card"/"set"/"gift".
function distinctiveTokens(s) {
  return tokenize(s).filter((w) => !FILLER.has(w));
}
// TC-79: is this gift idea a BESPOKE / composed gesture rather than ONE literally-shoppable
// item? Such ideas (a card + a tucked-in ticket, a handwritten-note pairing, a DIY kit) have
// no single real listing that matches, so pinning a product always mismatches. Conservative
// but biased toward NOT pinning when the text clearly describes a combination or a custom act.
// Signals in the idea's own text (title/blurb/search_query):
//   • an explicit combination joiner: " + ", "＋", "X and a Y" (two distinct items). We do
//     NOT treat a bare "X with a Y" as combo — that also describes a single decorated item
//     ("candle with a wooden wick", "notebook with a fun design"), which should still resolve.
//   • an enumerated set of items: "X, Y, and Z" / "X, Y and a Z" (a comma-listed collection,
//     e.g. "fun pens, sticky notes, and a small notepad" — a curated multi-item set no single
//     listing matches). Requires a comma so single items ("Blue, cream mug") aren't caught.
//   • a curated COLLECTION paired with a second item: "…set/kit/basket/bundle/box/package…
//     with/and a …" ("tea set with a handmade mug", "care package with a candle").
//   • "tucked inside" / "tucked in"
//   • a personal message: "with a note", "a note that says", "note reading", "handwritten",
//     "monogrammed", "personalized message", a custom/personalized inscription
//   • DIY / make-it-yourself: "DIY", "make", "homemade", "hand-make"
// A literal "+" / "＋" joiner ("card + ticket") is an unambiguous composition marker even
// inside prose, so it stays scanned across ALL fields (incl. blurb). The comma/"and"-list
// heuristics below are prose-tripping and get scoped to title+search_query only.
const PLUS_JOIN_RE = /\s(?:\+|＋)\s/;
const COMBO_JOIN_RE = /\s(?:\+|＋)\s|\b\w+\s+(?:and|plus)\s+a\s+\w+|,[^,]*\s+and\s+\w+/i;
// A curated collection ("…set/kit/basket/bundle/box/care package…") plus a second item.
const COLLECTION_COMBO_RE = /\b(?:set|kit|basket|bundle|box|package|assortment|sampler)\b[^.]*?\b(?:with|and|plus)\s+a\s+\w+/i;
const BESPOKE_PHRASES = [
  "tucked inside", "tucked in", "tucked into",
  "with a note", "a note that says", "note that says", "note reading", "note saying",
  "handwritten", "hand-written", "hand written", "monogrammed", "monogram",
  "personalized message", "personalised message", "custom message", "custom note",
  "homemade", "hand-make", "hand make", "make your own", "diy",
];
function isBespokeIdea(idea) {
  // STRONG bespoke signals scan ALL fields incl. the blurb — a personal message, a
  // "tucked inside", a DIY gesture, or a literal "+" is a true bespoke marker wherever
  // it appears ("peace lily … with a heartfelt note tucked in" in prose must be caught).
  const text = `${idea?.title || ""} ${idea?.blurb || ""} ${idea?.search_query || ""}`.toLowerCase();
  if (!text.trim()) return false;
  if (BESPOKE_PHRASES.some((p) => text.includes(p))) return true;
  // "make" as a verb/instruction (a homemade gesture), not "makeup"/"homemaker" substrings.
  if (/\bmake\b/.test(text) && !/\bmakes\b/.test(text)) return true;
  // A literal "+" joiner is an unambiguous composition marker — keep reading all fields.
  if (PLUS_JOIN_RE.test(text)) return true;
  // TC-79 refine: the COMBINATION/COLLECTION heuristics ("X and a Y", "A, B, and Z" list
  // joins, collection-word + second item) rely on comma/"and" list grammar that ordinary
  // prose trips constantly ("beautiful, low-maintenance, and personal"). Restrict those to
  // the TITLE + SEARCH_QUERY (terse, structured fields), NOT the free-text blurb — a blurb's
  // comma list is almost always descriptive adjectives, not a two-item gift.
  const structured = `${idea?.title || ""} ${idea?.search_query || ""}`.toLowerCase();
  if (COMBO_JOIN_RE.test(structured)) return true;
  if (COLLECTION_COMBO_RE.test(structured)) return true;
  return false;
}
function priceValue(it) {
  if (it && it.price && it.price.amount != null) return Number(it.price.amount) / Number(it.price.divisor || 100);
  return null;
}
// Parse a dollar figure out of a free-text price string ("$413.00", "$30–45",
// "From $12.99") → a Number, or null. For a range we take the LOW end (the most
// charitable read — a listing is only rejected as "too pricey" if even its floor
// blows past the budget). Strips thousands separators so "$1,299" reads as 1299.
function parsePrice(s) {
  const m = String(s || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
// Words that mark a listing as a BULK / wholesale lot rather than the single ordinary
// gift the plan described — the TC-77 repro was a "25+ Copies… $413.00" book listing
// surfacing for a single-book idea. "pack of N"/"lot of"/"case of"/"set of N" and a bare
// "N+ copies/pack/count" quantity prefix all read as wholesale, not a giftable single item.
const BULK_KIND = ["wholesale", "bulk", "case of", "lot of", "carton", "pallet", "in bulk", "resale", "for resale"];
const BULK_RE = /\b(\d{2,}\+?\s*(?:copies|copy|pack|packs|count|ct|pcs|pieces|units|bulk)|(?:pack|lot|case|box|set|carton)\s*of\s*\d{2,}|\d{2,}\s*(?:pack|pk|count|ct)\b)/i;
function isBulkListing(title) {
  const tl = String(title || "").toLowerCase();
  if (BULK_KIND.some((b) => tl.includes(b))) return true;
  return BULK_RE.test(tl);
}
// Returns true if this Etsy listing plausibly matches the described gift idea.
function etsyListingMatches(it, idea) {
  const title = String(it.title || "");
  const tl = title.toLowerCase();
  // 2) Wrong KIND of product (a digital/printable/card item posing as a physical gift).
  const ideaText = `${idea?.title || ""} ${idea?.blurb || ""} ${idea?.search_query || ""}`.toLowerCase();
  for (const bad of WRONG_KIND) {
    if (tl.includes(bad) && !ideaText.includes(bad)) return false;
  }
  // 3) Implausibly cheap for a described physical item → almost certainly a mismatch
  //    (stickers/prints/digital), not the artisan good the plan described.
  const price = priceValue(it);
  if (price != null) {
    if (price < 8) return false;
    // TC-80: upper-bound sanity — mirror the TC-77 Shopping ceiling. A baby journal
    // resolved at $597,286 and would render a buy link; reject a listing running FAR
    // above the described budget (2.5× the idea's band high end, else a $250 everyday
    // cap). Reuses parsePriceHigh; null-safe (a missing/odd price never throws or blocks).
    const rangeHigh = parsePriceHigh(idea?.price_range);
    const ceiling = rangeHigh != null ? rangeHigh * 2.5 : 250;
    if (price > ceiling) return false;
  }
  // 1) Keyword overlap: at least one DISTINCTIVE, idea-specific token must appear in the
  //    listing title. We compare against the idea's own words (title/blurb), not just the
  //    broad search query, so a generic query can't rubber-stamp an off-topic listing.
  //    TC-79: overlap must be on a theme-bearing token, not generic filler like
  //    "letterpress"/"card"/"set" — that filler is what let a holiday-card box match a
  //    new-job card idea. distinctiveTokens strips the filler stoplist first.
  const ideaTokens = new Set([...distinctiveTokens(idea?.title), ...distinctiveTokens(idea?.search_query), ...distinctiveTokens(idea?.blurb)]);
  if (!ideaTokens.size) return true; // nothing distinctive to check against → don't block
  const titleTokens = new Set(distinctiveTokens(title));
  for (const t of ideaTokens) { if (titleTokens.has(t)) return true; }
  return false; // no shared distinctive keyword → treat as a mismatch, drop it
}

// TC-77 confidence guard for the Google Shopping FALLBACK — the same discipline TC-69
// gave the Etsy path, adapted to the shopping result shape ({ title, price: "$413.00" }).
// When a correct Etsy match is rejected we fall through to Shopping, which likewise
// returns loosely-related hits: a single-book gift idea surfaced a "25+ Copies… $413.00"
// bulk/wholesale listing. Before attaching one we require it to plausibly match the idea:
//   1) meaningful keyword overlap between the idea and the listing title,
//   2) not the wrong KIND — a digital/printable/card item (WRONG_KIND) OR a bulk/wholesale
//      lot (isBulkListing) when the idea describes a single ordinary gift, and
//   3) price sanity — not implausibly cheap for a physical item (same <$8 rule) AND not
//      wildly above what the idea described (the $413 book). We derive a ceiling from the
//      idea's own price_range when present, else fall back to an everyday-gift cap.
// A listing that fails is dropped → the client shows the search-link tile. Better no
// photo than a mismatched one.
function shoppingResultMatches(it, idea) {
  const title = String(it?.title || "");
  const tl = title.toLowerCase();
  const ideaText = `${idea?.title || ""} ${idea?.blurb || ""} ${idea?.search_query || ""}`.toLowerCase();
  // 2) Wrong KIND — digital/printable/card posing as a physical gift…
  for (const bad of WRONG_KIND) {
    if (tl.includes(bad) && !ideaText.includes(bad)) return false;
  }
  //    …or a bulk/wholesale lot when the idea describes a single ordinary gift.
  if (isBulkListing(title) && !/\b(bulk|wholesale|pack|lot|case|dozen)\b/.test(ideaText)) return false;
  // 3) Price sanity. Shopping prices are free-text strings ("$413.00", "$30–45").
  const price = parsePrice(it?.price);
  if (price != null) {
    if (price < 8) return false; // implausibly cheap for a physical good → likely a mismatch
    // Upper bound: prefer the idea's own budget band. Reject only when the listing runs
    // FAR above it (2.5× the band's high end) so normal price scatter isn't over-filtered.
    // With no stated band, cap everyday gifts at $250 — well above a boutique gift, well
    // below the $413 bulk-book outlier this guard exists to reject. Null-safe throughout.
    const rangeHigh = parsePriceHigh(idea?.price_range);
    const ceiling = rangeHigh != null ? rangeHigh * 2.5 : 250;
    if (price > ceiling) return false;
  }
  // 1) Keyword overlap — at least one DISTINCTIVE, idea-specific token in the listing title.
  //    TC-79: strip generic filler ("card"/"set"/"gift"…) so overlap must be on a
  //    theme-bearing token, never generic vocabulary alone.
  const ideaTokens = new Set([...distinctiveTokens(idea?.title), ...distinctiveTokens(idea?.search_query), ...distinctiveTokens(idea?.blurb)]);
  if (!ideaTokens.size) return true; // nothing distinctive to check against → don't block
  const titleTokens = new Set(distinctiveTokens(title));
  for (const t of ideaTokens) { if (titleTokens.has(t)) return true; }
  return false; // no shared distinctive keyword → treat as a mismatch, drop it
}
// The HIGH end of an idea's price band ("$30–45" → 45, "$30" → 30), for the ceiling above.
function parsePriceHigh(s) {
  const nums = String(s || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return null;
  return Number(nums[nums.length - 1]);
}

async function etsyLookup(query, key, idea) {
  const url = `https://openapi.etsy.com/v3/application/listings/active?limit=10&sort_on=score&keywords=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "x-api-key": key } });
  if (!res.ok) return null;
  const data = await res.json();
  const results = (data.results || []).filter((r) => r.listing_id && r.url);
  if (!results.length) return null;
  // TC-69: keep only listings that plausibly match the DESCRIBED gift, then vary among
  // those (not among all keyword hits). If none pass the confidence guard, return null so
  // we never show a wrong photo/price — the client falls back to the Etsy search link.
  const confident = idea ? results.filter((r) => etsyListingMatches(r, idea)) : results;
  if (!confident.length) return null;
  const it = pickVaried(confident, 4); // vary among the top few *matching* listings
  if (!it) return null;
  // The `includes=Images` association isn't populated for app-key (non-OAuth) auth,
  // so pull the listing's primary image from the dedicated images endpoint.
  const image = await etsyPrimaryImage(it.listing_id, key);
  if (!image) return null; // no photo → let the Shopping fallback try instead
  let price = "";
  if (it.price && it.price.amount != null) {
    price = "$" + (Number(it.price.amount) / Number(it.price.divisor || 100)).toFixed(2);
  }
  return { source: "etsy", title: it.title || "", image, price, url: it.url || "", merchant: "Etsy" };
}

async function etsyPrimaryImage(listingId, key) {
  try {
    const res = await fetch(`https://openapi.etsy.com/v3/application/listings/${listingId}/images`, { headers: { "x-api-key": key } });
    if (!res.ok) return "";
    const data = await res.json();
    const first = (data.results || [])[0];
    return (first && (first.url_570xN || first.url_fullxfull || first.url_340x270)) || "";
  } catch (e) {
    console.error("etsy image fetch failed", e);
    return "";
  }
}

async function shoppingLookup(query, key, idea) {
  const url = `https://www.searchapi.io/api/v1/search?engine=google_shopping&num=12&q=${encodeURIComponent(query)}&api_key=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const items = data.shopping_results || [];
  const candidates = [];
  for (const it of items) {
    const merchant = it.seller || it.merchant || it.source || "";
    const link = it.product_link || it.link || it.offers_link || "";
    const image = it.thumbnail || it.image || "";
    if (!link || !image || isBigBox(merchant, link)) continue;
    const cand = { source: "shopping", title: it.title || "", image, price: it.price || "", url: link, merchant };
    // TC-77: keep only listings that plausibly match the DESCRIBED gift (keyword overlap,
    // right KIND — no digital/bulk, price sanity). If none pass we return null so the client
    // falls back to the search-link tile — never a mismatched/implausible result.
    if (idea && !shoppingResultMatches(cand, idea)) continue;
    candidates.push(cand);
    if (candidates.length >= 6) break;
  }
  return pickVaried(candidates, 4); // vary among the top *matching* boutique listings
}

// For each "local" gift idea, look up one real nearby business via Google Places
// (New) and attach it. Capped to keep latency and cost low. Failures fall back to
// the client's map-search link.
async function enrichLocalIdeas(plan, location, key) {
  if (!plan || !Array.isArray(plan.gift_ideas)) return;
  const locals = plan.gift_ideas.filter((g) => g.locality === "local").slice(0, 2);
  const used = new Set(); // businesses already attached, so two ideas never share one
  for (const g of locals) {
    try {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri,places.websiteUri,places.photos",
        },
        body: JSON.stringify({ textQuery: `${g.search_query} near ${location}`, maxResultCount: 5 }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const p0 = pickBestPlace(data.places, used);
      if (!p0) continue;
      g.local_place = {
        name: p0.displayName?.text || "",
        address: p0.formattedAddress || "",
        rating: p0.rating || null,
        ratingCount: p0.userRatingCount || null,
        mapsUri: p0.googleMapsUri || "",
        website: p0.websiteUri || "",
        photoName: (p0.photos && p0.photos[0] && p0.photos[0].name) || "",
      };
    } catch (err) {
      console.error("places lookup failed", err);
    }
  }
}
