-- TC — "Tell Della, she remembers": multiple custom-timed reminders per date/situation.
-- STATUS: PROPOSED — NOT APPLIED. Apply only on David's explicit go (Agent Infra Guardrail).
-- Apply via the Supabase Management API (PAT in .env SUPABASE_ACCESS_TOKEN) — AFTER approval.
--
-- Purely additive. Nothing existing is altered destructively.
--   • Every current key_date keeps working: its single lead_days still fires exactly as today
--     (nudges-cron treats a key_date with NO situation_reminders rows as one implicit reminder
--     at its own lead_days — see spec §5). No backfill required.
--   • A "situation" is just a key_date with kind='situation', linked (via source_fact_id) to the
--     fact that carries its context, with N situation_reminders children.

-- 1) Allow the new kind. key_dates.kind is a plain text column with no CHECK constraint today
--    (schema.sql is a DEFAULT only), so no constraint change is needed. Documented here:
--    kind ∈ birthday | work_anniversary | moment | custom | situation.

-- 2) The reminders child table: many per key_date, each its own offset + per-occurrence dedup.
create table if not exists situation_reminders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,   -- denormalized for clean RLS (mirrors household_member/identifiers)
  key_date_id  uuid not null references key_dates(id) on delete cascade,     -- the situation/date this fires around
  lead_days    integer not null default 0,        -- days BEFORE the occurrence to nudge (0 = on the day; negatives allowed = after)
  label        text,                              -- optional per-reminder note ("first check-in", "day of"); nudge copy falls back to the key_date label
  active       boolean not null default true,     -- soft on/off without deleting history
  created_at   timestamptz not null default now()
);

create index if not exists idx_situation_reminders_kd
  on situation_reminders(key_date_id) where active;
create index if not exists idx_situation_reminders_user
  on situation_reminders(user_id);

-- 3) Dedup: nudge_log dedups per date+occurrence today (unique (key_date_id, occurrence)). With
--    several reminders on one date we must dedup per (reminder, occurrence). Add a nullable column
--    and widen the unique key so legacy single-reminder rows (reminder_id IS NULL) are untouched.
alter table nudge_log add column if not exists reminder_id uuid references situation_reminders(id) on delete cascade;

-- Replace the (key_date_id, occurrence) unique with one that includes the reminder. A NULL
-- reminder_id represents the legacy "the key_date's own single lead_days" occurrence, so old rows
-- keep deduping exactly as before, and each new reminder dedups independently.
--   Postgres treats NULLs as distinct in a UNIQUE, which is the behavior we want:
--   (kd, occ, NULL) stays a single legacy slot; (kd, occ, r1), (kd, occ, r2) are independent.
alter table nudge_log drop constraint if exists nudge_log_key_date_id_occurrence_key;
create unique index if not exists nudge_log_kd_occ_reminder_uniq
  on nudge_log(key_date_id, occurrence, reminder_id);

-- 4) RLS — owner-only, identical contract to every other table (auth.uid() = user_id).
alter table situation_reminders enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='situation_reminders' and policyname='own_situation_reminders') then
    create policy own_situation_reminders on situation_reminders
      for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
  end if;
end $$;
-- nudge_log has NO policy by design (service-role/server only) — unchanged.
