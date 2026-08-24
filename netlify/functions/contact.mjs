// Thoughts Count — "Contact us / Need help" form handler.
//
// Receives a short help request (email + message + which screen they were on) and emails it to
// care@thoughtscount.com with the sender set as reply-to, so a reply reaches them directly. This
// is the robust alternative to a bare mailto: link (which does nothing on a desktop with no mail
// app configured) — the message reaches us regardless of the visitor's setup.
//
// Available before AND after sign-in. Rate-limited so it can't be milked as a spam relay from our
// authenticated sending domain (protects SendGrid reputation, same guard as send-plan).

import { sendEmail } from "./_email.mjs";
import { guardPaid, envInt, clientIp } from "./_ratelimit.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }

  const email = String(body?.email || "").trim();
  const message = String(body?.message || "").trim().slice(0, 4000);
  const context = String(body?.context || "").trim().slice(0, 200);
  if (!EMAIL_RE.test(email)) return json(400, { error: "Please add a valid email so we can reply." });
  if (message.length < 2) return json(400, { error: "Please add a short message." });

  const guard = await guardPaid(req, {
    ipStore: "contact-ratelimit",
    capStore: "contact-dailycap",
    killFlag: "CONTACT_DISABLED",
    ipLimit: envInt("TC_CONTACT_IP_LIMIT", 8),
    dailyCap: envInt("TC_CONTACT_DAILY_CAP", 300),
  });
  if (!guard.ok) return json(429, { error: "Please wait a moment before sending again." });

  const ip = clientIp(req);
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2c2a26;font-size:15px;line-height:1.6;">
      <p style="margin:0 0 10px;"><b>New help request</b></p>
      <p style="margin:0 0 4px;"><b>From:</b> ${esc(email)}</p>
      <p style="margin:0 0 4px;"><b>Screen:</b> ${esc(context || "unknown")}</p>
      <p style="margin:0 0 12px;color:#8a8377;"><b>IP:</b> ${esc(ip || "unknown")}</p>
      <div style="white-space:pre-wrap;background:#f4f1ea;border-radius:12px;padding:14px 16px;">${esc(message)}</div>
    </div>`;
  const text = `New help request\nFrom: ${email}\nScreen: ${context || "unknown"}\nIP: ${ip || "unknown"}\n\n${message}`;

  const sent = await sendEmail({
    to: "care@thoughtscount.com",
    replyTo: email,
    subject: `Help request from ${email}`,
    html,
    text,
  });
  if (!sent.ok) return json(502, { error: "We couldn't send that just now. Please email care@thoughtscount.com directly." });

  return json(200, { ok: true });
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
