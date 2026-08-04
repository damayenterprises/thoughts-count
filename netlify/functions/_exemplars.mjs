// Thoughts Count — craft library (TC-59, Loop 2b of the learning engine).
//
// A curated, bucket-keyed set of "phrasings that land" for the kinds of moments people
// actually bring. At plan generation we look these up by the intake's non-identifying
// bucket (occasion, with optional relationship refinement) and inject them as few-shot
// craft references into the generator's system prompt, so the plan sharpens on that kind
// of moment.
//
// ── HARD RULE — PII-FREE BY CONSTRUCTION ──────────────────────────────────────────────
// Everything here is curator/AI-authored, SYNTHETIC, and GENERIC. NEVER paste a user's
// story, a person's name, or any generated-plan output into this file. It lives in git so
// that "no user data ever enters the shared library" is provable by review (TC-34 guardrail).
//
// ── AUTHORING NOTE ────────────────────────────────────────────────────────────────────
// This is MIX authoring: the snippets below are a Builder first-draft for TONE REVIEW.
// Design Lead + UX weigh in, then David does the final voice pass before merge. Keep the
// voice warm, specific, non-saccharine, better than "sorry for your loss" — and NEVER
// gift-pushing (gestures are non-purchase; a gift is only ever one option among many).

// Keyed by `occasion` (the coarse label from bucketOf() in _analytics.mjs — the same key
// TC-58's helpfulness-by-occasion sensor uses). Optional `by_relationship` refines within
// an occasion where the craft genuinely differs (e.g. a coworker vs a partner). Any
// occasion NOT present here simply falls back to today's behavior (no exemplars, no change).
export const EXEMPLARS = {
  bereavement: {
    what_to_say: [
      "I don't have the right words, and I won't pretend to — but I'm here, and I'm not going anywhere.",
      "I keep thinking about them. Whenever you're ready — even months from now — I'd love for you to tell me a story about them.",
      "You don't have to be okay around me. Whatever you're feeling is allowed.",
      "There's nothing you need to say or do right now. I'm just here, and I'll keep being here.",
      "I'll check in, and there's never any pressure to answer — you don't owe me a reply.",
    ],
    what_not_to_say: [
      "\"They're in a better place\" — even if you believe it, it can feel like their loss is being explained away.",
      "\"Let me know if you need anything\" — it quietly puts the work on the grieving person; offer one specific thing instead.",
      "Anything that starts with \"at least\" (\"at least they lived a long life\") — it tends to minimize the pain they're in right now.",
    ],
    gestures: [
      "Leave a labeled, freezer-ready meal on the porch — no need to knock or stay. Feeding yourself feels impossible in grief.",
      "Put their hard dates on your own calendar and reach out three weeks from now, when everyone else has gone quiet — that's the loneliest stretch.",
      "Handle one invisible chore without being asked: take the bins to the curb, walk the dog, keep the fridge stocked.",
    ],
    by_relationship: {
      coworker: {
        what_to_say: [
          "I was so sorry to hear about your loss. Please don't give work a second thought — I've got your back while you're out.",
        ],
        gestures: [
          "Quietly coordinate their workload so they don't return to a mountain, and organize a no-reply-needed meal delivery from the team.",
        ],
      },
    },
  },

  new_baby: {
    what_to_say: [
      "No pressure to write back — I just wanted all of you to know I'm thinking of you.",
      "You're going to be wonderful at this, even on the days it doesn't feel like it.",
      "How are YOU doing? Not the baby — you.",
      "No advice from me, I promise — just tell me what would actually help this week.",
      "You don't have to host or tidy or entertain. I'd love to see you, exactly as things are.",
    ],
    what_not_to_say: [
      "\"Sleep when the baby sleeps\" — well-meant, but it lands as one more thing they're failing at.",
      "\"Is the baby good?\" — it implies a baby could be \"bad\"; ask how they're all settling in instead.",
      "Unsolicited feeding or sleep advice — they're already drowning in opinions.",
    ],
    gestures: [
      "Bring a meal that reheats one-handed, in containers they never have to return.",
      "Offer a specific window, not a vague \"let me know\": \"Can I come hold the baby Tuesday morning so you can shower and nap?\"",
      "While you're there, quietly do a load of dishes or laundry instead of only holding the baby.",
    ],
  },

  new_job_promotion: {
    what_to_say: [
      "They saw what the people who love you already knew. This wasn't luck — it was you.",
      "So proud of you. I want to hear the whole story — the part where you found out, all of it.",
      "You earned every bit of this. Can't wait to hear all about it.",
      "This is the good kind of news, and you deserve every bit of it. Congratulations.",
      "I've watched how hard you've worked for this — seeing it pay off makes my whole week.",
    ],
    what_not_to_say: [
      "\"More money means more stress, right?\" — don't undercut the win with a caveat.",
      "\"Must be nice\" — even as a joke, it reads as envy on their big day.",
      "Immediately asking if they can get you in there too — let them have the moment first.",
    ],
    gestures: [
      "Send a quick \"thinking of you, go get 'em\" text on their first morning.",
      "Name one specific thing you've watched them do that made this inevitable — the moment, not just the title. It costs nothing and lands deeper than any gift.",
      "Plan a small celebration on their terms — a favorite meal, a toast. The acknowledgment matters more than the size.",
    ],
  },

  illness_diagnosis: {
    what_to_say: [
      "I'm here for the long haul, not just this week. Lean on me.",
      "You don't have to stay positive for my sake. Tell me how it actually is.",
      "I want to help without adding to your plate — can I take one thing off it?",
      "However today is going, I'm on your team — the good days and the scary ones both.",
      "You don't have to have the answers or a brave face with me. Just be however you are.",
    ],
    what_not_to_say: [
      "\"My aunt had that and she's totally fine now\" — comparisons can feel dismissive of their specific fear.",
      "\"Have you tried [diet/supplement/other doctor]?\" — unsolicited cures imply they're not handling it right.",
      "\"Everything happens for a reason\" — there's no reason that comforts someone newly diagnosed.",
    ],
    gestures: [
      "Offer concrete help as a short menu: \"I can drive you to an appointment, drop off groceries, or just sit with you — which sounds good?\"",
      "Set a recurring reminder to check in during treatment, not just at diagnosis — the middle stretch is the loneliest.",
      "Send a \"no need to reply\" note so they feel thought of without owing you any energy.",
    ],
  },

  job_loss: {
    what_to_say: [
      "This one's on them, not you — you're good at what you do, and the right place will see it.",
      "This says nothing about your worth. How are you holding up?",
      "I'm in your corner — want to vent, want help, or just a distraction tonight?",
      "You didn't do anything wrong here. Companies make cuts; that's not a verdict on you.",
      "Take the time you need to land — and lean on me for whatever makes the meantime easier.",
    ],
    what_not_to_say: [
      "\"Everything happens for a reason\" — it minimizes a real and scary loss.",
      "\"At least you'll have some free time now\" — they'd trade it for security in a heartbeat.",
      "\"Have you applied anywhere yet?\" in the first days — it's pressure, not support.",
    ],
    gestures: [
      "Offer something concrete without making them ask: a warm introduction, a resume read, or covering a meal.",
      "Keep inviting them to things and quietly cover their share — isolation compounds the blow.",
    ],
  },

  encouragement: {
    what_to_say: [
      "No reason — just thinking of you and wanted you to know.",
      "You've been carrying a lot. I see it, and I'm proud of how you keep showing up.",
      "Rooting for you today.",
      "No need to reply — I just wanted to be a small good thing in your day.",
      "Whatever this stretch is asking of you, you don't have to face it by yourself.",
    ],
    what_not_to_say: [
      "\"It could be worse\" — comparison rarely comforts.",
      "\"Just stay positive\" — it can feel like their struggle is being brushed off.",
    ],
    gestures: [
      "Send a specific good memory or a photo of a moment you shared — proof they're thought of.",
      "Drop off their favorite coffee or treat with a short note, no occasion needed.",
    ],
  },

  birthday: {
    what_to_say: [
      "Not just \"happy birthday\" — I'm genuinely glad you were born. The world's better with you in it.",
      "Every year I know you, I'm more grateful we're in each other's lives.",
      "Hope today feels like everything you are to the people who love you.",
      "Of all the people I'm lucky to know, you're one I'd choose again in a heartbeat. Happy birthday.",
      "However you want to spend today, I hope it's exactly your kind of good.",
    ],
    what_not_to_say: [
      "\"Another year older, huh?\" — the aging joke lands flat; celebrate them, don't remind them of the number.",
      "A bare \"HBD\" or a wall post you clearly sent to five other people — effortless reads as thoughtless on the one day that's theirs.",
      "\"We should catch up sometime!\" with no actual plan — a vague someday can feel like a brush-off on their day.",
    ],
    gestures: [
      "Skip the public wall post — send a private message that names one specific thing you love about them.",
      "Recall a specific moment from the past year: \"I still laugh about…\" — proof you were paying attention.",
      "If you can, call instead of text. Your voice on their day beats another notification.",
    ],
  },

  thank_you: {
    what_to_say: [
      "I don't think I ever properly told you what it meant — so I want to now.",
      "You probably don't realize how much that mattered to me. It did.",
      "I've been carrying this gratitude around for a while. Thank you, genuinely.",
      "You didn't have to do that, and you did it anyway. I noticed, and I won't forget it.",
      "The way you showed up for me when it counted — that's who I try to be for others now.",
    ],
    what_not_to_say: [
      "\"Thanks for everything!\" — the catch-all is warm but forgettable; name the specific thing they did.",
      "\"I owe you one\" — it turns a heartfelt thank-you into a debt to settle.",
      "Waiting for the \"perfect\" moment forever — a slightly late, specific thank-you beats a perfect one that never comes.",
    ],
    gestures: [
      "Name the impact, not just the act: \"When you did X, it changed Y for me.\" Specificity is what makes gratitude land.",
      "Put it in writing — a short handwritten note they can keep and re-read outlasts a text.",
      "Thank them in front of someone whose opinion they value — sincere recognition, witnessed, is a rare gift.",
    ],
  },

  wedding_engagement: {
    what_to_say: [
      "So happy for you both — the way you are together just fits, and everyone can see it.",
      "I've loved watching who you are with them. Congratulations, truly.",
      "This is wonderful news. Can't wait to celebrate you.",
      "You've found your person, and it shows on you. I couldn't be happier for you both.",
      "Here's to all of it — the big day and the ordinary Tuesdays that make a life together.",
    ],
    what_not_to_say: [
      "\"Well, marriage is hard work…\" — save the seasoned-veteran realism; let them have the joy today.",
      "\"So when's the baby coming?\" / \"You're next!\" — it rushes past this milestone to the next expectation.",
      "Turning their news into a story about your own relationship — keep the spotlight on them.",
    ],
    gestures: [
      "Tell them specifically what you admire about them together — what you see that works. It means more than \"congrats.\"",
      "If you're close, offer a concrete hand: \"Want a second set of eyes on anything — or a night off from wedding talk?\"",
      "Mark the engagement itself, not just the wedding — the long in-between gets forgotten by almost everyone else.",
    ],
  },

  graduation: {
    what_to_say: [
      "You did the work, and it shows. I'm proud of you.",
      "This wasn't handed to you — you earned every bit of it.",
      "Can't wait to see what you do next — and I mean that. You've got something.",
      "Every late night and hard semester led here. You should be so proud — I am.",
      "Whatever comes next, you've already proven you can do hard things. Congratulations.",
    ],
    what_not_to_say: [
      "\"So what's the plan now?\" / \"Got a job yet?\" — the pressure question deflates the thing they just earned.",
      "\"A degree in THAT?\" — even joking, questioning their path steps on their moment.",
      "\"Enjoy the real world…\" — the ominous warning undercuts a day that should feel like a win.",
    ],
    gestures: [
      "Name a specific hard thing you watched them push through to get here — proof you saw the effort, not just the result.",
      "Show up to the ceremony or celebration if you possibly can — presence on the day says more than any card.",
      "Write down what you believe they're capable of — a note they can keep for the wobbly early days of what's next.",
    ],
  },
};

const FIELDS = ["what_to_say", "what_not_to_say", "gestures"];
const CAP = 3; // max snippets per field injected, to keep the prompt tight

// Fisher-Yates shuffle (returns a copy). Math.random is fine in the function runtime.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Merge relationship-specific snippets (always preferred, kept first) with a RANDOM
// rotation of the occasion base pool, dedupe, and cap. When a pool has more than CAP
// snippets, each generation sees a different subset — so a strong line doesn't recur
// across everyone's plans (TC-59 addendum: cross-user anti-repetition). Returns [] if
// neither has content for a field.
function mergeField(base, rel, field) {
  const relSnips = (rel && rel[field]) || [];             // relationship refinement: preferred
  const baseSnips = shuffle((base && base[field]) || []); // rotate the base pool for variety
  const seen = new Set();
  const out = [];
  for (const s of [...relSnips, ...baseSnips]) {
    const v = String(s || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= CAP) break;
  }
  return out;
}

// Retrieve the capped, merged exemplar set for a plan's bucket, or null if this occasion
// isn't in the library (→ caller falls back to today's behavior, no regression).
// `bucket` is the object from bucketOf(): { occasion, valence, relationship, budget_band }.
export function getExemplars(bucket = {}) {
  const base = EXEMPLARS[bucket && bucket.occasion];
  if (!base) return null;
  const rel = base.by_relationship && base.by_relationship[bucket.relationship];
  const out = {};
  let any = false;
  for (const f of FIELDS) {
    const arr = mergeField(base, rel, f);
    if (arr.length) { out[f] = arr; any = true; }
  }
  return any ? out : null;
}

// Render the few-shot craft block appended to the system prompt. Returns "" when there
// are no exemplars, so the generation call is byte-identical to today for unseeded buckets.
// The framing is load-bearing: guides craft/tone only, must not override the meet-the-weight
// principle or push gifting.
export function buildExemplarBlock(exemplars) {
  if (!exemplars) return "";
  const sections = [];
  if (exemplars.what_to_say && exemplars.what_to_say.length) {
    sections.push("Phrasings that tend to land:\n" + exemplars.what_to_say.map((s) => `- ${s}`).join("\n"));
  }
  if (exemplars.what_not_to_say && exemplars.what_not_to_say.length) {
    sections.push("Well-meaning things to avoid:\n" + exemplars.what_not_to_say.map((s) => `- ${s}`).join("\n"));
  }
  if (exemplars.gestures && exemplars.gestures.length) {
    sections.push("Gestures that land (not purchases):\n" + exemplars.gestures.map((s) => `- ${s}`).join("\n"));
  }
  if (!sections.length) return "";
  return (
    "\n\n---\n" +
    "CRAFT REFERENCES for this kind of moment (for inspiration on tone and craft only):\n" +
    "These are examples of phrasings and non-gift gestures that tend to land for moments like this one. " +
    "Adapt them to the specific person and details — do NOT copy them verbatim, do NOT let them override the " +
    "principles above (especially \"meet the real emotional weight\" and \"a gift is only one option among many\"), " +
    "and do NOT let them push spending or gifting.\n\n" +
    sections.join("\n\n")
  );
}
