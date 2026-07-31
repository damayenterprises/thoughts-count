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
import { logEvent, classifyValence, classifyOccasion, classifyRelationship, budgetBand } from "./_analytics.mjs";

const MODEL = "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 1800; // cost + latency guard

const PLAN_SCHEMA = {
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
      description: "2-3 timed follow-ups for AFTER everyone else moves on, each with a specific small gesture.",
      items: {
        type: "object",
        properties: {
          when: { type: "string", description: "Human label for the timing, e.g. 'In two weeks', 'One month out', 'On the one-year anniversary'." },
          gesture: { type: "string" },
          days_from_now: { type: "integer", description: "Whole number of days from today when this follow-up should happen, so a calendar reminder can be set. E.g. 14 for two weeks, 30 for a month, 365 for a one-year anniversary. Must match 'when'." },
        },
        required: ["when", "gesture", "days_from_now"],
      },
    },
    closing_encouragement: { type: "string", description: "One or two sentences reassuring the user that they're already being a good friend by caring enough to think this through." },
  },
  required: ["plan_title", "headline", "what_matters_most", "what_to_say", "what_not_to_say", "thoughtful_actions", "spend_guidance", "gift_ideas", "follow_up", "closing_encouragement"],
};

const SYSTEM_PROMPT = `You are the intelligence behind Thoughts Count — an AI relationship companion that helps people show up for life's most important moments.

You are NOT a gift website, a greeting-card writer, or a generic chatbot. You are a thoughtful, emotionally intelligent guide. The person talking to you cares deeply and is a little afraid of getting it wrong. Your job is to replace their uncertainty with confidence.

Principles:
- Meet the real emotional weight of the moment. A death is not a promotion. Match your tone to what happened.
- Be specific to the details shared about this person and relationship. Never generic. Use any detail they mention (a hobby, a fear, a history). If their name is given, use it naturally where it warms the plan; if no name is given, never invent one.
- A gift is only ONE possible answer, and often not the best one. Sometimes the right move is a handwritten note, a meal, a specific act of help, or simply showing up. Honor "sometimes it's simply showing up."
- Respect the relationship's closeness. What's right for a spouse is wrong for a coworker.
- Respect the stated budget and time. Never push spending they didn't signal. It's okay to say money isn't the point.
- Be warm and human, never saccharine or clinical. Give them better words than "sorry for your loss."
- Be concise. Each field is 1-3 sentences or 2-4 short items — quality over volume.
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
        system: SYSTEM_PROMPT,
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

    await store.setJSON(jobId, { status: "done", plan: toolUse.input });

    // Anonymized "what people need" signal — buckets only, never raw text/names.
    try {
      const a = body?.answers || {};
      const gifts = Array.isArray(toolUse.input?.gift_ideas) ? toolUse.input.gift_ideas : [];
      await logEvent("plan_generated", {
        sid: (body?.sid || "").toString().slice(0, 40),
        occasion: classifyOccasion(a.moment),
        valence: classifyValence(a.moment),
        relationship: classifyRelationship(a.relationship),
        budget_band: budgetBand(a.constraints),
        has_location: !!(a.location || "").trim(),
        gift_fit: gifts.length > 0,
        gift_count: gifts.length,
        followups: Array.isArray(toolUse.input?.follow_up) ? toolUse.input.follow_up.length : 0,
      }, { test: !!body?.test });
    } catch (e) { console.error("plan analytics failed", e); }

    return new Response("ok", { status: 202 });
  } catch (err) {
    console.error("generate-background error", err);
    try { if (jobId) await store.setJSON(jobId, { status: "error", error: "Something went wrong reaching our guide. Please try again." }); } catch {}
    return new Response("error", { status: 202 });
  }
};

function buildUserMessage(a) {
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
    let product = null;
    if (etsyKey) { try { product = await etsyLookup(q, etsyKey); } catch (e) { console.error("etsy lookup failed", e); } }
    if (!product && shoppingKey) { try { product = await shoppingLookup(q, shoppingKey); } catch (e) { console.error("shopping lookup failed", e); } }
    if (product && product.image && product.url) g.product = product;
  }
}

async function etsyLookup(query, key) {
  const url = `https://openapi.etsy.com/v3/application/listings/active?limit=10&sort_on=score&keywords=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "x-api-key": key } });
  if (!res.ok) return null;
  const data = await res.json();
  const results = (data.results || []).filter((r) => r.listing_id && r.url);
  const it = pickVaried(results, 4); // vary among the top few relevant matches
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

async function shoppingLookup(query, key) {
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
    candidates.push({ source: "shopping", title: it.title || "", image, price: it.price || "", url: link, merchant });
    if (candidates.length >= 6) break;
  }
  return pickVaried(candidates, 4); // vary among the top boutique matches
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
