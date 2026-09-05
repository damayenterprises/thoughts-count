// Thoughts Count — SEO guide-page generator.
// Turns the GUIDES data below into static, richly-marked-up intent pages under
// /public/guides/<slug>/index.html, plus a guides hub, sitemap.xml and robots.txt.
// Each page is genuinely useful (what to say, what to avoid, gestures, follow-up,
// FAQ) and ends in a CTA that opens the plan flow with the moment pre-filled.
//
// Run: node scripts/build-guides.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://thoughtscount.com";
const TODAY = "2026-07-27";

// Real designer bubble+heart mark (icon-color.svg, viewBox 0 0 250 250) — used in the
// guide header brand lockups. Outlined paths, no font dependency.
// Della's name, for the inline intake CTA. Hardcoded here because this is a static build-time
// generator (the live app loads it dynamically; a build script can't reach that runtime config).
const HER_NAME = "Della";
const MARK = `<svg viewBox="0 0 250 250" aria-hidden="true"><path fill="#118ab9" d="M30.84,247.61c-1.22,0-2.42-.54-3.34-1.57-1.36-1.51-1.87-3.82-1.31-5.92l9.28-34.68C14.07,182.85,2.33,153.46,2.33,122.3,2.33,55.3,57.27.8,124.8.8s122.47,54.5,122.47,121.5-54.94,121.5-122.47,121.5c-19.29,0-38.44-4.55-55.53-13.17l-36.69,16.6c-.57.26-1.16.38-1.74.38ZM69.39,218.66c.68,0,1.35.17,1.99.5,16.31,8.59,34.78,13.13,53.42,13.13,62.16,0,112.73-49.34,112.73-110S186.96,12.3,124.8,12.3,12.07,61.65,12.07,122.3c0,28.9,11.42,56.2,32.16,76.89,1.5,1.5,2.09,3.92,1.5,6.13l-7.2,26.9,29.12-13.18c.56-.25,1.15-.38,1.74-.38Z"/><path fill="#ef4136" d="M148.18,75.95c-7.61,0-15.23,2.92-21.04,8.75l-2.35,2.36-2.35-2.36c-5.81-5.83-13.42-8.75-21.03-8.75-7.62,0-15.23,2.92-21.04,8.76l-.42.43c-11.62,11.67-11.62,30.59,0,42.27l2.35,2.36,5.15,5.18,37.34,37.52,42.5-42.7,2.35-2.36c11.61-11.67,11.61-30.6,0-42.27l-.43-.43c-5.81-5.83-13.42-8.75-21.04-8.75h0Z"/></svg>`;

const GUIDES = [
  {
    slug: "what-to-say-when-someone-loses-a-parent",
    tone: "hard",
    title: "What to Say When Someone Loses a Parent",
    meta: "Kind, specific things to say when a friend loses a parent, plus what to avoid, gestures that help, and how to keep showing up in the weeks after.",
    h1: "What to say when someone loses a parent",
    begin: "A close friend just lost a parent",
    intro: [
      "When someone you care about loses a parent, the fear of saying the wrong thing can make you say nothing at all, and silence is the one thing that hurts most. You don't need perfect words. You need honest, warm ones, and the willingness to stay.",
      "Here are things that genuinely help, things to avoid, and small gestures that mean more than any card.",
    ],
    matters: "Right now they don't need their grief fixed or explained. They need to feel less alone in it. The goal of anything you say is simply: <em>I see you, I'm not going anywhere.</em> Specific beats grand every time.",
    say: [
      ["“I don't have the right words, but I love you and I'm here.”", "Naming that there are no perfect words is itself comforting. It takes the pressure off both of you."],
      ["“Your mom was the kind of person who… I'll always remember that about her.”", "A specific memory tells them their parent mattered and won't be forgotten. This is the gift grieving people treasure most."],
      ["“I'm bringing dinner Thursday, is 6 okay? You don't have to talk.”", "Offer a concrete action with an easy out, not a vague 'let me know if you need anything.'"],
    ],
    avoid: [
      ["“They're in a better place.”", "Even when well-meant, it can feel dismissive of the pain that's real right now."],
      ["“Let me know if you need anything.”", "It sounds kind but puts the work on them. They won't call. Offer something specific instead."],
      ["“I know exactly how you feel.”", "You don't, quite, and it can shift the focus to you. “I can't imagine” lands better."],
    ],
    gestures: [
      ["Drop off a meal, no strings", "Food that can go straight in the freezer. Leave it on the porch if they can't face a conversation."],
      ["Handle one logistical thing", "Grief is exhausting. Offer to field phone calls, walk the dog, or mow the lawn, one concrete load lifted."],
      ["Write the memory down", "A short handwritten note sharing one thing you loved about their parent becomes a keepsake they'll reread for years."],
    ],
    followUp: "The hardest time isn't the funeral. It's three weeks later, when the casseroles stop and everyone else has moved on. Put a reminder in your calendar for two weeks out, and again on the one-month and one-year marks. A simple “Thinking of you today” on those days is extraordinary.",
    faq: [
      ["What do you say to someone whose parent just died?", "Keep it honest and warm: acknowledge you don't have perfect words, tell them you love them and you're there, and share one specific memory of their parent if you have one. Then offer a concrete gesture, a meal or an errand, rather than a vague 'let me know if you need anything.'"],
      ["What should you not say to someone grieving a parent?", "Avoid clichés that minimize the pain, like 'they're in a better place,' 'everything happens for a reason,' or 'I know exactly how you feel.' Also avoid vague offers of help that put the work back on them."],
      ["Is it better to text or call someone who lost a parent?", "A text is often kinder in the first days. It lets them respond when they have the energy. Say you don't expect a reply. Save calls and visits for when they signal they're ready."],
      ["How long should you keep checking in?", "Well past the funeral. The support usually vanishes after a few weeks, exactly when the loss sinks in. Reach out at two weeks, one month, and the one-year anniversary."],
    ],
    related: ["comforting-words-for-a-cancer-diagnosis", "what-to-say-when-someone-loses-a-pet"],
  },
  {
    slug: "comforting-words-for-a-cancer-diagnosis",
    tone: "hard",
    title: "Comforting Words for Someone With a Cancer Diagnosis",
    meta: "What to say when someone you love is diagnosed with cancer: genuine, supportive words, what to avoid, and practical ways to show up beyond 'let me know if you need anything.'",
    h1: "What to say when someone is diagnosed with cancer",
    begin: "Someone I care about was just diagnosed with cancer",
    intro: [
      "A cancer diagnosis knocks the ground out from under everyone who loves the person. You want to say something that helps, and you're terrified of saying something that hurts. That instinct to be careful is a good one, and it doesn't have to freeze you.",
      "Here's how to offer real comfort, what to steer clear of, and how to be useful in the long haul.",
    ],
    matters: "They're being flooded with medical information and other people's fear. What they most need from you is steadiness and normalcy: a friend who treats them like a person, not a diagnosis, and who will still be there months from now when the initial rush of support fades.",
    say: [
      ["“I'm so sorry you're facing this. I'm with you, however this goes.”", "It's honest, it doesn't rush to false optimism, and it promises presence, which is what they actually need."],
      ["“I'm free Tuesdays and Thursdays, can I drive you to treatment or bring lunch?”", "Naming specific availability makes it easy to say yes and signals you mean it."],
      ["“Do you want to talk about it, or would a normal, dumb conversation be better today?”", "Letting them choose the register gives back a sense of control they've largely lost."],
    ],
    avoid: [
      ["“My aunt had that and she…” (a scary story)", "Other people's cancer stories, especially bad outcomes, add fear. Keep the focus on them."],
      ["“Stay positive! You've got this!”", "Relentless positivity can make them feel they can't share how scared they really are."],
      ["“Have you tried [diet/supplement/alternative cure]?”", "Unsolicited medical advice is exhausting and can feel like blame. Trust their care team."],
    ],
    gestures: [
      ["Set up a meal or ride rotation", "Treatment is relentless. Organizing a simple schedule of meals or rides removes a huge daily burden."],
      ["Send a low-effort care package", "Cozy socks, lip balm, ginger candy, a good book, small comforts for long hospital hours, with no reply expected."],
      ["Keep texting normally", "Memes, updates about your life, inside jokes. Being treated like themselves is a relief when everything else is medical."],
    ],
    followUp: "Support floods in at diagnosis and dries up during the long middle of treatment. That middle is when it's hardest. Set reminders to check in every couple of weeks. Not 'how are your scans,' just 'thinking of you, no need to reply.' Consistency is the whole gift.",
    faq: [
      ["What is the best thing to say to someone with cancer?", "Something honest and steady: that you're sorry they're facing this, that you're with them however it goes, and a specific offer of help. Then follow their lead on whether they want to talk about it or be distracted."],
      ["What should you not say to someone with cancer?", "Avoid scary anecdotes about other people's cancer, forced positivity that shuts down their fear, and unsolicited advice about diets or alternative treatments. Don't make them comfort you about their diagnosis."],
      ["How can I help a friend going through chemo?", "Practical, recurring help is best: organize meals or rides, send small comforts for long treatment days, and keep up normal, everyday conversation so they still feel like themselves."],
      ["How often should I check in?", "Regularly and for the long haul: every week or two throughout treatment, not just at the start. A brief 'thinking of you, no reply needed' message is enough and means a lot."],
    ],
    related: ["what-to-say-when-someone-loses-a-parent", "what-to-say-for-a-new-job-or-promotion"],
  },
  {
    slug: "what-to-say-when-someone-loses-a-pet",
    tone: "hard",
    title: "What to Say When Someone Loses a Pet",
    meta: "Losing a pet is real grief. Here's what to say to comfort someone whose pet died, what not to say, and thoughtful ways to help them feel their loss is taken seriously.",
    h1: "What to say when someone loses a pet",
    begin: "Someone I care about just lost their pet",
    intro: [
      "Losing a pet is real grief, but the world often treats it as minor, which can leave your friend feeling silly for how devastated they are. The most healing thing you can do is take their loss completely seriously.",
      "Here's how to comfort someone whose pet has died, and what to avoid.",
    ],
    matters: "Their pet was family, and part of the pain is worrying that others won't understand that. When you treat the loss as significant, because it is, you give them permission to grieve openly. That validation is the heart of it.",
    say: [
      ["“I'm so sorry. Bailey was family, and this is a real loss.”", "Using the pet's name and calling it a real loss validates grief the world tends to dismiss."],
      ["“He was so loved, and he knew it. You gave him a wonderful life.”", "Reassuring them they were a good pet parent eases the guilt that often comes with the grief."],
      ["“Tell me a favorite story about her.”", "Inviting memories lets them celebrate the pet and feel the bond mattered to you too."],
    ],
    avoid: [
      ["“It was just a dog, you can get another one.”", "This dismisses the bond entirely and is deeply hurtful, even if meant to comfort."],
      ["“At least it wasn't a person.”", "Comparing losses minimizes their pain. Grief isn't a competition."],
      ["“When are you getting a new pet?”", "It rushes them past the loss. Let them grieve this one first."],
    ],
    gestures: [
      ["A keepsake of their pet", "A small framed photo, a custom ornament, or a paw-print keepsake honors the pet and shows you understood."],
      ["A donation in the pet's name", "A gift to a local animal shelter in their pet's name turns grief into something meaningful."],
      ["Just sit with them", "Bring their favorite coffee and let them talk about their pet. Presence beats advice."],
    ],
    followUp: "The house feels emptiest a week or two later: the missing food bowl, the quiet at the door. Check in then. First birthdays or 'gotcha day' anniversaries can also sting; a simple 'thinking of you and Bailey today' shows you remembered.",
    faq: [
      ["What do you say when someone's pet dies?", "Acknowledge the loss as real and significant, use the pet's name, and reassure them they gave the pet a good life. Invite them to share a favorite memory. Avoid anything that minimizes the bond."],
      ["What should you not say when someone loses a pet?", "Don't say 'it was just an animal,' 'at least it wasn't a person,' or 'you can get another one.' These dismiss real grief. Don't rush them toward a replacement pet."],
      ["Is it appropriate to send a sympathy gift for a pet?", "Yes. A keepsake photo or ornament, a paw-print memento, or a donation to an animal shelter in the pet's name are all thoughtful ways to show the loss is taken seriously."],
      ["How do you comfort someone grieving a pet?", "Take the loss seriously, listen to their stories, and stay present without offering solutions. Check in again a week or two later when the quiet of the house really sets in."],
    ],
    related: ["what-to-say-when-someone-loses-a-parent", "comforting-words-for-a-cancer-diagnosis"],
  },
  {
    slug: "what-to-write-in-a-new-baby-card",
    tone: "celebration",
    title: "What to Write in a New Baby Card",
    meta: "Warm, non-cliché things to write in a new baby card: messages for the parents, what to avoid, and thoughtful gestures that help beyond the newborn rush.",
    h1: "What to write in a new baby card",
    begin: "A friend just had a new baby",
    intro: [
      "A new baby is pure joy, and the parents are also exhausted, overwhelmed, and drowning in identical 'congratulations!' cards. A few genuine, specific lines will stand out and actually land.",
      "Here's what to write, what to skip, and how to be the friend they remember from those blurry first weeks.",
    ],
    matters: "New parents are celebrated and depleted at the same time. The most meaningful notes celebrate the baby <em>and</em> see the parents, acknowledging both the wonder and the hard work of these early days.",
    say: [
      ["“Welcome to the world, little one. You were wished for and you are so loved already.”", "Warm, specific to the baby, and free of cliché. It reads like you, not a greeting card."],
      ["“You two are going to be wonderful parents. Be gentle with yourselves in these early days.”", "Speaks to the parents' hearts and quietly gives them permission to struggle."],
      ["“I'm dropping off dinner next week. No need to host, I'll leave it at the door.”", "A concrete, low-pressure offer is worth more than any gift in the newborn fog."],
    ],
    avoid: [
      ["“Sleep now while you can!”", "Every single person says it, and it's not actually helpful. It can feel like a warning, not support."],
      ["“Is he a good baby?”", "It subtly judges both baby and parents. All babies are 'good.'"],
      ["“Enjoy every moment, it goes so fast!”", "Well-meant, but it can add guilt on the genuinely hard days when they're not enjoying every moment."],
    ],
    gestures: [
      ["Bring a freezer meal", "Hot, homemade food they can reheat one-handed is the gift new parents rave about for years."],
      ["Give a gift for the parents, not the baby", "The baby gets plenty. A nice coffee, a comfort treat, or a gift card for takeout looks after the exhausted grown-ups."],
      ["Offer a specific hour of help", "“Can I hold the baby Saturday so you can shower and nap?” An offer that's easy to accept."],
    ],
    followUp: "The meals and visitors taper off after a couple of weeks, right as the reality sets in and any partner's leave ends. Check in around week three or four with a simple 'how are <em>you</em> doing?', and you'll be the friend who actually got it.",
    faq: [
      ["What do you write in a new baby card?", "A warm, specific line welcoming the baby, a note that sees the parents (a word of encouragement about the hard early days), and ideally a concrete offer of help like a meal drop-off. Skip the tired clichés everyone else writes."],
      ["What should you not write in a baby card?", "Avoid overused lines like 'sleep now while you can,' 'enjoy every moment, it goes so fast,' and questions like 'is he a good baby?' that can add pressure or guilt for tired parents."],
      ["What's a good gift for new parents?", "Something for the parents rather than the baby, who already has plenty: a homemade freezer meal, good coffee, a takeout gift card, or an offer to hold the baby so they can rest."],
      ["When should you check in on new parents?", "Around three to four weeks in, when the initial help fades and any parental leave is ending. A simple 'how are you doing?' focused on the parents means a lot then."],
    ],
    related: ["what-to-say-when-someone-gets-engaged", "what-to-write-in-a-graduation-card"],
  },
  {
    slug: "what-to-say-for-a-new-job-or-promotion",
    tone: "celebration",
    title: "What to Say for a New Job or Promotion",
    meta: "How to congratulate someone on a new job or promotion in a way that feels personal, not generic: messages that land, what to avoid, and thoughtful ways to celebrate.",
    h1: "What to say for a new job or big promotion",
    begin: "A friend just got a big promotion",
    intro: [
      "A new job or promotion is a milestone worth marking well, and 'congrats!' in a group chat doesn't quite do it justice. A little specificity turns a throwaway line into something they'll remember.",
      "Here's how to celebrate them in a way that feels genuinely personal.",
    ],
    matters: "Behind a promotion is usually a lot of unseen effort, and sometimes a quiet dose of impostor syndrome. The best thing you can do is name the work you know they put in, proof that someone noticed how hard they earned this.",
    say: [
      ["“This is so well deserved. I've watched how hard you worked for it.”", "Naming the effort behind the win means more than the congratulations itself."],
      ["“They are lucky to have you. Can't wait to hear how the first week goes.”", "Affirms their value and shows you'll still be there for the ride ahead."],
      ["“We have to celebrate. Dinner's on me this week.”", "Turning the moment into a real celebration marks it as the milestone it is."],
    ],
    avoid: [
      ["“Must be nice / big paycheck now, huh?”", "Reducing it to money undercuts the achievement and can feel a little envious."],
      ["“Don't forget us little people!”", "Even as a joke, it puts a strange distance in the moment. Just be happy for them."],
      ["“Isn't that going to be super stressful?”", "Leading with the downside deflates the celebration. There's time for that later."],
    ],
    gestures: [
      ["Take them out to celebrate", "A dinner or drinks in their honor turns the news into a memory."],
      ["A small 'first day' gift", "A nice notebook, a good pen, or a desk plant for the new role is a thoughtful, understated touch."],
      ["A heartfelt note", "A card naming a specific strength you know they'll bring to the role beats any gift."],
    ],
    followUp: "The excitement fades and week one of a new role can be daunting. A quick 'how's it going?' a week or two in, after everyone else has moved on, shows you're genuinely in their corner, not just there for the announcement.",
    faq: [
      ["What do you say to congratulate someone on a new job?", "Make it specific: name the effort you know they put in, affirm that the employer is lucky to have them, and offer to celebrate. Specificity is what separates a memorable message from a generic 'congrats.'"],
      ["What should you avoid saying about a promotion?", "Avoid reducing it to money ('big paycheck now, huh?'), joke put-downs like 'don't forget us,' and leading with the stress or downsides. Let the celebration be a celebration."],
      ["What's a good gift for a new job or promotion?", "Something understated for the new role, like a quality notebook or pen or a desk plant, or simply taking them out to celebrate. A heartfelt note naming their strengths is always welcome."],
      ["Should I check in after they start?", "Yes. A brief 'how's the new role going?' a week or two after they start, once the initial buzz has passed, shows real, lasting support."],
    ],
    related: ["what-to-say-when-someone-loses-their-job", "what-to-write-in-a-graduation-card"],
  },
  {
    slug: "what-to-write-in-a-graduation-card",
    tone: "celebration",
    title: "What to Write in a Graduation Card",
    meta: "Meaningful, non-generic things to write in a graduation card: messages that inspire without cliché, what to avoid, and thoughtful gift ideas for the graduate.",
    h1: "What to write in a graduation card",
    begin: "Someone close to me is graduating",
    intro: [
      "Graduation cards tempt everyone into the same tired quote about 'the places you'll go.' A few genuine, personal lines will mean far more to the graduate than another borrowed cliché.",
      "Here's what to write to make a graduation card they'll actually keep.",
    ],
    matters: "A graduate is proud and, underneath it, often anxious about what's next. The most meaningful notes celebrate how far they've come <em>and</em> steady them for the unknown ahead: belief in them, not just applause.",
    say: [
      ["“Watching you grow into who you are has been one of my greatest joys. I'm so proud of you.”", "Personal and heartfelt. It celebrates the person, not just the diploma."],
      ["“You don't have to have it all figured out. Trust yourself; you've earned that.”", "Speaks to the quiet anxiety about the future and offers reassurance instead of pressure."],
      ["“Whatever comes next, I'm in your corner. Always.”", "A promise of continued support as they step into the unknown."],
    ],
    avoid: [
      ["“The real world is nothing like school, good luck!”", "It's ominous and a little condescending on a day meant for pride."],
      ["“So what's your plan now?”", "The pressure question everyone asks. If they don't know yet, it stings."],
      ["A generic quote and nothing else", "A famous quote with no personal words feels like you didn't really show up."],
    ],
    gestures: [
      ["A gift toward their next chapter", "Something practical for what's next, like a bag for a first job or a quality item for a new apartment, says you believe in their future."],
      ["A handwritten letter", "A longer note about who they've become and what you see in them becomes a keepsake they'll reread for years."],
      ["Mark the milestone together", "A celebratory meal or a small gathering makes the achievement feel seen."],
    ],
    followUp: "The excitement of graduation gives way to an uncertain summer and the pressure of 'what's next.' A check-in a few weeks later, a simple 'no pressure, just proud of you and here if you want to talk it through,' lands exactly when they need it.",
    faq: [
      ["What do you write in a graduation card?", "Something personal: celebrate who they've become, reassure them they don't need everything figured out, and promise your continued support. Personal words beat a borrowed inspirational quote every time."],
      ["What should you not write in a graduation card?", "Avoid ominous 'the real world is hard' warnings, the pressure-laden 'so what's your plan?', and generic famous quotes with no personal message attached."],
      ["What's a meaningful graduation gift?", "Something for their next chapter, like practical items for a first job or apartment, paired with a handwritten letter. The letter is often the part they keep."],
      ["How do you encourage a graduate who doesn't know what's next?", "Reassure them that not having it all figured out is normal and okay, express your belief in them, and check in again a few weeks later without pressure."],
    ],
    related: ["what-to-write-in-a-milestone-birthday-card", "what-to-say-for-a-new-job-or-promotion"],
  },

  // ---- Batch 2: DO / practical help + ACKNOWLEDGE / recognize / celebrate ----
  {
    slug: "ways-to-help-a-grieving-friend",
    tone: "hard",
    gesturesHeading: "Ways to actually help",
    title: "Ways to Actually Help a Grieving Friend",
    meta: "Beyond 'let me know if you need anything,' here are concrete, practical ways to help a grieving friend, what to skip, and how to keep showing up long after the funeral.",
    h1: "Ways to actually help a grieving friend",
    begin: "A close friend is grieving a loss",
    intro: [
      "When someone we love is grieving, we say “let me know if you need anything,” and they never do, because grief makes it impossible to delegate. The most loving thing you can do is stop asking and start doing something specific.",
      "Here are concrete ways to actually help, what to skip, and how to stay long after the crowd thins.",
    ],
    matters: "A grieving person is running on empty and can't manage a to-do list of well-wishers. Help that requires no decision from them, that you simply <em>do</em>, is the help that lands. Specific and quiet beats generous and vague.",
    say: [
      ["“I'm dropping off dinner Thursday and walking the dog. I've got it handled.”", "Announce the help instead of offering it. It removes the burden of asking."],
      ["“No need to reply, just thinking of you today.”", "Frees them from the exhausting job of responding to everyone."],
      ["“I'm here for the long haul, not just this week.”", "Names the thing they quietly dread: being forgotten once the funeral passes."],
    ],
    avoid: [
      ["“Let me know if you need anything.”", "The most common, and least useful, thing we say. They won't. Offer something concrete instead."],
      ["Showing up unannounced expecting to be hosted", "Grief is exhausting; don't make them entertain you. Drop and go unless invited in."],
      ["“Everything happens for a reason.”", "Meaning-making clichés can sting. Presence beats explanation."],
    ],
    gestures: [
      ["Bring food that needs nothing", "Freezer-ready meals, paper plates, easy snacks. Eating is the last thing they'll think to do."],
      ["Take a chore off the list", "Mow the lawn, run a laundry load, field the phone calls, handle a carpool. One concrete load lifted."],
      ["Help with the 'death admin'", "Grief comes with paperwork: thank-you notes, accounts to close. Offer to sit beside them and share the dreaded list."],
      ["Put future check-ins in your calendar", "Set reminders for two weeks, one month, and six months out. A note when everyone else has moved on is priceless."],
    ],
    followUp: "The casseroles stop after two weeks, right as the numbness wears off and the loss turns real. That's the moment to show up again. Mark the one-month, six-month, and one-year dates now; those quiet check-ins are what people remember for the rest of their lives.",
    faq: [
      ["What is the best way to help someone who is grieving?", "Do something specific rather than offering open-ended help. Bring ready-to-eat food, take a chore off their plate, and keep checking in well past the funeral. Announce what you'll do instead of asking what they need."],
      ["What should you not do for a grieving person?", "Avoid vague offers like 'let me know if you need anything,' showing up unannounced expecting to be hosted, and clichés that try to explain the loss. Don't disappear after the first week."],
      ["What practical things can I do for a grieving friend?", "Drop off freezer meals, handle chores (lawn, laundry, pet care, errands), help with the paperwork that follows a death, and coordinate a longer-term meal or check-in schedule."],
      ["How long should I keep helping?", "Well beyond the funeral. Support usually vanishes after a couple of weeks, exactly when grief deepens. Check in at one month, six months, and the one-year anniversary."],
    ],
    related: ["what-to-say-after-a-miscarriage", "how-to-honor-someone-on-a-loss-anniversary"],
  },
  {
    slug: "how-to-help-new-parents",
    tone: "celebration",
    gesturesHeading: "Ways to actually help",
    title: "How to Help New Parents (Without Being Asked)",
    meta: "The most useful ways to help new parents in the exhausting newborn weeks: practical support they'll never ask for, what to avoid, and how to be the friend they remember.",
    h1: "How to help new parents (without being asked)",
    begin: "Friends just became new parents",
    intro: [
      "New parents are joyful and utterly depleted, and far too overwhelmed to tell you what they need. The best help is the kind you quietly provide without making them ask, decide, or host.",
      "Here's how to actually lighten the load in those blurry first weeks.",
    ],
    matters: "In the newborn fog, decisions are exhausting and hosting is impossible. Help that asks nothing of them, like food left at the door, a chore done, or an hour of quiet, is worth more than any gift or visit. Care for the parents, not just the baby.",
    say: [
      ["“I'm dropping dinner at your door Tuesday at 6. Don't get up, I'll text when it's there.”", "A concrete, no-hosting-required offer beats 'let me know if you need anything.'"],
      ["“Can I come hold the baby Saturday so you two can nap or shower?”", "Offers the rarest gift, rest, with a specific time."],
      ["“How are <em>you</em> doing?”", "Everyone asks about the baby. Asking about the parents makes them feel seen."],
    ],
    avoid: [
      ["Visiting to be entertained", "A visit where they have to tidy up and make coffee is work, not help. Come to help, or come later."],
      ["“Sleep when the baby sleeps!”", "Unhelpful and a little smug. Bring them a coffee instead."],
      ["Only bringing gifts for the baby", "The baby is drowning in onesies. The parents are the ones running on fumes."],
    ],
    gestures: [
      ["Drop a meal at the door", "Hot, homemade, reheatable one-handed. The gift new parents rave about for years."],
      ["Do a load of anything", "Dishes, laundry, a grocery run, the trash. Do it quietly and don't wait to be asked."],
      ["Give them an hour off", "Hold the baby, take the older kids to the park, walk the dog. Trade them a pocket of rest."],
      ["Care for the grown-ups", "Good coffee, a comfort treat, a takeout gift card. Look after the exhausted humans, not just the tiny one."],
    ],
    followUp: "Meals and visitors dry up after a couple of weeks, right as any parental leave ends and reality hits. Check in around week three or four, focused on the parents, and you'll be the friend who truly got it.",
    faq: [
      ["What is the most helpful thing to do for new parents?", "Provide practical help without making them ask: drop off a ready meal, do a chore, or hold the baby so they can rest. Focus on caring for the exhausted parents, not just gifts for the baby."],
      ["What should you not do when visiting new parents?", "Don't visit expecting to be hosted, don't offer unhelpful advice like 'sleep when the baby sleeps,' and don't focus only on the baby. Keep visits short and useful."],
      ["What do new parents actually need?", "Food, rest, and a lightened load: meals, chores done, an hour of sleep, and someone asking how the parents themselves are holding up."],
      ["When is help most needed?", "The first few weeks, and especially around weeks three to four when initial support fades and parental leave ends. That later check-in matters most."],
    ],
    related: ["what-to-write-in-a-new-baby-card", "ways-to-help-a-grieving-friend"],
  },
  {
    slug: "how-to-help-a-friend-with-cancer",
    tone: "hard",
    gesturesHeading: "Practical ways to help",
    title: "How to Help a Friend Going Through Cancer Treatment",
    meta: "Practical, lasting ways to help a friend through cancer treatment, beyond 'let me know if you need anything,' plus what to avoid and how to support them for the long haul.",
    h1: "How to help a friend going through cancer treatment",
    begin: "A friend is going through cancer treatment",
    intro: [
      "When a friend is in cancer treatment, you desperately want to help, and “let me know if you need anything” puts the work on the person with the least energy to spare. Specific, recurring help is what actually carries them.",
      "Here's how to show up practically, week after week.",
    ],
    matters: "Treatment is a long, depleting marathon, and support tends to flood in at diagnosis then vanish during the hard middle. The help that matters is concrete and repeating, and treats them like a friend, not a patient.",
    say: [
      ["“I'm free Tuesdays. I'll bring lunch and drive you to treatment.”", "Naming a specific, recurring slot makes it real and easy to accept."],
      ["“I set up a meal calendar. You don't have to organize a thing.”", "Removes the coordination burden entirely."],
      ["“Want company, a distraction, or nothing today? All fine.”", "Gives them control over how you show up, which cancer takes away."],
    ],
    avoid: [
      ["“Let me know if you need anything.”", "They won't ask. Offer something specific and recurring instead."],
      ["Unsolicited advice about diets or cures", "Exhausting, and it can feel like blame. Trust their care team."],
      ["Disappearing after the first month", "The long middle of treatment is the loneliest stretch. Consistency is the whole gift."],
    ],
    gestures: [
      ["Organize meals or rides", "Set up a simple rotation so they never have to ask. Treatment days are relentless."],
      ["Take over a household load", "Groceries, cleaning, laundry, childcare, the dog. Pick one and own it."],
      ["Send low-effort comfort", "Cozy socks, ginger candy, lip balm, a good series: small kindnesses for long treatment hours, no reply expected."],
      ["Keep it normal", "Text memes, share your everyday life, keep the inside jokes going. Being treated like themselves is a relief."],
    ],
    followUp: "Support spikes at diagnosis and dries up during months of treatment, exactly when it's hardest. Put recurring reminders in your calendar to check in every week or two, long after others have moved on. A simple 'thinking of you, no need to reply' is enough.",
    faq: [
      ["What are practical ways to help someone with cancer?", "Set up recurring, concrete help: a meal or ride rotation, taking over a household chore, sending small comforts for treatment days, and keeping up normal everyday contact. Avoid open-ended offers."],
      ["What should you not say or do?", "Don't say 'let me know if you need anything,' don't push diets or alternative cures, and don't fade away after the first weeks. Let them lead on how much they want to talk about it."],
      ["How can I help if I live far away?", "Send meal-delivery gift cards, organize an online meal or ride schedule with local friends, mail small care packages, and keep texting normally so they feel connected."],
      ["How often should I check in?", "Regularly and for the long haul: every week or two throughout treatment, not just at diagnosis. Brief, no-pressure messages are perfect."],
    ],
    related: ["comforting-words-for-a-cancer-diagnosis", "ways-to-help-a-grieving-friend"],
  },
  {
    slug: "ways-to-celebrate-a-friends-promotion",
    tone: "celebration",
    gesturesHeading: "Ways to celebrate",
    title: "Meaningful Ways to Celebrate a Friend's Promotion",
    meta: "Go beyond 'congrats' with meaningful ways to celebrate a friend's promotion or new job, what to avoid, and how to recognize the work they put in to get there.",
    h1: "Meaningful ways to celebrate a friend's promotion",
    begin: "A friend just got a big promotion",
    intro: [
      "A promotion is a milestone worth marking, and a thumbs-up in the group chat lets it pass like it was nothing. A little intention turns “congrats” into a celebration they'll remember.",
      "Here's how to recognize the win in a way that actually lands.",
    ],
    matters: "Behind a promotion is usually years of unseen effort, and sometimes a quiet case of impostor syndrome. The most meaningful thing you can do is <em>name the work</em> and mark the moment, so they feel genuinely seen, not just briefly congratulated.",
    say: [
      ["“I've watched how hard you worked for this. It's so deserved.”", "Recognizing the effort behind the title means more than the congratulations."],
      ["“We're celebrating this properly. Dinner's on me, you pick the place.”", "Turns the news into a real event, not a passing comment."],
      ["“They're lucky to have you.”", "Affirms their value at a moment when nerves can creep in."],
    ],
    avoid: [
      ["A one-word 'congrats' and nothing more", "Fine in passing, but for a close friend it can feel like you barely noticed."],
      ["“Must be a nice raise, huh?”", "Reducing it to money undercuts the achievement."],
      ["“Isn't that going to be so stressful?”", "Leading with the downside deflates the moment. There's time for that later."],
    ],
    gestures: [
      ["Take them out to mark it", "A dinner or drinks in their honor makes the milestone a memory."],
      ["A small 'first day' gift", "A quality notebook, a nice pen, or a desk plant for the new role, understated and thoughtful."],
      ["A handwritten note", "Name a specific strength you know they'll bring to the job. It outlasts any gift."],
      ["Rally the group", "A surprise round of congratulations from mutual friends makes the recognition feel big."],
    ],
    followUp: "The buzz fades fast, and week one of a new role can rattle even confident people. A quick 'how's it going?' a week or two in, after everyone else has moved on, shows you're in their corner for the whole journey, not just the announcement.",
    faq: [
      ["How do you celebrate a friend's promotion?", "Mark it as a real milestone: take them out, give a small first-day gift, write a note naming the strengths that earned it, and recognize the effort behind the title rather than just saying 'congrats.'"],
      ["What should you avoid when someone gets promoted?", "Avoid a bare 'congrats' for a close friend, reducing it to money, or leading with how stressful the new role will be. Let the celebration be a celebration."],
      ["What's a good gift for a promotion?", "Something understated for the new role, like a quality notebook or pen or a desk plant, or an experience like a celebratory dinner. A heartfelt note is always welcome."],
      ["How do you recognize the effort behind a promotion?", "Say it directly: name what you saw them put in to get there. Acknowledging the unseen work is what makes the recognition feel personal and real."],
    ],
    related: ["what-to-say-for-a-new-job-or-promotion", "what-to-write-in-a-retirement-card"],
  },
  {
    slug: "how-to-honor-someone-on-a-loss-anniversary",
    tone: "hard",
    gesturesHeading: "Ways to honor them",
    title: "How to Honor Someone on the Anniversary of a Loss",
    meta: "Thoughtful ways to acknowledge the anniversary of a loved one's death: how to honor the person, support the grieving, and show you remember when everyone else has forgotten.",
    h1: "How to honor someone on the anniversary of a loss",
    begin: "It's the anniversary of a friend's loss",
    intro: [
      "The anniversary of a loss is one of the hardest days of the year, and one almost everyone else forgets. Simply remembering, and saying so, is an extraordinary gift to someone who's grieving.",
      "Here are ways to honor the person and support the people who miss them.",
    ],
    matters: "By the one-year mark, the world has moved on, but the grief hasn't. What a grieving person most fears is that their loved one will be forgotten. When you remember the day and speak the person's name, you tell them: this loss still matters, and so do they.",
    say: [
      ["“I'm thinking of you and remembering <em>[name]</em> today.”", "Saying the person's name is a gift. It proves they're not forgotten."],
      ["“I still remember how <em>[name]</em> used to… That always makes me smile.”", "A specific memory keeps the person alive and honors them."],
      ["“No need to reply, just wanted you to know I remembered.”", "Removes any pressure on a heavy day."],
    ],
    avoid: [
      ["Saying nothing for fear of 'reminding' them", "You won't remind them. They never forgot. Silence feels like the loss doesn't matter."],
      ["“At least it's been a year, time heals.”", "Grief has no schedule. Minimizing it stings."],
      ["Making the day about your own discomfort", "Follow their lead on how much or little they want to engage."],
    ],
    gestures: [
      ["Say the person's name", "Simply naming them in a message or call is the single most meaningful thing you can do."],
      ["Mark it with a small ritual", "Light a candle, visit a meaningful place, or donate in the person's name and tell the family you did."],
      ["Share a memory or photo", "Send a story or picture they may not have seen. Grieving people treasure new fragments of the person they lost."],
      ["Just be with them", "Offer to sit together, share a meal, or take a quiet walk. Presence says 'you're not alone in remembering.'"],
    ],
    followUp: "Anniversaries, birthdays, and holidays keep coming, and each can reopen the loss. Note the important dates and reach out on them, year after year. Being the person who always remembers is one of the most enduring kindnesses there is.",
    faq: [
      ["What do you say on the anniversary of someone's death?", "Tell the grieving person you're thinking of them and remembering their loved one by name. Share a specific memory if you have one, and let them know they don't need to reply."],
      ["Should you acknowledge a death anniversary?", "Yes. Many people fear that mentioning it will 'remind' the grieving person, but they never forgot. Silence can feel like the loss no longer matters. Acknowledgment is almost always welcomed."],
      ["How can you honor someone who has died?", "Say their name, share memories, light a candle, visit a meaningful place, or donate in their name. Telling the family you did something in their loved one's memory means a great deal."],
      ["What should you avoid on a loss anniversary?", "Avoid saying nothing out of fear, minimizing the grief with 'time heals,' or centering your own discomfort. Follow the grieving person's lead."],
    ],
    related: ["what-to-say-when-someone-loses-a-parent", "ways-to-help-a-grieving-friend"],
  },
  {
    slug: "ways-to-thank-someone-who-is-always-there",
    tone: "everyday",
    gesturesHeading: "Ways to show it",
    title: "Thoughtful Ways to Thank Someone Who's Always There for You",
    meta: "How to genuinely thank the person who always shows up for you: meaningful words and gestures to recognize a friend, parent, or partner who quietly holds you up.",
    h1: "Thoughtful ways to thank someone who's always there for you",
    begin: "I want to thank someone who's always there for me",
    intro: [
      "The people who are always there, the friend who never misses a call, the parent who quietly holds everything together, are the easiest to take for granted precisely because they never ask for anything. Telling them they're seen is one of the most meaningful things you can do.",
      "Here's how to thank someone whose steadiness you've come to rely on.",
    ],
    matters: "People who give quietly rarely hear that it's noticed. The most meaningful thank-you is <em>specific</em>: not a vague 'thanks for everything,' but naming the exact things they do and what they've meant to you. Specificity is what proves you truly see them.",
    say: [
      ["“I don't say it enough, but I count on you more than you know. Thank you.”", "Naming that you don't say it enough makes the gratitude feel honest and overdue."],
      ["“That time you <em>[specific thing]</em>… I've never forgotten it.”", "A specific memory proves your thanks is real, not routine."],
      ["“You make my life better just by being in it.”", "Simple, direct, and the kind of thing steady people rarely get told."],
    ],
    avoid: [
      ["A vague 'thanks for everything'", "Kind but forgettable. Name the specific things they do."],
      ["Waiting for an occasion", "The best thank-yous often come out of nowhere, on an ordinary day, for no reason at all."],
      ["Turning it into a transaction", "This isn't about paying them back. It's about making sure they feel seen."],
    ],
    gestures: [
      ["Write it down", "A heartfelt handwritten note naming what they mean to you becomes something they'll keep and reread."],
      ["Give them your time", "Plan a day around something they love. Steady givers rarely get to be the one who's cared for."],
      ["Return the favor quietly", "Do for them the kind of unasked, behind-the-scenes thing they always do for you."],
      ["Say it in front of others", "A word of appreciation spoken publicly, in a toast or a group message, lets them feel recognized, not just thanked."],
    ],
    followUp: "Gratitude means the most when it's a habit, not a one-off. Make a point of noticing and naming the small things they do, again and again. The people who are always there deserve to always know it.",
    faq: [
      ["How do you thank someone who is always there for you?", "Be specific: name the exact things they do and what they've meant to you, rather than a vague 'thanks for everything.' Put it in a handwritten note or say it out loud, and don't wait for an occasion."],
      ["What's a meaningful way to show appreciation?", "Combine words with a gesture: a heartfelt note, a day planned around something they love, or quietly returning the kind of unasked help they always give you."],
      ["Do you need a special occasion to thank someone?", "No. Some of the most meaningful thank-yous come on an ordinary day for no reason at all, which is exactly what makes them feel genuine."],
      ["How do you make a thank-you feel genuine?", "Specificity. Name the particular things they do and the moments you remember, so they know you truly see and value them rather than offering a routine thanks."],
    ],
    related: ["what-to-say-to-someone-having-a-hard-week", "what-to-write-in-a-graduation-card"],
  },

  // ---- Batch 3: the hard, underserved moments (TC-24 gap-fillers) ----
  {
    slug: "what-to-say-when-someone-loses-their-job",
    tone: "hard",
    title: "What to Say When Someone Loses Their Job",
    meta: "Supportive, non-awkward things to say when a friend loses their job or is laid off, plus what to avoid, and concrete ways to help beyond 'let me know if you hear of anything.'",
    h1: "What to say when someone loses their job",
    begin: "A friend just lost their job",
    intro: [
      "Losing a job hits far more than the bank account. It shakes someone's sense of identity, security, and worth all at once. You want to help, and you're afraid of saying something that lands as pity or judgment. The good news: warmth and one concrete offer beat perfect words every time.",
      "Here's what genuinely helps, what to avoid, and how to keep showing up while the search drags on.",
    ],
    matters: "Right now they're likely cycling through shock, embarrassment, and fear about what's next. What they most need is to feel that this doesn't change how you see them, and that they're not facing it alone. Steady belief in them matters more than advice.",
    say: [
      ["“This says nothing about how good you are at what you do, and I've seen how good you are.”", "Layoffs are usually about budgets, not merit. Naming their competence pushes back on the shame."],
      ["“I'm here. Do you want to vent, brainstorm, or think about something else entirely today?”", "Lets them choose what they need instead of assuming they want job-hunt talk."],
      ["“Can I introduce you to [name], or look over your resume this week?”", "A specific, concrete offer is worth far more than 'let me know if you hear of anything.'"],
    ],
    avoid: [
      ["“Everything happens for a reason.”", "It asks them to feel grateful in the middle of a gut-punch. Let them be upset first."],
      ["“At least you hated that job anyway.”", "Even if true, it minimizes a real loss of income and stability."],
      ["“Have you tried applying to…?”", "Unsolicited job-hunt advice can feel like pressure or blame. Offer help; don't assign homework."],
    ],
    gestures: [
      ["Make a real introduction", "The fastest path to a new job is a warm intro. Think of one person in your network and connect them. That beats any pep talk."],
      ["Treat them to something normal", "Buy the coffee, cover dinner, plan a free hike. Money stress makes people withdraw; a low-key treat keeps them connected without making it a thing."],
      ["Offer a concrete skill", "Proofread the resume, run a mock interview, share a template that worked for you. One tangible task done is real help."],
    ],
    followUp: "Check-ins pour in the first week, then everyone assumes it's handled, but a search often drags on for months, and the quiet stretch is the demoralizing part. Set a reminder to reach out in a few weeks with a low-pressure note: 'thinking of you, no update needed, just in your corner.'",
    faq: [
      ["What do you say to someone who just lost their job?", "Lead with warmth, not advice: reassure them a layoff doesn't define their worth, offer to listen however they need, and make one concrete offer of help like an introduction or a resume review. Skip the silver-lining clichés."],
      ["What should you not say when someone loses their job?", "Avoid 'everything happens for a reason,' 'at least you hated it anyway,' and unsolicited 'have you tried…' advice. These minimize the loss or add pressure. Let them feel the blow before problem-solving."],
      ["How can I actually help a friend who was laid off?", "Make a warm introduction in your network, offer a specific skill (resume, mock interview, referrals), and treat them to something normal and low-cost so money stress doesn't isolate them."],
      ["How long should I keep checking in?", "Well past the first week. Job searches often stretch for months, and support tends to vanish right when the discouragement sets in. A brief, no-pressure check-in every few weeks means a lot."],
    ],
    related: ["what-to-say-for-a-new-job-or-promotion", "what-to-say-to-someone-having-a-hard-week"],
  },
  {
    slug: "what-to-say-to-someone-going-through-a-divorce",
    tone: "hard",
    title: "What to Say to Someone Going Through a Divorce",
    meta: "What to say to a friend going through a divorce: supportive words that don't take sides or pry, what to avoid, and thoughtful ways to help through a long, messy transition.",
    h1: "What to say to someone going through a divorce",
    begin: "A friend is going through a divorce",
    intro: [
      "Divorce is a grief no one brings a casserole for. Your friend is mourning a future they'd planned on, often while handling logistics, kids, and everyone's opinions. You want to support them without taking sides or saying the wrong thing.",
      "Here's how to show up for someone whose life is coming apart and being rebuilt at the same time.",
    ],
    matters: "They may feel like a failure, even when the divorce is the right call. What helps most is knowing you're on their side without needing them to justify anything: no interrogation, no scorekeeping, just steady presence through a long, messy transition.",
    say: [
      ["“I'm so sorry. However you're feeling about it, I'm on your side.”", "Offers loyalty without forcing them to explain or defend the decision."],
      ["“You don't have to have it figured out. I'm here for the long haul.”", "Divorce is a marathon of logistics and emotion; naming that you'll stay eases the fear of being a burden."],
      ["“Do you want to talk about it, or would a normal night out sound better?”", "Gives them a break from being 'the person going through a divorce.'"],
    ],
    avoid: [
      ["“I never liked them anyway.”", "Trashing the ex can backfire. They may reconcile, co-parent, or still love parts of them. Follow their lead."],
      ["“At least you didn't have kids / weren't married that long.”", "Ranking their loss minimizes it. Every divorce is its own grief."],
      ["“So what went wrong?”", "The interrogation everyone subjects them to. Let them share what they want, when they want."],
    ],
    gestures: [
      ["Take a logistical load off", "Divorce buries people in admin and solo parenting. Offer one specific thing: a meal, a school pickup, help moving boxes."],
      ["Keep including them", "Newly single people often get quietly dropped from couple gatherings. A standing invitation says 'you still belong here.'"],
      ["Mark the small wins", "First night in the new place, paperwork finalized: a card or a 'proud of you' text honors milestones no one else celebrates."],
    ],
    followUp: "Support clusters around the announcement, then fades as the process grinds on for a year or more. Check in during the quiet stretches: after a court date, around what would've been an anniversary, on the first holidays alone. Being the friend who remembers those dates is a rare gift.",
    faq: [
      ["What do you say to someone going through a divorce?", "Offer loyalty and presence without taking sides or asking for details: 'I'm on your side, however you feel about it,' and 'I'm here for the long haul.' Let them decide how much to share and whether they want distraction or a listening ear."],
      ["What should you not say to someone getting divorced?", "Avoid bashing the ex, ranking their loss ('at least no kids'), and prying with 'what went wrong?' These can backfire or minimize a real grief. Support them without interrogating them."],
      ["How can I support a friend during a divorce?", "Take a logistical load off (meals, childcare, moving help), keep including them in plans so they don't feel dropped, and quietly mark the milestones and hard dates no one else acknowledges."],
      ["How long does someone need support after a divorce?", "Often a year or more. The legal process and the emotional recovery both take time. Support usually fades after the announcement, so checking in through the long, quiet middle matters most."],
    ],
    related: ["ways-to-help-a-grieving-friend", "what-to-say-to-someone-having-a-hard-week"],
  },
  {
    slug: "what-to-say-after-a-miscarriage",
    tone: "hard",
    title: "What to Say to Someone After a Miscarriage",
    meta: "Gentle, comforting things to say to someone who's had a miscarriage: words that acknowledge the loss, what to avoid, and how to support them through a grief the world often overlooks.",
    h1: "What to say to someone after a miscarriage",
    begin: "Someone I care about had a miscarriage",
    intro: [
      "A miscarriage is a real loss of a real future, and one the world often rushes past, or never learns about at all. Your friend may be grieving a baby they'd already loved, sometimes in silence. Simply acknowledging that loss, gently and without minimizing it, is profoundly healing.",
      "Here's how to offer comfort after a pregnancy loss, and what to avoid.",
    ],
    matters: "So much of the pain of miscarriage is how invisible and lonely it can feel: the sense that they should just 'move on' from something no one else saw. When you treat it as the genuine loss it is, and follow their lead on how they name it, you give them permission to grieve openly.",
    say: [
      ["“I'm so sorry. This was a real loss, and I'm here with you.”", "Naming it as a real loss counters the world's instinct to minimize it."],
      ["“You don't have to be strong or say anything. I'm just here.”", "Removes the pressure to perform okayness or explain their grief."],
      ["“I'm thinking of you both. There is nothing you did to cause this.”", "Miscarriage often comes with irrational guilt; gently naming that it wasn't their fault can matter enormously."],
    ],
    avoid: [
      ["“At least you know you can get pregnant.”", "It reframes a loss as a silver lining and dismisses the baby they just lost."],
      ["“Everything happens for a reason.” / “It wasn't meant to be.”", "Meaning-making clichés can feel cruel in fresh grief. Presence beats explanation."],
      ["“You can always try again.”", "It rushes them past this loss toward a replacement. Let them grieve this one first."],
    ],
    gestures: [
      ["Acknowledge it in writing", "A short, gentle note, something like 'thinking of you, no need to reply,' tells them the loss is seen. So many people, unsure what to say, say nothing at all."],
      ["Bring quiet, practical care", "A meal at the door, a warm blanket, their favorite tea. Comfort with no expectation of conversation."],
      ["Remember the hard dates", "The due date and the anniversary can hit hard, often long after everyone else has forgotten. A simple message on those days is extraordinary."],
    ],
    followUp: "Grief after a miscarriage doesn't follow a schedule, and support usually disappears within days. The due date, especially, can arrive months later like a fresh wave. Quietly note it, and reach out then with a simple 'I remembered, and I'm thinking of you.' Few things mean more.",
    faq: [
      ["What do you say to someone who had a miscarriage?", "Acknowledge it as a real loss and offer steady presence: 'I'm so sorry, this was a real loss, and I'm here with you.' Gently reassure them it wasn't their fault, and let them lead on how much they want to talk. Avoid silver linings."],
      ["What should you not say after a miscarriage?", "Avoid minimizing lines like 'at least you can get pregnant,' 'everything happens for a reason,' 'it wasn't meant to be,' and 'you can always try again.' These dismiss the loss or rush the person past their grief."],
      ["How can you support someone after a pregnancy loss?", "Acknowledge the loss in a gentle note, bring quiet practical comfort (a meal, tea, a blanket) with no pressure to talk, and remember the hard dates like the due date and anniversary, when grief can resurface."],
      ["Is it okay to bring it up, or will that remind them?", "It's almost always okay. They haven't forgotten, and silence can feel like the loss didn't matter. Acknowledge it gently, follow their lead on how much to say, and make clear they don't owe you a reply."],
    ],
    related: ["what-to-say-when-someone-loses-a-parent", "ways-to-help-a-grieving-friend"],
  },
  {
    slug: "what-to-say-to-someone-having-a-hard-week",
    tone: "everyday",
    title: "What to Say to Someone Having a Hard Time",
    meta: "What to say to someone going through a rough patch or a hard week: comforting words that help without fixing, what to avoid, and small gestures that remind them they're not alone.",
    h1: "What to say to someone having a hard time",
    begin: "Someone I care about is having a really hard week",
    intro: [
      "Not every hard moment has a name. Sometimes someone you love is just worn down, stressed, overwhelmed, quietly struggling, and there's no casserole or card for 'a rough patch.' You don't need to fix it. You just need to let them know you noticed, and you're here.",
      "Here's how to comfort someone having a hard time without minimizing it or rushing to solutions.",
    ],
    matters: "When someone's struggling, the instinct is to cheer them up or solve the problem, but what most people want first is to feel understood. Being witnessed in a hard moment, without judgment or a fix, is what actually lightens it.",
    say: [
      ["“That sounds really hard. I'm sorry you're carrying all this.”", "Validation before advice. Feeling understood is what people crave most in a rough patch."],
      ["“You don't have to have it together with me.”", "Gives them permission to drop the 'I'm fine' act, which is a relief."],
      ["“What would actually help right now: company, a distraction, or some space?”", "Asks instead of assuming, and hands them a little control when everything feels heavy."],
    ],
    avoid: [
      ["“Just stay positive!”", "Forced positivity can make them feel they can't be honest about how bad it is."],
      ["“It could be worse.”", "Comparing their struggle to something bigger makes them feel unjustified in feeling bad."],
      ["“Have you tried…?” (unsolicited advice)", "Jumping to solutions can feel dismissive. Ask if they want ideas before offering them."],
    ],
    gestures: [
      ["Send a low-effort lifeline", "A 'thinking of you, no need to reply' text, or their favorite snack delivered. Small proof they're not alone, with zero pressure."],
      ["Take one thing off their plate", "Bring dinner, run an errand, watch the kids for an hour. Lightening the load says more than any pep talk."],
      ["Just show up", "Sit with them, go for a walk, put on a comfort movie. Presence without an agenda is often the whole gift."],
    ],
    followUp: "A rough patch rarely resolves in a day. Circle back in a few days with a simple 'still thinking of you, how are you holding up?' The person who checks in again, after the first message, is the one who really shows they care.",
    faq: [
      ["What do you say to someone having a hard time?", "Lead with validation, not solutions: 'that sounds really hard, I'm sorry you're carrying this.' Let them know they don't have to pretend to be okay, and ask what would actually help: company, distraction, or space."],
      ["What should you not say to someone who's struggling?", "Avoid forced positivity ('just stay positive!'), comparisons ('it could be worse'), and unsolicited advice. These can make them feel unheard or guilty for struggling. Ask before offering solutions."],
      ["How do you comfort someone without fixing their problem?", "Focus on being present and understanding. Reflect back that it sounds hard, resist jumping to advice, and offer small concrete support, a text, a meal, your company, so they feel less alone."],
      ["How do you check in on someone going through a rough patch?", "Reach out simply and without pressure ('thinking of you, no need to reply'), then circle back again a few days later. Consistency matters more than perfect words."],
    ],
    related: ["what-to-say-to-someone-going-through-a-divorce", "ways-to-thank-someone-who-is-always-there"],
  },

  // ---- Batch 4: the celebratory moments (balance the library toward "celebrations and hard days alike") ----
  {
    slug: "what-to-write-in-a-wedding-card",
    tone: "celebration",
    title: "What to Write in a Wedding Card",
    meta: "Heartfelt, non-cliché things to write in a wedding card: warm messages for the couple, what to avoid, and thoughtful ways to celebrate beyond the gift registry.",
    h1: "What to write in a wedding card",
    begin: "A couple close to me is getting married",
    intro: [
      "A wedding card is a small square of paper carrying a big wish, and it's easy to freeze and fall back on 'congrats to the happy couple.' A few genuine, specific lines will mean far more than anything printed inside a store-bought card.",
      "Here's what to write to a couple you love, what to skip, and how to celebrate them beyond the registry.",
    ],
    matters: "A wedding isn't just a party. It's two people promising each other a life. The most meaningful notes speak to <em>them</em>: the couple you actually know, the love you've watched grow. Specific and warm beats grand and generic every time.",
    say: [
      ["“Watching you two together has shown me what real partnership looks like.”", "Naming something true about their relationship proves the card came from you, not a shelf."],
      ["“Wishing you a marriage full of the ordinary Tuesdays as much as the big days.”", "A wish for the everyday feels more honest and lasting than 'happily ever after.'"],
      ["“I'm so honored to celebrate you both. Here's to a lifetime of it.”", "Simple, heartfelt, and centered on them rather than the event."],
    ],
    avoid: [
      ["“Marriage is hard work, good luck!”", "Even as a joke, leading with warnings deflates a day that's about hope."],
      ["“You're next!” or jokes about the old ball-and-chain", "Tired clichés that can land awkwardly. Keep the focus on their joy."],
      ["A signature and nothing else", "For people you love, a blank card with just your name reads like you didn't quite show up."],
    ],
    gestures: [
      ["Give the gift of a memory", "Beyond the registry, an experience like a dinner out or a contribution toward the honeymoon becomes a story they'll retell."],
      ["Write the longer letter", "A separate handwritten note about what you admire in their relationship becomes a keepsake they'll reread on anniversaries."],
      ["Show up fully on the day", "Be present, toast them if asked, help a frazzled parent. Your attention is the real gift."],
    ],
    followUp: "The glow of a wedding fades into the ordinary work of a first year together: moving, merging lives, the unglamorous parts. A note on their first anniversary, or a 'thinking of you two' in a quiet stretch, tells them you're in it for the long marriage, not just the big day.",
    faq: [
      ["What do you write in a wedding card?", "Write something specific to the couple: name what you admire about their relationship, offer a warm wish for their everyday life together, and express how glad you are to celebrate them. Personal beats generic every time."],
      ["What should you not write in a wedding card?", "Avoid 'marriage is hard work, good luck,' jokes about the 'ball and chain,' and leaving just a signature. Keep the tone hopeful and centered on the couple's joy."],
      ["What's a thoughtful wedding gift beyond the registry?", "An experience or a contribution toward the honeymoon, paired with a heartfelt handwritten letter. The letter is often the part the couple keeps for years."],
      ["How do you make a wedding message personal?", "Mention something real you've seen in their relationship, and wish them well in the ordinary days, not just the wedding. Specificity is what makes a message feel like it came from you."],
    ],
    related: ["what-to-say-when-someone-gets-engaged", "what-to-write-in-an-anniversary-card"],
  },
  {
    slug: "what-to-write-in-a-milestone-birthday-card",
    tone: "celebration",
    title: "What to Write in a Milestone Birthday Card",
    meta: "Meaningful things to write in a milestone birthday card, from the 30th to the 40th, 50th and beyond: messages that celebrate the person, what to avoid, and thoughtful ways to mark a big year.",
    h1: "What to write in a milestone birthday card",
    begin: "Someone I care about has a big milestone birthday",
    intro: [
      "A milestone birthday, whether it's 30, 40, 50, or 60, deserves more than 'happy birthday, you're old now!' These are the years people quietly take stock of their lives, and a thoughtful word can land far deeper than the usual joke about age.",
      "Here's what to write to make a milestone birthday card they'll actually keep.",
    ],
    matters: "Behind a big birthday is often a mix of pride and reflection: <em>am I where I hoped to be?</em> The most meaningful notes celebrate who the person has become and what they mean to you, gently steering past the anxiety about the number itself.",
    say: [
      ["“Getting to watch you grow into who you are has been a gift. Here's to the next chapter.”", "Celebrates the person's growth rather than poking at their age."],
      ["“The world is better with you in it, and I'm luckier for knowing you.”", "Warm, direct, and the kind of thing people rarely hear said plainly."],
      ["“You wear these years so well. Whatever's next, I'm cheering you on.”", "Reframes the number as something to be proud of, not to dread."],
    ],
    avoid: [
      ["“Over the hill!” / endless age jokes", "One wink is fine; a whole card of 'you're ancient now' can quietly sting on a reflective day."],
      ["“Life's basically downhill from here.”", "Even joking, it casts a shadow over a milestone that can already stir doubt."],
      ["Comparing them to others their age", "'Look how well so-and-so is doing' turns a celebration into a scoreboard."],
    ],
    gestures: [
      ["Gather the people who matter", "A surprise note or video from friends near and far can mean more than any object on a milestone year."],
      ["Give a 'then and now' keepsake", "A framed photo, a memory book, a letter listing things you love about them: something that honors the whole journey."],
      ["Mark it with an experience", "A trip, a special dinner, a day built around something they love makes the milestone a memory rather than a number."],
    ],
    followUp: "The party ends, but a milestone year often stirs bigger questions about what's next. A check-in a few weeks later, a gentle 'how are you feeling about this new chapter?', shows you saw past the balloons to the real person.",
    faq: [
      ["What do you write in a milestone birthday card?", "Celebrate who the person has become and what they mean to you, and offer a warm wish for the chapter ahead. Focus on their growth and value rather than jokes about their age."],
      ["What should you not write in a milestone birthday card?", "Skip the relentless 'over the hill' age jokes, 'downhill from here' lines, and comparisons to other people their age. On a reflective birthday, these can quietly land wrong."],
      ["What's a good gift for a milestone birthday?", "Something that honors the journey: a memory book, a framed photo, notes gathered from friends, or an experience like a special trip or dinner. Meaning matters more than price."],
      ["How do you make a big birthday feel special?", "Bring together the people who matter (even by note or video), give something that celebrates their whole story, and mark the day with an experience rather than just a gift."],
    ],
    related: ["what-to-write-in-an-anniversary-card", "ways-to-thank-someone-who-is-always-there"],
  },
  {
    slug: "what-to-write-in-an-anniversary-card",
    tone: "celebration",
    title: "What to Write in an Anniversary Card",
    meta: "Warm, non-cliché things to write in an anniversary card, for a couple or your own partner: messages that mean something, what to avoid, and thoughtful ways to mark the year.",
    h1: "What to write in an anniversary card",
    begin: "A couple I care about has an anniversary coming up",
    intro: [
      "An anniversary marks something quietly remarkable: two people who kept choosing each other, year after year. Whether it's for your own partner or a couple you love, a few genuine lines beat the pre-printed verse every time.",
      "Here's what to write to honor the years, and how to mark the day.",
    ],
    matters: "An anniversary isn't about the wedding. It's about everything since: the ordinary days, the hard seasons weathered together. The most meaningful notes honor the <em>staying</em>, not just the starting. Name what their commitment has shown you.",
    say: [
      ["“All these years in, you two still make it look like a choice worth making.”", "Honors the ongoing work of a relationship, not just its beginning."],
      ["“Thank you for showing the rest of us what steady, real love looks like.”", "Tells a couple their relationship matters beyond themselves."],
      ["(For a partner) “I'd choose this, choose you, all over again.”", "Simple and direct, which is exactly what long love wants to hear."],
    ],
    avoid: [
      ["“Congrats on not killing each other!”", "The tired joke undercuts a genuine achievement of commitment."],
      ["Focusing only on the wedding day", "The years since are the real story. Honor those, not just the photos."],
      ["A generic verse with no personal line", "For people you love, add at least one sentence that's truly yours."],
    ],
    gestures: [
      ["Recreate a shared memory", "Revisit the first-date restaurant, remake the wedding meal, replay 'their' song. Nostalgia is a gift money can't buy."],
      ["Give the gift of time together", "A night out, a weekend away, or an offer to babysit so a couple can have an evening to themselves."],
      ["Write down a memory you have of them", "Share a moment you witnessed in their relationship. Couples treasure seeing their love through someone else's eyes."],
    ],
    followUp: "Anniversaries come every year, and remembering theirs, especially for a couple whose milestones others forget, is a quiet, lasting kindness. Note the date and send a simple 'happy anniversary, still so happy for you two' when it comes around again.",
    faq: [
      ["What do you write in an anniversary card?", "Honor the years the couple has spent together, not just the wedding. Name what their commitment has shown you, and offer a warm wish for the years ahead. For a partner, simple and direct heartfelt lines land best."],
      ["What should you not write in an anniversary card?", "Avoid the 'congrats on not killing each other' joke, focusing only on the wedding day, and generic printed verses with nothing personal added. Celebrate the staying, not just the starting."],
      ["What's a thoughtful anniversary gift?", "An experience that recreates a shared memory, the gift of time together (a night out or a weekend away), or a heartfelt letter. Meaning outlasts any object."],
      ["How do you make an anniversary message meaningful?", "Speak to the years since the wedding, the ordinary days and the seasons weathered together, and name something real you admire about their relationship."],
    ],
    related: ["what-to-write-in-a-wedding-card", "what-to-write-in-a-milestone-birthday-card"],
  },
  {
    slug: "what-to-write-in-a-retirement-card",
    tone: "celebration",
    title: "What to Write in a Retirement Card",
    meta: "Meaningful things to write in a retirement card: messages that honor a career and the person, what to avoid, and thoughtful ways to celebrate the start of a new chapter.",
    h1: "What to write in a retirement card",
    begin: "Someone I care about is retiring",
    intro: [
      "Retirement is a bigger moment than a card usually gives it credit for: the close of a decades-long chapter and the start of an unwritten one. 'Enjoy the golf!' doesn't quite honor a working life. A few real words can.",
      "Here's what to write to mark a retirement with the weight it deserves.",
    ],
    matters: "Retirement stirs pride and a surprising amount of uncertainty. A career is a big part of identity, and stepping away can feel like loss as much as freedom. The most meaningful notes honor what they built <em>and</em> the person beyond the job.",
    say: [
      ["“The mark you've made, on this work and on the people around you, is real and lasting.”", "Recognizes their legacy, which is what people most want to hear at the end of a career."],
      ["“You've earned every bit of this. I can't wait to see what you do with the time.”", "Frames retirement as a beginning, easing the fear of 'what now?'"],
      ["“Work was lucky to have you, but we're all luckier to just have <em>you</em>.”", "Separates their worth from their job title, which matters at exactly this moment."],
    ],
    avoid: [
      ["“Guess you're old now!”", "Retirement can already stir feelings about aging; don't pile on."],
      ["“You'll be so bored.”", "It plants doubt at a threshold that can already feel uncertain."],
      ["Only joking about naps and golf", "A wink is fine, but a whole card of it skips the meaning of a life's work."],
    ],
    gestures: [
      ["Collect memories from colleagues", "A book of notes, photos, or stories from the people they worked with honors a career better than any object."],
      ["Give a gift toward the next chapter", "Something for what's ahead, like gear for a hobby, a trip, or a class they've wanted to take, says you believe in their future."],
      ["Mark the transition together", "A dinner or gathering to send them off makes the milestone feel seen, not just clocked out."],
    ],
    followUp: "The send-off is exciting; the quiet Monday a few weeks later, when the calendar's suddenly empty, can be harder than expected. A check-in then, a warm 'how's the new rhythm treating you?', shows you understood retirement is a real transition, not just a party.",
    faq: [
      ["What do you write in a retirement card?", "Honor the mark they made over their career and the person beyond the job, and offer an encouraging wish for the next chapter. Recognizing their legacy means more than jokes about free time."],
      ["What should you not write in a retirement card?", "Avoid 'you're old now,' 'you'll be so bored,' and filling the whole card with naps-and-golf jokes. Retirement can stir uncertainty, so lead with meaning, not teasing."],
      ["What's a good retirement gift?", "A book of memories and notes from colleagues, something for their next chapter (a hobby, a trip, a class), or a gathering to send them off. Honor the whole journey."],
      ["How do you honor someone's career at retirement?", "Name the lasting impact they had on the work and the people around them, and separate their worth from the job title. Collected memories from coworkers make it tangible."],
    ],
    related: ["ways-to-celebrate-a-friends-promotion", "what-to-write-in-a-milestone-birthday-card"],
  },
  {
    slug: "what-to-say-when-someone-gets-engaged",
    tone: "celebration",
    title: "What to Say When Someone Gets Engaged",
    meta: "Genuine ways to congratulate someone on their engagement: warm messages that feel personal, what to avoid, and thoughtful ways to celebrate the newly engaged couple.",
    h1: "What to say when someone gets engaged",
    begin: "A friend just got engaged",
    intro: [
      "An engagement is pure, giddy joy, and it deserves more than a thumbs-up on the announcement post. A warm, specific reaction tells the newly engaged couple you're genuinely thrilled, not just politely reacting.",
      "Here's how to congratulate someone on their engagement in a way that actually lands.",
    ],
    matters: "The newly engaged are floating, and quietly noticing who shows up with real enthusiasm. The most meaningful thing you can do is match their joy and make it about <em>them</em>, not the ring, the date, or the logistics everyone's about to pepper them with.",
    say: [
      ["“This is the best news. I'm so happy for you both. Tell me everything!”", "Genuine enthusiasm and an invitation to share beats a quick 'congrats.'"],
      ["“You two are so right for each other. I've thought so for a long time.”", "Affirms the relationship itself, which means more than reacting to the proposal."],
      ["“However you celebrate this, I'm here for it. No pressure, just joy.”", "A refreshing change from everyone immediately asking about the wedding date."],
    ],
    avoid: [
      ["“So when's the wedding?” right away", "It rushes past the moment into logistics they may not have figured out yet."],
      ["“Weddings are so expensive / stressful…”", "Leading with the hard parts deflates a moment that's about hope."],
      ["Making it about the ring", "'Let me see the ring!' as your first reaction centers the object over the couple."],
    ],
    gestures: [
      ["Celebrate the moment itself", "Take them out, raise a toast, or send a small treat to mark the engagement, before all the wedding planning begins."],
      ["Offer specific help, later", "Once the dust settles, a genuine 'I'd love to help with X' is welcome, but let them enjoy being engaged first."],
      ["Send a heartfelt note", "A card celebrating the two of them, not the wedding to come, is a warm surprise in a sea of logistics questions."],
    ],
    followUp: "The excitement of an engagement gives way to months of planning, and a surprising amount of stress and family opinions. Check in during that stretch, not about the seating chart, just 'how are <em>you two</em> doing in all this?' It's a rare and welcome question.",
    faq: [
      ["What do you say when someone gets engaged?", "Lead with genuine enthusiasm and make it about the couple: 'I'm so happy for you both, tell me everything,' and affirm that they're right for each other. Save the wedding-logistics questions for later."],
      ["What should you not say to a newly engaged couple?", "Avoid immediately asking 'when's the wedding?', leading with how expensive or stressful weddings are, or making the ring your first reaction. Let them enjoy the moment first."],
      ["How do you celebrate someone's engagement?", "Mark the engagement itself by taking them out, toasting them, or sending a small treat, all before the wedding planning starts. A heartfelt note about the two of them is always welcome."],
      ["When should you offer to help with the wedding?", "After the initial excitement settles. Let the couple simply be engaged for a while, then offer specific help rather than a vague 'let me know if you need anything.'"],
    ],
    related: ["what-to-write-in-a-wedding-card", "what-to-write-in-a-new-baby-card"],
  },
];

const GUIDE_BY_SLUG = Object.fromEntries(GUIDES.map((g) => [g.slug, g]));

// ---------- templates ----------
// Privacy-first tracker, same shape as the homepage. Shares the tc_sid session so a
// guide → app journey is one continuous funnel, and records the traffic source.
// TC-133 marketing analytics: Meta Pixel + Google Analytics (GA4) + Pinterest tag.
// Public client IDs (safe in the browser, not secrets). Injected immediately after
// <head> on every generated guide page + the hub — these are the Pinterest pins'
// landing pages, so they must be tracked like the homepage.
const MARKETING_TAGS = `<!-- Meta Pixel -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '1056603483422469');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=1056603483422469&ev=PageView&noscript=1"
alt="" /></noscript>
<!-- End Meta Pixel -->
<!-- Google Analytics (GA4) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-8WM0S308TV"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-8WM0S308TV');
</script>
<!-- End Google Analytics -->
<!-- Pinterest Tag -->
<script>
!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(
Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version="3.0";
var t=document.createElement("script");t.async=!0,t.src=e;var r=
document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}
("https://s.pinimg.com/ct/core.js");
pintrk('load', '2612849670075');
pintrk('page');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://ct.pinterest.com/v3/?event=init&tid=2612849670075&noscript=1"
alt="" /></noscript>
<!-- End Pinterest Tag -->`;

const TRACKER = `<script>(function(){try{var s=localStorage.getItem('tc_sid');if(!s){s=(self.crypto&&crypto.randomUUID)?crypto.randomUUID():('s'+Date.now()+Math.random().toString(36).slice(2));localStorage.setItem('tc_sid',s);}var t=false;try{t=localStorage.getItem('tc_test')==='1';}catch(e){}var ref='';try{ref=(document.referrer||'').split('/')[2]||'';}catch(e){}var q={};try{var u=new URLSearchParams(location.search);q={utm_source:u.get('utm_source'),utm_medium:u.get('utm_medium'),utm_campaign:u.get('utm_campaign')};}catch(e){}var p=JSON.stringify(Object.assign({event:'page_view',sid:s,test:t,page:location.pathname,ref:ref},q));if(navigator.sendBeacon)navigator.sendBeacon('/api/track',new Blob([p],{type:'application/json'}));else fetch('/api/track',{method:'POST',keepalive:true,headers:{'content-type':'application/json'},body:p});}catch(e){}})();</script>`;

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function page(g) {
  const url = `${SITE}/guides/${g.slug}/`;
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: g.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Guides", item: SITE + "/guides/" },
      { "@type": "ListItem", position: 3, name: g.title, item: url },
    ],
  };
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: g.title,
    description: g.meta,
    mainEntityOfPage: url,
    inLanguage: "en",
    datePublished: TODAY,
    dateModified: TODAY,
    author: { "@type": "Organization", name: "Thoughts Count", url: SITE + "/" },
    publisher: { "@type": "Organization", name: "Thoughts Count", logo: { "@type": "ImageObject", url: SITE + "/favicon.svg" } },
  };
  const sayRows = g.say.map(([line, note]) => `
      <div class="row good">
        <div class="line">${line}</div>
        <div class="note">${note}</div>
      </div>`).join("");
  const avoidRows = g.avoid.map(([line, note]) => `
      <div class="row bad">
        <div class="line">${line}</div>
        <div class="note">${note}</div>
      </div>`).join("");
  const gestureRows = g.gestures.map(([t, txt]) => `
      <div class="gesture"><h3>${t}</h3><p>${txt}</p></div>`).join("");
  const faqRows = g.faq.map(([q, a]) => `
      <div class="qa"><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join("");
  const related = g.related.map((s) => GUIDE_BY_SLUG[s]).filter(Boolean).map((r) => `
        <a class="rel" href="/guides/${r.slug}/">${r.h1}</a>`).join("");
  // TC-174 Surface 3: an inline Della intake, pre-filled with this guide's situation and editable.
  // Native GET form → /?begin=<situation>&from=guide, so it works even without JS (progressive
  // enhancement). Placed at peak intent (right after "What to say") and again at the foot of the page.
  // Grief guard (UX gate): on hard-moment guides (tone:"hard") the celebratory "make my plan" framing
  // reads as turning loss into a task, so Della speaks differently — steadier, no "plan" language.
  const ctaHard = g.tone === "hard";
  const ctaLine = ctaHard
    ? "This is a hard one, and the right words are personal. Tell me about your person and I'll help you find them."
    : "Want words that fit your person, not a stranger's? Tell me who they are and I'll make you a plan.";
  const ctaBtn = ctaHard ? "Help me find the words" : "Make my plan";
  const dellaCta = `
    <div class="della-cta">
      <div class="della-cta-head">${MARK}<span>From ${esc(HER_NAME)}</span></div>
      <p class="della-cta-line">${ctaLine}</p>
      <form class="della-cta-form" action="/" method="get">
        <input type="text" name="begin" value="${esc(g.begin)}" maxlength="120" aria-label="Your situation" />
        <input type="hidden" name="from" value="guide" />
        <button type="submit">${ctaBtn}</button>
      </form>
      <span class="della-cta-sub">Free. No account. About a minute.</span>
    </div>`;

  // TC-174 Surface 2: a slim daily-thought opt-in at the foot of the guide, for the many readers who
  // never start a plan. Self-contained (guides ship no companion.js): posts to /api/subscribe-daily
  // with source "guide". Straight punctuation only (human-sendable rule). Hidden once opted in.
  const dailyOptin = `
    <div class="daily-optin" id="guideDailyOptin">
      <p class="do-prompt">Want a small thought like this from me each morning?</p>
      <form class="do-form" id="guideDailyForm" novalidate>
        <input type="email" id="guideDailyEmail" placeholder="you@email.com" aria-label="Your email" autocomplete="email" />
        <button type="submit" id="guideDailyBtn">Yes, send them</button>
      </form>
      <p class="do-msg" id="guideDailyMsg" role="status" aria-live="polite"></p>
    </div>
    <script>
    (function(){
      var form=document.getElementById('guideDailyForm');if(!form)return;
      var wrap=document.getElementById('guideDailyOptin');
      var input=document.getElementById('guideDailyEmail');
      var btn=document.getElementById('guideDailyBtn');
      var msg=document.getElementById('guideDailyMsg');
      try{if(localStorage.getItem('tc_daily_sub')==='1'){wrap.style.display='none';return;}}catch(e){}
      var RE=/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
      form.addEventListener('submit',function(ev){
        ev.preventDefault();
        var email=(input.value||'').trim();
        msg.className='do-msg';
        if(!RE.test(email)){msg.className='do-msg bad';msg.textContent='That email looks off. Mind checking it?';return;}
        var sid;try{sid=localStorage.getItem('tc_sid')||undefined;}catch(e){}
        btn.disabled=true;msg.textContent='One moment...';
        fetch('/api/subscribe-daily',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email,source:'guide',sid:sid})})
          .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
          .then(function(res){
            if(!res.ok){btn.disabled=false;msg.className='do-msg bad';msg.textContent=(res.j&&res.j.error)||'That did not go through. Try again in a moment.';return;}
            try{localStorage.setItem('tc_daily_sub','1');}catch(e){}
            form.style.display='none';wrap.querySelector('.do-prompt').style.display='none';
            msg.className='do-msg';msg.textContent="Lovely. I'll send you a small thought each morning.";
          })
          .catch(function(){btn.disabled=false;msg.className='do-msg bad';msg.textContent='That did not go through. Try again in a moment.';});
      });
    })();
    </script>`;

  return `<!doctype html>
<html lang="en">
<head>
${MARKETING_TAGS}
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(g.title)} | Thoughts Count</title>
<meta name="description" content="${esc(g.meta)}" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(g.title)}" />
<meta property="og:description" content="${esc(g.meta)}" />
<meta property="og:url" content="${url}" />
<meta property="og:site_name" content="Thoughts Count" />
<meta property="og:image" content="${SITE}/og.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${SITE}/og.png" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<script type="application/ld+json">${JSON.stringify(articleLd)}</script>
<script type="application/ld+json">${JSON.stringify(faqLd)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>
<style>
  :root{--paper:#f7f3ec;--cloud:#fdfbf7;--ink:#2c2a26;--soft:#5a554c;--blue:#118ab9;--blue-deep:#0a5876;--red:#ef4136;--line:#e7ded0}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Hanken Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);line-height:1.75;background:var(--paper)}
  /* TC-174 blocker #2 (Design Lead ruling): share home's living-gradient COLOR WORLD so the guide→home
     seam reads as one brand, but STATIC (no blobs) — a reading page stays calm (brand law #6: only the
     orb animates, and guides have no orb). Article + cards stay opaque warm "rooms" for legibility.
     Exact base wash from ITERATION-2-SPEC PART 2. */
  #bg{position:fixed;inset:0;z-index:-2;background:radial-gradient(130% 100% at 20% 10%, #f4e6dc 0%, #dfe9ee 45%, #b9d2de 78%, #8fb9cc 100%)}
  a{color:var(--blue)}
  h1,h2,h3{font-family:'Hanken Grotesk',system-ui,sans-serif;font-weight:700;letter-spacing:-.01em;line-height:1.2}
  .wrap{max-width:760px;margin:0 auto;padding:0 22px}
  header.bar{padding:20px 0}
  .brand{font-size:15px;font-weight:700;color:var(--blue);text-decoration:none;display:inline-flex;gap:9px;align-items:center;text-transform:uppercase;letter-spacing:.18em}
  .brand svg{width:22px;height:22px}
  .crumbs{font-size:13px;color:var(--soft);margin:8px 0 0}
  .crumbs a{color:var(--soft)}
  article{background:var(--cloud);border:1px solid var(--line);border-radius:22px;padding:40px 38px;margin:14px 0 30px;box-shadow:0 14px 40px rgba(64,52,34,.06)}
  h1{font-size:clamp(27px,4.4vw,40px);margin:0 0 18px}
  h2{font-size:23px;margin:34px 0 12px}
  .lead p{font-size:18px;color:var(--ink)}
  .matters{background:#e3f0f6;border-radius:14px;padding:16px 18px;font-size:16px}
  .row{border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:10px 0;background:var(--cloud)}
  .row .line{font-weight:600;font-size:16px}
  .row.good .line{color:var(--blue-deep)}
  .row.bad .line{color:var(--red)}
  .row .note{font-size:14.5px;color:var(--soft);margin-top:4px}
  .gesture{border-bottom:1px dashed var(--line);padding:12px 0}
  .gesture:last-child{border-bottom:none}
  .gesture h3{font-size:17px;margin:0 0 3px;font-weight:600}
  .gesture p{margin:0;font-size:15.5px;color:var(--ink)}
  .qa{padding:12px 0;border-bottom:1px dashed var(--line)}
  .qa:last-child{border-bottom:none}
  .qa h3{font-size:16.5px;margin:0 0 4px;font-weight:600}
  .qa p{margin:0;font-size:15.5px;color:var(--ink)}
  .cta{margin:30px 0 6px;text-align:center}
  .cta a{display:inline-block;background:var(--red);color:#fff;text-decoration:none;padding:15px 32px;border-radius:999px;font-weight:700;font-size:16.5px;box-shadow:0 10px 30px rgba(64,52,34,.14)}
  .cta .sub{display:block;font-size:13.5px;color:var(--soft);margin-top:10px}
  /* TC-174 Surface 3: inline Della intake, turns a reader into a personalized plan without leaving the page */
  .della-cta{background:#e3f0f6;border:1px solid var(--line);border-radius:18px;padding:22px 24px;margin:26px 0;text-align:center}
  .della-cta-head{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:var(--blue-deep);text-transform:uppercase;letter-spacing:.12em}
  .della-cta-head svg{width:22px;height:22px}
  .della-cta-line{font-size:17px;color:var(--ink);margin:10px auto 16px;max-width:44ch}
  .della-cta-form{display:flex;gap:9px;flex-wrap:wrap;justify-content:center;align-items:stretch}
  .della-cta-form input[type=text]{flex:1 1 280px;min-width:0;padding:13px 15px;border:1px solid var(--line);border-radius:12px;font:inherit;font-size:15.5px;background:var(--cloud);color:var(--ink)}
  .della-cta-form input[type=text]:focus{outline:none;border-color:var(--blue)}
  .della-cta-form button{background:var(--red);color:#fff;border:0;padding:13px 28px;border-radius:999px;font-weight:700;font-size:16px;cursor:pointer;box-shadow:0 10px 30px rgba(64,52,34,.14);white-space:nowrap}
  .della-cta-sub{display:block;font-size:13px;color:var(--soft);margin-top:12px}
  /* TC-174 Surface 2: slim daily-thought opt-in at the guide foot */
  .daily-optin{margin:26px 0 4px;padding:18px 20px;background:#eef6fa;border:1px solid var(--line);border-radius:16px}
  .do-prompt{margin:0 0 10px;font-size:15.5px;font-weight:600;color:var(--blue-deep)}
  .do-form{display:flex;gap:8px;flex-wrap:wrap;align-items:stretch}
  .do-form input[type=email]{flex:1 1 220px;min-width:0;padding:11px 14px;border:1px solid var(--line);border-radius:11px;font:inherit;font-size:15px;background:var(--cloud);color:var(--ink)}
  .do-form input[type=email]:focus{outline:none;border-color:var(--blue)}
  .do-form button{flex:0 0 auto;background:var(--blue);color:#fff;border:0;padding:11px 20px;border-radius:11px;font:inherit;font-weight:700;font-size:15px;cursor:pointer;white-space:nowrap}
  .do-form button:disabled{opacity:.6;cursor:default}
  .do-msg{margin:10px 0 0;font-size:13.5px;color:var(--soft)}
  .do-msg.bad{color:var(--red)}
  .related{margin:26px 0 0}
  .related h2{font-size:19px}
  .rel{display:block;background:var(--cloud);border:1px solid var(--line);border-radius:12px;padding:11px 15px;margin:7px 0;text-decoration:none;color:var(--blue);font-weight:600}
  footer{padding:20px 0 50px;color:var(--soft);font-size:13px;text-align:center}
</style>
</head>
<body>
<div id="bg" aria-hidden="true"></div>
${TRACKER}
<div class="wrap">
  <header class="bar">
    <a class="brand" href="/">${MARK}Thoughts Count</a>
    <div class="crumbs"><a href="/">Home</a> › <a href="/guides/">Guides</a> › ${esc(g.h1)}</div>
  </header>

  <article>
    <h1>${esc(g.h1)}</h1>
    <div class="lead">${g.intro.map((p) => `<p>${p}</p>`).join("")}</div>

    <h2>What matters most</h2>
    <div class="matters">${g.matters}</div>

    <h2>What to say</h2>${sayRows}
${dellaCta}
    <h2>What to avoid</h2>${avoidRows}

    <h2>${g.gesturesHeading || "Gestures that help"}</h2>
    <div class="gestures">${gestureRows}</div>

    <h2>How to keep showing up</h2>
    <p>${g.followUp}</p>

${dellaCta}

    <h2>Common questions</h2>
    <div class="faq">${faqRows}</div>

    <div class="related">
      <h2>More guides</h2>${related}
    </div>
${dailyOptin}
  </article>

  <footer>Thoughts Count: helping good intentions become meaningful actions.</footer>
</div>
</body>
</html>`;
}

function hub() {
  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Guides: What to Say & Do When It Matters",
    url: SITE + "/guides/",
    description: "Warm, practical guides on what to say and do for life's big moments.",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: GUIDES.map((g, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE}/guides/${g.slug}/`,
        name: g.title,
      })),
    },
  };
  const cards = GUIDES.map((g) => `
      <a class="card" href="/guides/${g.slug}/">
        <span class="tag ${g.tone}">${g.tone === "hard" ? "Hard moment" : g.tone === "everyday" ? "Everyday" : "Celebration"}</span>
        <h2>${esc(g.h1)}</h2>
        <p>${esc(g.meta)}</p>
      </a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
${MARKETING_TAGS}
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Guides: What to Say &amp; Do When It Matters | Thoughts Count</title>
<meta name="description" content="Warm, practical guides on what to say and do for life's big moments: losses, diagnoses, new babies, promotions, and more. Genuine words and gestures that help." />
<link rel="canonical" href="${SITE}/guides/" />
<meta property="og:title" content="Guides: What to Say & Do When It Matters" />
<meta property="og:description" content="Warm, practical guides on what to say and do for life's big moments." />
<meta property="og:url" content="${SITE}/guides/" />
<meta property="og:site_name" content="Thoughts Count" />
<meta property="og:image" content="${SITE}/og.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${SITE}/og.png" />
<meta name="twitter:title" content="Guides: What to Say & Do When It Matters" />
<meta name="twitter:description" content="Warm, practical guides on what to say and do for life's big moments." />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<script type="application/ld+json">${JSON.stringify(collectionLd)}</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  :root{--cloud:#fdfbf7;--paper:#f7f3ec;--ink:#2c2a26;--soft:#5a554c;--blue:#118ab9;--blue-deep:#0a5876;--red:#ef4136;--line:#e7ded0}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Hanken Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);line-height:1.7;background:var(--paper)}
  /* TC-174 blocker #2 (Design Lead ruling): share home's living-gradient COLOR WORLD so the guide→home
     seam reads as one brand, but STATIC (no blobs) — a reading page stays calm (brand law #6: only the
     orb animates, and guides have no orb). Article + cards stay opaque warm "rooms" for legibility.
     Exact base wash from ITERATION-2-SPEC PART 2. */
  #bg{position:fixed;inset:0;z-index:-2;background:radial-gradient(130% 100% at 20% 10%, #f4e6dc 0%, #dfe9ee 45%, #b9d2de 78%, #8fb9cc 100%)}
  a{color:var(--blue)}
  h1,h2{font-family:'Hanken Grotesk',system-ui,sans-serif;font-weight:700;letter-spacing:-.01em}
  .wrap{max-width:900px;margin:0 auto;padding:0 22px}
  .bar{padding:20px 0}
  .brand{font-size:15px;font-weight:700;color:var(--blue);text-decoration:none;display:inline-flex;gap:9px;align-items:center;text-transform:uppercase;letter-spacing:.18em}
  .brand svg{width:22px;height:22px}
  .hero{text-align:center;padding:26px 0 8px}
  .hero h1{font-size:clamp(28px,4.6vw,42px);margin:0 0 10px}
  .hero p{color:var(--soft);max-width:52ch;margin:0 auto;font-size:17px}
  .hcta{text-align:center;margin:22px 0 4px}
  .hcta a{display:inline-block;background:var(--red);color:#fff;text-decoration:none;padding:13px 30px;border-radius:999px;font-weight:700;font-size:16px;box-shadow:0 10px 30px rgba(64,52,34,.14)}
  .hcta .sub{display:block;font-size:13px;color:var(--soft);margin-top:9px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin:26px 0 40px}
  .card{background:var(--cloud);border:1px solid var(--line);border-radius:18px;padding:20px;text-decoration:none;color:var(--ink);box-shadow:0 10px 30px rgba(64,52,34,.05);transition:transform .12s}
  .card:hover{transform:translateY(-2px)}
  .card h2{font-size:19px;margin:8px 0 6px}
  .card p{color:var(--soft);font-size:14px;margin:0}
  .tag{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:3px 9px;border-radius:999px}
  .tag.hard{background:#e3f0f6;color:var(--blue-deep)}
  .tag.celebration{background:#fdeceb;color:var(--red)}
  .tag.everyday{background:#f1ebe1;color:var(--soft)}
  footer{padding:20px 0 50px;color:var(--soft);font-size:13px;text-align:center}
</style>
</head>
<body>
<div id="bg" aria-hidden="true"></div>
${TRACKER}
<div class="wrap">
  <div class="bar"><a class="brand" href="/">${MARK}Thoughts Count</a></div>
  <div class="hero">
    <h1>What to say &amp; do when it matters</h1>
    <p>Honest, practical guidance for life's big moments, the hard ones and the joyful ones. Real words, and gestures that actually help.</p>
    <div class="hcta"><a href="/">Get a plan for your situation →</a><span class="sub">Free · no account needed · personal to your relationship</span></div>
  </div>
  <div class="grid">${cards}</div>
  <footer>Thoughts Count: helping good intentions become meaningful actions.</footer>
</div>
</body>
</html>`;
}

function sitemap() {
  const urls = [
    { loc: SITE + "/", pri: "1.0" },
    { loc: SITE + "/guides/", pri: "0.8" },
    ...GUIDES.map((g) => ({ loc: `${SITE}/guides/${g.slug}/`, pri: "0.7" })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${TODAY}</lastmod><priority>${u.pri}</priority></url>`).join("\n")}
</urlset>
`;
}

const robots = `User-agent: *
Allow: /
Sitemap: ${SITE}/sitemap.xml
`;

// ---------- write ----------
let n = 0;
for (const g of GUIDES) {
  const dir = join(ROOT, "public", "guides", g.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page(g));
  n++;
}
mkdirSync(join(ROOT, "public", "guides"), { recursive: true });
writeFileSync(join(ROOT, "public", "guides", "index.html"), hub());
writeFileSync(join(ROOT, "public", "sitemap.xml"), sitemap());
writeFileSync(join(ROOT, "public", "robots.txt"), robots);
console.log(`Wrote ${n} guide pages + hub + sitemap.xml + robots.txt`);
