-- TC-50 (Phase 2) — the capture lifecycle: the To-Review inbox that every intake door
-- (typed today; voice/scan/email later) lands in. One extract → resolve → confirm path.
--
-- Purely additive: one new table + RLS. Nothing the live app depends on is altered.
--
-- A capture is the raw thing the user said/forwarded/scanned, plus the engine's PROPOSED
-- reading of it (who it's about + the facts to save), held until it's either written
-- (Level A: confident — status 'confirmed', facts already seeded) or waiting for a human
-- glance (Level B: ambiguous — status 'pending', nothing written to a person yet). The
-- confirmation model is spec §6; the levels are computed in _capture.mjs.
--
-- Column-naming note: mirrors the rest of the schema — owner is `user_id`, RLS is
-- `auth.uid() = user_id` (see 005_relationship_memory.sql for the rationale).
--
-- Apply via the Supabase Management API:
--   POST https://api.supabase.com/v1/projects/ntnlzfezdlbwxbrphknn/database/query
--   Authorization: Bearer <PAT>   (PAT in .env, SUPABASE_ACCESS_TOKEN)

create table if not exists captures (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,

  raw_text              text,                       -- what the user typed/said (audit + "what we heard")
  source                text not null default 'typed'
                          check (source in ('voice','scan','email','typed','import')),

  -- Lifecycle. 'pending' = waiting in To-Review (nothing written to a person). 'confirmed' =
  -- facts have been seeded (Level A wrote them at capture time; Level B writes them on the
  -- user's confirm). 'discarded' = the user threw it away.
  status                text not null default 'pending'
                          check (status in ('pending','confirmed','discarded')),

  -- Who the engine thinks this is about, and how sure it is. proposed_person_id is null for a
  -- brand-new-person capture (the user confirms to create them). match_confidence is the
  -- resolution score (0..1); match_evidence is the PLAIN-LANGUAGE reason shown to the user
  -- ("the Maria in Denver you noted in June") — never engine vocabulary (spec §7).
  proposed_person_id    uuid references people(id)     on delete set null,
  proposed_household_id uuid references households(id) on delete set null,
  match_confidence      real,
  match_evidence        text,

  -- The engine's structured reading: an array of proposed facts (subject/relation/object/
  -- fact_class/event_date/provenance/confidence/suggested_gesture) plus person hints. One
  -- utterance may yield several facts across several subjects — all live here until confirmed.
  parsed                jsonb not null default '{}'::jsonb,

  -- True when captured from within a person's card (the mic/scan/add lived on Maria) — identity
  -- is 100% right by construction, so resolution was skipped and this is always Level A.
  context_locked        boolean not null default false,

  -- Housekeeping horizon for sensitive raw material (scanned images, forwarded email bodies —
  -- Phase 6/7). A user's own typed note is NOT sensitive; its durable audit is the per-fact
  -- raw_text (spec §3), so the typed door leaves this null.
  purge_after           timestamptz,

  created_at            timestamptz not null default now(),
  resolved_at           timestamptz                 -- when it left 'pending' (confirmed/discarded)
);

-- The To-Review surface reads pending captures newest-first; the badge counts them.
create index if not exists idx_captures_pending on captures(user_id, created_at desc)
  where status = 'pending';

alter table captures enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='captures' and policyname='own_captures') then
    create policy own_captures on captures for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
  end if;
end $$;
