-- TC-38 — Pro Contact Ingestion. Purely additive: new tables + nullable columns +
-- extensions. Does not alter or drop anything the live companion depends on.
--
-- Data model = Option B (spec decision 1): the SAME people table holds both the
-- intimate personal circle and the book-of-business roster, distinguished by
-- contact_kind. One engine (plans + key-date nudges) runs across both; the UI
-- splits them (roster gets its own dense surface).
--
-- Apply via the Supabase Management API:
--   POST https://api.supabase.com/v1/projects/ntnlzfezdlbwxbrphknn/database/query
--   Authorization: Bearer <PAT>   (PAT in .env)

create extension if not exists pg_trgm;
create extension if not exists fuzzystrmatch;

-- Extend people (Option B): personal vs book-of-business, denormalized primaries.
alter table people add column if not exists contact_kind  text not null default 'personal'; -- personal | contact
alter table people add column if not exists primary_email  text;
alter table people add column if not exists primary_phone  text;  -- E.164
-- TC-44: once the user has answered "business or personal?" for a person, lock the kind
-- so a re-import never re-asks (a contact import matching a personal person prompts once).
alter table people add column if not exists kind_locked   boolean not null default false;
create index if not exists idx_people_kind on people(user_id, contact_kind);
create index if not exists idx_people_name_trgm on people using gin (name gin_trgm_ops);

-- The dedup + convergence spine. Every identifier ever seen for a person.
create table if not exists identifiers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  person_id  uuid not null references people(id) on delete cascade,
  type       text not null,   -- email | phone | fub_id | csv_natural_key
  value      text not null,   -- normalized
  created_at timestamptz not null default now(),
  unique (user_id, type, value)
);
create index if not exists idx_identifiers_person on identifiers(person_id);

-- Provenance + idempotency per source.
create table if not exists contact_sources (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  person_id    uuid not null references people(id) on delete cascade,
  source       text not null,       -- csv | fub | manual
  external_id  text,                -- FUB person id
  natural_key  text,                -- sha256 of best identifier (CSV)
  last_seen_at timestamptz not null default now(),
  unique (user_id, source, natural_key),
  unique (user_id, source, external_id)
);

create table if not exists import_batches (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  filename   text,
  added      int  not null default 0,
  updated    int  not null default 0,
  needs_review int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists review_candidates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  batch_id     uuid references import_batches(id) on delete cascade,
  existing_person_id uuid references people(id) on delete cascade,
  incoming     jsonb not null,      -- the normalized incoming row
  score        real,
  created_at   timestamptz not null default now()
);

create table if not exists fub_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  fub_account_id text,
  owner_info     jsonb,
  tokens_enc     text not null,     -- AES-256-GCM ciphertext (server-only key)
  field_map      jsonb,             -- {fub_custom_field_id: 'birthday'|'work_anniversary'|'closing'}
  webhook_state  jsonb,
  sync_cursor    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, fub_account_id)
);

-- RLS: owner-only on everything users touch. fub_connections holds secrets → NO policy
-- (service-role only), mirroring nudge_log.
alter table identifiers       enable row level security;
alter table contact_sources   enable row level security;
alter table import_batches     enable row level security;
alter table review_candidates  enable row level security;
alter table fub_connections    enable row level security;   -- no policy = service-role only

create policy own_identifiers      on identifiers      for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy own_contact_sources  on contact_sources  for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy own_import_batches   on import_batches   for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy own_review_candidates on review_candidates for all using (auth.uid()=user_id) with check (auth.uid()=user_id);

-- Fuzzy person match (the dedup core's Tier-2 "propose, never auto-merge" step).
-- PostgREST can't express similarity() in a plain select, so the import function
-- calls this RPC (service-role, user_id passed explicitly). Scoped to book-of-
-- business contacts only, so a CSV row never fuzzy-collides with the intimate
-- personal circle — deterministic email/phone matches still converge across kinds.
-- Returns has_identifier so the import can apply identifier-first dedup: a name-only
-- similarity to a person who has a DIFFERENT known email/phone is not a duplicate.
drop function if exists tc38_fuzzy_person_match(uuid, text, real);
create or replace function tc38_fuzzy_person_match(
  p_user_id   uuid,
  p_name      text,
  p_threshold real default 0.4
) returns table(person_id uuid, name text, score real, has_identifier boolean)
language sql stable as $$
  select id, name, similarity(name, p_name) as score,
         (primary_email is not null or primary_phone is not null) as has_identifier
  from people
  where user_id = p_user_id
    and contact_kind = 'contact'
    and p_name is not null and length(trim(p_name)) > 0
    and similarity(name, p_name) >= p_threshold
  order by score desc
  limit 5;
$$;
