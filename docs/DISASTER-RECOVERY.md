# Thoughts Count — Disaster Recovery Runbook

**Purpose:** everything needed to rebuild, restore, or replace the Thoughts Count platform.
Last audited **2026-08-26** (Linear TC-167/168/169).

> **TL;DR — if this workstation dies:** the platform keeps running (it's 100% cloud-hosted).
> To rebuild a dev machine: `git clone` the repo, copy `.env` from Google Drive, `netlify link`.
> ~15 minutes. The only data that is NOT trivially recoverable is the Supabase DB — see §4.

---

## 1. What the platform is made of

| Layer | Where it lives (survives this machine) | Recoverable from |
|---|---|---|
| **Code** | GitHub `damayenterprises/thoughts-count` (public) | git clone; auto-deploys to Netlify on push to `main` |
| **Hosting** | Netlify site `thoughts-count` (id `995d0b17-2f40-4568-a583-bf47db556e56`, team dmay3) | relink repo + restore env + reattach domain |
| **Secrets** | local `.env` (gitignored) | **Google Drive:** `G:\My Drive\Damay Enterprises Backup\thoughtfulness\.env` + Netlify env |
| **DB (accounts/people/plans)** | Supabase project `ntnlzfezdlbwxbrphknn` (FREE org "Thoughts Count") | **daily backup repo** (§4) + schema in git |
| **Blobs (reminders/analytics)** | Netlify Blobs (same Netlify account) | ⚠️ no off-platform backup yet — TC-169 |
| **Domain** | thoughtscount.com @ Namecheap | Namecheap account; DNS in §6 |
| **Email** | SendGrid (send) + Zoho (care@ mailbox) | SendGrid + Zoho accounts |

## 2. Accounts / single points of failure
Access to these accounts IS the recovery. Keep credentials in David's password manager.
- **GitHub** — `damayenterprises` (holds code + the private `tc-db-backups` repo)
- **Netlify** — team `dmay3` / Damay Enterprises (Pro); site `thoughts-count`
- **Supabase** — org "Thoughts Count" (separate free org), project ref `ntnlzfezdlbwxbrphknn`
- **Namecheap** — domain registrar for thoughtscount.com
- **SendGrid** (from MAP account) — domain-authenticated sender `care@thoughtscount.com`
- **Zoho** — `care@thoughtscount.com` mailbox (app-specific password for IMAP)
- **Google Cloud** (MapMySales project) — Places key billing
- **Google Drive** — the off-machine copy of `.env` + manual DB snapshots
- Providers: Anthropic, OpenAI (voice), Etsy, SearchAPI, Google Search Console

## 3. Secrets (`.env`) — 20 keys
Authoritative copy: **`G:\My Drive\Damay Enterprises Backup\thoughtfulness\.env`** (Google Drive, auto-backed-up, PII-free but secret — keep private). Netlify holds runtime copies of most.

⚠️ **Gotchas when restoring env:**
- These 4 are in `.env` but **NOT** in Netlify (needed for ops/backups, add them if rebuilding tooling): `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and the older `VOICE_AUDIENCE`.
- `OPENAI_API_KEY` (voice) is set only in Netlify's **production** context — it does not appear in the default `env:list`/`env:get`. A naive "copy the env vars" will silently miss it → voice breaks. Set it in production context explicitly.

## 4. Database backups (the important one)
The Supabase project is **free tier: no PITR, no restorable platform backups** (`pitr_enabled:false`, `backups:[]`). Backups are therefore external:

- **Automated daily** — private repo **`damayenterprises/tc-db-backups`**, GitHub Actions cron `0 9 * * *` (04:00 CT). Dumps every public table + a safe `auth.users` projection to `backups/tc-supabase-<date>.json` (last 30 kept). Secrets on that repo: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`.
- **Manual snapshot** — `node --env-file=.env scripts/db-snapshot.mjs <outfile>` (this repo). Latest manual copy in `G:\My Drive\...\thoughtfulness\db-backups\`.

**Verify backups are running:** `gh run list --repo damayenterprises/tc-db-backups` — the newest run should be < 24h old and green.

### Restore the database
1. Create (or repair) the Supabase project. Apply structure from `supabase/schema.sql` then `supabase/migrations/*`.
2. Re-insert rows from the newest `tc-db-backups/backups/*.json` (`data.<table>` arrays), **parents first**: `people` → `key_dates` / `saved_plans` → `nudge_log`. (TC + MOS share this DB, so the dump also contains MOS tables.)
3. If accounts were lost, re-create `auth.users` via the Supabase Auth admin API from the `data["auth.users"]` list (magic-link users have no password to restore).
4. Point `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` at the new project (Netlify env + `.env`).

## 5. Full platform rebuild (worst case)
1. **Code:** `git clone https://github.com/damayenterprises/thoughts-count.git`
2. **Secrets:** copy `.env` from Google Drive into the repo root.
3. **Netlify:** create a site from the repo (build: none/static, publish `public`, functions `netlify/functions` — all in `netlify.toml`). Set every env var **for all contexts**, minding the §3 gotchas. `netlify link --name thoughts-count`.
4. **Domain + DNS:** attach thoughtscount.com in Netlify; set DNS at Namecheap per §6.
5. **Database:** restore per §4.
6. **Verify:** site returns 200; sign-in (magic link) works; a plan generates; the daily crons (`reminders-cron`, `nudges-cron`, etc.) are scheduled; the backup workflow is green.

## 6. DNS (thoughtscount.com @ Namecheap — Advanced DNS)
Records were set 2026-07-26 (see AgentGuide-Archive for exact values). Types in play:
- **Netlify** — apex A / `www` CNAME to the Netlify load balancer (or Netlify DNS).
- **Zoho mail** — MX records + SPF `TXT` + DKIM `zmail._domainkey` TXT (for the care@ mailbox).
- **SendGrid** — domain-auth CNAMEs + DKIM (branded `care@` sending).
- **Google Search Console** — domain-property TXT verification.
> Exact record values live in the Namecheap DNS panel; do not guess them — read from Namecheap or the 2026-07-26 setup notes before changing anything.

## 7. Known gaps (tracked)
- **TC-169** — Netlify Blobs (opted-in email reminders + analytics) have no off-platform backup yet.
- `SUPABASE_ACCESS_TOKEN` used by the backup job is **account-scoped** (all Supabase projects). Rotate if the private repo/secret is ever exposed.
