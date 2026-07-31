// Thoughts Count — the memory write endpoint (spec §3/§4). One authenticated door for the
// mutations that must run server-side because they touch more than one row and enforce the
// temporal rules: create a fact (with deterministic supersession + key_date seeding), correct
// a fact, hard-delete a fact, hard-delete a whole person.
//
// Reads and export stay client-side: they're plain RLS-scoped anon selects (see companion.js /
// roster.js), so no read endpoint is needed here.
//
// Every op runs under the JWT-verified userId via the service-role client — the request body
// never supplies its own user_id.

import { requireUser, serviceClient, json } from "./_supabase.mjs";
import { insertFact, updateFact, deleteFact, deletePerson } from "./_memory.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const auth = await requireUser(req);
  if (auth.error) return json(auth.status, { error: auth.error });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }
  const op = body?.op;

  try {
    const supa = serviceClient();
    const userId = auth.userId;

    switch (op) {
      case "create_fact": {
        if (!body.personId && !body.householdId) return json(400, { error: "Attach the note to a person." });
        const result = await insertFact(supa, userId, body);
        return json(200, result);
      }
      case "update_fact": {
        if (!body.factId) return json(400, { error: "Missing fact." });
        const fact = await updateFact(supa, userId, body.factId, body.patch || body);
        return json(200, { fact });
      }
      case "delete_fact": {
        if (!body.factId) return json(400, { error: "Missing fact." });
        const result = await deleteFact(supa, userId, body.factId);
        return json(200, result);
      }
      case "delete_person": {
        if (!body.personId) return json(400, { error: "Missing person." });
        const result = await deletePerson(supa, userId, body.personId);
        return json(200, result);
      }
      default:
        return json(400, { error: "Unknown operation." });
    }
  } catch (err) {
    console.error("memory endpoint failed", op, err);
    return json(500, { error: "We couldn't save that just now. Please try again." });
  }
};
