-- TC-117 (PROPOSED — NOT APPLIED). One row per (person-plan) Della has circled back on,
-- so an outcome is never re-asked and the per-person cooldown survives a device switch.
-- Purely additive. Apply only on David's explicit go.
create table if not exists plan_checkins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  saved_plan_id uuid references saved_plans(id) on delete cascade, -- nullable: a Mechanism-B check-back may not be tied to one plan
  mechanism     text not null check (mechanism in ('A','B')),
  asked_at      timestamptz not null default now(),
  outcome       text check (outcome in ('went_well','fell_flat','unclear')), -- nullable; ALWAYS null for grief-care-only + Mechanism B
  unique (user_id, saved_plan_id, mechanism)  -- idempotent per plan+mechanism; a reload can't double-ask
);
create index if not exists idx_plan_checkins_user on plan_checkins(user_id);
create index if not exists idx_plan_checkins_person_asked on plan_checkins(user_id, saved_plan_id, asked_at);
alter table plan_checkins enable row level security;
-- Owner-only. The /api/plan-checkin endpoint uses the service client under requireUser,
-- so a service-role write also satisfies RLS; this policy covers any direct user reads.
create policy own_plan_checkins on plan_checkins for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
