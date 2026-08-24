// Thoughts Count — smart column mapping for the pro CSV import.
//
// The make-or-break of this feature is that ANY file just works: any column names,
// any order, no template. The client parses the file, sniffs the obvious columns
// itself, and sends here ONLY the headers plus a few sample values for the columns
// it couldn't resolve. We re-sniff every header, and for the genuine remainder ask
// one small model call to propose a mapping. If that call fails, we degrade to our
// best heuristic guess — an LLM outage never blocks an import.
//
// Privacy posture mirrors plan generation: obvious fields are resolved locally; only
// the unresolved columns' header + a handful of samples ever leave the browser.

import { requireUser, json } from "./_supabase.mjs";
import { getEnv } from "./_email.mjs";
import { logClaudeUsage } from "./_usage.mjs";

const MODEL = "claude-sonnet-4-6";

// The canonical fields a column can map to.
const FIELDS = ["name", "first_name", "last_name", "email", "phone", "relationship", "notes", "location", "key_date", "ignore"];
const KEY_DATE_KINDS = ["birthday", "work_anniversary", "closing", "custom"];

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const auth = await requireUser(req);
  if (auth.error) return json(auth.status, { error: auth.error });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }
  const headers = Array.isArray(body?.headers) ? body.headers.map((h) => String(h ?? "")) : [];
  const samples = body?.samples && typeof body.samples === "object" ? body.samples : {};
  if (!headers.length) return json(400, { error: "No columns to analyze." });

  // 1) Header + content heuristics for every column.
  const mapping = {};
  const keyDateColumns = [];
  const confidence = {};
  const ambiguous = []; // { index, header, sampleValues }

  headers.forEach((header, i) => {
    const sv = Array.isArray(samples[i]) ? samples[i].filter((x) => x != null && String(x).trim() !== "").slice(0, 5) : [];
    const guess = sniffColumn(header, sv);
    confidence[i] = guess.confidence;
    if (guess.confidence === "high") {
      applyGuess(mapping, keyDateColumns, i, guess);
    } else if (sv.length) {
      // Client flagged it ambiguous (sent samples) and we can't resolve it confidently → LLM.
      ambiguous.push({ index: i, header, sampleValues: sv });
      applyGuess(mapping, keyDateColumns, i, guess); // provisional best guess, may be overwritten
    } else {
      applyGuess(mapping, keyDateColumns, i, guess);
    }
  });

  // 2) One small model call for the ambiguous remainder only. Graceful on any failure.
  if (ambiguous.length) {
    try {
      const proposed = await proposeMapping(ambiguous);
      if (proposed) {
        for (const p of proposed) {
          const col = ambiguous.find((a) => a.header === p.header);
          if (!col) continue;
          const field = FIELDS.includes(p.field) ? p.field : "ignore";
          const guess = { field, confidence: "model" };
          if (p.is_key_date || field === "key_date") {
            guess.field = "key_date";
            guess.kind = KEY_DATE_KINDS.includes(p.key_date_kind) ? p.key_date_kind : "custom";
          }
          // clear any provisional keyDateColumns entry for this index before re-applying
          removeKeyDate(keyDateColumns, col.index);
          applyGuess(mapping, keyDateColumns, col.index, guess);
          confidence[col.index] = "model";
        }
      }
    } catch (err) {
      console.error("import-analyze: model mapping failed, using heuristics", err);
      // keep the provisional heuristic guesses already in `mapping`
    }
  }

  return json(200, { mapping, keyDateColumns, confidence });
};

// ---------- heuristics ----------

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|[a-z]{3,9}\.?\s+\d{1,2},?\s+\d{2,4})$/i;
const PHONE_RE = /^[+(]?[\d][\d\s().\-]{6,}$/;

// Returns { field, kind?, confidence: 'high'|'low'|'none' }. Exported for unit tests.
export function sniffColumn(header, samples = []) {
  const h = norm(header);

  // Header keyword rules (high confidence).
  const byHeader = headerRule(h);
  if (byHeader) return { confidence: "high", ...byHeader };

  // Content sniffing when the header didn't tell us.
  if (samples.length) {
    const frac = (pred) => samples.filter(pred).length / samples.length;
    if (frac((v) => EMAIL_RE.test(String(v).trim())) >= 0.6) return { field: "email", confidence: "high" };
    if (frac((v) => DATE_RE.test(String(v).trim())) >= 0.6) return { field: "key_date", kind: "custom", confidence: "low" };
    if (frac((v) => PHONE_RE.test(String(v).trim()) && (String(v).replace(/\D/g, "").length >= 7)) >= 0.6)
      return { field: "phone", confidence: "high" };
  }
  return { field: "ignore", confidence: "none" };
}

function headerRule(h) {
  if (h.includes("email") || h === "mail" || h === "eaddress") return { field: "email" };
  if (h.includes("mobile") || h.includes("cell") || h === "phone" || h.includes("phone") || h.includes("telephone")) return { field: "phone" };
  if (h.includes("firstname") || h === "fname" || h.includes("givenname")) return { field: "first_name" };
  if (h.includes("lastname") || h === "lname" || h.includes("surname") || h.includes("familyname")) return { field: "last_name" };
  if (h === "name" || h.includes("fullname") || h.includes("contactname") || h.includes("clientname") || h.includes("displayname")) return { field: "name" };
  if (h.includes("birthday") || h.includes("birthdate") || h === "dob" || h === "bday" || h.includes("dateofbirth")) return { field: "key_date", kind: "birthday" };
  if (h.includes("workanniversary") || h.includes("workanniv") || h.includes("startdate") || h.includes("hiredate")) return { field: "key_date", kind: "work_anniversary" };
  if (h.includes("closing") || h.includes("closedate") || h.includes("clientsince") || h.includes("customersince")) return { field: "key_date", kind: "closing" };
  if (h.includes("anniversary")) return { field: "key_date", kind: "work_anniversary" };
  if (h.includes("relationship") || h === "type" || h.includes("category") || h.includes("role") || h === "stage" || h.includes("segment")) return { field: "relationship" };
  if (h.includes("note") || h.includes("comment") || h.includes("memo") || h.includes("description")) return { field: "notes" };
  if (h.includes("address") || h === "city" || h.includes("state") || h === "zip" || h.includes("zipcode") || h.includes("postal") || h.includes("location") || h.includes("region")) return { field: "location" };
  if (h.includes("date") && !h.includes("update") && !h.includes("create")) return { field: "key_date", kind: "custom" };
  return null;
}

function applyGuess(mapping, keyDateColumns, index, guess) {
  mapping[index] = guess.field;
  if (guess.field === "key_date") {
    keyDateColumns.push({ colIndex: index, kind: guess.kind || "custom" });
  }
}
function removeKeyDate(keyDateColumns, index) {
  const at = keyDateColumns.findIndex((k) => k.colIndex === index);
  if (at >= 0) keyDateColumns.splice(at, 1);
}

// ---------- model call ----------

const PROPOSE_SCHEMA = {
  type: "object",
  properties: {
    mappings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          header: { type: "string", description: "The exact column header text provided." },
          field: { type: "string", enum: FIELDS, description: "Which canonical contact field this column holds." },
          is_key_date: { type: "boolean", description: "True if this column is a date worth showing up for." },
          key_date_kind: { type: "string", enum: KEY_DATE_KINDS, description: "If is_key_date, which kind." },
        },
        required: ["header", "field"],
      },
    },
  },
  required: ["mappings"],
};

async function proposeMapping(ambiguous) {
  const apiKey = getEnv("ANTHROPIC_API_KEY");
  if (!apiKey) return null;

  const columnList = ambiguous
    .map((a) => `- Header: ${JSON.stringify(a.header)} · sample values: ${JSON.stringify(a.sampleValues)}`)
    .join("\n");
  const userMessage =
    "Map each spreadsheet column below to the contact field it holds, for a tool that helps a " +
    "professional load their book of business. Use the header and the sample values. If a column " +
    "is a meaningful date (birthday, work anniversary, closing/client-since), set is_key_date and " +
    "the kind. If a column isn't a contact detail, map it to \"ignore\".\n\n" +
    columnList;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      temperature: 0,
      tools: [{ name: "propose_mapping", description: "Return the canonical field each column maps to.", input_schema: PROPOSE_SCHEMA }],
      tool_choice: { type: "tool", name: "propose_mapping" },
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) {
    console.error("import-analyze anthropic error", res.status);
    return null;
  }
  const data = await res.json();
  await logClaudeUsage({ fn: "import-analyze", model: MODEL, usage: data.usage });
  const toolUse = (data.content || []).find((b) => b.type === "tool_use");
  return Array.isArray(toolUse?.input?.mappings) ? toolUse.input.mappings : null;
}
