// Thoughts Count — client helpers for SITUATION reminders (capture-loop spec §6 / §4.2).
//
// A "situation" is a key_date with kind='situation' (e.g. "Marcus's chemo · Sep 7"). Unlike a
// plain date, which nudges once at a single lead time, a situation can carry SEVERAL nudges around
// it — "3 days before", "day of", "the day after". Those live in a child table, situation_reminders.
//
// This module is the sibling of _memory.js → mountNoticed(): same read/add/inline-edit/two-step-
// confirm-delete affordances, same warm plain language, no engine vocabulary. Writes go DIRECTLY to
// situation_reminders via RLS (mirroring how companion.js writes key_dates client-side), with
// user_id denormalized on insert so RLS is satisfied.
//
// DEGRADE GRACEFULLY: if the situation_reminders table isn't migrated yet, every read returns [] and
// a situation renders as a plain date row — nothing throws (spec: empty ⇒ render as plain dates).

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A pre-migration read error we treat as "no reminders" (table not there yet) rather than a failure.
function isMissingTable(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = String(error.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || code === "PGRST200" ||
    /does not exist|could not find the table|relationship|schema cache/.test(msg);
}

/* ---------------- offset ↔ phrase (the ONE vocabulary of a reminder) ---------------- */
// lead_days follows key_dates.lead_days: POSITIVE = that many days BEFORE the date, 0 = the day
// itself, NEGATIVE = that many days AFTER. This is the whole model — one signed integer per nudge.
export function offsetPhrase(lead_days) {
  const n = Number(lead_days);
  if (!Number.isFinite(n) || n === 0) return "day of";
  if (n === 1) return "1 day before";
  if (n === 7) return "a week before";
  if (n === 14) return "two weeks before";
  if (n > 0) return `${n} days before`;
  const a = Math.abs(n);
  if (a === 1) return "1 day after";
  if (a === 7) return "a week after";
  return `${a} days after`;
}

// The presets the picker offers first (a calm, common palette); a free integer covers the rest.
export const REMINDER_PRESETS = [
  { lead_days: 7, label: "A week before" },
  { lead_days: 3, label: "3 days before" },
  { lead_days: 1, label: "The day before" },
  { lead_days: 0, label: "On the day" },
  { lead_days: -1, label: "The day after" },
  { lead_days: -7, label: "A week after" },
];

// A compact summary of a situation's nudges for the row (e.g. "3 days before, day of, day after").
// Sorted soonest-lead-first (largest positive → most-after) so it reads chronologically.
export function remindersSummary(reminders) {
  const active = (reminders || []).filter((r) => r.active !== false);
  if (!active.length) return "";
  return active
    .slice()
    .sort((a, b) => Number(b.lead_days) - Number(a.lead_days))
    .map((r) => offsetPhrase(r.lead_days))
    .join(", ");
}

/* ---------------- reads (RLS-scoped anon) ---------------- */

// A single situation's reminders. Degrades to [] if the table is absent (pre-migration).
export async function loadReminders(sb, keyDateId) {
  if (!sb || !keyDateId) return [];
  const { data, error } = await sb
    .from("situation_reminders")
    .select("id,key_date_id,lead_days,label,active")
    .eq("key_date_id", keyDateId)
    .order("lead_days", { ascending: false });
  if (error) { if (!isMissingTable(error)) console.error("loadReminders", error); return []; }
  return data || [];
}

/* ---------------- writes (direct RLS, user_id denormalized) ---------------- */

// The signed-in user's id — reminders denormalize user_id so RLS (owner-only) is satisfied on insert.
async function currentUserId(sb) {
  const { data } = await sb.auth.getSession();
  return data?.session?.user?.id || null;
}

// Add a reminder to a situation. Idempotent-ish: a duplicate (same key_date_id + lead_days) is a
// no-op so re-adding "day of" can't stack. Returns the inserted (or existing) row, or null on failure.
export async function addReminder(sb, keyDateId, lead_days, label = null) {
  const uid = await currentUserId(sb);
  if (!uid || !keyDateId) throw new Error("Please sign in to add a reminder.");
  const n = Number(lead_days);
  if (!Number.isFinite(n)) throw new Error("That reminder timing didn't look right.");
  const row = { user_id: uid, key_date_id: keyDateId, lead_days: n, active: true };
  if (label) row.label = String(label).slice(0, 120);
  const { data, error } = await sb.from("situation_reminders").insert(row).select().single();
  if (error) {
    // Unique-violation on (key_date_id, lead_days) → the nudge already exists; treat as success.
    if (String(error.code) === "23505") return { ...row, duplicate: true };
    throw new Error(error.message || "Couldn't add that reminder.");
  }
  return data;
}

export async function removeReminder(sb, reminderId) {
  const { error } = await sb.from("situation_reminders").delete().eq("id", reminderId);
  if (error) throw new Error(error.message || "Couldn't remove that reminder.");
}

export async function retimeReminder(sb, reminderId, lead_days) {
  const n = Number(lead_days);
  if (!Number.isFinite(n)) throw new Error("That reminder timing didn't look right.");
  const { error } = await sb.from("situation_reminders").update({ lead_days: n }).eq("id", reminderId);
  if (error) throw new Error(error.message || "Couldn't update that reminder.");
}

/* ---------------- styles (injected once) ---------------- */
export function ensureReminderStyles() {
  if (document.getElementById("tcRemindersCss")) return;
  const s = document.createElement("style");
  s.id = "tcRemindersCss";
  s.textContent = `
  .tc-reminders{margin:6px 0 2px;}
  .tc-rem-head{color:var(--sage-deep);font-size:.8rem;font-weight:600;margin-bottom:6px;}
  .tc-rem-list{display:flex;flex-direction:column;gap:5px;margin-bottom:8px;}
  .tc-rem-row{display:flex;align-items:center;justify-content:space-between;gap:8px;
    background:var(--mist);border:1px solid var(--line);border-radius:10px;padding:6px 6px 6px 12px;}
  .tc-rem-txt{font-size:.9rem;color:var(--ink);}
  .tc-rem-tools{display:inline-flex;gap:2px;align-items:center;flex:0 0 auto;}
  .tc-rem-confirm{font-size:.85rem;color:var(--ink-soft);}
  .tc-rem-editwrap{display:flex;align-items:center;gap:6px;flex:1 1 auto;}
  .tc-rem-editnum{width:64px;text-align:center;}
  .tc-rem-editwhen{font-size:.85rem;color:var(--ink-soft);}
  .tc-rem-add{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
  .tc-rem-add .tc-select{flex:1 1 150px;min-width:0;}
  .tc-rem-empty{color:var(--ink-soft);font-size:.85rem;margin-bottom:8px;}
  .tc-rem-msg{margin-top:4px;}
  /* Situation row (a date + its nudges summary + the inline editor), shared by both surfaces. */
  .tc-sit{padding:2px 0 4px;}
  .tc-sit-nudges{color:var(--sage-deep);font-size:.82rem;margin:1px 0 4px;}
  .tc-sit-nudges-empty{color:var(--ink-soft);}
  /* Starter-nudge chips on the add-a-situation form (spec §4.2), default off, toggle on. */
  .tc-nudge-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px;}
  .tc-nudge-chip{appearance:none;background:transparent;border:1.5px solid var(--sage);color:var(--sage-deep);
    font:inherit;font-weight:600;font-size:.86rem;padding:6px 13px;border-radius:999px;cursor:pointer;
    transition:background .12s,border-color .12s,color .12s;}
  .tc-nudge-chip:hover,.tc-nudge-chip:focus-visible{background:var(--mist);border-color:var(--sage-deep);outline:none;}
  .tc-nudge-chip.is-on{background:var(--sage-deep);border-color:var(--sage-deep);color:#fff;}
  `;
  document.head.appendChild(s);
}

/* ---------------- mountReminders (sibling of mountNoticed) ---------------- */

// Mount the reminders editor for ONE situation key_date into `container`, self-refreshing across
// add / retime (inline edit) / remove (two-step confirm). Mirrors mountNoticed's structure + idioms.
//   opts.reminders — initial rows (skips a fetch); opts.onChange — called after any change so the
//   caller can refresh the row summary. Returns { refresh }.
export function mountReminders(container, sb, keyDate, opts = {}) {
  ensureReminderStyles();
  let reminders = opts.reminders || null;
  const onChange = typeof opts.onChange === "function" ? opts.onChange : () => {};

  async function refresh(fetch = true) {
    if (fetch || !reminders) reminders = await loadReminders(sb, keyDate.id);
    render();
  }

  function presetOptions() {
    // Hide presets the situation already carries, so "add" never offers a duplicate.
    const have = new Set((reminders || []).map((r) => Number(r.lead_days)));
    const opts = REMINDER_PRESETS.filter((p) => !have.has(p.lead_days))
      .map((p) => `<option value="${p.lead_days}">${esc(p.label)}</option>`).join("");
    return opts + `<option value="custom">A number of days…</option>`;
  }

  function render() {
    const list = reminders || [];
    const rows = list.length
      ? list.slice().sort((a, b) => Number(b.lead_days) - Number(a.lead_days)).map((r) => `
          <div class="tc-rem-row" data-rid="${r.id}">
            <span class="tc-rem-txt">${esc(offsetPhrase(r.lead_days))}</span>
            <span class="tc-rem-tools">
              <button class="link-btn tc-rem-edit" data-rid="${r.id}" aria-label="Change timing">Change</button>
              <button class="link-btn tc-rem-del" data-rid="${r.id}" aria-label="Remove reminder">Remove</button>
            </span>
          </div>`).join("")
      : `<div class="tc-rem-empty">No nudges yet — add one so ${esc(keyDate.label ? "this" : "it")} doesn't slip by.</div>`;

    container.innerHTML = `
      <div class="tc-reminders">
        <div class="tc-rem-head">Nudge me</div>
        <div class="tc-rem-list">${rows}</div>
        <div class="tc-rem-add">
          <select class="tc-select tc-rem-preset">${presetOptions()}</select>
          <input type="number" class="tc-rem-customnum" placeholder="days" style="width:72px;display:none;" />
          <span class="tc-rem-customdir" style="display:none;"><select class="tc-select tc-rem-customwhen" style="width:auto;"><option value="before">before</option><option value="after">after</option></select></span>
          <button class="link-btn tc-rem-save">Add nudge</button>
        </div>
        <div class="k-msg tc-rem-msg"></div>
      </div>`;
    wire();
  }

  function wire() {
    const msg = container.querySelector(".tc-rem-msg");
    const setMsg = (t, bad) => { msg.className = "k-msg tc-rem-msg" + (bad ? " bad" : ""); msg.textContent = t || ""; };
    const preset = container.querySelector(".tc-rem-preset");
    const customNum = container.querySelector(".tc-rem-customnum");
    const customDir = container.querySelector(".tc-rem-customdir");
    const customWhen = container.querySelector(".tc-rem-customwhen");

    const syncCustom = () => {
      const on = preset.value === "custom";
      customNum.style.display = on ? "" : "none";
      customDir.style.display = on ? "" : "none";
      if (on) customNum.focus();
    };
    preset.onchange = syncCustom;

    // Add
    const add = async () => {
      let lead;
      if (preset.value === "custom") {
        const days = Math.abs(parseInt(customNum.value, 10));
        if (!Number.isFinite(days) || days < 1) { customNum.focus(); return; }
        lead = customWhen.value === "after" ? -days : days;
      } else {
        lead = Number(preset.value);
      }
      setMsg("Adding...");
      try {
        await addReminder(sb, keyDate.id, lead);
        setMsg("");
        await refresh();
        onChange();
      } catch (e) { setMsg(e.message, true); }
    };
    container.querySelector(".tc-rem-save").onclick = add;
    customNum.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });

    // Retime (inline edit — number of days + before/after, mirroring the add picker)
    container.querySelectorAll(".tc-rem-edit").forEach((btn) => {
      btn.onclick = () => {
        const row = container.querySelector(`.tc-rem-row[data-rid="${btn.dataset.rid}"]`);
        const r = (reminders || []).find((x) => x.id === btn.dataset.rid);
        if (!row || !r) return;
        const n = Number(r.lead_days);
        const dayOf = n === 0;
        row.innerHTML = `
          <span class="tc-rem-editwrap">
            <input type="number" class="tc-rem-editnum" min="0" value="${dayOf ? 0 : Math.abs(n)}" />
            <select class="tc-select tc-rem-editwhen" style="width:auto;">
              <option value="before"${n > 0 ? " selected" : ""}>days before</option>
              <option value="day"${dayOf ? " selected" : ""}>day of</option>
              <option value="after"${n < 0 ? " selected" : ""}>days after</option>
            </select>
          </span>
          <span class="tc-rem-tools">
            <button class="link-btn tc-rem-saveedit">Save</button>
            <button class="link-btn tc-rem-canceledit">Cancel</button>
          </span>`;
        const numEl = row.querySelector(".tc-rem-editnum");
        const whenEl = row.querySelector(".tc-rem-editwhen");
        const syncNum = () => { numEl.style.display = whenEl.value === "day" ? "none" : ""; };
        syncNum(); whenEl.onchange = syncNum;
        numEl.focus();
        const save = async () => {
          let lead = 0;
          if (whenEl.value !== "day") {
            const days = Math.abs(parseInt(numEl.value, 10));
            if (!Number.isFinite(days) || days < 1) { numEl.focus(); return; }
            lead = whenEl.value === "after" ? -days : days;
          }
          setMsg("Saving...");
          try { await retimeReminder(sb, r.id, lead); await refresh(); onChange(); }
          catch (e) { setMsg(e.message, true); }
        };
        row.querySelector(".tc-rem-saveedit").onclick = save;
        numEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") render(); });
        row.querySelector(".tc-rem-canceledit").onclick = () => render();
      };
    });

    // Remove (two-step inline confirm — no blocking dialog, mirroring mountNoticed)
    container.querySelectorAll(".tc-rem-del").forEach((btn) => {
      btn.onclick = () => {
        const row = container.querySelector(`.tc-rem-row[data-rid="${btn.dataset.rid}"]`);
        const tools = row && row.querySelector(".tc-rem-tools");
        if (!tools) return;
        tools.innerHTML = `<span class="tc-rem-confirm">Remove this nudge? <button class="link-btn tc-rem-yes">Yes</button> · <button class="link-btn tc-rem-no">Keep</button></span>`;
        tools.querySelector(".tc-rem-no").onclick = () => render();
        tools.querySelector(".tc-rem-yes").onclick = async () => {
          setMsg("Removing...");
          try { await removeReminder(sb, btn.dataset.rid); await refresh(); onChange(); }
          catch (e) { setMsg(e.message, true); }
        };
      };
    });
  }

  refresh(!opts.reminders);
  return { refresh };
}
