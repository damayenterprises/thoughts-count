#!/usr/bin/env node
/**
 * IndexNow ping — instantly notifies Bing, Yandex, and other IndexNow search
 * engines of new/updated URLs. (Google does NOT participate in IndexNow; it is
 * still fed by the sitemap + manual Search Console submission.)
 *
 * Protocol: https://www.bing.com/indexnow
 * Endpoint accepts up to 10,000 URLs per call. 200/202 = accepted; any 4xx is a
 * real error (key file missing, host mismatch, etc.).
 *
 * The key file must be live at https://thoughtscount.com/<KEY>.txt BEFORE this
 * fires — which is why `npm run deploy` runs the deploy first, then this ping.
 *
 * URL list: read straight from public/sitemap.xml, so every page the guide
 * generator produces is covered automatically — no list to maintain here.
 *
 * Usage:
 *   node scripts/indexnow-ping.js                    # pings every URL in the sitemap
 *   node scripts/indexnow-ping.js https://...new...  # pings only the URL(s) given
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KEY = "8b53f6fba86d40054d5a9a95c5f3606f";
const HOST = "thoughtscount.com";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/indexnow";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function urlsFromSitemap() {
  const xml = readFileSync(join(ROOT, "public", "sitemap.xml"), "utf8");
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

async function ping(urlList) {
  if (!urlList.length) {
    console.error("[IndexNow] No URLs to submit.");
    process.exit(1);
  }
  const body = { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList };

  console.log(`[IndexNow] Pinging ${urlList.length} URL(s) for ${HOST}:`);
  urlList.forEach((u) => console.log(`  - ${u}`));

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`\n[IndexNow] HTTP ${res.status} ${res.statusText}`);
  if (text) console.log(`[IndexNow] Body: ${text}`);

  if (res.status === 200 || res.status === 202) {
    console.log("[IndexNow] OK — URLs submitted. Bing/Yandex crawl on their own schedule.");
    process.exit(0);
  } else {
    console.error("[IndexNow] FAILED");
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const urls = args.length ? args : urlsFromSitemap();

ping(urls).catch((err) => {
  console.error("[IndexNow] Network error:", err.message);
  process.exit(1);
});
