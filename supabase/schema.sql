-- Thoughts Count — companion schema.
-- Sign-in/identity is handled by Supabase Auth (auth.users). Every row below is
-- scoped to its owner via user_id = auth.uid(), enforced by Row Level Security,
-- so one user can never see another's people, dates, or plans.

create extension if not exists "pgcrypto";

-- The people who matter to a user (a manager's reports, a friend group, family).
create table if not exists people (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  relationship text,                       -- "Someone I manage", "Close friend", ...
  notes        text,                        -- what they're like / what they're going through
  location     text,                        -- optional, for local gift ideas
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Key dates worth showing up for. Recurring dates (birthdays, work anniversaries)
-- fire every year on the same month/day; one-offs fire once.
create table if not exists key_dates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  person_id   uuid not null references people(id) on delete cascade,
  label       text not null,               -- "Birthday", "Work anniversary", "Started new job"
  kind        text not null default 'custom', -- birthday | work_anniversary | moment | custom
  event_date  date not null,
  recurs      boolean not null default false,
  lead_days   integer not null default 7,  -- how many days before the date to nudge (0 = on the day)
  created_at  timestamptz not null default now()
);

-- Plans a user saved and attached to a person, so context carries over next time.
create table if not exists saved_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  person_id   uuid references people(id) on delete set null,
  plan_title  text,
  occasion    text,
  plan        jsonb not null,
  created_at  timestamptz not null default now()
);

-- Dedupe record so a proactive nudge for a given date fires at most once per year.
create table if not exists nudge_log (
  id          uuid primary key default gen_random_uuid(),
  key_date_id uuid not null references key_dates(id) on delete cascade,
  occurrence  date not null,
  sent_at     timestamptz not null default now(),
  unique (key_date_id, occurrence)
);

create index if not exists idx_people_user      on people(user_id);
create index if not exists idx_key_dates_user    on key_dates(user_id);
create index if not exists idx_key_dates_person  on key_dates(person_id);
create index if not exists idx_saved_plans_user  on saved_plans(user_id);

-- Row Level Security: users touch only their own rows.
alter table people      enable row level security;
alter table key_dates   enable row level security;
alter table saved_plans enable row level security;
alter table nudge_log   enable row level security;   -- no policy = server (service_role) only

create policy "own_people"      on people      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_key_dates"   on key_dates   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_saved_plans" on saved_plans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
