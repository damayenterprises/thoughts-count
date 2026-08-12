// Thoughts Count — TC-107: guided, one-question-at-a-time capture (the lowest-cognitive-load
// capture STYLE for the timid / first-time / accessibility case).
//
// This is NOT a new capture SOURCE and NOT a new extraction engine. It is a calm STYLE that layers
// over the existing voice/type capture brain: one question per screen, a single field in focus,
// every step skippable, and it funnels the collected answers into the SAME
// captureExtract(preview) → renderImportConfirm → captureResolve → onConfirmed path everything
// else uses. No parallel write logic lives here.
//
// This module holds ONLY the pure, framework-free, unit-tested pieces:
//   • GUIDED_STEPS — the ordered questions (calm copy, one thing at a time).
//   • a tiny step/skip state machine (advance / back / skip / isDone).
//   • answersToDraft(answers) — shapes the collected answers into { rawText, prefill } that the
//     UI hands to the existing resolve/confirm plumbing. No DB, no browser.
//
// Copy rule (portfolio-wide): human-typed voice only — no em-dashes, ellipsis chars, or smart
// quotes anywhere a user could read it.

// The questions, in order. Only the FIRST (name) is ever a soft requirement to make a person; every
// other step is skippable and never blocks. `key` maps into the answers object; `optional:true`
// steps render a "Skip" affordance and never demand an answer.
export const GUIDED_STEPS = [
  {
    key: "name",
    eyebrow: "One at a time",
    title: "Who do you want to remember?",
    help: "Just their name is plenty. We'll add the rest together, one gentle question at a time.",
    placeholder: "e.g. Maria",
    optional: false,
  },
  {
    key: "relationship",
    eyebrow: "One at a time",
    title: "What are they to you?",
    help: "This quietly shapes everything. What's right for a close friend is different for someone you manage.",
    placeholder: "e.g. a close friend, my sister, someone I manage",
    optional: true,
  },
  {
    key: "birthday",
    eyebrow: "One at a time",
    title: "When's their birthday?",
    help: "If you know it, we'll gently remind you before it comes around. The year is optional.",
    placeholder: "e.g. June 15",
    optional: true,
  },
  {
    key: "note",
    eyebrow: "One at a time",
    title: "Anything worth remembering about them?",
    help: "Whatever helps you show up for them. What they're going through, what they love, your history. Only if you want to.",
    placeholder: "e.g. She just started a new job and has been carrying a lot.",
    optional: true,
  },
];

// The step/skip state machine. Pure: given the steps and a current index it computes the next
// index for advance / back / skip, and whether the flow is complete. Skipping and advancing move
// the same direction (skip just means "no answer for this step"); the difference is recorded by the
// caller when it stores (or omits) an answer. `isDone(idx)` is true once we've moved past the last
// step.
export function makeGuidedState(steps = GUIDED_STEPS) {
  return { steps, idx: 0 };
}

export function stepAt(state) {
  return state.steps[state.idx] || null;
}

// Move forward one step (used by both "Continue" with an answer and "Skip" without one). Clamps at
// steps.length (one past the last), which isDone() reads as complete.
export function advance(state) {
  return { ...state, idx: Math.min(state.idx + 1, state.steps.length) };
}

// Move back one step, never before the first. Answers already collected are preserved by the
// caller, so going back and forward is non-destructive.
export function back(state) {
  return { ...state, idx: Math.max(state.idx - 1, 0) };
}

export function isDone(state) {
  return state.idx >= state.steps.length;
}

// The very first answer (a name) is the ONLY thing needed to make a person. Everything after is
// optional, so the flow can finish the moment there's a name — never demanding more.
export function canFinish(answers) {
  return !!(answers && String(answers.name || "").trim());
}

// Shape the collected answers into what the EXISTING resolve/confirm plumbing wants:
//   • rawText   — a plain, human sentence assembled from the answers, fed to captureExtract(preview)
//                 so the SAME extraction/dedup brain resolves WHICH person (never a parallel writer).
//                 It leads with the name so the extractor anchors on the right subject.
//   • prefill   — the structured fields the guided flow already knows, used to PRE-FILL the confirm
//                 card (name, relationship, birthday) so the user just checks and saves. These are
//                 authoritative over anything re-derived, because the user typed them directly.
// Trimmed, no trailing punctuation games, no chrome punctuation. Returns null when there's no name
// (nothing to save yet).
export function answersToDraft(answers) {
  const name = String((answers && answers.name) || "").trim();
  if (!name) return null;
  const relationship = String((answers && answers.relationship) || "").trim();
  const birthday = String((answers && answers.birthday) || "").trim();
  const note = String((answers && answers.note) || "").trim();

  // Build a natural sentence for the extractor. Each clause is only added when the user gave it, so
  // a name-only add stays a clean "Remember Maria." The sentence is internal (never shown to the
  // user), but we still keep it plain and free of chrome punctuation on principle.
  const parts = [`Remember ${name}`];
  if (relationship) parts.push(`, ${relationship}`);
  const lead = parts.join("") + ".";
  const extra = [];
  if (birthday) extra.push(`Their birthday is ${birthday}.`);
  if (note) extra.push(note.replace(/\s+/g, " ").trim());
  const rawText = [lead, ...extra].join(" ").trim();

  return {
    rawText,
    prefill: {
      name,
      relationship,
      // birthday stays as the human text the user typed ("June 15"); the confirm card parses it
      // with the same parseBirthdayInput everything else uses, so we never re-invent date parsing.
      birthday,
    },
  };
}
