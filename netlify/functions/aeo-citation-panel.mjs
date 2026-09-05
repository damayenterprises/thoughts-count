// Thoughts Count — TC-177 AEO citation panel (weekly cron).
//
// Once a week, ask the AI answer engines the real questions our guides target and record whether
// thoughtscount.com is cited. Stores a dated snapshot to Blobs (so we can watch the trend) and emails
// a short scoreboard to the admin. Probe logic lives in _aeo.mjs so it can be smoke-tested locally.
//
// Cost: ~30 prompts x (1 OpenAI web-search + 1 SearchAPI call) per week, a few cents to ~$1/wk on keys
// we already have. Runs Mondays 15:00 UTC (~10am CT).

import { getStore } from "@netlify/blobs";
import { PROMPTS, probePrompt } from "./_aeo.mjs";
import { getEnv, sendEmail } from "./_email.mjs";
import { recordSend } from "./_sendlog.mjs";

export const config = { schedule: "0 15 * * 1" };

const STORE = "aeo-citations";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async () => {
  const day = new Date().toISOString().slice(0, 10);
  const results = [];
  let errors = 0;

  // Sequential, gentle pacing, so one flaky call never aborts the batch and we don't spike rate limits.
  for (const p of PROMPTS) {
    try {
      const r = await probePrompt(p);
      results.push(r);
      if (!r.openai.ok || !r.aiOverview.ok) errors++;
    } catch (e) {
      errors++;
      results.push({ prompt: p, openai: { ok: false, error: String(e).slice(0, 120) }, aiOverview: { ok: false } });
    }
    await sleep(600);
  }

  const openaiCited = results.filter((r) => r.openai?.cited).length;
  const aiOverviewPresent = results.filter((r) => r.aiOverview?.present).length;
  const aiOverviewCited = results.filter((r) => r.aiOverview?.cited).length;
  const citedPrompts = results.filter((r) => r.openai?.cited || r.aiOverview?.cited).map((r) => r.prompt);
  const totals = { total: PROMPTS.length, openaiCited, aiOverviewPresent, aiOverviewCited, errors };

  // Store snapshot + read the previous one for a trend delta. Fail-soft: storage issues never block email.
  let prev = null;
  try {
    const store = getStore(STORE);
    const list = await store.list();
    const keys = (list.blobs || []).map((b) => b.key).filter((k) => k < day).sort();
    if (keys.length) prev = await store.get(keys[keys.length - 1], { type: "json" }).catch(() => null);
    await store.setJSON(day, { day, totals, citedPrompts, results });
  } catch (e) {
    console.error("aeo panel store failed", e);
  }

  const delta = prev
    ? `Since last run (${prev.day}): OpenAI ${fmtDelta(openaiCited - (prev.totals?.openaiCited || 0))}, AI Overview ${fmtDelta(aiOverviewCited - (prev.totals?.aiOverviewCited || 0))}.`
    : "First run, this is the baseline.";

  const subject = `AEO citations: ${openaiCited}/${PROMPTS.length} ChatGPT, ${aiOverviewCited}/${aiOverviewPresent} AI Overviews`;
  const admin = getEnv("ADMIN_NOTIFICATION_EMAIL") || "david@damayenterprises.com";
  const citedHtml = citedPrompts.length
    ? `<ul>${citedPrompts.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`
    : "<p>Not cited anywhere yet. Expected while the new pages are still gaining authority; this is the number to watch climb.</p>";

  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#2c2a26;line-height:1.6">
      <h2 style="margin:0 0 6px">AEO citation panel</h2>
      <p style="color:#5a554c;margin:0 0 14px">${esc(day)} · ${PROMPTS.length} target prompts</p>
      <table style="border-collapse:collapse;font-size:15px">
        <tr><td style="padding:3px 14px 3px 0">Cited in ChatGPT answers</td><td><strong>${openaiCited} / ${PROMPTS.length}</strong></td></tr>
        <tr><td style="padding:3px 14px 3px 0">Google AI Overviews present</td><td><strong>${aiOverviewPresent} / ${PROMPTS.length}</strong></td></tr>
        <tr><td style="padding:3px 14px 3px 0">Cited in an AI Overview</td><td><strong>${aiOverviewCited} / ${aiOverviewPresent || 0}</strong></td></tr>
        <tr><td style="padding:3px 14px 3px 0">Probe errors</td><td>${errors}</td></tr>
      </table>
      <p style="margin:14px 0 6px;color:#5a554c">${esc(delta)}</p>
      <h3 style="margin:16px 0 4px">Where we are cited</h3>
      ${citedHtml}
      <p style="margin-top:18px;font-size:12px;color:#8a8377">Reactive AI-referral traffic is tracked separately in the analytics "AI" channel. This probe is the proactive citation scoreboard (TC-177).</p>
    </div>`;

  let emailed = false;
  try {
    const res = await sendEmail({ to: admin, subject, html, replyTo: "care@thoughtscount.com" });
    emailed = !!res?.ok;
  } catch (e) {
    console.error("aeo panel email failed", e);
  }

  await recordSend({
    job: "aeo-citation-panel",
    status: errors > PROMPTS.length / 2 ? "partial" : "ok",
    audience: 1, delivered: emailed ? 1 : 0, failed: emailed ? 0 : 1,
    meta: { day, ...totals },
  });

  return new Response(JSON.stringify({ day, totals, citedPrompts }), { headers: { "content-type": "application/json" } });
};

function fmtDelta(n) { return n > 0 ? `+${n}` : String(n); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
