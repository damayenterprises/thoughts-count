// TC-140/TC-149 — validate Della's JUDGMENT on the active voice model (run against prod after
// flipping VOICE_MODEL). Checks the tool/action she picks at key beats: does she drive to the
// plan (not stall), ask when gathering, hand off on "just make it", and route a capture.
// Run: node test/voice-validation.mjs  (hits prod /api/converse, typed path)
const BASE = "https://thoughtscount.com/api/converse";

async function turn(messages) {
  const r = await fetch(BASE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }) });
  return r.json();
}
const U = (content) => ({ role: "user", content });
const A = (content) => ({ role: "assistant", content });

const cases = [
  {
    name: "TC-149 stall — has enough → last-call (not a dead-end reflection)",
    messages: [
      U("My golf buddy Mike is going through a rough divorce. I want to show up for him but keep it low-key, he hates being fussed over."),
      A("That's a hard stretch for him. When you're together, is it mostly just the two of you?"),
      U("Yeah, usually just the two of us on the course."),
      A("That's its own kind of support. Do you know when you're playing next with him?"),
      U("It'll probably be a few weeks."),
    ],
    ok: (j) => j.action === "reply" && /\?/.test(j.say || "") && /(before I|anything else|pull this together|put this together|miss|left out)/i.test(j.say || ""),
    want: "reply that is a last-call (asks, invites anything-else)",
  },
  {
    name: "TC-149 close — last-call answered 'done' → ready (handoff, no loop)",
    messages: [
      U("My golf buddy Mike is going through a rough divorce, keep it low-key."),
      A("Do you know when you're playing next with him?"),
      U("A few weeks."),
      A("I think I've got a good picture here. Anything else before I pull this together?"),
      U("No, that's everything."),
    ],
    ok: (j) => j.action === "ready",
    want: "ready (builds the plan)",
  },
  {
    name: "Grief gathering — empathy + one question (not premature ready, not stall)",
    messages: [ U("My coworker's dad just passed away suddenly.") ],
    ok: (j) => j.action === "reply" && /\?/.test(j.say || ""),
    want: "reply with empathy + one question",
  },
  {
    name: "Explicit 'just make it' → ready now",
    messages: [
      U("My sister just had her first baby. I want to do something nice for her."),
      A("Congratulations to her. What's your sister like, and how are you two?"),
      U("We're close. Honestly just make me a plan, I don't need to talk it through."),
    ],
    ok: (j) => j.action === "ready",
    want: "ready (honor the stop)",
  },
  {
    name: "Capture routing — 'remember X' → note_and_remind (not a plan)",
    messages: [ U("Just remember for me that my friend Sarah's baby is due in April.") ],
    ok: (j) => j.action === "noted" || j.action === "confirm_who" || /remember|hold onto|got it/i.test(j.say || ""),
    want: "capture (note_and_remind) or ask-who, not a plan",
  },
];

let pass = 0;
for (const c of cases) {
  try {
    const j = await turn(c.messages);
    const good = c.ok(j);
    if (good) pass++;
    console.log(`${good ? "PASS" : "FAIL"} — ${c.name}`);
    console.log(`   want: ${c.want}`);
    console.log(`   got:  action=${j.action}  say=${(j.say || JSON.stringify(j)).slice(0, 160)}`);
  } catch (e) {
    console.log(`ERROR — ${c.name}: ${e.message}`);
  }
}
console.log(`\n${pass}/${cases.length} passed`);
