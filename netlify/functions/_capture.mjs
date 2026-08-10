// Thoughts Count — the capture brain (TC-50, spec §5/§6/§12). ONE extract→resolve path that
// every intake door reuses. Phase 2 wires the TYPED door through it; voice/scan/email (Phase
// 3/6/7) will call the exact same two functions.
//
//   extract(rawText, { lockedPersonId })  → Claude structured-output → a LIST of proposed
//       facts (each routable) + the named-person hints in the utterance. One sentence can
//       yield several facts across several subjects/people.
//   resolve(userId, parsed, supa)         → the entity-resolution gate (spec §12): strong-key
//       (identifiers) → Level A; fuzzy name+context (tc38_fuzzy_person_match + _names.mjs) →
//       0.60–0.90 Level B, <0.60 new person; bias to SPLIT, never auto-merge; builds the
//       plain-language match_evidence a human reads in To-Review.
//
// Two rules that are easy to get wrong and are load-bearing:
//   • Subject-relative facts NEVER spawn a person. "her mom is moving in" is a fact ABOUT the
//     resolved person (Maria) with subject "mom" — not a new person named "mom". Resolution
//     only ever runs on the NAMED person hint ("Maria"), never on a relative subject.
//   • Engine vocabulary (fact_class, confidence, salience) is internal — match_evidence is
//     always warm, plain language (spec §7).
//
// Mirrors import-analyze.mjs for the Claude call shape: temperature 0, tool-forced schema,
// claude-sonnet-4-6. The prompt is the crux of this feature — keep it here, well-commented,
// and treat it as versioned.

import { getEnv } from "./_email.mjs";
import { sameSurname, firstNamesEquivalent } from "./_names.mjs";
import { insertFact } from "./_memory.mjs";

const MODEL = "claude-sonnet-4-6";

// Health episodes fade faster than life episodes (spec §3): ~21 days vs the _memory default
// of 90. The extractor tags a health episode so insertFact gets the tighter window.
const HEALTH_SURFACE_DAYS = 21;

// ──────────────────────────────────────────────────────────────────────────────────────────
//  EXTRACTION
// ──────────────────────────────────────────────────────────────────────────────────────────

const FACT_CLASSES = ["DURABLE", "EPISODIC", "MILESTONE", "RECURRING", "PREFERENCE"];

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      description:
        "Every distinct thing worth remembering in what the user said. ONE sentence can produce several facts — split them. Return an empty array if there is nothing durable to remember (e.g. a greeting).",
      items: {
        type: "object",
        properties: {
          person_hint: {
            type: "string",
            description:
              "The NAMED person this fact is about, exactly as the user named them (e.g. \"Maria\", \"Maria Edmond\"). CRITICAL: if the fact is about that person's relative — \"her mom\", \"his wife\", \"their son Eli\" — the person_hint STAYS the named person (Maria), and the relative goes in `subject`. Never put \"mom\"/\"wife\" here. Leave EMPTY only when the user named no one (a person is supplied by context).",
          },
          subject: {
            type: "string",
            description:
              "Who within that person's world this is about: \"self\" for the person themselves, or a relative/associate like \"mom\", \"wife\", \"daughter Ava\", \"their team\". Default \"self\".",
          },
          relation: {
            type: "string",
            description:
              "A short snake_case attribute name. For something a person has ONE current value of, use a canonical single-valued name so a newer value can update it: \"health_status\", \"job\", \"location\", \"marital_status\", \"birthday\". For something a person can have MANY of — hobbies, allergies, interests, preferences, foods, pets — use a plain category name like \"hobby\", \"allergy\", \"interest\", \"preference\" (these accumulate and NEVER replace each other). Use \"note\" for a general free observation.",
          },
          object: {
            type: "string",
            description: "The value, in a few plain words: \"started at Acme\", \"moving in with Maria\", \"recovering from surgery\", \"loves hiking\".",
          },
          fact_class: {
            type: "string",
            enum: FACT_CLASSES,
            description:
              "DURABLE = never fades (twins, loves hiking, an allergy). EPISODIC = time-sensitive, fades later (sick, job hunt, going through a divorce). MILESTONE = a fresh event to congratulate now that then becomes background (got the job, moved to Denver, closed on a house). RECURRING = a yearly date (birthday, work anniversary). PREFERENCE = a durable but replaceable liking (prefers texts, likes bourbon).",
          },
          is_health: {
            type: "boolean",
            description: "True only for a health/medical episode (sick, surgery, recovering). Used to fade it faster. Default false.",
          },
          event_date: {
            type: "string",
            description: "The real-world date in YYYY-MM-DD if one is clearly stated or unambiguous (a birthday, a closing date, \"moved in June 2026\" → null unless a day is given). Otherwise omit. Never invent a day.",
          },
          suggested_gesture: {
            type: "string",
            description: "Optional: a one-line thoughtful gesture this fact invites (\"send a congratulations card\", \"check in in a couple of weeks\"). Omit if none fits.",
          },
          confidence: {
            type: "number",
            description: "0..1 — how confident you are you read this fact correctly from the text. Lower it for vague or inferred readings.",
          },
        },
        required: ["person_hint", "subject", "relation", "object", "fact_class"],
      },
    },
    location_hint: {
      type: "string",
      description: "A city/place tied to the person that could help tell apart two people of the same name (\"the Maria in Denver\"). Omit if none.",
    },
    co_mentioned: {
      type: "boolean",
      description: "True if TWO OR MORE distinct NAMED people are introduced together as a pair/couple/household (\"Dave and Maria\", \"the Hendersons\"). Default false.",
    },
  },
  required: ["facts"],
};

const EXTRACT_SYSTEM = `You read a short note a thoughtful person jotted about someone they care about, and turn it into clean, structured things-to-remember. You are the memory behind a relationship companion — not a chatbot. Be faithful to what they said; never invent details.

Rules:
- Split everything worth remembering into separate facts. One sentence often holds several.
- A fact about someone's RELATIVE ("her mom", "his wife", "their son Eli") is a fact about the SAME named person, with the relative in the subject field. It must NEVER become its own person. Only a directly-named person is a person_hint.
- For a replaceable, one-value-at-a-time attribute use a canonical single-valued relation (health_status, job, location, marital_status, birthday) so a later update can supersede it. For anything a person can have several of (hobby, allergy, interest, preference, food, pet) use a plain category relation — these accumulate and must never replace each other. Use "note" for a general observation.
- Classify each fact's temporal behavior with fact_class. Mark health/medical episodes is_health:true.
- Only set event_date when a real date (with a day, or an unambiguous yearly birthday/anniversary) is present. Never fabricate a day.
- If nothing durable is being said, return an empty facts array.

Always respond by calling the extract_memory tool.`;

// Run the model. Returns { facts:[...], location_hint, co_mentioned } — a normalized parsed
// object — or throws. `lockedPersonId` (context-lock) tells the model the person is already
// known, so it should leave person_hint empty and just split the facts.
export async function extract(rawText, { lockedPersonId = null } = {}) {
  const text = String(rawText || "").trim();
  if (!text) return { facts: [], location_hint: "", co_mentioned: false };

  const apiKey = getEnv("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("extraction is not configured");

  const userMessage =
    (lockedPersonId
      ? "The note below is about a person already in focus — you do NOT know their name, so leave every person_hint EMPTY and simply split the facts (still distinguish the person themselves, `self`, from their relatives).\n\n"
      : "") + `Note:\n${text}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 900,
      temperature: 0,
      system: EXTRACT_SYSTEM,
      tools: [{ name: "extract_memory", description: "Return the structured things to remember from the note.", input_schema: EXTRACT_SCHEMA }],
      tool_choice: { type: "tool", name: "extract_memory" },
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("capture extract anthropic error", res.status, detail.slice(0, 300));
    throw new Error("We couldn't read that just now. Please try again.");
  }
  const data = await res.json();
  const toolUse = (data.content || []).find((b) => b.type === "tool_use");
  const input = toolUse?.input || {};
  return normalizeParsed(input, lockedPersonId);
}

// Coerce the model output into clean, trusted internal facts. Context-lock forces person_hint
// empty (identity comes from the locked person, never the model).
function normalizeParsed(input, lockedPersonId) {
  const facts = Array.isArray(input.facts) ? input.facts : [];
  const clean = [];
  for (const f of facts) {
    const object = String(f.object || "").trim();
    const relation = String(f.relation || "").trim() || "note";
    if (!object) continue;
    const factClass = FACT_CLASSES.includes(f.fact_class) ? f.fact_class : "DURABLE";
    const subject = String(f.subject || "").trim() || "self";
    const personHint = lockedPersonId ? "" : String(f.person_hint || "").trim();
    const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(String(f.event_date || "").trim()) ? f.event_date.trim() : null;
    clean.push({
      person_hint: personHint,
      subject,
      relation,
      object,
      fact_class: factClass,
      is_health: !!f.is_health,
      event_date: eventDate,
      suggested_gesture: String(f.suggested_gesture || "").trim() || null,
      confidence: typeof f.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0.9,
    });
  }
  return {
    facts: clean,
    location_hint: String(input.location_hint || "").trim(),
    co_mentioned: !!input.co_mentioned,
  };
}

// The per-fact surface window a health episode wants (tighter than the 90-day default). The
// endpoint passes this straight into _memory.insertFact.
export function surfaceDaysFor(fact) {
  return fact.is_health && fact.fact_class === "EPISODIC" ? HEALTH_SURFACE_DAYS : undefined;
}

// Write a group of extracted facts to ONE person via the memory engine. Returns
// { writtenIds, supersededIds } — writtenIds are the new rows (delete them to undo), supersededIds
// are any single-valued prior values these writes retired (reopen them to fully undo, so a revert
// never leaves the person with neither value). Subject-relative facts ("mom", "wife") are stored
// AS-IS on this person — resolution already picked the person; the relative is only a subject,
// never its own person (spec / David clarification #1). A RECURRING/MILESTONE fact with a date
// seeds a key_date. Shared by capture-extract (Level A now) and capture-resolve (Level B on
// confirm) so both doors write identically. `rawText` is the per-fact durable audit (spec §3).
export async function writeFactsToPerson(supa, userId, personId, facts, source, rawText) {
  const writtenIds = [];
  const supersededIds = [];
  for (const f of facts) {
    const seeds = f.fact_class === "RECURRING" || f.fact_class === "MILESTONE";
    const { fact, supersededIds: retired } = await insertFact(supa, userId, {
      personId,
      subject: f.subject,
      relation: f.relation,
      object: f.object,
      factClass: f.fact_class,
      source,
      provenance: f.provenance || "user_stated",
      confidence: f.confidence,
      eventDate: f.event_date || null,
      rawText,
      surfaceDays: surfaceDaysFor(f),
      ...(seeds && f.event_date ? { keyDateLabel: f.object } : {}),
    });
    if (fact?.id) writtenIds.push(fact.id);
    if (retired?.length) supersededIds.push(...retired);
  }
  return { writtenIds, supersededIds };
}

// ──────────────────────────────────────────────────────────────────────────────────────────
//  RESOLUTION  (spec §12 — never guess, never merge)
// ──────────────────────────────────────────────────────────────────────────────────────────

const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
const tokens = (s) => String(s || "").trim().split(/\s+/).filter(Boolean);

// Is a roster candidate the same person as this NAMED hint? Deterministic, reusing the shared
// name engine (_names.mjs) — no new fuzzy matching. Three ways, strongest first:
//   exact — normalized full-name equality ("Maria Edmond" = "maria edmond")
//   full  — same surname AND equivalent first name ("Bill Smith" ≡ "William Smith")
//   first — first names equivalent AND at least one side has no surname ("Maria" ~ "Maria Edmond")
function nameMatchKind(hint, candName) {
  if (norm(hint) === norm(candName)) return "exact";
  const se = sameSurname(hint, candName);
  const fe = firstNamesEquivalent(hint, candName);
  if (se && fe) return "full";
  if (fe && (tokens(hint).length < 2 || tokens(candName).length < 2)) return "first";
  return null;
}
const KIND_CONF = { exact: 0.97, full: 0.92, first: 0.9 };

function locMatch(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

// Resolve ONE named hint against the user's people. Returns:
//   { level:'A'|'B', proposedPersonId, confidence, evidence, name }
// Level A = confident enough to write now (strong-key, or a single clear name match); Level B =
// ambiguous or unknown → To-Review, nothing written until the user confirms. `context` may carry
// a locationHint (to tell two same-named people apart) and identifiers (email/phone strong keys).
//
// context.fallbackFirstName (TC-91): opt-in first-name fallback for the VOICE/TYPED capture path
// only. When the RPC candidate set surfaces no name match, compare the spoken name's FIRST TOKEN
// against every saved person's FIRST TOKEN via the deterministic name engine (firstNamesEquivalent),
// so a bare spoken first name ("Jon") still catches a saved full name ("John Miller") the trigram
// RPC missed (~0.14 similarity). OFF by default so the import dedup path (which uses its OWN RPC at
// threshold 0.4 in _import.mjs, and never calls resolvePerson) is provably unaffected — the two
// capture callers (resolve() and resolve-name.mjs) opt in explicitly. A fallback hit is only ever a
// CANDIDATE that flows into the existing confirm-WHO UI (Level B); never a silent attach.
export async function resolvePerson(supa, userId, hintName, context = {}) {
  const name = String(hintName || "").trim();
  if (!name) {
    return { level: "B", proposedPersonId: null, confidence: 0, evidence: "We couldn't tell who this is about — tap to choose.", name };
  }

  // 1) Strong key — an exact email/phone we already have wins outright (spec §12.1). Typed
  //    notes rarely carry one, so this is usually dormant, but every door funnels through here.
  //    identifiers survive a person tombstone, so we must confirm the matched person is still live.
  const ids = Array.isArray(context.identifiers) ? context.identifiers : [];
  if (ids.length) {
    const hit = await strongKeyMatch(supa, userId, ids);
    if (hit && (await personIsLive(supa, userId, hit.person_id))) {
      return { level: "A", proposedPersonId: hit.person_id, confidence: 1, evidence: `matches ${name} by a saved contact detail`, name };
    }
  }

  // 2) Fuzzy candidates from the shared RPC (trigram band ∪ same-surname), then the deterministic
  //    name engine decides real equivalence. NO new fuzzy logic. The RPC does not filter tombstoned
  //    people, so we drop any hard-deleted match here — never resolve/attach to a removed person
  //    (spec §4: a deleted person is excluded from every read/write).
  // TC-89 (1b): widen the trigram recall band for the voice/typed resolver from 0.4 → 0.25.
  // Bare first-name homophones like "Jon"/"John" score ~0.29 on trigram and, with no surname to
  // hit the RPC's surname branch, fall below 0.4 → the candidate never surfaces → a mis-spelled
  // duplicate is silently created. 0.25 sits just under that 0.29 so the pair enters the CANDIDATE
  // set only; the deterministic name engine (nameMatchKind → _names.mjs) still makes the real
  // yes/no call and the bias-to-split / never-auto-merge guarantees are unchanged. Caller-side
  // value only (the RPC default stays 0.4 for import dedup) — no migration, reversible by one number.
  const { data: cands, error } = await supa.rpc("tc38_fuzzy_person_match", { p_user_id: userId, p_name: name, p_threshold: 0.25 });
  if (error) { console.error("resolvePerson rpc", error); }
  const meta = await peopleMetaFor(supa, userId, (cands || []).map((c) => c.person_id));
  const matches = (cands || [])
    .map((c) => ({ ...c, kind: nameMatchKind(name, c.name) }))
    .filter((c) => c.kind && meta[c.person_id] && !meta[c.person_id].deleted);

  if (!matches.length) {
    // TC-91 first-name fallback (voice/typed capture only — see context.fallbackFirstName above).
    // The RPC's trigram+surname net missed everyone, but a bare spoken first name can still be an
    // existing saved person whose stored name is fuller ("Jon" said, "John Miller" saved). Compare
    // first-token↔first-token with the SAME deterministic engine (firstNamesEquivalent → _names.mjs,
    // which owns the Jon/John homophone + diminutive rules AND the length floor that kills 3-letter
    // noise like Tim/Jon). Every hit is a CANDIDATE only — it re-enters the identical confirm-WHO
    // paths below (single → one confirm-WHO; several → the ambiguous "which one?" list). Never a
    // silent attach; never a default pick. Reuses the same lightweight people read as roster biasing.
    if (context.fallbackFirstName) {
      const fb = await firstNameFallbackCandidates(supa, userId, name);
      if (fb.length === 1) {
        const m = fb[0];
        // Exactly one first-name match: a single confirm-WHO (Level B — the user must confirm WHO
        // before any write; a fallback hit is a homophone guess, never confident enough for Level A).
        return {
          level: "B",
          proposedPersonId: m.id,
          fallback: true, // marks a first-name homophone guess (not a trigram/surname match) so
                          // callers render it as a "is this them?" confirm-WHO, never a silent write.
          confidence: 0.7,
          evidence: `the only ${firstOf(name)} in your people${m.location ? `, in ${m.location}` : ""} — is this them?`,
          name,
        };
      }
      if (fb.length > 1) {
        // Several people share this first name — bias to SPLIT: surface all as candidates, never a
        // default pick (same contract as the RPC-side ambiguous branch below).
        return {
          level: "B",
          proposedPersonId: null,
          ambiguous: true,
          candidates: fb.map((m) => ({ id: m.id, name: m.name, location: m.location || "" })),
          confidence: 0.65,
          evidence: `there's more than one ${firstOf(name)} — tap the right one`,
          name,
        };
      }
    }
    return { level: "B", proposedPersonId: null, confidence: 0, evidence: `You don't have anyone named ${name} yet — confirm to add them.`, name };
  }

  // Location for the (small) live match set, so we can disambiguate + name the city in evidence.
  const locById = {};
  for (const m of matches) locById[m.person_id] = (meta[m.person_id] || {}).location || "";
  const rank = (m) => (m.kind === "exact" ? 3 : m.kind === "full" ? 2 : 1) * 100 + (typeof m.score === "number" ? m.score : 0);
  matches.sort((a, b) => rank(b) - rank(a));

  const locationHint = context.locationHint || "";

  if (matches.length === 1) {
    const m = matches[0];
    const conf = KIND_CONF[m.kind];
    const city = locById[m.person_id];
    const evidence =
      m.kind === "first"
        ? `the only ${firstOf(name)} in your people${city ? `, in ${city}` : ""}`
        : `matches ${m.name} in your people`;
    return { level: conf >= 0.9 ? "A" : "B", proposedPersonId: m.person_id, confidence: conf, evidence, name };
  }

  // Several people share this name. Bias to SPLIT — don't auto-attach. A location hint can pick
  // exactly one out of the crowd (then it's confident); otherwise it waits in To-Review.
  if (locationHint) {
    const corrob = matches.filter((m) => locMatch(locById[m.person_id], locationHint));
    if (corrob.length === 1) {
      const m = corrob[0];
      return { level: "A", proposedPersonId: m.person_id, confidence: 0.92, evidence: `the ${firstOf(name)} in ${locById[m.person_id] || locationHint}`, name };
    }
  }
  // Truly ambiguous: several same-name people and nothing to tell them apart. Do NOT pre-select a
  // best guess — a one-tap Confirm on a defaulted person is a silent wrong-person attach (P7). We
  // return the candidates so To-Review forces the user to pick which one (or reassign / discard).
  return {
    level: "B",
    proposedPersonId: null,
    ambiguous: true,
    candidates: matches.map((m) => ({ id: m.person_id, name: m.name, location: locById[m.person_id] || "" })),
    confidence: 0.72,
    evidence: `there's more than one ${firstOf(name)} — tap the right one`,
    name,
  };
}

// Group a parsed capture by its distinct NAMED people and resolve each once (resolution never
// runs on a relative subject). Returns { groups:[{ personHint, facts, resolution }], co_mentioned }.
// Facts with an empty person_hint (context supplies the person) are handled by the caller.
export async function resolve(userId, parsed, supa, context = {}) {
  const facts = Array.isArray(parsed?.facts) ? parsed.facts : [];
  const byHint = new Map();
  for (const f of facts) {
    const key = norm(f.person_hint);
    if (!byHint.has(key)) byHint.set(key, { personHint: f.person_hint || "", facts: [] });
    byHint.get(key).facts.push(f);
  }
  const groups = [];
  for (const g of byHint.values()) {
    const resolution = await resolvePerson(supa, userId, g.personHint, {
      locationHint: parsed.location_hint || context.locationHint || "",
      identifiers: context.identifiers,
      // TC-91: this is the voice/typed capture path — opt into the first-name fallback so a bare
      // spoken first name still surfaces an existing fuller-named person as a confirm-WHO candidate.
      fallbackFirstName: true,
    });
    groups.push({ ...g, resolution });
  }
  return { groups, co_mentioned: !!parsed?.co_mentioned };
}

// ──────────────────────────────────────────────────────────────────────────────────────────
//  ROSTER  (TC-89 — shared read for transcription biasing + the "say a name" front door)
// ──────────────────────────────────────────────────────────────────────────────────────────

// How many roster names we ever pull for biasing. A personal circle is tens of people; even a
// Pro book-of-business is low-hundreds. 200 keeps the OpenAI transcription `prompt` well under a
// few-hundred tokens (so it never bloats the request or the latency) while covering essentially
// every real roster. If a user somehow exceeds it, we take the 200 MOST-RECENTLY-CREATED people —
// a stable, deterministic proxy for "most likely to be talked about" without a schema change.
// (David's decision #3: reasonable cap, most-recent first. A richer recency signal — last note /
// last plan — is a future refinement; created_at is the cheap, indexed default.)
const ROSTER_CAP = 200;

// Fetch the verified user's people names for name biasing/matching. MUST be called with a
// service-role client and a userId taken from a VERIFIED token (never a request-body value) —
// this bypasses RLS, so the user_id pin is the whole safety story (_supabase.mjs contract).
// Returns a deduped array of names (first + full), newest-first, capped at ROSTER_CAP. Any
// failure returns [] — callers treat biasing as best-effort and never break on it.
export async function rosterNames(supa, userId) {
  try {
    const { data, error } = await supa
      .from("people")
      .select("name")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(ROSTER_CAP);
    if (error) { console.error("rosterNames", error); return []; }
    const seen = new Set();
    const out = [];
    for (const p of data || []) {
      const full = String(p.name || "").trim();
      if (!full) continue;
      for (const variant of [full, tokens(full)[0]]) {
        const v = String(variant || "").trim();
        const key = v.toLowerCase();
        if (v && !seen.has(key)) { seen.add(key); out.push(v); }
      }
    }
    return out;
  } catch (e) { console.error("rosterNames", e); return []; }
}

// TC-93 — the prompt-sized roster for the person-aware home conversation. ONE cheap query (no
// per-person fact read — that would be N queries and blow the Siri/Alexa speed budget). Returns
// [{ name, detail }] newest-first, capped at ROSTER_CAP, where `detail` is built INLINE from the
// relationship/location the same read already carries ("your close friend", "in Denver", or "" if
// neither). This lands in the CACHED system block (paid once per conversation), so Della can
// recognize "which Marc?" on the natural voice path with zero extra round-trip. The precise
// fact-based recognizableDetail is reserved for the resolve_person checker on tricky turns only.
// Must be called with a service-role client + a userId from a VERIFIED token (RLS is bypassed, so
// the user_id pin is the whole safety story). Any failure returns [] — the conversation just runs
// name-unaware (exactly today's anon behavior), never breaks.
export async function rosterForPrompt(supa, userId) {
  try {
    const { data, error } = await supa
      .from("people")
      .select("name, relationship, location")
      .eq("user_id", userId)
      .eq("contact_kind", "personal")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(ROSTER_CAP);
    if (error) { console.error("rosterForPrompt", error); return []; }
    const seen = new Set();
    const out = [];
    for (const p of data || []) {
      const name = String(p.name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const rel = String(p.relationship || "").trim();
      const loc = String(p.location || "").trim();
      // Same priority as recognizableDetail's non-fact tiers: relationship, then location.
      const detail = rel ? rel : (loc ? `in ${loc}` : "");
      out.push({ name, detail });
    }
    return out;
  } catch (e) { console.error("rosterForPrompt", e); return []; }
}

// TC-91 — first-name fallback candidate finder. When the trigram+surname RPC surfaced nobody for a
// spoken/typed name, walk the SAME bounded people read used for roster biasing (id + name + location,
// user_id-pinned, undeleted, newest-first, capped) and keep every person whose FIRST TOKEN is
// equivalent to the hint's FIRST TOKEN under the deterministic engine (firstNamesEquivalent). This is
// what catches "Jon" → saved "John Miller": the full-name trigram missed it, but first-token↔first-token
// (jon↔john) passes _names.mjs's spelling-close rule, while its length floor still rejects 3-letter
// coincidences (Tim/Jon). Returns [{ id, name, location }]; [] on any failure (fallback is best-effort,
// the caller then shows the normal "add new"). Never resolves a tombstoned person (deleted_at filter).
async function firstNameFallbackCandidates(supa, userId, hintName) {
  const hint = String(hintName || "").trim();
  if (!hint) return [];
  try {
    const { data, error } = await supa
      .from("people")
      .select("id, name, location")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(ROSTER_CAP);
    if (error) { console.error("firstNameFallbackCandidates", error); return []; }
    const out = [];
    for (const p of data || []) {
      const nm = String(p.name || "").trim();
      if (!nm) continue;
      if (firstNamesEquivalent(hint, nm)) out.push({ id: p.id, name: nm, location: p.location || "" });
    }
    return out;
  } catch (e) { console.error("firstNameFallbackCandidates", e); return []; }
}

// ──────────────────────────────────────────────────────────────────────────────────────────
//  RECOGNIZABLE DETAIL  (TC-89 refinement — "which person did you mean?")
// ──────────────────────────────────────────────────────────────────────────────────────────

// When a voice/name flow LOCKS onto an existing saved person by a spoken/typed name, the risk is
// IDENTITY, not spelling: the "Marc" the user means may be a DIFFERENT real human than the "Marc"
// they already saved (same sound, sometimes same spelling). So before we start the note we must make
// WHO we picked unmistakable — name them back with something the user will recognize.
//
// Returns { detail, hasDetail }:
//   detail    — a short recognizable phrase pulled from what the RECORD ACTUALLY HAS, in priority
//               order: relationship ("your close friend") → location ("in Denver") → most recent
//               open fact ("just started a new job"). NEVER invented — only real stored values.
//   hasDetail — false when the record carries nothing distinguishing, so the caller can fall back to
//               the clear "the <Name> you already have?" framing instead of a bare name.
// Best-effort: any failure returns an empty, no-detail result so the confirm still renders.
export async function recognizableDetail(supa, userId, personId) {
  const empty = { detail: "", hasDetail: false };
  if (!personId) return empty;
  try {
    const { data: person } = await supa
      .from("people")
      .select("relationship, location")
      .eq("user_id", userId)
      .eq("id", personId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!person) return empty;

    const rel = String(person.relationship || "").trim();
    const loc = String(person.location || "").trim();
    // 1) Relationship / how they know them ("your close friend", "someone you manage").
    if (rel) return { detail: rel, hasDetail: true };
    // 2) Location ("in Denver").
    if (loc) return { detail: `in ${loc}`, hasDetail: true };

    // 3) Most recent thing on record about them — a single open (undeleted) fact, newest first.
    //    Kept to the plain object text so it reads like a memory jog, not a data dump.
    const { data: facts } = await supa
      .from("facts")
      .select("object, created_at")
      .eq("user_id", userId)
      .eq("person_id", personId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const recent = String(facts?.[0]?.object || "").trim();
    if (recent) return { detail: recent, hasDetail: true };

    return empty;
  } catch (e) {
    console.error("recognizableDetail", e);
    return empty;
  }
}

// TC-93 — the shared, READ-ONLY name resolver both resolve-name.mjs (the T2/T4 endpoint) and
// converse.mjs (the `resolve_person` precise-checker tool) call, so their verdict can NEVER drift.
// Runs the SAME deterministic engine as capture (resolvePerson → _names.mjs) with the voice/typed
// first-name fallback opted in, then enriches the matched person / each candidate with the real
// recognizableDetail (relationship → location → most recent fact) so the caller can say
// "Marc, your friend in Denver — or someone new?" and the user can catch a wrong-identity match
// BEFORE anything is written. Writes NOTHING. Returns the canonical shape:
//   { kind:'match'|'ambiguous'|'none', person?:{id,name,detail,hasDetail}, candidates?:[...], evidence }
// Must be called with a service-role client + a userId from a VERIFIED token (RLS is bypassed).
export async function resolveNameShaped(supa, userId, hintName, context = {}) {
  const name = String(hintName || "").trim();
  if (!name) return { kind: "none", evidence: "" };

  const r = await resolvePerson(supa, userId, name, { fallbackFirstName: true, ...context });

  // A single match to confirm: a confident RPC match (Level A) OR a single first-name fallback hit
  // (Level B + fallback flag, a homophone guess like "Jon"→saved "John Miller"). Both render the
  // same confirm-WHO card; neither writes anything (read-only).
  if (r.proposedPersonId && (r.level === "A" || r.fallback)) {
    const { data: person } = await supa
      .from("people").select("id, name").eq("user_id", userId).eq("id", r.proposedPersonId).is("deleted_at", null).maybeSingle();
    if (person) {
      const { detail, hasDetail } = await recognizableDetail(supa, userId, person.id);
      return { kind: "match", person: { id: person.id, name: person.name, detail, hasDetail }, evidence: r.evidence || "" };
    }
    // Proposed person vanished (tombstoned between reads) → fall through to no match.
  }

  // Several same-name people, nothing to tell them apart → let the user pick (never a guess). A
  // recognizable detail per candidate keeps the pick list from repeating the same bare name.
  if (Array.isArray(r.candidates) && r.candidates.length) {
    const candidates = await Promise.all(
      r.candidates.map(async (c) => {
        const { detail, hasDetail } = await recognizableDetail(supa, userId, c.id);
        return { id: c.id, name: c.name, location: c.location || "", detail, hasDetail };
      })
    );
    return { kind: "ambiguous", candidates, evidence: r.evidence || "" };
  }

  return { kind: "none", evidence: r.evidence || "" };
}

// ── small helpers ──────────────────────────────────────────────────────────────────────────

function firstOf(name) { return tokens(name)[0] || name; }

async function strongKeyMatch(supa, userId, identifiers) {
  const values = identifiers.map((i) => i.value).filter(Boolean);
  if (!values.length) return null;
  const { data } = await supa.from("identifiers").select("person_id, type, value").eq("user_id", userId).in("value", values);
  if (!data?.length) return null;
  const wanted = new Set(identifiers.map((i) => `${i.type} ${i.value}`));
  const hit = data.find((r) => wanted.has(`${r.type} ${r.value}`));
  return hit ? { person_id: hit.person_id } : null;
}

// Location + tombstone status for a set of candidate ids, in one query — used to drop hard-deleted
// matches (spec §4) and to name the city in disambiguation evidence.
async function peopleMetaFor(supa, userId, ids) {
  const map = {};
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return map;
  const { data } = await supa.from("people").select("id, location, deleted_at").eq("user_id", userId).in("id", uniq);
  for (const p of data || []) map[p.id] = { location: p.location || "", deleted: !!p.deleted_at };
  return map;
}

// Is a person still live (not user-hard-deleted)? Used to reject a strong-key match onto a
// tombstoned person (identifiers outlive the person row).
async function personIsLive(supa, userId, personId) {
  const { data } = await supa.from("people").select("id").eq("user_id", userId).eq("id", personId).is("deleted_at", null).maybeSingle();
  return !!data;
}
