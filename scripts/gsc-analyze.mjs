// Throwaway GSC deep-pull for TC-173 SEO prioritization. Run: node --env-file=.env scripts/gsc-analyze.mjs
// Pulls 90d performance with depth: totals, top queries, top pages (with position), and
// query+page near-winners (position 5–25 = one push from clickable). Read-only.

const CID = process.env.GSC_OAUTH_CLIENT_ID;
const SEC = process.env.GSC_OAUTH_CLIENT_SECRET;
const RT = process.env.GSC_OAUTH_REFRESH_TOKEN;
const SITE = process.env.GSC_SITE_URL;

async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CID, client_secret: SEC, refresh_token: RT, grant_type: "refresh_token" }),
  });
  if (!r.ok) throw new Error("token mint " + r.status + " " + (await r.text()));
  return (await r.json()).access_token;
}
const ymd = (d) => d.toISOString().slice(0, 10);

async function main() {
  const tk = await token();
  const end = new Date();
  const start = new Date(end.getTime() - 90 * 86400000);
  const base = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`;
  const q = (dimensions, rowLimit = 100) =>
    fetch(base, {
      method: "POST",
      headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), dimensions, rowLimit }),
    }).then((r) => (r.ok ? r.json() : Promise.reject(r.status + " " + r.statusText)));

  const [totals, queries, pages, combos] = await Promise.all([
    q([], 1), q(["query"], 100), q(["page"], 100), q(["query", "page"], 250),
  ]);

  const t = totals.rows?.[0];
  console.log("\n===== 90-DAY TOTALS =====");
  console.log(t ? `clicks=${t.clicks}  impressions=${t.impressions}  ctr=${(t.ctr * 100).toFixed(2)}%  avgPos=${t.position.toFixed(1)}` : "no data");

  const fmtRow = (r, keyLabel) => `${String(Math.round(r.impressions)).padStart(4)} imp  pos ${r.position.toFixed(1).padStart(5)}  clk ${r.clicks}  | ${r.keys.join("  ←  ").slice(0, 90)}`;

  console.log("\n===== TOP 20 QUERIES by impressions =====");
  (queries.rows || []).sort((a,b)=>b.impressions-a.impressions).slice(0, 20).forEach((r) => console.log(fmtRow(r)));

  console.log("\n===== ALL PAGES by impressions =====");
  (pages.rows || []).sort((a,b)=>b.impressions-a.impressions).forEach((r) => console.log(fmtRow(r)));

  console.log("\n===== NEAR-WINNERS: query×page at position 5–20, ranked by impressions =====");
  (combos.rows || [])
    .filter((r) => r.position >= 5 && r.position <= 20)
    .sort((a,b)=>b.impressions-a.impressions)
    .slice(0, 30)
    .forEach((r) => console.log(fmtRow(r)));

  console.log("\n===== DEEP (pos 20–45) high-impression queries (demand we're barely surfacing) =====");
  (combos.rows || [])
    .filter((r) => r.position > 20 && r.position <= 45)
    .sort((a,b)=>b.impressions-a.impressions)
    .slice(0, 20)
    .forEach((r) => console.log(fmtRow(r)));
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
