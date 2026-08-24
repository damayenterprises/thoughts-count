-- TC-139 — Send accountability log (ported from MAP-432).
-- One row every time a scheduled/automated send RUNS (even when it delivers 0), so the
-- send-watchdog can confirm each expected send actually fired. Service-role only (RLS).

CREATE TABLE IF NOT EXISTS send_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job text NOT NULL,                  -- stable job name, e.g. 'reminders-cron', 'nudges-cron'
  status text NOT NULL DEFAULT 'ok',  -- 'ok' | 'partial' | 'error' | 'skipped'
  audience int NOT NULL DEFAULT 0,    -- intended recipients
  delivered int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  meta jsonb,                         -- freeform: window, error message, etc.
  fired_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS send_log_job_fired_idx ON send_log (job, fired_at DESC);

ALTER TABLE send_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "send_log service role only" ON send_log;
CREATE POLICY "send_log service role only"
  ON send_log FOR ALL
  USING (auth.role() = 'service_role');
