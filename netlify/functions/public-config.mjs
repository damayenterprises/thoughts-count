// Thoughts Count — public runtime config for the browser.
// Returns ONLY the values that are safe in the client: the Supabase project URL
// and the anon (public) key. The anon key is designed to be public — every table
// is guarded by Row Level Security, so it grants nothing on its own. The secret
// service_role key and API keys never leave the server.
// If Supabase isn't configured yet, returns enabled:false so the companion UI
// stays dormant and the core plan flow keeps working.

import { getEnv } from "./_email.mjs";
import { HER_NAME } from "./_persona.mjs";

export default async () => {
  const url = getEnv("SUPABASE_URL") || "";
  const anon = getEnv("SUPABASE_ANON_KEY") || "";
  const enabled = !!(url && anon);
  // Voice front-door audience gate (TC-60): who sees voice — everyone / signedin / members.
  // Set to "everyone" now for open testing; flip to "members" when Pro (TC-40) is ready.
  const voiceAudience = normalizeAudience(getEnv("VOICE_AUDIENCE"));
  // Her name, single-sourced from _persona.mjs (HER_NAME = "Della"). The home hero shows
  // it on screen (David approved 2026-08-10); a rename stays a one-line change server-side.
  return new Response(JSON.stringify({ enabled, supabaseUrl: url, supabaseAnonKey: anon, voiceAudience, herName: HER_NAME }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};

// Only three valid audiences; anything unset/unknown falls back to the safe default.
export function normalizeAudience(v) {
  const a = String(v || "").trim().toLowerCase();
  return (a === "signedin" || a === "members") ? a : "everyone";
}
