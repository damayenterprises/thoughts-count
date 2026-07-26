// Shared email helpers for Thoughts Count.
// Sends via SendGrid (reusing the Damay account key). Sender is the branded
// domain care@thoughtscount.com (authenticated in that account, 2026-07-26).

const BRAND = "Thoughts Count";

export async function sendEmail({ to, subject, html, text }) {
  const key = getEnv("SENDGRID_API_KEY");
  const from = getEnv("FROM_EMAIL") || "care@thoughtscount.com";
  const fromName = getEnv("FROM_NAME") || BRAND;
  if (!key) return { ok: false, error: "Email isn't configured (missing SENDGRID_API_KEY)." };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: fromName },
      subject,
      content: [
        { type: "text/plain", value: text || stripHtml(html) },
        { type: "text/html", value: html },
      ],
    }),
  });
  if (res.status >= 200 && res.status < 300) return { ok: true };
  const detail = await safeText(res);
  console.error("SendGrid error", res.status, detail);
  return { ok: false, error: "We couldn't send the email just now." };
}

export function getEnv(name) {
  if (typeof Netlify !== "undefined" && Netlify.env?.get) {
    const v = Netlify.env.get(name);
    if (v) return v;
  }
  return process.env[name];
}

// ---- warm branded email templates ----
const WRAP = (inner) => `
<div style="margin:0;padding:24px;background:#f5efe3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#3b362e;">
  <div style="max-width:560px;margin:0 auto;background:#fffbf4;border:1px solid #e7ddca;border-radius:20px;overflow:hidden;">
    <div style="padding:20px 28px;border-bottom:1px solid #e7ddca;font-family:Georgia,serif;font-size:20px;font-weight:600;color:#3b362e;">🤍 Thoughts Count</div>
    <div style="padding:26px 28px;line-height:1.6;font-size:15px;">${inner}</div>
    <div style="padding:16px 28px;border-top:1px solid #e7ddca;font-size:12px;color:#b3a58c;">Helping good intentions become meaningful actions.</div>
  </div>
</div>`;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const H = (t) => `<div style="font-family:Georgia,serif;font-size:16px;font-weight:600;color:#5f6c4c;margin:18px 0 6px;">${esc(t)}</div>`;
const ul = (arr) => `<ul style="margin:4px 0 0;padding-left:18px;">${(arr || []).map((x) => `<li style="margin-bottom:5px;">${esc(x)}</li>`).join("")}</ul>`;

export function planEmailHtml(plan) {
  const p = plan || {};
  const actions = (p.thoughtful_actions || [])
    .map((a) => `<div style="margin-bottom:10px;"><b>${esc(a.action)}</b><br><span style="color:#6f675b;">${esc(a.why_it_fits)} · ${esc(a.effort || "")} · ${esc(a.approx_cost || "")}</span></div>`)
    .join("");
  const gifts = (p.gift_ideas || []).length
    ? H("If you'd like to send something") + (p.gift_ideas || []).map((g) =>
        `<div style="margin-bottom:8px;"><b>${esc(g.title)}</b> — <span style="color:#6f675b;">${esc(g.price_range || "")}. ${esc(g.why_it_fits || "")}</span></div>`).join("")
    : "";
  const follow = (p.follow_up || [])
    .map((f) => `<div style="margin-bottom:6px;"><b style="color:#a97350;">${esc(f.when)}:</b> ${esc(f.gesture)}</div>`)
    .join("");

  const inner = `
    <div style="font-family:Georgia,serif;font-size:19px;color:#3b362e;margin-bottom:8px;">${esc(p.headline || "Your plan")}</div>
    ${H("What matters most")}<div>${esc(p.what_matters_most || "")}</div>
    ${H("What you might say")}${ul(p.what_to_say)}
    ${H("What to gently avoid")}${ul(p.what_not_to_say)}
    ${H("Thoughtful things you could do")}${actions}
    ${H("How much to spend")}<div>${esc(p.spend_guidance || "")}</div>
    ${gifts}
    ${H("Keep showing up")}${follow}
    <div style="margin-top:18px;font-style:italic;color:#6f675b;">${esc(p.closing_encouragement || "")}</div>`;
  return WRAP(inner);
}

export function reminderEmailHtml({ when, gesture, headline }) {
  const inner = `
    <div style="font-family:Georgia,serif;font-size:18px;color:#3b362e;margin-bottom:6px;">A gentle nudge — ${esc(when)}</div>
    <div style="color:#6f675b;margin-bottom:14px;">You wanted to keep showing up${headline ? " for: " + esc(headline) : ""}.</div>
    <div style="background:#f4ead3;border-radius:14px;padding:16px 18px;font-size:16px;">${esc(gesture)}</div>
    <div style="margin-top:16px;color:#6f675b;">A small gesture now, when everyone else has moved on, is exactly the kind that's remembered.</div>`;
  return WRAP(inner);
}

// Proactive, standing nudge for a saved person's upcoming key date (companion).
export function peopleNudgeEmailHtml({ personName, label, whenText, planUrl }) {
  const inner = `
    <div style="font-family:Georgia,serif;font-size:18px;color:#3b362e;margin-bottom:6px;">${esc(personName)}'s ${esc(label)} is ${esc(whenText)}</div>
    <div style="color:#6f675b;margin-bottom:14px;">A gentle heads-up, so you have time to show up well.</div>
    <div style="background:#f4ead3;border-radius:14px;padding:16px 18px;font-size:15px;">Want a thoughtful, personal plan for ${esc(personName)}? <a href="${esc(planUrl)}" style="color:#a97350;font-weight:600;text-decoration:none;">Take two minutes here →</a></div>
    <div style="margin-top:16px;color:#6f675b;">Thinking of it ahead of everyone else is exactly what makes it land.</div>`;
  return WRAP(inner);
}

function stripHtml(h) { return String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
async function safeText(res) { try { return await res.text(); } catch { return "(no body)"; } }
