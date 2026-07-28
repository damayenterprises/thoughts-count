// Thoughts Count — commit a mapped CSV import (inline path, small files).
//
// The browser has already parsed the file and applied the confirmed column mapping,
// so each row here is a canonical contact object: { name, first_name, last_name,
// email, phone, relationship, notes, location, key_dates:[{kind,date,label}] }.
// We run every row through the shared dedup core and return a plain-language summary.
//
// Small files (<= MAX_INLINE rows) commit in this single request; larger files use
// import-commit-background so we never risk a function timeout mid-import.

import { requireUser, serviceClient, json } from "./_supabase.mjs";
import { runImport } from "./_import.mjs";

const MAX_INLINE = 200;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const auth = await requireUser(req);
  if (auth.error) return json(auth.status, { error: auth.error });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows) return json(400, { error: "No rows to import." });
  if (rows.length > MAX_INLINE) {
    // Client should route large files to the background endpoint.
    return json(413, { error: "That file is large — use the background import.", useBackground: true, maxInline: MAX_INLINE });
  }

  try {
    const supa = serviceClient();
    const summary = await runImport({ supa, userId: auth.userId, filename: body?.filename, rows, source: "csv" });
    return json(200, summary);
  } catch (err) {
    console.error("import-commit failed", err);
    return json(500, { error: "We couldn't finish that import. Please try again." });
  }
};
