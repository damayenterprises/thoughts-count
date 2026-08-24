// Thoughts Count — weekly report builder + sender.
// Pulls the anonymized analytics, formats a warm branded email covering usage,
// the funnel, "what people are coming for," and SEO status, and sends it to the
// report recipients. Shared by the Monday scheduler and the manual "send now" trigger.

import { getStore } from "@netlify/blobs";
import { sendEmail } from "./_email.mjs";
import { loadAllEvents, computeSummary, ymdOf } from "./_analytics.mjs";
import { getSearchPerformance } from "./_gsc.mjs";

export const REPORT_RECIPIENTS = ["david@damayenterprises.com", "cowartjd@gmail.com"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function niceDate(d) { return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }

export async function runDigest(recipients = REPORT_RECIPIENTS) {
  const store = getStore("analytics");
  const events = await loadAllEvents(store);
  const real = events.filter((e) => !e.test && !e.bot);

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cutYmd = ymdOf(weekAgo);
  const week = real.filter((e) => (e.ymd || "") > cutYmd);

  const allSum = computeSummary(real);
  const weekSum = computeSummary(week);
  const seo = await getSearchPerformance(7);

  const rangeLabel = `${niceDate(weekAgo)} – ${niceDate(now)}`;
  const html = digestHtml({ allSum, weekSum, rangeLabel, seo });
  const subject = `Thoughts Count — weekly report (${niceDate(now)})`;

  const results = [];
  for (const to of recipients) {
    const r = await sendEmail({ to, subject, html });
    results.push({ to, ok: !!r.ok, error: r.error || null });
  }
  return { rangeLabel, recipients, results, weekVisitors: weekSum.unique_visitors };
}

// ---- email HTML ---------------------------------------------------------
const C = { paper: "#f7f3ec", card: "#fdfbf7", line: "#e7ded0", ink: "#2c2a26", soft: "#5a554c", sage: "#0a5876", clay: "#118ab9" };

function seoSection(seo) {
  // Not connected at all.
  if (seo === null) {
    return `Search Console isn't connected yet. This section will fill in with clicks, impressions, and top queries once it's wired up.`;
  }
  const t = seo.totals;
  // Connected but no search data yet (brand-new pages Google hasn't ranked).
  if (!t.impressions) {
    return `Connected to Search Console ✓ — no search impressions yet. Brand-new pages take days-to-weeks to start appearing in Google. This will populate automatically as they get indexed and start ranking.`;
  }
  const queries = seo.topQueries.length
    ? `<div style="margin-top:8px;"><b style="color:${C.ink};">Top searches:</b> ${seo.topQueries.map((q) => `${q.q} <span style="color:${C.soft};">(${q.impressions})</span>`).join(" · ")}</div>`
    : "";
  return `<b style="color:${C.ink};">${t.clicks}</b> clicks · <b style="color:${C.ink};">${t.impressions}</b> impressions · ${(t.ctr * 100).toFixed(1)}% CTR · avg position ${t.position.toFixed(1)}${queries}`;
}

function trafficBlock(traffic) {
  const chan = Object.entries(traffic?.by_channel || {});
  if (!chan.length) return "";
  const chips = chan
    .map(([k, v]) => `<span style="display:inline-block;background:#fff;border:1px solid ${C.line};border-radius:999px;padding:3px 11px;margin:3px 5px 0 0;font-size:12.5px;color:${C.ink};">${k}: <b>${v}</b></span>`)
    .join("");
  const srcs = Object.entries(traffic.top_sources || {});
  const srcLine = srcs.length
    ? `<div style="margin-top:8px;font-size:12px;color:${C.soft};"><b style="color:${C.ink};">Top sources:</b> ${srcs.map(([k, v]) => `${k} (${v})`).join(" · ")}</div>`
    : "";
  return `<div style="margin:14px 6px 0;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:${C.soft};margin-bottom:5px;">Where visitors came from</div>
      ${chips}${srcLine}
    </div>`;
}

function digestHtml({ allSum, weekSum, rangeLabel, seo }) {
  const wf = weekSum.funnel, af = allSum.funnel;

  const stat = (label, value, sub) => `
    <td style="padding:6px;width:33%;vertical-align:top;">
      <div style="background:${C.paper};border:1px solid ${C.line};border-radius:14px;padding:14px 12px;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:28px;font-weight:600;color:${C.sage};line-height:1;">${value}</div>
        <div style="font-size:12px;color:${C.soft};margin-top:6px;">${label}</div>
        ${sub ? `<div style="font-size:11px;color:${C.clay};margin-top:2px;">${sub}</div>` : ""}
      </div>
    </td>`;

  const breakdown = (title, obj) => {
    const entries = Object.entries(obj || {});
    if (!entries.length) return "";
    const rows = entries.map(([k, v]) => `
      <tr>
        <td style="padding:3px 0;font-size:13px;color:${C.ink};">${prettyLabel(k)}</td>
        <td style="padding:3px 0;font-size:13px;color:${C.soft};text-align:right;">${v}</td>
      </tr>`).join("");
    return `<div style="margin-top:14px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:${C.soft};margin-bottom:4px;">${title}</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    </div>`;
  };

  const need = allSum.what_people_need;
  const hasNeed = allSum.funnel.plans_generated > 0;

  const conv = (v) => (v == null ? "—" : v + "%");

  // Loop 2 (TC-58): plan-quality read — overall 👍 rate, per-occasion, and the
  // reasons behind downvotes so a weak situation is visible at a glance.
  const qualityBlock = (sum) => {
    const h = sum.helpfulness || {};
    if (!h.responses) return "";
    const occRows = Object.entries(h.by_occasion || {})
      .map(([k, v]) => `
        <tr>
          <td style="padding:3px 0;font-size:13px;color:${C.ink};">${prettyLabel(k)}</td>
          <td style="padding:3px 0;font-size:13px;color:${C.soft};text-align:right;">${v.rate_pct == null ? "—" : v.rate_pct + "%"} <span style="color:${C.soft};">(${v.yes + v.no})</span></td>
        </tr>`).join("");
    const reasons = Object.entries(h.down_reasons || {});
    const reasonLine = reasons.length
      ? `<div style="margin-top:8px;font-size:12px;color:${C.soft};"><b style="color:${C.ink};">What was off:</b> ${reasons.map(([k, v]) => `${prettyLabel(k)} (${v})`).join(" · ")}</div>`
      : "";
    return `<div style="margin-top:18px;">
      <div style="font-family:Georgia,serif;font-size:16px;color:${C.ink};">Plan quality</div>
      <div style="margin-top:6px;font-size:13px;color:${C.ink};">
        <b style="color:${C.sage};">${h.helpful_rate_pct == null ? "—" : h.helpful_rate_pct + "%"}</b> found their plan helpful
        <span style="color:${C.soft};">(${h.responses} rated · ${h.helpful_yes} 👍 / ${h.helpful_no} 👎)</span>
      </div>
      ${occRows ? `<div style="margin-top:10px;"><div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:${C.soft};margin-bottom:4px;">Helpful rate by occasion</div><table style="width:100%;border-collapse:collapse;">${occRows}</table></div>` : ""}
      ${reasonLine}
    </div>`;
  };

  return `
<div style="margin:0;padding:24px;background:${C.paper};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.ink};">
  <div style="max-width:600px;margin:0 auto;background:${C.card};border:1px solid ${C.line};border-radius:20px;overflow:hidden;">
    <div style="padding:22px 28px;border-bottom:1px solid ${C.line};">
      <div style="font-family:Georgia,serif;font-size:20px;font-weight:600;color:#118ab9;">&#10084; Thoughts Count — Weekly Report</div>
      <div style="font-size:13px;color:${C.soft};margin-top:4px;">${rangeLabel}</div>
    </div>

    <div style="padding:20px 22px;">
      <div style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:${C.soft};margin:2px 0 8px 6px;">This week</div>
      <table style="width:100%;border-collapse:collapse;"><tr>
        ${stat("Visitors", wf.visitors, wf.page_views > wf.visitors ? `${wf.page_views} views` : "")}
        ${stat("Engaged", wf.engaged_visitors)}
        ${stat("Plans created", wf.plans_generated)}
      </tr></table>

      <div style="font-size:13px;color:${C.ink};margin:14px 6px 0;line-height:1.6;">
        Of ${wf.visitors || 0} visitor${wf.visitors === 1 ? "" : "s"}${wf.page_views > wf.visitors ? ` (${wf.page_views} views)` : ""}, ${wf.engaged_visitors || 0} engaged and
        ${wf.plans_generated || 0} received a plan. ${wf.emails_submitted || 0} had it emailed to them.
      </div>

      <div style="margin:16px 6px 0;padding:12px 14px;background:#e3f0f6;border:1px solid ${C.line};border-radius:12px;font-size:13px;color:${C.ink};">
        <b style="color:${C.sage};">Growth this week:</b> ${wf.unique_emails || 0} new outside email${wf.unique_emails === 1 ? "" : "s"}
        <span style="color:${C.soft};">(excludes you &amp; JC)</span>
        &nbsp;·&nbsp; <b style="color:${C.clay};">Team:</b> ${wf.team_emails || 0} email${wf.team_emails === 1 ? "" : "s"}, ${wf.reminders_sent || 0} reminder${wf.reminders_sent === 1 ? "" : "s"} sent
      </div>

      <div style="margin:12px 6px 0;padding:12px 14px;background:${C.paper};border-radius:12px;font-size:12.5px;color:${C.soft};">
        <b style="color:${C.ink};">Conversion:</b>
        landed → started ${conv(weekSum.conversion.landed_to_started_pct)} ·
        started → plan ${conv(weekSum.conversion.started_to_plan_pct)} ·
        plan → email ${conv(weekSum.conversion.plan_to_email_pct)}
      </div>

      ${trafficBlock(weekSum.traffic)}
    </div>

    <div style="padding:4px 22px 20px;">
      <div style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:${C.soft};margin:2px 0 8px 6px;">All time</div>
      <table style="width:100%;border-collapse:collapse;"><tr>
        ${stat("Total visitors", af.visitors, af.page_views > af.visitors ? `${af.page_views} views` : "")}
        ${stat("Total plans", af.plans_generated)}
        ${stat("Outside emails", af.unique_emails, "excl. team")}
      </tr></table>

      <div style="padding:0 6px;">
        ${hasNeed ? `<div style="margin-top:18px;font-family:Georgia,serif;font-size:16px;color:${C.ink};">What people are coming for</div>` : ""}
        ${hasNeed ? breakdown("By type of moment", need.valence) : ""}
        ${hasNeed ? breakdown("By occasion", need.occasion) : ""}
        ${hasNeed ? breakdown("By relationship", need.relationship) : ""}
        ${qualityBlock(allSum)}
      </div>
    </div>

    <div style="padding:4px 28px 22px;">
      <div style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:${C.soft};margin:2px 0 6px;">Search / SEO</div>
      <div style="font-size:13px;color:${C.ink};line-height:1.6;background:${C.paper};border-radius:12px;padding:12px 14px;">
        ${seoSection(seo)}
      </div>
    </div>

    <div style="padding:14px 28px;border-top:1px solid ${C.line};font-size:11.5px;color:${C.soft};line-height:1.7;">
      <b style="color:${C.ink};">What the numbers mean</b><br/>
      <b>Visitors</b> — distinct real, outside people (by session), not raw page-loads. <b>Engaged</b> — of those, how many started the conversation or got a plan (the real interest signal).
      <b>Plans created</b> — finished the conversation and got a plan.
      <b>Growth / Outside emails</b> — distinct email addresses from people who <i>aren't</i> you or JC (the real traction number).
      <b>Team</b> — your &amp; JC's own usage, shown so you can see it working.<br/><br/>
      Anonymized, aggregate data only — no names or personal details. <b>Excluded from Visitors:</b> bots/crawlers, QA/test sessions, browser automation, and you &amp; JC (whenever a session is tied to an insider sign-in or email).
      Data starts 26 Jul 2026 (when tracking went live).<br/>
      Thoughts Count · sent every Monday to you &amp; JC
    </div>
  </div>
</div>`;
}

function prettyLabel(k) {
  return String(k).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
