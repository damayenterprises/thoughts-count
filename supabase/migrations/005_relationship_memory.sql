-- TC-49 (Phase 1) — Relationship Memory spine + sovereignty.
--
-- The facts/households data layer everything else in the Pro memory build feeds, plus
-- the user's absolute edit/delete/export. Purely additive: new tables + nullable columns.
-- Nothing the live companion depends on is altered or dropped.
--
-- Column-naming note: the product spec (§3) sketches the owner as `owner_id`; every
-- existing table in this schema (people, key_dates, identifiers, …) names it `user_id`
-- and the RLS contract is literally `auth.uid() = user_id`, so we keep `user_id` here.
--
-- Engine vocabulary (fact_class, confidence, salience, supersede) lives ONLY in these
-- rows — spec principle 4 forbids it ever reaching the UI.
--
-- Apply via the Supabase Management API:
--   POST https://api.supabase.com/v1/projects/ntnlzfezdlbwxbrphknn/database/query
--   Authorization: Bearer <PAT>   (PAT in .env, SUPABASE_ACCESS_TOKEN)

-- ── Households — an OPTIONAL grouping for couples/families (spec §11) ────────────────
-- Two linked person records under one household, never a blended record. Individual-only
-- users (HR, bankers) simply never create one.
create table if not exists households (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  label      text,                          -- "The Hendersons"
  created_at timestamptz not null default now()
);

-- People gain an optional household link and the user-hard-delete tombstone.
alter table people add column if not exists household_id uuid references households(id) on delete set null;
alter table people add column if not exists deleted_at   timestamptz;  -- user hard-delete: excluded from every read + nudge

create table if not exists household_member (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,  -- denormalized for a clean RLS policy (mirrors identifiers)
  household_id uuid not null references households(id) on delete cascade,
  person_id    uuid not null references people(id) on delete cascade,
  role         text,                         -- spouse | partner | child | co-founder | null
  created_at   timestamptz not null default now(),
  unique (household_id, person_id)
);
create index if not exists idx_household_member_hh on household_member(household_id);

-- ── Facts — the memory spine (spec §3) ──────────────────────────────────────────────
-- A durable fact or a timestamped episode about a person OR a household (exactly one).
-- Bi-temporal: valid_from/valid_to close a fact when it's superseded; deleted_at is the
-- user's absolute hard-delete which excludes the row from EVERY read and nudge.
create table if not exists facts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  person_id     uuid references people(id)     on delete cascade,
  household_id  uuid references households(id) on delete cascade,
  subject       text not null,               -- "dad", "self", "daughter Ava"
  relation      text not null,               -- "health_status", "job", "hobby", "allergy", "note"
  object        text not null,               -- "sick", "started new job at Acme"
  fact_class    text not null default 'DURABLE'
                  check (fact_class in ('DURABLE','EPISODIC','MILESTONE','RECURRING','PREFERENCE')),
  raw_text      text,                        -- original phrasing (audit/trust)
  source        text not null
                  check (source in ('voice','scan','email','typed','import','derived')),
  provenance    text not null default 'user_stated'
                  check (provenance in ('user_stated','inferred')),
  confidence    real not null default 1.0,
  event_date    date,                        -- when it happened in the world
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz,                 -- NULL = currently valid
  superseded_by uuid references facts(id) on delete set null,
  surface_until date,                        -- soft nudge window; NULL = durable
  salience_base real not null default 1.0,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,                 -- user hard-delete: excluded from all reads
  -- Attach to exactly one owner-object: a person XOR a household (spec §3 / build plan).
  constraint facts_person_xor_household check (
    (person_id is not null)::int + (household_id is not null)::int = 1
  )
);
-- Active-read + supersession lookup paths. The partial indexes keep hard-deleted and
-- retired rows out of the hot path (person card reads only open, undeleted facts).
create index if not exists idx_facts_person    on facts(user_id, person_id)    where deleted_at is null;
create index if not exists idx_facts_household  on facts(user_id, household_id) where deleted_at is null;
create index if not exists idx_facts_supersede  on facts(user_id, person_id, subject, relation)
  where valid_to is null and deleted_at is null;

-- A RECURRING/MILESTONE fact with an event_date seeds a key_date (the schedule layer).
-- The link keeps seeding idempotent and lets a fact delete cascade to its seeded date.
alter table key_dates add column if not exists source_fact_id uuid references facts(id) on delete cascade;

-- ── Touches — lightweight "I reached out" / capture signal (spec §8/§9) ──────────────
-- Feeds self-snooze + fading-person detection later. NOT an activity log.
create table if not exists touches (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  person_id  uuid not null references people(id) on delete cascade,
  kind       text not null default 'reached_out',   -- reached_out | capture | ...
  at         timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_touches_person on touches(user_id, person_id);

-- ── RLS: owner-only on everything the user touches ──────────────────────────────────
alter table households       enable row level security;
alter table household_member  enable row level security;
alter table facts             enable row level security;
alter table touches           enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='households' and policyname='own_households') then
    create policy own_households on households for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='household_member' and policyname='own_household_member') then
    create policy own_household_member on household_member for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='facts' and policyname='own_facts') then
    create policy own_facts on facts for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename='touches' and policyname='own_touches') then
    create policy own_touches on touches for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
  end if;
end $$;
