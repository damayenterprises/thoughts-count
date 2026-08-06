-- TC-66 Phase 3b — conversation memory WRITE-BACK: allow the new 'conversation' capture source.
--
-- 3b routes a memory-aware conversation about a KNOWN saved person through the EXISTING
-- authenticated capture pipeline (capture-extract.mjs) with source:'conversation', so those
-- captures are tagged distinctly from typed/voice/scan/email/import. Two CHECK constraints gate
-- that column and must both learn the new value, or the write 500s at the DB:
--   • captures.source  (006_captures.sql) — the raw capture row.
--   • facts.source     (005_relationship_memory.sql) — writeFactsToPerson stamps each written
--                        fact with the same source, so the fact table must accept it too.
--
-- Purely additive: widens two allow-lists, alters no data, breaks nothing already stored.
--
-- Apply via the Supabase Management API:
--   POST https://api.supabase.com/v1/projects/<SUPABASE_PROJECT>/database/query
--   Authorization: Bearer <SUPABASE_ACCESS_TOKEN>   (both in .env)

-- facts.source: add 'conversation' (keep 'derived', which 005 introduced).
alter table facts drop constraint if exists facts_source_check;
alter table facts add constraint facts_source_check
  check (source in ('voice','scan','email','typed','import','derived','conversation'));

-- captures.source: add 'conversation'.
alter table captures drop constraint if exists captures_source_check;
alter table captures add constraint captures_source_check
  check (source in ('voice','scan','email','typed','import','conversation'));
