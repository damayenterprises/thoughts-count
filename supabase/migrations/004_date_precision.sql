-- TC-43: preserve imported partial dates honestly. Placeholder day/month is never shown
-- or nudged; date_precision governs display + reminder eligibility. Purely additive.
--
-- Apply via the Supabase Management API:
--   POST https://api.supabase.com/v1/projects/ntnlzfezdlbwxbrphknn/database/query
--   Authorization: Bearer <PAT>   (PAT in .env, SUPABASE_ACCESS_TOKEN)
--
-- Legacy rows default to 'day' (correct — everything imported so far is day-precise,
-- because partial dates were dropped by normalizeDate before this feature).
alter table key_dates add column if not exists date_precision text not null default 'day'
  check (date_precision in ('day','month','year'));
