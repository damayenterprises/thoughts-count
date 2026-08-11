-- TC-117 (PROPOSED — NOT APPLIED). Store each plan's valence at save time so the grief
-- guard is a stored SAFETY control, not a lossy re-derivation from an occasion string.
-- Apply only on David's explicit go.
alter table saved_plans
  add column if not exists valence text
  check (valence in ('celebration','hard_time','gratitude','other','unspecified'));

-- One-time back-fill for existing rows. Conservative: any HARD keyword => hard_time so the
-- grief guard errs safe. Runs ONLY on David's go (Builder executes after approval, not now).
-- (Illustrative; the Builder may instead back-fill via a script that reuses classifyValence
--  from _analytics.mjs so the keyword set can't drift. Do NOT run automatically.)
-- update saved_plans set valence = '<classifyValence(coalesce(occasion, plan_title))>'
--   where valence is null;
