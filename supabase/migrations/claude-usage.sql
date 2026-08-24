-- Anthropic API spend attribution (TC cost logging).
-- One row per Claude call (converse / capture / extract-image / generate-background /
-- import-analyze): which fn, model, tokens, cache split, computed USD. Written via the
-- service key by netlify/functions/_usage.mjs; read by the daily spend digest.
-- RLS on with NO policies -> only the service key touches it (cost data is never user-facing).
create table if not exists public.claude_usage (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  fn text not null,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,   -- 5-min ephemeral cache writes
  cache_read_tokens integer not null default 0,
  web_search_count integer not null default 0,
  cost_usd numeric(12,6),                            -- null if model unpriced
  user_id uuid,
  meta jsonb
);
create index if not exists claude_usage_created_at_idx on public.claude_usage (created_at);
create index if not exists claude_usage_fn_idx on public.claude_usage (fn);
alter table public.claude_usage enable row level security;
