# TC-138 — "A daily thought" (Della's daily reflection) — Implementation Spec

**Author:** The Architect (pipeline agent 1) · **Status:** SPEC — not built · **Linear:** TC-138
**Scope:** cross-repo (Thoughts Count app + Marketing OS). No application code in this doc; work-packages below.
**Guardrails honored:** migrations/config are *proposed, not applied*; reuse MOS infra over rebuilding; 3-reviewer gate is non-negotiable; TC grief-sensitivity; one-voice (Della); no AI tells; publish stays OFF (`publish_enabled=false`) until David flips it.

---

## 0. What we are building

ONE short daily reflection in Della's voice, per day, that lands on **two surfaces at once**:

- **(a) The Thoughts Count site** — a quiet "daily thought" section on the home page (understated, warm, once-per-day, dismissible, degrades to nothing if none is approved).
- **(b) Social** — a daily post to IG/FB/Pinterest through **Marketing OS**, rendered as a `quote` card with **varied backgrounds/design styles** (surface rotation), generated as a **draft** that waits for the existing **3-reviewer approval gate**. Never auto-posted, never AI-sounding.

Both surfaces show the **same day's approved reflection**.

---

## 1. Source of truth — DECISION

**Decision: a dedicated `daily_reflections` table in the shared Supabase DB is the source of truth. The on-site text is NOT derived from a `social_posts` row.**

### Why (the less-coupled model)
- **Different lifecycles.** The site needs the *reflection text + author* for ONE day. `social_posts` is per-platform (3 rows: IG/FB/Pinterest for one idea), carries captions/hashtags/image_url/scheduled_for, and moves through `draft→approved→scheduled→publishing→posted`. Deriving the on-site line from a social row would force the site to (a) pick one of three platform rows, (b) strip caption/hashtags back down to the bare line, and (c) couple "what shows on the site today" to social scheduling + `publish_enabled`. That is exactly the coupling David's grief-sensitivity + "site even without social" requirements want to avoid.
- **The site must work before/without social being enabled.** `publish_enabled=false` for TC means nothing ever reaches `posted`. If the site read from social rows it would either show nothing or show unposted drafts. A dedicated table lets the **approved reflection** feed the site immediately while social stays safely OFF.
- **One reflection → one day → one social idea.** `daily_reflections.day` (a `date`, unique) is the clean key. The day's social `social_posts` rows are *generated from* that reflection and back-reference it (`meta.reflection_day`, `meta.objective='daily-reflection'`). The reflection is authored/approved once; social rendering is a downstream consumer.
- **Dedup/freshness lives naturally here.** Repeat-avoidance queries `daily_reflections` history (all prior `text`), not a filtered slice of the social queue.

### The table (PROPOSED migration — see WP-1, `sql/004-daily-reflections.sql`)

```sql
create table if not exists daily_reflections (
  id           uuid primary key default gen_random_uuid(),
  app          text not null default 'thoughts-count' references apps(id),
  day          date not null,                       -- the calendar day (America/Chicago) this reflection is FOR
  text         text not null,                       -- Della's one short reflection, sanitized, no AI tells, NO numbers
  theme        text,                                -- 'thoughtful' | 'encouragement' | 'showing-up' (rotation/dedup aid)
  author       text not null default 'Della',       -- display author (single-sourced label; see §2)
  status       text not null default 'draft'
                 check (status in ('draft','approved','rejected','retired')),
  approved_at  timestamptz,
  meta         jsonb not null default '{}'::jsonb,  -- { social_slug, generated_by, review_notes, ... }
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- one reflection per day per app (the on-site read + the social idea both key on this)
create unique index if not exists daily_reflections_day_uniq on daily_reflections (app, day);
-- history scan for dedup / "today's approved" read
create index if not exists daily_reflections_status_day_idx on daily_reflections (app, status, day desc);

alter table daily_reflections enable row level security;   -- service-role only, like every MOS table
drop trigger if exists daily_reflections_touch on daily_reflections;
create trigger daily_reflections_touch before update on daily_reflections
  for each row execute function marketing_touch_updated_at();
```

**Mapping guarantee:** `unique (app, day)` guarantees ONE reflection per day. The day's social `social_posts` rows carry `meta.reflection_day = <day>` and `meta.objective='daily-reflection'`, so one approved reflection ↔ one day on the site ↔ that day's social post(s).

---

## 2. Generation — ongoing, unique drafts in Della's voice

### Where it runs
A **new Marketing OS feeder script**, `scripts/draft-daily-reflection.js`, run **daily** on the portfolio's standard scheduler (**QStash** — the standing standard; NOT a GitHub-Actions cron; see MEMORY "Scheduler Standard = QStash"). It authors N days ahead of the front of the queue (a small buffer, e.g. 5–7 days) so the 3-reviewer gate always has runway and a rejected day can be re-drafted without a gap. This mirrors how `map-autodraft.js` / `weekly-autodraft.js` author a buffered batch of drafts.

It is a **feeder** (like `draft-from-opportunities.js`), NOT the interactive `/social-manager` skill loop — the skill can still be used by David to hand-author or re-roll a day, but the daily cadence must be unattended-safe and land as drafts.

### How Della's voice reaches MOS (separate repo)
MOS already reads a per-brand `apps.brand.voice_prompt` for authoring (see MAP/MIQ in `002-brand-config-seed.sql`). **Seed a TC `voice_prompt` derived from `_persona.mjs`** (HER_NAME + herIdentity() + HER_CHARACTER) into `apps.brand` for `thoughts-count` (WP-2). This is the single voice bridge across the repo boundary.
- **Sync rule (one-voice):** the TC `voice_prompt` is *generated from* `_persona.mjs`, and the seed file header records that provenance. If `_persona.mjs` changes, the `voice_prompt` seed is re-derived and re-proposed. Do NOT hand-edit divergent voice text into MOS. (A follow-up nicety: a tiny `scripts/derive-tc-voice.js` that prints the seed block from the TC repo's `_persona.mjs` — optional, WP-2 stretch.)
- `author` label in `daily_reflections` = `HER_NAME` ('Della'), also single-sourced conceptually from `_persona.mjs`.

### The reflection itself
- **Themes (rotate):** being thoughtful, encouragement, showing up for people who matter. Rotate `theme` so consecutive days differ.
- **Form:** ONE short reflection (1–2 sentences), warm, human, restraint-forward. **NO numbers, no stats, no CTA, no hashtags in the reflection text itself.** (Captions for social are separate, added downstream.)
- **NO AI tells:** run the MOS `sanitizeText` sanitizer (belt) at draft time — same as `draft-from-idea.js` — AND instruct against em/en-dashes, curly quotes, ellipsis, "elevate/unlock/seamless", everything-in-threes in the prompt (suspenders). This is the portfolio "human-sendable copy" rule.
- **Grief-sensitivity guardrail (TC-specific):** the generator must NOT produce a flippant or "inspirational-poster" line for a heavy theme. Reflections skew gentle and non-prescriptive; never turn grief into a quippy quote. Encode this in the TC `voice_prompt` AND surface it explicitly in the TC gate rubric (WP-2) so a reviewer holds anything that reads glib on a hard theme.

### Repeat-avoidance / freshness
Before authoring day D, the feeder loads the last ~60–90 days of `daily_reflections.text` (all statuses) and passes them to the author as an explicit "do NOT repeat or paraphrase any of these; vary theme and opening" block. Cheap dedup: reject a candidate whose normalized text (lowercased, punctuation-stripped) is a near-duplicate (e.g. shared opening clause or high token overlap) of any recent one and re-roll. Theme rotation further spreads it.

### Output
One `daily_reflections` row per authored day at `status='draft'`, plus the day's social **draft** `social_posts` rows (via the existing repurpose→build-graphics→insert rails). Nothing is approved, nothing is scheduled, nothing posts.

---

## 3. Approval gate — UNCHANGED, and it gates BOTH surfaces

Reflections flow through the **existing MOS 3-reviewer gate** (Design / UX / Social) in the board — no new gate, no bypass. The reflection's *content* is what the reviewers judge; the social `quote` card carries that same reflection text.

**Two-surface approval binding (the key mechanic):**
- The daily social post rows and the `daily_reflections` row share the day (`meta.reflection_day`). Approving the reflection's social idea in the board (all its platform rows → `approved`) is the single human act.
- On that approval, a **small hook** flips the matching `daily_reflections` row to `status='approved'` + stamps `approved_at`. Concretely: extend `netlify/functions/dashboard-action.js` so that when an `objective='daily-reflection'` post is approved, it also `PATCH`es `daily_reflections` for that `(app, day)` to approved. (Alternatively, a trigger — but the hook keeps it explicit and in one place; the Builder picks whichever is cleaner given `dashboard-action.js` structure.)
- **Result of approval:** (1) the social rows enter the slotter's approved pool → get scheduled (but do NOT post while `publish_enabled=false`); (2) the `daily_reflections` row becomes visible to the site read endpoint. Nothing appears on-site or on social until this one approval happens.
- **Reject** leaves both un-approved; the feeder re-drafts that day next run (dedup skips the rejected text).

---

## 4. Varied graphics — reuse the `quote` format + surface rotation

**No new render path.** The MOS `quote` format already exists in `templates/card-formats.html`, and **surface rotation** (`lib/content-mix.js` `surfacesFor()` / `assignSurfaces()`) already guarantees "never two adjacent posts share a surface or color family" — this IS David's "different backgrounds and design styles." We only need to give TC a real palette + turn rotation on.

### TC tenant config — PROPOSED SQL seed (WP-2, `sql/005-tc-brand-config-seed.sql`, NOT applied)
Mirror the structure of `002-brand-config-seed.sql` (jsonb merge, non-destructive). Key fields for `thoughts-count`:

- `voice_prompt` — derived from `_persona.mjs` (see §2), plus TC hard rules: warm/sanctuary, grief-sensitive, restraint, never say "AI", no numbers, no hashtags-in-line, no AI tells.
- `allow_formats` — **must include `'quote'`.** Start narrow: `['quote']` (optionally add `'carousel'` later for a themed mini-reflection; out of scope for day one). Keeps the daily post a clean single reflection card.
- `surfaces.palette` — a **TC-brand** multi-hue set fitting blue `#118ab9` + red-heart `#ef4136` + Hanken Grotesk (DESIGN-SYSTEM-v2). Give ~4–5 calm fields (e.g. a soft blue, a deep ink-blue, a warm cream, a muted rose, a slate) — saturated enough for genuine variety but never loud; the heart `#ef4136` is an **accent/motif**, not a full background. `surfaces.family` tags so adjacency never repeats a hue family. (Exact hex values are a Design-Lead call at build time — WP-2 consults the Design Lead / DESIGN-SYSTEM-v2.md; the *structure* is pinned here.)
- `motif` — `'heart'` (the TC red heart as the signature mark on the card), analogous to MAP's `'route'` / MIQ's `'sold-pill'`. Card template gets a small heart-motif treatment (WP-2, in `card-formats.html`, gated behind TC's motif so MAP/MIQ are untouched).
- `posting_slots` (in `marketing_config`) — **one slot/day** (e.g. `['13:30']` UTC ≈ 7:30–8:30 CT morning; final time a Social-Manager call). One reflection/day.
- `week_days` — 7 (a daily thought runs every day).
- Author/gate toggles: `sanitize_captions: true`, `surface_rotation: true`, `use_lessons: true` (TC learns from reject-with-feedback), `guarantee_real_object: false` (no photo requirement — this is a quote card), `auto_approve: false` (**gate everything**).
- `format_specs.quote` / `tone_guide` / `gate_rubric` / `gate_instructions` — TC versions. **The gate rubric must add the grief-sensitivity guardrail** (Design/UX/Social all hold a line that reads glib on a heavy theme; Social holds anything that isn't unmistakably Della's voice / "same person as the home page").

**Grief guardrail note (restate in the seed):** never a flippant quote for a heavy theme; reflections are gentle, non-prescriptive, and never make a show of remembering.

---

## 5. Scheduling / publishing — reuse slotter + publisher, stay OFF

- On approval, `lib/slotter.js` assigns `scheduled_for` (approved→scheduled) using TC's `posting_slots`. `scheduled-publish.js` (every 15 min) would post — **except** the shared publisher only posts for apps with `apps.publish_enabled=true`, and **TC is `false`**. So the pipeline safely produces *approved + scheduled* posts that DO NOT go live.
- **Going live is a deliberate, separate step:** David flips `thoughts-count.publish_enabled=true` (a proposed one-line change, not applied here) once he's happy with the on-site experience and the queue quality, and once IG/FB/Pinterest tokens for the TC tenant are confirmed. Until then: site shows the daily thought; social accumulates approved+scheduled-but-unposted rows.
- **Cadence:** one reflection/day (one `daily_reflections` row/day → one social idea/day). One posting slot/day.
- **On-site independence:** the site read (§6) keys ONLY on `daily_reflections.status='approved'` for *today's* `day`. It does not look at `social_posts.status` or `publish_enabled` at all — so today's thought shows on-site the moment the reflection is approved, whether or not social is live.

---

## 6. On-site "daily thought" (TC app)

### Placement
A new **quiet, non-blocking section** in `public/index.html`, inserted **between the hero `</section>` (~line 991) and the `<section class="section wrap"><h2>What's the moment?</h2>` (~line 993).** It is NOT a modal, NOT a gate, NOT a loud quote card — it's a small, warm, on-brand strip in Della's voice. It must **degrade gracefully to rendering nothing** if there is no approved reflection for today (no empty box, no error).

### Behavior
- Fetches `/api/daily-reflection` on load (non-blocking; the page and voice front-door work regardless).
- Shows the reflection text + a subtle author line ("— Della", styled understated). Small heart motif consistent with brand; Hanken Grotesk; blue/cream palette; NOT a big social-style card.
- **Once-per-day, dismissible:** gate with a date-keyed localStorage key `tc_daily_<YYYY-MM-DD>` using the existing `ymd()` / `todayInZone("America/Chicago")` helpers. If the key is set (seen or dismissed today), don't re-show. A small dismiss control sets the key. New day → new key → shows again.
- Understated design direction (fits the rebrand): think a soft one-line "today's thought from Della," not a shareable graphic. It should feel like her leaving a small note, in keeping with restraint.

### The read endpoint — `/api/daily-reflection` (new TC function `netlify/functions/daily-reflection.mjs`)
- Uses `serviceClient()` (from `_supabase.mjs`) — the shared MOS tables are **service-role only (RLS on, no policies)**, so the browser anon key cannot read them directly; the read must go through a server endpoint (the `public-config.mjs` serviceClient pattern). This is why an endpoint, not a direct client query.
- Computes **today** in `America/Chicago` server-side and selects the single `daily_reflections` row where `app='thoughts-count' AND day=<today> AND status='approved'`.
- **Response contract (PINNED):**
  - `200 { "line": "<reflection text>", "author": "Della", "day": "YYYY-MM-DD" }` when today's approved reflection exists.
  - `200 { "line": null }` when there is none (site renders nothing). Never a 500 to the page for "no reflection."
  - `cache-control: no-store` (or a short cache) — mirrors the other TC functions.
- Add a route alias so `/api/daily-reflection` maps to the function (consistent with how other TC endpoints are exposed; Builder confirms the netlify redirect/route convention in this repo).

---

## 7. Work packages (parallel across the two repos; interfaces pinned)

The **shared contract** all three packages agree on (do not drift):
- **`daily_reflections`** shape as in §1 (`app`, `day` [date, America/Chicago], `text`, `theme`, `author`, `status ∈ draft|approved|rejected|retired`, `approved_at`, `meta`). Unique `(app, day)`.
- **Social linkage:** the day's `social_posts` rows carry `meta.objective='daily-reflection'` and `meta.reflection_day='YYYY-MM-DD'`.
- **`/api/daily-reflection` response:** `{ line: string|null, author?: 'Della', day?: 'YYYY-MM-DD' }`.
- **Approval binding:** approving the `objective='daily-reflection'` social idea flips `daily_reflections (app, day)` → `approved` + `approved_at`.
- **publish_enabled stays false** for `thoughts-count` (posting OFF until David's go).

### WP-1 — Shared schema + generation feeder (Marketing OS)
- `sql/004-daily-reflections.sql` — the table (§1), **PROPOSED, not applied** (flag proposed-not-applied; committed to branch only).
- `scripts/draft-daily-reflection.js` — daily feeder: load recent reflection history for dedup, author ONE reflection in TC voice per un-drafted day within the buffer (themes rotate, no numbers, no AI tells, sanitized, grief-safe), write `daily_reflections` draft row, then produce the day's social **draft** rows via the existing repurpose→build-graphics→insert rails with `meta.objective='daily-reflection'` + `meta.reflection_day`.
- QStash schedule registration (proposed; via the standard `qstash-register-schedule` path) — daily fire. **Do not register against prod without approval** (infra guardrail) — propose it.
- Extend `netlify/functions/dashboard-action.js`: on approve of an `objective='daily-reflection'` post, PATCH `daily_reflections (app, day)` → approved + `approved_at`.
- **Depends on:** WP-2 (TC brand config must exist for the author/graphics to have voice + palette). Sequence WP-2 slightly ahead, or land both configs before the first feeder run.

### WP-2 — TC tenant config + quote-card surfaces/motif (Marketing OS)
- `sql/005-tc-brand-config-seed.sql` — **PROPOSED, not applied.** TC `apps.brand`: `voice_prompt` (derived from `_persona.mjs`), `allow_formats` incl `'quote'`, `surfaces.palette` + `family` (TC blue/cream/rose calm set — Design-Lead-approved hexes), `motif:'heart'`, toggles (`sanitize_captions/surface_rotation/use_lessons` true, `auto_approve` false); `marketing_config`: `posting_slots` (1/day), `format_specs.quote`, `tone_guide`, `gate_rubric` (**with grief-sensitivity + one-voice holds**), `gate_instructions`.
- `templates/card-formats.html` — TC heart-motif treatment for the `quote` format, gated behind TC's `motif` so MAP/MIQ render identically (no regression). Verify TC surfaces recolor correctly via `applySurface`.
- (Stretch) `scripts/derive-tc-voice.js` to print the `voice_prompt` seed from `_persona.mjs` (keeps one-voice sync honest).
- **Interface out:** the seed's field names/shape; the `quote` card looks on-brand with rotating TC surfaces + heart motif.

### WP-3 — On-site daily thought + read endpoint (Thoughts Count app)
- `netlify/functions/daily-reflection.mjs` — `serviceClient()` read of today's (America/Chicago) approved `daily_reflections` row → the pinned `{ line, author, day }` / `{ line: null }` contract. Route `/api/daily-reflection`.
- `public/index.html` — the quiet daily-thought section between hero and "What's the moment?" (§6): fetch, render understated on-brand, `tc_daily_<date>` once-per-day gating via `ymd()`/`todayInZone`, dismissible, graceful empty.
- **Depends on:** the `daily_reflections` shape + endpoint contract only (WP-1's table). Can be built against the pinned contract in parallel; verified once a real approved row exists (seed one for review, per the "render on TEST" pattern).

**Collision safety:** WP-1/WP-2 are MOS-repo, WP-3 is TC-repo — no shared files across repos. Within MOS, WP-1 touches `sql/004`, `scripts/draft-daily-reflection.js`, `dashboard-action.js`; WP-2 touches `sql/005`, `card-formats.html`. Use separate worktrees per session (MEMORY "Shared Working Copy / Worktrees") to avoid branch-switch collisions.

---

## 8. Risks & tests

1. **Quality / AI-tells (highest).** A daily generated line is a lot of surface area for "AI-sounding" copy. Mitigation: prompt-level no-tells rules + `sanitizeText` sanitizer + the **non-negotiable 3-reviewer gate** (nothing shows anywhere unapproved). Test: run the sanitizer over a batch of generated candidates and assert no em/en-dash, curly quotes, ellipsis, banned buzzwords; a human spot-review of the first week.
2. **Grief-sensitivity.** A flippant "quote-poster" line on a heavy theme would be brand-damaging. Mitigation: encode in TC `voice_prompt` + an explicit grief hold in the gate rubric; skew gentle/non-prescriptive; never make a show of remembering. Test: seed heavy-theme candidates and confirm the gate rubric would hold a glib one.
3. **Timezone / day rollover for "today."** The site read and the `day` key must both use `America/Chicago`; a UTC vs local mismatch would show yesterday's thought after midnight or a gap. Mitigation: server computes today in `America/Chicago`; site gates with `todayInZone("America/Chicago")` + `tc_daily_<date>`. Test: read endpoint around the CT midnight boundary; assert the right `day`.
4. **Repeat-avoidance.** Over weeks, themes/openings could recur. Mitigation: history-fed dedup (60–90 days) + near-duplicate re-roll + theme rotation. Test: generate a long run in a dry harness; assert no near-duplicate openings.
5. **Graceful no-reflection fallback on-site.** If a day has no approved reflection (rejected, or feeder gap), the site must render **nothing** cleanly. Mitigation: `{ line: null }` → no DOM. Test: hit `/api/daily-reflection` with no approved row; assert empty render, no error, page + voice unaffected.
6. **Not going live prematurely.** Mitigation: `thoughts-count.publish_enabled=false` (unchanged) means approved+scheduled rows never post; going live is a separate, explicit David flip after IG/FB/Pinterest tokens for the TC tenant are confirmed. Test: with rows scheduled, confirm `scheduled-publish.js` skips TC while `publish_enabled=false`.
7. **One-voice drift (repo boundary).** TC `voice_prompt` in MOS could drift from `_persona.mjs`. Mitigation: derive-not-duplicate rule + seed-file provenance header (+ optional derive script). Reviewer gut-check: "same person as the home page?"

---

## 9. Standing-rules compliance checklist
- [x] Migrations/config **proposed, not applied** (`sql/004`, `sql/005`, QStash schedule, `publish_enabled` flip all flagged proposed).
- [x] **Reuse** MOS infra (quote format, surface rotation, slotter, publisher, gate) — no new render/publish path.
- [x] **3-reviewer gate** unchanged and gates both surfaces.
- [x] **No AI tells** (prompt + sanitizer).
- [x] **TC grief-sensitivity** in voice_prompt + gate rubric.
- [x] **One-voice (Della)** — voice derived from `_persona.mjs`.
- [x] **Read the actual files** in both repos (schema, seed, slotter, content-mix, draft-from-idea, index.html placement, _supabase/public-config, _persona) before asserting.
