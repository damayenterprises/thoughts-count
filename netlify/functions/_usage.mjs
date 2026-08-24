// Per-call Anthropic API usage + cost logging (Thoughts Count).
//
// Why this exists: Anthropic API spend was arriving only as opaque Stripe receipts
// with no attribution. This writes one row per Claude call — which function, model,
// tokens, cache split, and computed USD — to the `claude_usage` table, so David can
// see cost-per-plan / cost-per-capture instead of reverse-engineering it from receipts.
//
// FAIL-SOFT by contract (like _sendlog): never throws, never blocks the user response.
//
// Prices are per MILLION tokens, verified against the Anthropic pricing table
// (2026-08-24). Cache write = 5-min ephemeral (1.25x input); cache read = 0.1x input.
// Unknown model -> tokens still logged, cost_usd = null (never drop the row).

import { serviceClient, supabaseConfigured } from "./_supabase.mjs";

const PRICES = {
  "claude-sonnet-4-6": { in: 3.0, out: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5":  { in: 1.0, out: 5.0,  cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-opus-4-8":   { in: 5.0, out: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-7":   { in: 5.0, out: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
};

function priceKey(model) {
  if (!model) return null;
  if (PRICES[model]) return model;
  const stripped = model.replace(/-\d{8}$/, "");
  return PRICES[stripped] ? stripped : null;
}

export function computeCost(model, cols) {
  const key = priceKey(model);
  if (!key) return null;
  const p = PRICES[key];
  const cost =
    (cols.input_tokens * p.in +
      cols.output_tokens * p.out +
      cols.cache_write_tokens * p.cacheWrite +
      cols.cache_read_tokens * p.cacheRead) /
    1e6;
  return Math.round(cost * 1e6) / 1e6;
}

// Accepts the RAW Anthropic `usage` object (data.usage) so buffered call sites just
// pass it through. Streaming callers can pass the same shape assembled from SSE events.
export async function logClaudeUsage({ fn, model, usage, userId = null, meta = null }) {
  if (!fn || !usage || !supabaseConfigured()) return;
  try {
    const n = (v) => (Number.isFinite(v) ? v : 0);
    const cols = {
      input_tokens: n(usage.input_tokens),
      output_tokens: n(usage.output_tokens),
      cache_write_tokens: n(usage.cache_creation_input_tokens),
      cache_read_tokens: n(usage.cache_read_input_tokens),
      web_search_count: n(usage.server_tool_use?.web_search_requests),
    };
    await serviceClient()
      .from("claude_usage")
      .insert({
        fn,
        model: model || null,
        ...cols,
        cost_usd: computeCost(model, cols),
        user_id: userId || null,
        meta: meta == null ? null : meta,
      });
  } catch (err) {
    console.error(`[usage] could not log "${fn}":`, err?.message || err);
  }
}
