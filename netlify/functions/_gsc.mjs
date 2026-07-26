// Thoughts Count — Google Search Console reader (read-only, shared OAuth token).
// Mints a short-lived access token from the shared refresh token and pulls
// last-N-days search performance for the verified property. Used by the weekly
// report's SEO section. Fails soft: any error returns null so the report still sends.

import { getEnv } from "./_email.mjs";

async function accessToken() {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getEnv("GSC_OAUTH_CLIENT_ID"),
      client_secret: getEnv("GSC_OAUTH_CLIENT_SECRET"),
      refresh_token: getEnv("GSC_OAUTH_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) throw new Error("token mint " + resp.status);
  const data = await resp.json();
  return data.access_token;
}

function ymd(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Returns { totals:{clicks,impressions,ctr,position}, topQueries:[{q,clicks,impressions}],
// topPages:[{url,clicks,impressions}] } for the last `days`, or null on any failure.
export async function getSearchPerformance(days = 7) {
  const site = getEnv("GSC_SITE_URL");
  if (!site || !getEnv("GSC_OAUTH_REFRESH_TOKEN")) return null;
  try {
    const token = await accessToken();
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const base = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;

    const query = (dimensions, rowLimit) =>
      fetch(base, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), dimensions, rowLimit }),
      }).then((r) => (r.ok ? r.json() : { rows: [] }));

    const [totalsR, queriesR, pagesR] = await Promise.all([
      query([], 1),
      query(["query"], 5),
      query(["page"], 5),
    ]);

    const t = (totalsR.rows && totalsR.rows[0]) || null;
    return {
      totals: t
        ? { clicks: t.clicks || 0, impressions: t.impressions || 0, ctr: t.ctr || 0, position: t.position || 0 }
        : { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      topQueries: (queriesR.rows || []).map((r) => ({ q: r.keys[0], clicks: r.clicks || 0, impressions: r.impressions || 0 })),
      topPages: (pagesR.rows || []).map((r) => ({ url: r.keys[0], clicks: r.clicks || 0, impressions: r.impressions || 0 })),
    };
  } catch (err) {
    console.error("GSC read failed", err);
    return null;
  }
}
