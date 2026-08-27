#!/usr/bin/env node
// TC-167 — Supabase logical backup (JSON). Dumps every public table + a safe
// projection of auth.users to a single timestamped JSON file. Restorable by
// re-inserting rows (schema lives in supabase/schema.sql + supabase/migrations).
//
// Why JSON via the Management API (not pg_dump): no postgres client / driver /
// pooler-URL needed, one query per table returns ALL rows (no PostgREST 1000-row
// paging), runs identically on this box and in GitHub Actions.
//
// Usage:  node scripts/db-snapshot.mjs [outfile]
//   env:  SUPABASE_ACCESS_TOKEN (sbp_… PAT), SUPABASE_PROJECT_REF
//   outfile defaults to ./tc-supabase-<UTC-date>.json ; pass "-" for stdout.
//
// NOTE: the PAT is account-scoped. Keep the output OFF public git (it holds user
// PII) and keep the secret in a PRIVATE store only. See docs/DISASTER-RECOVERY.md.

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!TOKEN || !REF) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF in env.");
  process.exit(1);
}

const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;

async function query(sql) {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`query failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const stamp = new Date().toISOString();
const day = stamp.slice(0, 10);

// 1. discover every public base table
const tables = (await query(
  `select table_name from information_schema.tables
   where table_schema='public' and table_type='BASE TABLE' order by table_name`
)).map((r) => r.table_name);

// 2. dump each table's full contents as JSON (one round-trip, all rows)
const data = {};
const counts = {};
for (const t of tables) {
  const rows = (await query(`select coalesce(json_agg(x), '[]'::json) as j from public."${t}" x`))[0].j;
  data[t] = rows;
  counts[t] = rows.length;
}

// 3. auth.users — identity + metadata only (NO password hashes / tokens)
const authUsers = (await query(
  `select coalesce(json_agg(u), '[]'::json) as j from
     (select id, email, created_at, last_sign_in_at, raw_user_meta_data from auth.users) u`
))[0].j;
data["auth.users"] = authUsers;
counts["auth.users"] = authUsers.length;

const out = {
  _meta: {
    app: "thoughts-count (+ shared MOS tables)",
    project_ref: REF,
    taken_at: stamp,
    table_count: tables.length + 1,
    row_counts: counts,
    note: "Logical JSON backup. Restore: create project from supabase/schema.sql, then insert rows. PII — keep private.",
  },
  data,
};

const json = JSON.stringify(out, null, 2);
const outfile = process.argv[2] || `tc-supabase-${day}.json`;
if (outfile === "-") {
  process.stdout.write(json);
} else {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outfile, json);
  const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
  console.error(`✓ snapshot ${stamp} → ${outfile} (${kb} KB, ${out._meta.table_count} tables)`);
  console.error(`  rows: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}
