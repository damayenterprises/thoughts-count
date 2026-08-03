// Thoughts Count — TC-59 curation gap report (READ-ONLY).
//
// Tells the curator which occasion buckets to author craft exemplars for NEXT, by
// cross-referencing live demand + quality signal against what the library already covers:
//   • volume     — how often this kind of moment shows up   (what_people_need.occasion)
//   • 👍 rate     — how well we currently serve it            (helpfulness.by_occasion, TC-58)
//   • has_exemplars — whether _exemplars.mjs already covers it
//
// "Author here next" = high volume + low/absent 👍 rate + no exemplars yet.
//
// This script NEVER writes exemplars and NEVER reads raw stories — only the already-
// bucketed, non-identifying aggregates from the analytics summary endpoint. Authoring
// stays a reviewed edit to netlify/functions/_exemplars.mjs (the human-in-the-loop flywheel).
//
// Usage:
//   ANALYTICS_TOKEN=xxx node scripts/exemplar-gaps.mjs
//   ANALYTICS_TOKEN=xxx TC_BASE_URL=https://thoughtscount.com node scripts/exemplar-gaps.mjs
//   (add INCLUDE_TEST=1 to include test/insider events while validating locally)

import { EXEMPLARS } from "../netlify/functions/_exemplars.mjs";

const BASE = (process.env.TC_BASE_URL || "https://thoughtscount.com").replace(/\/+$/, "");
const TOKEN = process.env.ANALYTICS_TOKEN || "";
const INCLUDE_TEST = process.env.INCLUDE_TEST === "1";

if (!TOKEN) {
  console.error("Set ANALYTICS_TOKEN (the value of the site's ANALYTICS_TOKEN env var).");
  process.exit(1);
}

const covered = new Set(Object.keys(EXEMPLARS));

async function main() {
  const url = `${BASE}/api/analytics?token=${encodeURIComponent(TOKEN)}${INCLUDE_TEST ? "&includeTest=1" : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`analytics fetch failed: ${res.status} ${await res.text().catch(() => "")}`);
    process.exit(1);
  }
  const data = await res.json();
  const volume = (data.what_people_need && data.what_people_need.occasion) || {};
  const byOcc = (data.helpfulness && data.helpfulness.by_occasion) || {};

  // Union of every occasion that has either demand or a rating, plus everything we cover.
  const occasions = new Set([...Object.keys(volume), ...Object.keys(byOcc), ...covered]);

  const rows = [...occasions].map((occ) => {
    const vol = volume[occ] || 0;
    const fb = byOcc[occ] || null;
    const responses = fb ? fb.yes + fb.no : 0;
    const rate = fb ? fb.rate_pct : null; // null = no feedback yet
    const has = covered.has(occ);
    // Priority: unmet demand weighted by how poorly we serve it. No feedback yet = treat as
    // a 50% unknown so a high-volume bucket still surfaces. Already-covered buckets are
    // deprioritized (shown, but sorted last within a tier) — refine, don't re-author.
    const missRate = rate == null ? 0.5 : (100 - rate) / 100;
    const priority = (has ? 0.15 : 1) * vol * (0.5 + missRate);
    return { occ, vol, rate, responses, has, priority };
  });

  rows.sort((a, b) => b.priority - a.priority);

  const pct = (r) => (r == null ? "  — " : `${String(r).padStart(3)}%`);
  console.log(`\nThoughts Count — craft-library gap report  (${BASE}${INCLUDE_TEST ? " · incl. test" : ""})`);
  console.log(`Generated ${data.generated_at || new Date().toISOString()}\n`);
  console.log("  occasion               plans   👍rate   n   exemplars   → author next?");
  console.log("  " + "-".repeat(72));
  for (const r of rows) {
    const flag = !r.has && r.vol > 0 ? "  ⭐ AUTHOR" : (!r.has ? "  (none yet)" : "");
    console.log(
      "  " +
      r.occ.padEnd(22) +
      String(r.vol).padStart(5) +
      "   " + pct(r.rate) +
      "  " + String(r.responses).padStart(3) +
      "   " + (r.has ? "yes" : "NO ").padEnd(9) +
      flag
    );
  }
  console.log("\n  ⭐ = has real demand but no exemplars yet — the highest-leverage buckets to author.");
  console.log("  Author/refine by editing netlify/functions/_exemplars.mjs (reviewed commit).\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
