// Thoughts Count — shared Supabase helpers for the authenticated pro-import path.
//
// Three clients, three jobs:
//   requireUser(req)      → verify the caller's JWT, return their user_id (or a 401).
//   userClientFromReq(req)→ an anon client bound to the caller's JWT, so reads obey RLS
//                           (the user only ever sees their own rows).
//   serviceClient()       → the service-role client, used ONLY for the scoped writes the
//                           import needs (ON CONFLICT upserts + the pg_trgm RPC). Every
//                           write it makes MUST carry the user_id verified from the JWT —
//                           never a user_id taken from the request body.
//
// This split is the whole safety story: the service key bypasses RLS, so we lean on
// requireUser to pin every operation to the verified caller.

import { createClient } from "@supabase/supabase-js";
import { getEnv } from "./_email.mjs";

export function supabaseConfigured() {
  return !!(getEnv("SUPABASE_URL") && getEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

function bearer(req) {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

// Anon client bound to the caller's JWT — reads run under that user's RLS policies.
export function userClientFromReq(req) {
  const url = getEnv("SUPABASE_URL");
  const anon = getEnv("SUPABASE_ANON_KEY");
  const token = bearer(req);
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
}

// Service-role client — bypasses RLS. Use ONLY with an explicit, verified user_id.
export function serviceClient() {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Verify the JWT and return { userId } or { error, status } for a clean 401.
export async function requireUser(req) {
  const url = getEnv("SUPABASE_URL");
  const anon = getEnv("SUPABASE_ANON_KEY");
  if (!url || !anon) return { error: "Sign-in isn't configured.", status: 503 };
  const token = bearer(req);
  if (!token) return { error: "Please sign in.", status: 401 };
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user?.id) return { error: "Please sign in.", status: 401 };
  return { userId: data.user.id };
}

// Small JSON Response helper, matching the shape used across the other functions.
export function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
