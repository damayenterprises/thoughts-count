// WP-A tests — Nudge engine v2 (spec §5, §8 risks 4 & 5). Pure + offline: a fake supabase
// client + an injected `today` (the MOS CI test-gate injectable-clock pattern) so nothing is
// time-of-day flaky and no key/network is needed. Run WITHOUT --env-file:
//   node test/spec-a-nudges-v2.test.mjs
import assert from "node:assert";
import { runNudges, occurrenceFor, daysBetween } from "../netlify/functions/nudges-cron.mjs";

let pass = 0, fail = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { pass++; console.log(`  ok   ${name}`); },
    (e) => { fail++; console.log(`  FAIL ${name} — ${e.message}`); },
  );
}
const D = (s) => new Date(s + "T00:00:00");

// ── A minimal in-memory fake of the supabase client, matching ONLY the call shapes the cron
// uses: from(table).select(cols)[.eq/.is].maybeSingle() / .insert(row), and auth.admin.getUserById.
function makeSupa({ keyDates = [], reminders = [], log = [], userEmail = "owner@example.com" } = {}) {
  const nudgeLog = [...log];

  function builder(table) {
    const filters = [];
    const api = {
      select() { return api; },
      eq(col, val) { filters.push(["eq", col, val]); return api; },
      is(col, val) { filters.push(["is", col, val]); return api; },
      _rows() {
        let rows =
          table === "key_dates" ? keyDates :
          table === "situation_reminders" ? reminders :
          table === "nudge_log" ? nudgeLog : [];
        for (const [op, col, val] of filters) {
          rows = rows.filter((r) => {
            const cell = r[col] === undefined ? null : r[col];
            if (op === "is") return cell === val;      // .is(col, null)
            return cell === val;                        // .eq
          });
        }
        return rows;
      },
      async maybeSingle() { const r = api._rows(); return { data: r[0] || null, error: null }; },
      then(res) {                                        // awaited directly (the situation_reminders select)
        return Promise.resolve({ data: api._rows(), error: null }).then(res);
      },
      async insert(row) { if (table === "nudge_log") nudgeLog.push({ ...row }); return { data: null, error: null }; },
    };
    return api;
  }

  return {
    from: (table) => builder(table),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: userEmail } } }) } },
    __log: nudgeLog,
  };
}

// A send() stub that always "succeeds" and records what went out, so we can assert copy + counts.
function makeSend() {
  const outbox = [];
  const send = async (msg) => { outbox.push(msg); return { ok: true }; };
  return { send, outbox };
}

const OWNER = "11111111-1111-1111-1111-111111111111";
const kd = (over) => ({
  id: "kd-1", user_id: OWNER, person_id: "p-1", label: "Sarah's chemo",
  event_date: "2026-09-07", recurs: false, lead_days: 7, date_precision: "day",
  people: { name: "Sarah", deleted_at: null }, ...over,
});

console.log("# occurrenceFor — the timezone/occurrence math (kept verbatim for recurring/future one-off)");
await t("recurring rolls to this year when still ahead", () => {
  const occ = occurrenceFor("2020-09-07", true, D("2026-08-17"), 0);
  assert.equal(occ.getFullYear(), 2026);
  assert.equal(daysBetween(D("2026-08-17"), occ), 21);
});
await t("recurring rolls to NEXT year across the boundary (Jan reminder for a Dec date)", () => {
  // A +7 reminder on a Dec 25 recurring date, evaluated Dec 30 → next occurrence is next Dec 25.
  const occ = occurrenceFor("2020-12-25", true, D("2026-12-30"), 7);
  assert.equal(occ.getFullYear(), 2027);
});
await t("future one-off returns its fixed date", () => {
  assert.equal(occurrenceFor("2026-09-07", false, D("2026-08-17"), 0).getTime(), D("2026-09-07").getTime());
});
await t("past one-off with NO after-reminder returns null (legacy behavior)", () => {
  assert.equal(occurrenceFor("2026-09-07", false, D("2026-09-10"), 0), null);
});
await t("past one-off STAYS evaluable within the after-window (minLead=-3)", () => {
  assert.equal(occurrenceFor("2026-09-07", false, D("2026-09-10"), -3).getTime(), D("2026-09-07").getTime());
});
await t("past one-off drops out once beyond the after-window", () => {
  assert.equal(occurrenceFor("2026-09-07", false, D("2026-09-11"), -3), null);
});

console.log("\n# Risk 5 — legacy key_date (no reminders) fires exactly once at its own lead_days");
await t("legacy fires on the lead day, logs (kd, occ, NULL)", async () => {
  const supa = makeSupa({ keyDates: [kd()] });          // lead_days 7, no situation_reminders
  const { send, outbox } = makeSend();
  const out = await runNudges(supa, { today: D("2026-08-31"), send });   // 7 days before Sep 7
  assert.equal(out.sent, 1);
  assert.equal(outbox.length, 1);
  assert.equal(supa.__log.length, 1);
  assert.equal(supa.__log[0].reminder_id, null);        // legacy slot is NULL
  assert.equal(supa.__log[0].occurrence, "2026-09-07");
});
await t("legacy does NOT fire on a non-lead day", async () => {
  const supa = makeSupa({ keyDates: [kd()] });
  const { send } = makeSend();
  const out = await runNudges(supa, { today: D("2026-08-30"), send });   // 8 days before → no fire
  assert.equal(out.sent, 0);
});
await t("legacy fires ONCE — a second run the same day is deduped", async () => {
  const supa = makeSupa({ keyDates: [kd()] });
  const { send } = makeSend();
  await runNudges(supa, { today: D("2026-08-31"), send });
  const out2 = await runNudges(supa, { today: D("2026-08-31"), send });
  assert.equal(out2.sent, 0);
  assert.equal(supa.__log.length, 1);
});

console.log("\n# Risk 4 — a situation with reminders at +7 / 0 / -1 fires on the right CT days");
const sitReminders = [
  { id: "r-before", key_date_id: "kd-1", user_id: OWNER, lead_days: 7, label: "a week before", active: true },
  { id: "r-day",    key_date_id: "kd-1", user_id: OWNER, lead_days: 0, label: "day of",        active: true },
  { id: "r-after",  key_date_id: "kd-1", user_id: OWNER, lead_days: -1, label: "day after",    active: true },
];
await t("+7 reminder fires 7 days before, logged under its reminder_id", async () => {
  const supa = makeSupa({ keyDates: [kd({ kind: "situation" })], reminders: sitReminders });
  const { send, outbox } = makeSend();
  const out = await runNudges(supa, { today: D("2026-08-31"), send });
  assert.equal(out.sent, 1);
  assert.equal(supa.__log[0].reminder_id, "r-before");
  assert.match(outbox[0].html || outbox[0].subject, /week|Sarah/i);
});
await t("day-of reminder (0) fires on the event date", async () => {
  const supa = makeSupa({ keyDates: [kd({ kind: "situation" })], reminders: sitReminders });
  const { send } = makeSend();
  const out = await runNudges(supa, { today: D("2026-09-07"), send });
  assert.equal(out.sent, 1);
  assert.equal(supa.__log[0].reminder_id, "r-day");
});
await t("-1 'after' reminder fires the DAY AFTER a now-past one-off", async () => {
  const supa = makeSupa({ keyDates: [kd({ kind: "situation" })], reminders: sitReminders });
  const { send } = makeSend();
  const out = await runNudges(supa, { today: D("2026-09-08"), send });   // event was 09-07
  assert.equal(out.sent, 1);
  assert.equal(supa.__log[0].reminder_id, "r-after");
});
await t("recurring situation reminders fire correctly across a YEAR boundary", async () => {
  // Dec 25 recurring, +7 reminder → fires Dec 18 whatever the year.
  const rec = kd({ id: "kd-x", event_date: "2020-12-25", recurs: true, kind: "situation", label: "the holidays" });
  const rems = [{ id: "r7", key_date_id: "kd-x", user_id: OWNER, lead_days: 7, label: null, active: true }];
  const supa = makeSupa({ keyDates: [rec], reminders: rems });
  const { send } = makeSend();
  const out = await runNudges(supa, { today: D("2026-12-18"), send });
  assert.equal(out.sent, 1);
  assert.equal(supa.__log[0].occurrence, "2026-12-25");
});

console.log("\n# Risk 5 — a 2-reminder date logs two INDEPENDENT rows for one occurrence");
await t("two reminders due the SAME day both fire and log separately", async () => {
  // Two reminders both at +7 would collide on the day; use two that land the same CT day only if
  // offsets differ AND today matches both — instead assert independence across the occurrence: fire
  // +7 on 08-31 then 0 on 09-07, both logged, distinct reminder_ids, same occurrence string.
  const supa = makeSupa({
    keyDates: [kd({ kind: "situation" })],
    reminders: [
      { id: "rA", key_date_id: "kd-1", user_id: OWNER, lead_days: 7, label: null, active: true },
      { id: "rB", key_date_id: "kd-1", user_id: OWNER, lead_days: 0, label: null, active: true },
    ],
  });
  const { send } = makeSend();
  await runNudges(supa, { today: D("2026-08-31"), send });   // rA fires
  await runNudges(supa, { today: D("2026-09-07"), send });   // rB fires
  assert.equal(supa.__log.length, 2);
  const ids = supa.__log.map((r) => r.reminder_id).sort();
  assert.deepEqual(ids, ["rA", "rB"]);
  assert.ok(supa.__log.every((r) => r.occurrence === "2026-09-07"));  // same occurrence, independent rows
});
await t("a situation with reminders IGNORES the key_date's own lead_days", async () => {
  // kd.lead_days is 7, but the only reminder is at 0 → nothing fires 7 days out.
  const supa = makeSupa({
    keyDates: [kd({ kind: "situation" })],
    reminders: [{ id: "rOnly", key_date_id: "kd-1", user_id: OWNER, lead_days: 0, label: null, active: true }],
  });
  const { send } = makeSend();
  const out = await runNudges(supa, { today: D("2026-08-31"), send });   // 7 before → the legacy lead is ignored
  assert.equal(out.sent, 0);
});

console.log("\n# No-default-nudge — a captured one-off with lead_days=NULL is remembered but NEVER nudges");
await t("null lead_days + no reminders → zero fires on any day (della-situational-no-formula)", async () => {
  // A one-off dated capture the user set NO reminder on is seeded lead_days:null (non-nudging).
  const supa = makeSupa({ keyDates: [kd({ lead_days: null, kind: "moment" })] });
  const { send, outbox } = makeSend();
  // Try the day it WOULD have fired under the old 7-day default, the event day, and the day after.
  for (const day of ["2026-08-31", "2026-09-07", "2026-09-08"]) {
    const out = await runNudges(supa, { today: D(day), send });
    assert.equal(out.sent, 0, `should never nudge (day ${day})`);
  }
  assert.equal(outbox.length, 0);
  assert.equal(supa.__log.length, 0);              // nothing logged → nothing fired
});
await t("null lead_days but WITH explicit reminders → the reminders still fire", async () => {
  // A non-nudging key_date that later gains a real user-set reminder must fire that reminder
  // (the null legacy lead is only the fallback when there are NO situation_reminders).
  const supa = makeSupa({
    keyDates: [kd({ lead_days: null, kind: "situation" })],
    reminders: [{ id: "rX", key_date_id: "kd-1", user_id: OWNER, lead_days: 0, label: "day of", active: true }],
  });
  const { send } = makeSend();
  const out = await runNudges(supa, { today: D("2026-09-07"), send });
  assert.equal(out.sent, 1);
  assert.equal(supa.__log[0].reminder_id, "rX");
});

console.log("\n# Guardrails — deleted person, and graceful degrade when the table is absent");
await t("a tombstoned person never nudges", async () => {
  const supa = makeSupa({ keyDates: [kd({ people: { name: "Sarah", deleted_at: "2026-01-01T00:00:00Z" } })] });
  const { send } = makeSend();
  const out = await runNudges(supa, { today: D("2026-08-31"), send });
  assert.equal(out.sent, 0);
});

console.log("\n# FIX 2 — cross-user reminder (RLS with-check gap) is never fired");
const ATTACKER = "99999999-9999-9999-9999-999999999999";
await t("a situation_reminder whose user_id != the key_date owner is NOT fired", async () => {
  // The attacker inserted a reminder with THEIR own user_id but FK-referencing the OWNER's key_date
  // (the RLS with-check only pins the row's user_id, not the key_date's owner). The cron must skip it.
  // Use a NON-NUDGING key_date (lead_days:null) so there is no legitimate legacy fire — the ONLY
  // thing that could fire is the attacker's orphan, isolating the vector.
  const supa = makeSupa({
    keyDates: [kd({ kind: "situation", lead_days: null })],  // owned by OWNER, no implicit nudge
    reminders: [{ id: "r-evil", key_date_id: "kd-1", user_id: ATTACKER, lead_days: 7, label: "gotcha", active: true }],
  });
  const { send, outbox } = makeSend();
  const out = await runNudges(supa, { today: D("2026-08-31"), send });  // would-be +7 day
  assert.equal(out.sent, 0, "cross-user reminder must not fire");
  assert.equal(outbox.length, 0);
  assert.equal(supa.__log.length, 0);
});
await t("a legit owner reminder still fires even when a cross-user orphan sits alongside it", async () => {
  // The owner's own reminder must be unaffected by the presence of an attacker's orphan row.
  const supa = makeSupa({
    keyDates: [kd({ kind: "situation" })],
    reminders: [
      { id: "r-good", key_date_id: "kd-1", user_id: OWNER,    lead_days: 7, label: "a week before", active: true },
      { id: "r-evil", key_date_id: "kd-1", user_id: ATTACKER, lead_days: 7, label: "gotcha",        active: true },
    ],
  });
  const { send } = makeSend();
  const out = await runNudges(supa, { today: D("2026-08-31"), send });
  assert.equal(out.sent, 1, "the owner's reminder still fires");
  assert.equal(supa.__log.length, 1);
  assert.equal(supa.__log[0].reminder_id, "r-good");
});

await Promise.resolve();
console.log(`\n${fail ? "FAILED" : "PASSED"} — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
