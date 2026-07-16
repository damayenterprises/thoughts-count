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

const MODEL = "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 1800; // cost + latency guard

const PLAN_SCHEMA = {
  type: "object",
  properties: {
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
          category: { type: "string", enum: ["flowers","candle","food_drink","book","plant","self_care","stationery","keepsake","cozy","experience","donation","other"], description: "Best-fit category, used to show a matching illustration." },
          locality: { type: "string", enum: ["online","local"], description: "'local' ONLY if a location was provided AND this idea is best sourced from a nearby business (a florist, bakery, plant nursery, comfort-meal restaurant, coffee shop). Otherwise 'online'." },
          search_query: { type: "string", description: "For 'online': 2-5 words to find one on a boutique marketplace, e.g. 'hand poured soy candle'. For 'local': the TYPE of nearby business to search, e.g. 'florist', 'bakery', 'plant nursery' (do NOT invent a specific business name)." },
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
  required: ["headline", "what_matters_most", "what_to_say", "what_not_to_say", "thoughtful_actions", "spend_guidance", "gift_ideas", "follow_up", "closing_encouragement"],
};

const SYSTEM_PROMPT = `You are the intelligence behind Thoughts Count — an AI relationship companion that helps people show up for life's most important moments.

You are NOT a gift website, a greeting-card writer, or a generic chatbot. You are a thoughtful, emotionally intelligent guide. The person talking to you cares deeply and is a little afraid of getting it wrong. Your job is to replace their uncertainty with confidence.

Principles:
- Meet the real emotional weight of the moment. A death is not a promotion. Match your tone to what happened.
- Be specific to the details shared about this person and relationship. Never generic. Use any detail they mention (a hobby, a fear, a history).
- A gift is only ONE possible answer, and often not the best one. Sometimes the right move is a handwritten note, a meal, a specific act of help, or simply showing up. Honor "sometimes it's simply showing up."
- Respect the relationship's closeness. What's right for a spouse is wrong for a coworker.
- Respect the stated budget and time. Never push spending they didn't signal. It's okay to say money isn't the point.
- Be warm and human, never saccharine or clinical. Give them better words than "sorry for your loss."
- Be concise. Each field is 1-3 sentences or 2-4 short items — quality over volume.
- Gift ideas: suggest them only when a physical gift truly fits. Favor unique, boutique, artisan, or handmade — not Amazon/Walmart/big-box unless a tight budget makes that the kind choice. Never let gifts overshadow the non-purchase gestures; a gift is one option among many, and often not the best one.
- Local ideas: if a location (city or ZIP) is provided, prefer including at least one LOCAL idea (locality "local") — flowers from a nearby florist, a treat from a local bakery, a plant from a neighborhood nursery, a comfort meal from a nearby restaurant. Local gestures feel more personal. NEVER invent a specific business name or address — only name the TYPE of place; the app builds the "near them" map search. Mix local and online ideas as fits.

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

    await store.setJSON(jobId, { status: "done", plan: toolUse.input });
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
  const about = (a?.about || "").trim();
  const voice = (a?.voice || "").trim();
  const constraints = (a?.constraints || "").trim();
  const location = (a?.location || "").trim();
  if (!moment && !about) return null;
  return [
    "Here is what I'm navigating. Please build me a complete action plan.",
    "",
    `WHAT HAPPENED: ${moment || "(not specified)"}`,
    `WHO THIS PERSON IS TO ME: ${relationship || "(not specified)"}`,
    `ABOUT THEM / OUR RELATIONSHIP: ${about || "(not specified)"}`,
    `WHAT FEELS AUTHENTIC TO ME: ${voice || "(not specified)"}`,
    `MY TIME & BUDGET: ${constraints || "(not specified)"}`,
    `THEIR AREA (for local ideas): ${location || "(not specified)"}`,
  ].join("\n");
}

async function safeText(res) {
  try { return await res.text(); } catch { return "(no body)"; }
}

// For each "local" gift idea, look up one real nearby business via Google Places
// (New) and attach it. Capped to keep latency and cost low. Failures fall back to
// the client's map-search link.
async function enrichLocalIdeas(plan, location, key) {
  if (!plan || !Array.isArray(plan.gift_ideas)) return;
  const locals = plan.gift_ideas.filter((g) => g.locality === "local").slice(0, 2);
  for (const g of locals) {
    try {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri,places.photos",
        },
        body: JSON.stringify({ textQuery: `${g.search_query} near ${location}`, maxResultCount: 1 }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const p0 = data.places && data.places[0];
      if (!p0) continue;
      g.local_place = {
        name: p0.displayName?.text || "",
        address: p0.formattedAddress || "",
        rating: p0.rating || null,
        ratingCount: p0.userRatingCount || null,
        mapsUri: p0.googleMapsUri || "",
        photoName: (p0.photos && p0.photos[0] && p0.photos[0].name) || "",
      };
    } catch (err) {
      console.error("places lookup failed", err);
    }
  }
}
