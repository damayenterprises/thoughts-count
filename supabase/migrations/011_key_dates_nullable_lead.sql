-- TC — "Tell Della, she remembers": make key_dates.lead_days NULLABLE so a captured one-off the
-- user set NO reminder on can be REMEMBERED without auto-nudging (della-situational-no-formula).
--
-- STATUS: PROPOSED — DO NOT APPLY without David's approval (Agent Infra Guardrail). Apply via the
--   Supabase Management API (PAT in .env SUPABASE_ACCESS_TOKEN) AFTER approval.
--
-- WHY: key_dates.lead_days is `integer not null default 7` (schema.sql). That default means every
-- dated capture with no user-set reminder still fires a reflexive 7-day nudge — exactly the
-- formulaic cadence the guardrail forbids. Making the column nullable lets the capture path seed a
-- one-off with lead_days = NULL, which the nudge cron reads as "remember this date, do NOT
-- auto-nudge" (nudges-cron.mjs: a legacy key_date with lead_days IS NULL and no situation_reminders
-- produces zero fires).
--
-- BACKWARD-COMPAT (load-bearing):
--   • Existing rows are unaffected — they keep their integer lead_days and fire exactly as today.
--   • RECURRING dates (birthdays, anniversaries) still seed a real lead_days (7) and nudge as before;
--     only NON-recurring captures with zero user-set reminders seed NULL.
--   • The DEFAULT stays 7, so any legacy insert path that omits lead_days is unchanged.
--   • Purely additive/relaxing: dropping NOT NULL never invalidates existing data.
--
-- Until this is applied, _memory.maybeSeedKeyDate() degrades gracefully: a NULL insert that the
-- still-NOT-NULL column rejects is retried at lead_days = 7 (the capture is never lost; the nit is
-- simply not yet fixed). After apply, the NULL insert succeeds and the date is genuinely non-nudging.

alter table key_dates alter column lead_days drop not null;
-- Keep the default at 7 so omitted-lead_days inserts behave exactly as before.
alter table key_dates alter column lead_days set default 7;
