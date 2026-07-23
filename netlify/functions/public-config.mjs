// Thoughts Count — public runtime config for the browser.
// Returns ONLY the values that are safe in the client: the Supabase project URL
// and the anon (public) key. The anon key is designed to be public — every table
// is guarded by Row Level Security, so it grants nothing on its own. The secret
// service_role key and API keys never leave the server.
// If Supabase isn't configured yet, returns enabled:false so the companion UI
// stays dormant and the core plan flow keeps working.

import { getEnv } from "./_email.mjs";

export default async () => {
  const url = getEnv("SUPABASE_URL") || "";
  const anon = getEnv("SUPABASE_ANON_KEY") || "";
  const enabled = !!(url && anon);
  return new Response(JSON.stringify({ enabled, supabaseUrl: url, supabaseAnonKey: anon }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
