// Thoughts Count — shared abuse/cost guards for the paid, anonymous endpoints.
//
// The costly public paths (/api/generate → Anthropic + Google Places, /api/converse →
// Anthropic) are open by design (no sign-in), so a script could loop them and run up a
// real bill — the Places spend even hits a SHARED Google account. These guards bound that:
//
//   1. Per-IP sliding window  — stops a naive single-source flood.
//   2. Global daily cap        — the real backstop: bounds the worst-case DAILY bill even
//                                against rotating IPs. Resets each UTC day.
//   3. Kill switch (env flag)  — instant manual brake if anything slips past the caps.
//
// Every number is an env var so the ceilings can be raised/lowered LIVE (Netlify env change,
// no deploy) during the launch without touching code. All guards fail OPEN — a Blobs hiccup
// must never take down a legit user; the caps are a cost ceiling, not a correctness gate.

import { getStore } from "@netlify/blobs";

// Read config from Netlify.env first (v2 runtime), then process.env (local dev).
export function env(name) {
  try {
    if (typeof Netlify !== "undefined" && Netlify.env?.get) {
      const v = Netlify.env.get(name);
      if (v != null && v !== "") return v;
    }
  } catch { /* not on Netlify runtime */ }
  return process.env[name];
}

export function envInt(name, dflt) {
  const raw = env(name);
  const n = raw != null ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : dflt;
}

export function clientIp(req) {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0] ||
    ""
  ).trim();
}

// Kill switch: set <flag>=1 / true / on / yes to instantly disable a paid endpoint.
export function killed(flag) {
  const v = String(env(flag) || "").toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

// Per-IP sliding-window counter. Light guard — never throws, never blocks on limiter failure.
async function ipOverLimit(req, storeName, limit, windowMs) {
  try {
    const ip = clientIp(req);
    if (!ip) return false; // can't identify → don't penalize a real user
    const store = getStore(storeName);
    const now = Date.now();
    const rec = (await store.get(ip, { type: "json" })) || { count: 0, start: now };
    if (now - rec.start > windowMs) { rec.count = 0; rec.start = now; }
    rec.count += 1;
    await store.setJSON(ip, rec);
    return rec.count > limit;
  } catch { return false; }
}

// Global daily cap — one counter keyed by UTC date. Counts every attempt so an attacker
// can't get free retries. dailyLimit<=0 disables it.
async function overDailyCap(storeName, dailyLimit) {
  if (!dailyLimit || dailyLimit <= 0) return false;
  try {
    const store = getStore(storeName);
    const day = new Date().toISOString().slice(0, 10);
    const rec = (await store.get(day, { type: "json" })) || { count: 0 };
    rec.count += 1;
    await store.setJSON(day, rec);
    return rec.count > dailyLimit;
  } catch { return false; }
}

// One call that runs all three guards for a paid endpoint. Returns:
//   { ok: true }                          → proceed
//   { ok: false, reason, status }         → block (reason: "disabled" | "rate" | "capacity")
// Caller maps the reason to its own response shape (202+blob error, or j({say},200), etc).
export async function guardPaid(req, {
  ipStore,           // Blob store name for the per-IP counter
  capStore,          // Blob store name for the global daily counter
  killFlag,          // env flag name for the kill switch
  ipLimit,           // per-IP allowance per window
  ipWindowMs = 10 * 60 * 1000,
  dailyCap,          // site-wide daily allowance
}) {
  if (killFlag && killed(killFlag)) {
    return { ok: false, reason: "disabled", status: 503 };
  }
  if (await overDailyCap(capStore, dailyCap)) {
    return { ok: false, reason: "capacity", status: 429 };
  }
  if (await ipOverLimit(req, ipStore, ipLimit, ipWindowMs)) {
    return { ok: false, reason: "rate", status: 429 };
  }
  return { ok: true };
}
