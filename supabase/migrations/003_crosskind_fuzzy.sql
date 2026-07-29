-- TC-47 + TC-46 Fix 2 — broaden the dedup matcher so cross-kind + nickname near-dups
-- can be PROPOSED (never auto-merged). Two changes to tc38_fuzzy_person_match:
--   (1) Drop the hard `contact_kind = 'contact'` filter and RETURN contact_kind, so a
--       book-of-business import can see (and propose a merge onto) a personal person.
--       Cross-kind is always propose-only in JS — the RPC just surfaces the candidate.
--   (2) Also surface SAME-SURNAME candidates (UNION with the trigram matches), because
--       nickname/diminutive pairs (Bill/William, Sam/Samuel) score ~0 on name trigram
--       and would never appear otherwise. The JS layer (firstNamesEquivalent in
--       _names.mjs) makes the final name-equivalence decision; this just feeds it the
--       right candidate set. surname = lowercased last whitespace token.
--
-- Purely a function replacement — no table/column/data changes, fully reversible.
--
-- Apply via the Supabase Management API (same pattern as 002_pro_contacts.sql):
--   POST https://api.supabase.com/v1/projects/ntnlzfezdlbwxbrphknn/database/query
--   Authorization: Bearer <PAT>   (PAT in .env)
--
-- ── ROLLBACK (one step) ─────────────────────────────────────────────────────────
-- If the broadened matching misbehaves, restore prior behavior by re-applying the
-- ORIGINAL definition from 002_pro_contacts.sql (scoped to contact_kind='contact',
-- limit 5, no contact_kind in the return). Quoted here verbatim so it's copy-paste:
--
--   drop function if exists tc38_fuzzy_person_match(uuid, text, real);
--   create or replace function tc38_fuzzy_person_match(
--     p_user_id uuid, p_name text, p_threshold real default 0.4
--   ) returns table(person_id uuid, name text, score real, has_identifier boolean)
--   language sql stable as $$
--     select id, name, similarity(name, p_name) as score,
--            (primary_email is not null or primary_phone is not null) as has_identifier
--     from people
--     where user_id = p_user_id
--       and contact_kind = 'contact'
--       and p_name is not null and length(trim(p_name)) > 0
--       and similarity(name, p_name) >= p_threshold
--     order by score desc
--     limit 5;
--   $$;
-- (Restoring the old signature also drops the contact_kind column from the result; the
--  JS reader tolerates a missing contact_kind, so this rollback is safe with A2 in place.)
-- ────────────────────────────────────────────────────────────────────────────────

drop function if exists tc38_fuzzy_person_match(uuid, text, real);
create or replace function tc38_fuzzy_person_match(
  p_user_id   uuid,
  p_name      text,
  p_threshold real default 0.4
) returns table(person_id uuid, name text, score real, has_identifier boolean, contact_kind text)
language sql stable as $$
  select id, name, similarity(name, p_name) as score,
         (primary_email is not null or primary_phone is not null) as has_identifier,
         contact_kind
  from people
  where user_id = p_user_id
    and p_name is not null and length(trim(p_name)) > 0
    and (
      -- trigram band (spelling variants: Sara/Sarah, Jon/John)
      similarity(name, p_name) >= p_threshold
      -- OR same surname (feeds the JS nickname/diminutive check: Bill/William, Sam/Samuel,
      -- which score ~0 on trigram). Surname = lowercased last whitespace token of each name.
      or lower(split_part(name, ' ', array_length(regexp_split_to_array(trim(name), '\s+'), 1)))
         = lower(split_part(p_name, ' ', array_length(regexp_split_to_array(trim(p_name), '\s+'), 1)))
    )
  order by score desc
  limit 25;  -- surname net can return several; JS applies firstNamesEquivalent + guards
$$;
