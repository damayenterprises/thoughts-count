// Thoughts Count — Google Places photo proxy. Streams a place photo so the
// Google Places key stays server-side (never in an <img src> the browser exposes).

export default async (req) => {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref"); // Places photo resource name, e.g. "places/XXX/photos/YYY"
  const key =
    (typeof Netlify !== "undefined" && Netlify.env?.get("GOOGLE_PLACES_KEY")) ||
    process.env.GOOGLE_PLACES_KEY;
  if (!ref || !key) return new Response("", { status: 400 });
  if (!/^places\/[^/]+\/photos\/[^/]+$/.test(ref)) return new Response("", { status: 400 });

  try {
    const g = await fetch(
      `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=480&maxHeightPx=480&key=${encodeURIComponent(key)}`,
      { redirect: "follow" }
    );
    if (!g.ok || !g.body) return new Response("", { status: 502 });
    return new Response(g.body, {
      status: 200,
      headers: {
        "content-type": g.headers.get("content-type") || "image/jpeg",
        "cache-control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error("place-photo error", err);
    return new Response("", { status: 502 });
  }
};
