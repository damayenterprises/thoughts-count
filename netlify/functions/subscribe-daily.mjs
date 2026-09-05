// Thoughts Count — TC-174 Surface 2: the low-commitment "daily thought" email opt-in.
//
// Catches the majority of visitors who never finish a plan: on the home daily-thought bar and at
// the foot of a guide, Della offers to send one small thought each morning. This endpoint stores
// the subscriber (deduped by a one-way hash of the email so re-opt-in is idempotent) and logs the
// SAME `email_submitted` analytics event a plan-email opt-in does, tagged source:"daily_thought"
// so growth counts see it as a unique captured email (the whole point of the ticket).
//
// The email is stored in the clear in a private Blob store (we must be able to actually send the
// daily line); analytics only ever sees the hash. Fail-soft everywhere: a Blobs hiccup returns a
// clean error, and analytics never blocks the opt-in.

import { getStore } from "@netlify/blobs";
import { logEvent, hashEmail, isTestEmail } from "./_analytics.mjs";
import { guardPaid, envInt } from "./_ratelimit.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_SOURCE = new Set(["home", "guide"]);
export const SUBSCRIBER_STORE = "daily-subscribers";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }

  const email = (body?.email || "").trim();
  if (!EMAIL_RE.test(email)) return json(400, { error: "Please enter a valid email address." });
  const source = VALID_SOURCE.has(body?.source) ? body.source : "home";

  // Abuse guard: this endpoint writes an address we will later email from our authenticated domain.
  // Cap it per-IP + site-wide (same idiom as send-plan) so it can't be milked to seed a spam list.
  // Fails open on limiter error.
  const guard = await guardPaid(req, {
    ipStore: "subscribe-ratelimit",
    capStore: "subscribe-dailycap",
    killFlag: "SUBSCRIBE_DISABLED",
    ipLimit: envInt("TC_SUBSCRIBE_IP_LIMIT", 12),
    dailyCap: envInt("TC_SUBSCRIBE_DAILY_CAP", 1000),
  });
  if (!guard.ok) return json(429, { error: "Please wait a moment before trying again." });

  const hash = await hashEmail(email);
  let created = true;
  try {
    const store = getStore(SUBSCRIBER_STORE);
    const existing = await store.get(hash, { type: "json" });
    if (existing && existing.active !== false) {
      created = false; // already subscribed and active — idempotent success, no duplicate row
    } else {
      // New, or a previously-unsubscribed address opting back in: (re)activate, keep a stable token.
      const token = existing?.token || newToken();
      await store.setJSON(hash, {
        email,
        source,
        active: true,
        token,
        subscribedAt: new Date().toISOString(),
        lastSentDay: existing?.lastSentDay || null,
      });
    }
  } catch (err) {
    console.error("subscribe store error", err);
    return json(502, { error: "We couldn't save that just now. Please try again." });
  }

  // Record a unique-email submission (hashed, never stored in the clear here). Insider/test
  // addresses and agent sessions are flagged so growth counts stay clean. source lets the digest
  // tell a daily-thought opt-in apart from a plan-email opt-in.
  try {
    await logEvent("email_submitted", {
      emailHash: hash,
      insider: isTestEmail(email),
      sid: (body?.sid ? String(body.sid).slice(0, 40) : undefined),
      source: "daily_thought",
      channel: source, // home | guide
      is_new: created,
    }, { test: !!body?.test });
  } catch (e) { console.error("subscribe analytics failed", e); }

  return json(200, { ok: true, created });
};

function newToken() {
  const raw = globalThis.crypto?.randomUUID?.() || (Math.random().toString(36).slice(2) + Date.now().toString(36));
  return String(raw).replace(/-/g, "");
}
function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
