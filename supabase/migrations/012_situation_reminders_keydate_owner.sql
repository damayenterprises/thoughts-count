-- TC — "Tell Della, she remembers": defense-in-depth so a reminder can only ever attach to the
-- inserting user's OWN key_date.
-- STATUS: PROPOSED — NOT APPLIED. Apply only on David's explicit go (Agent Infra Guardrail).
-- Apply via the Supabase Management API (PAT in .env SUPABASE_ACCESS_TOKEN) — AFTER approval.
-- Depends on 010_situation_reminders.sql (must be applied — it is, live).
--
-- WHY
-- The 010 policy `own_situation_reminders` (FOR ALL) checks only that the ROW's user_id is the
-- caller: `with check (auth.uid() = user_id)`. It does NOT check that the referenced key_date_id
-- belongs to the same user. So an authenticated user could insert a reminder with their OWN user_id
-- but pointing at ANOTHER user's key_date_id (a value they'd have to guess/leak — but we don't want
-- to rely on unguessability). The cron already refuses to fire a cross-owned reminder, but we want
-- the guarantee enforced at WRITE time too. This is purely a tightening — no new capability.
--
-- APPROACH: strengthen the policy's WITH CHECK (chosen over a trigger).
--   • It is declarative, lives next to the existing RLS, and needs no function/definer to reason
--     about. The added clause is an EXISTS subquery over key_dates that runs AS THE USER, so it can
--     only see the user's OWN key_dates (key_dates already has owner-only RLS). Therefore the
--     subquery returns a row ONLY when the referenced key_date is the caller's own — exactly the
--     invariant we want, with no extra privilege.
--   • A trigger would need SECURITY DEFINER (to read key_dates regardless of RLS) and hand-rolled
--     ownership logic; the policy subquery expresses the same rule more simply and safely.
--
-- WHY LEGIT CLIENT WRITES STILL PASS
-- The People UI inserts situation_reminders directly (under RLS) onto the user's OWN key_dates.
-- For such an insert: user_id = auth.uid() (unchanged first clause), AND the referenced key_date is
-- one the user owns, so `exists (select 1 from key_dates kd where kd.id = NEW.key_date_id and
-- kd.user_id = auth.uid())` is TRUE (the row is visible to them under key_dates' RLS). Both clauses
-- hold → the insert passes exactly as before. Server-side seeds run with the service role, which
-- bypasses RLS entirely, so they are unaffected too.
--
-- WHY A CROSS-USER WRITE FAILS
-- If a user inserts a reminder with their own user_id but a key_date_id owned by SOMEONE ELSE, the
-- EXISTS subquery finds no matching row (that key_date is invisible to them under key_dates' RLS,
-- and its user_id ≠ auth.uid() anyway) → WITH CHECK is false → the insert is rejected with an RLS
-- violation. The USING clause (owner read/update/delete) is unchanged.

do $$ begin
  if exists (select 1 from pg_policies where tablename='situation_reminders' and policyname='own_situation_reminders') then
    drop policy own_situation_reminders on situation_reminders;
  end if;

  create policy own_situation_reminders on situation_reminders
    for all
    using (auth.uid() = user_id)
    with check (
      auth.uid() = user_id
      and exists (
        select 1 from key_dates kd
        where kd.id = situation_reminders.key_date_id
          and kd.user_id = auth.uid()
      )
    );
end $$;

-- MANUAL VERIFICATION (post-apply, run in the SQL editor / Management API as two real users):
--   1) Legit own-key_date insert SUCCEEDS:
--        - As user A (a real session/JWT, NOT service role), pick one of A's own key_dates KD_A.
--        - insert into situation_reminders (user_id, key_date_id, lead_days)
--            values (auth.uid(), 'KD_A', 3);
--        - Expect: 1 row inserted (unchanged from today).
--   2) Cross-user key_date insert FAILS:
--        - Still as user A, take a key_date KD_B that belongs to user B.
--        - insert into situation_reminders (user_id, key_date_id, lead_days)
--            values (auth.uid(), 'KD_B', 3);
--        - Expect: ERROR "new row violates row-level security policy for table
--          \"situation_reminders\"" (the EXISTS clause is false — KD_B isn't A's).
--   3) Regression: the app's confirm-card save (which seeds situation_reminders via the service
--      role) still works — service role bypasses RLS, so it is unaffected. And a normal UI reminder
--      add/remove on your OWN date still saves.
