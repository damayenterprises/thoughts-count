# Paid program archive — Launch push (Aug 2026)

**Snapshot taken:** 2026-09-05 (the paid campaign had ended ~a week prior).
**Raw data:** `paid-program-launch-2026-08.json` (full `/api/analytics` response at snapshot time).
**Why this exists:** the live dashboard is cumulative and keeps moving, so these program-window
numbers would otherwise get diluted. Frozen here so any agent can retrieve the history later.
It is intentionally NOT shown in the live dashboard.

## Caveat on the window
The analytics endpoint reports "since launch" (from **2026-08-24**) onward — it does not accept an
arbitrary date range, so the totals below include a little post-program organic traffic. The
**Paid channel** rows and the **ad-spend** totals are the clean program-attributable figures.

## Headline (since launch, 2026-08-24 → snapshot)
- **Real visitors:** 1,251 (excl. bots/agents/insiders)
- **Engaged (started a plan):** 51
- **Plans generated:** 8
- **Emails captured:** 0  ← the capture leak; fixed 2026-09-05 by TC-174 Surfaces 2 & 4.

## Paid spend (Meta)
- **Spend:** $249.01
- **Impressions:** 68,082 · **Reach:** 32,237 · **Clicks:** 2,599

## Acquisition by channel (sessions → engaged)
| Channel  | Sessions | Engaged | Plans | Engaged % |
|----------|----------|---------|-------|-----------|
| Paid     | 1,162    | 32      | 2     | 2.8%      |
| Direct   | 50       | 13      | 4     | 26.0%     |
| Social   | 37       | 4       | 1     | 10.8%     |
| Internal | 2        | 2       | 0     | 100%      |

## Read (for the file, not the dashboard)
- Paid drove the vast majority of sessions (1,162) but converted poorly: **2.8% engaged**, 2 plans.
  Implied **~$7.78 per engaged visitor** and **~$124.50 per plan** — expensive.
- **Direct converted ~9x better than Paid** (26% vs 2.8%). The product works when the right person
  lands; the paid audience/targeting was the weak link, not the product.
- **0 emails** the entire program = the bottom of the funnel leaked completely. That is exactly what
  TC-174 (daily-thought opt-in + plan-save reframe) addresses, so a future paid push should be
  measured against a funnel that can now actually capture.
