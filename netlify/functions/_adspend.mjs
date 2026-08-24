// Thoughts Count — live Meta ad spend for the dashboard.
//
// The paid campaigns run through Marketing OS under the shared "Damay Ads" app; the durable,
// auto-refreshing Meta token lives in the MOS Supabase (marketing_config · key meta_ads_token),
// so we read it fresh on each call instead of copying a token that would rotate out from under us.
// Spend is pulled from the ad account that bills TC's campaigns and filtered to the "TC ·" prefix
// (the shared account bills one card; brands are attributed by campaign-name prefix).
//
// Fail-safe by construction: ANY missing env / token / Meta error returns null so the dashboard
// simply omits the spend card — it never breaks the page. A short Blobs cache keeps us off Meta's
// rate limit and keeps the dashboard fast (Meta insights can be slow).

import { getStore } from "@netlify/blobs";
import { REAL_BASELINE_YMD } from "./_analytics.mjs";

const GRAPH = "https://graph.facebook.com/v21.0";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min — spend moves slowly; keeps the dashboard snappy
const BRAND_PREFIX = "TC"; // campaign names look like "TC · National Thoughtful Day (...)"

async function fetchWithTimeout(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// The always-fresh Meta token from the MOS Supabase (same source ad-report.js uses).
async function currentToken() {
  const url = process.env.MOS_SUPABASE_URL, key = process.env.MOS_SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetchWithTimeout(
      `${url}/rest/v1/marketing_config?select=value&app=eq._global&key=eq.meta_ads_token`,
      5000,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return (rows[0] && rows[0].value && rows[0].value.token) || null;
  } catch { return null; }
}

// Roll up TC spend across the billing account. Returns null on any problem (dashboard omits it).
export async function getTcAdSpend() {
  // Serve from cache if fresh.
  let store = null;
  try { store = getStore("adspend"); } catch { store = null; }
  if (store) {
    try {
      const cached = await store.get("tc", { type: "json" });
      if (cached && cached.at && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
    } catch { /* ignore cache read errors */ }
  }

  const acctRaw = process.env.META_ADS_ACCOUNT_ID || "";
  if (!acctRaw) return null;
  const acct = acctRaw.startsWith("act_") ? acctRaw : `act_${acctRaw}`;
  const token = await currentToken();
  if (!token) return null;

  try {
    const fields = "campaign_name,spend,impressions,clicks,reach";
    // Explicit launch-window time_range (NOT date_preset=maximum): account-level insights lag ~a day,
    // so "maximum" can end yesterday and miss a campaign that only started spending today. Anchor to
    // the same launch baseline the dashboard reports "since launch" from, through today.
    const since = `${REAL_BASELINE_YMD.slice(0, 4)}-${REAL_BASELINE_YMD.slice(4, 6)}-${REAL_BASELINE_YMD.slice(6, 8)}`;
    const now = new Date();
    const until = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
    const u = `${GRAPH}/${acct}/insights?level=campaign&time_range=${timeRange}&fields=${fields}&limit=500&access_token=${encodeURIComponent(token)}`;
    const r = await fetchWithTimeout(u, 7000);
    const j = await r.json();
    if (!j || j.error || !Array.isArray(j.data)) return null;

    const mine = j.data.filter((row) => {
      const brand = String(row.campaign_name || "").split("·")[0].trim();
      return brand.toUpperCase() === BRAND_PREFIX;
    });
    if (!mine.length) {
      const data = { spend: 0, impressions: 0, clicks: 0, reach: 0, campaigns: [] };
      if (store) { try { await store.setJSON("tc", { at: Date.now(), data }); } catch {} }
      return data;
    }

    let spend = 0, impressions = 0, clicks = 0, reach = 0;
    const campaigns = [];
    for (const row of mine) {
      const s = Number(row.spend || 0);
      spend += s;
      impressions += Number(row.impressions || 0);
      clicks += Number(row.clicks || 0);
      reach += Number(row.reach || 0);
      campaigns.push({ name: row.campaign_name, spend: s });
    }
    const data = {
      spend: Math.round(spend * 100) / 100,
      impressions, clicks, reach,
      campaigns: campaigns.sort((a, b) => b.spend - a.spend),
    };
    if (store) { try { await store.setJSON("tc", { at: Date.now(), data }); } catch {} }
    return data;
  } catch { return null; }
}
