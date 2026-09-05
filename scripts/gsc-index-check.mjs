// TC-173/TC-175: per-URL index-status check via the GSC URL Inspection API.
// Reads every URL from public/sitemap.xml and reports Google's coverageState + verdict for each,
// so we can see which pages are actually indexed vs discovered-not-yet-indexed. Read-only.
// Run: node --env-file=.env scripts/gsc-index-check.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CID = process.env.GSC_OAUTH_CLIENT_ID;
const SEC = process.env.GSC_OAUTH_CLIENT_SECRET;
const RT = process.env.GSC_OAUTH_REFRESH_TOKEN;
const SITE = process.env.GSC_SITE_URL; // e.g. sc-domain:thoughtscount.com

async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CID, client_secret: SEC, refresh_token: RT, grant_type: "refresh_token" }),
  });
  if (!r.ok) throw new Error("token mint " + r.status + " " + (await r.text()));
  return (await r.json()).access_token;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function main() {
  const xml = readFileSync(join(ROOT, "public", "sitemap.xml"), "utf8");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const tk = await token();
  console.log(`Inspecting ${urls.length} URLs for ${SITE}\n`);

  const buckets = {};
  for (const u of urls) {
    let state = "ERROR", verdict = "";
    try {
      const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
        method: "POST",
        headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json" },
        body: JSON.stringify({ inspectionUrl: u, siteUrl: SITE }),
      });
      if (r.ok) {
        const j = await r.json();
        const idx = j.inspectionResult?.indexStatusResult || {};
        verdict = idx.verdict || "";
        state = idx.coverageState || "(no coverageState)";
      } else {
        state = "HTTP " + r.status;
        verdict = (await r.text()).slice(0, 120);
      }
    } catch (e) {
      state = "EXC"; verdict = String(e).slice(0, 120);
    }
    const path = u.replace(/^https?:\/\/[^/]+/, "") || "/";
    console.log(`${verdict.padEnd(4)} | ${String(state).padEnd(38)} | ${path}`);
    buckets[state] = (buckets[state] || 0) + 1;
    await sleep(400); // stay well under 600/min
  }

  console.log("\n===== SUMMARY =====");
  for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(3)}  ${k}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
