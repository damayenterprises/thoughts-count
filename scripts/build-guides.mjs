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
// PUBLISHED is the stable original publish date (datePublished). dateModified + sitemap lastmod use the
// live BUILD_DATE so Google sees a genuine freshness signal every time we regenerate (TC-176 lever #3).
// A per-guide `published` override wins when set (so new matrix waves carry their own real publish date).
const PUBLISHED = "2026-07-27";
const BUILD_DATE = new Date().toISOString().slice(0, 10);
// The homepage declares the canonical entity graph (Organization/WebSite by @id). Guides reference the
// SAME @id for author/publisher so all guide authority consolidates onto one entity (TC-173 brand-term).
const ORG_ID = SITE + "/#organization";

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
    related: ["what-to-write-in-a-milestone-birthday-card", "what-to-say-for-a-new-job-or-promotion", "what-to-say-when-someone-gets-engaged"],
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
    related: ["what-to-say-after-a-miscarriage", "how-to-honor-someone-on-a-loss-anniversary", "what-to-say-to-someone-going-through-a-divorce"],
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
      ["“None of this makes you a failure.”", "Say it plainly. Even people who chose the divorce often carry a quiet sense of having failed; naming it out loud helps lift it."],
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
      ["Note the hard dates", "Quietly put the would-be anniversary and the first solo holidays in your calendar. A short 'thinking of you today' when everyone else has forgotten means the most."],
    ],
    sections: [
      {
        h: "What to say based on your relationship",
        rows: [
          ["If it's a close friend", "Be direct about your loyalty and then keep showing up in ordinary ways, not just the crisis moments: 'I'm on your side no matter what, and I'm not going anywhere.'"],
          ["If it's a family member", "Family divorces come loaded with everyone's opinions. Be the one who adds none: 'I love you, I'm not keeping score, and I'm here however you need me.'"],
          ["If it's a coworker or someone you don't know well", "Keep it brief and private: 'I heard you've got a lot going on right now, I'm thinking of you.' Don't probe for details, and don't raise it in front of others."],
          ["If you're worried about taking sides", "You don't have to take one. Support the person in front of you without commenting on the ex at all. 'I'm here for you' needs no verdict on who was right."],
        ],
      },
      {
        h: "What to say once the divorce is final",
        p: "When the paperwork is signed, the world assumes it's over and moves on, but this is often when the quiet really sets in. Skip 'congratulations, you're better off' unless they say it first, and skip a heavy 'I'm so sorry' if what they feel is relief. Something open works better: 'However you're feeling about this being final, I'm glad you're through it, and I'm still here.' Then keep treating them like the same friend, invited to the same things, checked in on through the first solo holidays and the dates that used to matter.",
      },
    ],
    followUp: "Support clusters around the announcement, then fades as the process grinds on for a year or more. Check in during the quiet stretches: after a court date, around what would've been an anniversary, on the first holidays alone. Being the friend who remembers those dates is a rare gift.",
    faq: [
      ["What do you say to someone going through a divorce?", "Offer loyalty and presence without taking sides or asking for details: 'I'm on your side, however you feel about it,' and 'I'm here for the long haul.' Let them decide how much to share and whether they want distraction or a listening ear."],
      ["What do you text someone going through a divorce?", "Keep it warm and low-pressure: 'Thinking of you. No need to reply, I just wanted you to know I'm on your side.' A short, no-obligation text is often kinder than a call in the early days, because it lets them respond when they have the energy."],
      ["Do you say congratulations or sorry about a divorce?", "Follow their lead. Divorce can be a grief, a relief, or both, and assuming either way can sting. If you're unsure, stay open: 'However you're feeling about this, I'm here for you,' and save 'congratulations' or 'I'm sorry' for after they've signaled which one fits."],
      ["What do you say to a coworker or acquaintance who's getting divorced?", "Acknowledge it gently and keep it private: 'I heard you've got a lot going on, I'm thinking of you.' Don't ask what happened or bring it up in front of others. Warm, brief, and no prying is exactly right."],
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
    related: ["what-to-write-in-a-wedding-card", "what-to-write-in-a-milestone-birthday-card", "what-to-say-when-someone-gets-engaged"],
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
      ["“I love seeing you this happy.”", "Sometimes the warmest thing is to simply reflect their joy back to them, with no advice and no questions attached."],
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
      ["Note the date for later", "Jot down the engagement date and check in around their first anniversary of it, or as the wedding nears. Remembering when others have forgotten is its own quiet gift."],
    ],
    sections: [
      {
        h: "What to say based on your relationship",
        rows: [
          ["If it's your best friend", "Skip the polish and be real: 'I'm actually crying, this is the best news, I love you both.' They want your unfiltered joy far more than a perfect sentence."],
          ["If it's a sibling or close family", "Speak to the whole story and the belonging: 'I've watched this relationship grow, and I could not be happier to really call them family.' That lands hard here."],
          ["If it's a coworker or someone you're not close to", "Warm but brief is exactly right: 'Congratulations, that's wonderful news, I'm so happy for you.' Sincere and uncomplicated beats overreaching."],
          ["If you have mixed feelings about it", "Lead with them, not your doubts: 'I'm happy for you.' Your job in this moment is to celebrate. Any concerns, if they are yours to raise at all, are for another day."],
        ],
      },
      {
        h: "Should you text, call, or send a card?",
        p: "A text is perfect for the first reaction, warm and immediate the moment you hear the news. A call is lovely for someone close, so they can actually hear the joy in your voice. And a handwritten card a week or two later, once the flood of announcement comments has died down, is the one that gets kept. If you can, do both: the quick text now and the card later. The couple feels celebrated twice, at the peak and again in the quiet after.",
      },
    ],
    followUp: "The excitement of an engagement gives way to months of planning, and a surprising amount of stress and family opinions. Check in during that stretch, not about the seating chart, just 'how are <em>you two</em> doing in all this?' It's a rare and welcome question.",
    faq: [
      ["What do you say when someone gets engaged?", "Lead with genuine enthusiasm and make it about the couple: 'I'm so happy for you both, tell me everything,' and affirm that they're right for each other. Save the wedding-logistics questions for later."],
      ["Do you say congratulations when someone gets engaged?", "Yes. The old etiquette rule was to say 'congratulations' to the person who proposed and 'best wishes' to the other, on the idea that you don't congratulate someone simply for getting engaged. That distinction has largely faded, and a warm 'congratulations to you both' is welcome and correct today."],
      ["What do you text someone who just got engaged?", "Keep it warm and immediate: 'Just saw the news, I'm so happy for you both. Congratulations!' You don't need the perfect line in a text; your quick, genuine excitement in the moment is the whole point. Save a longer message for a card later."],
      ["How do you congratulate a coworker on their engagement?", "Warm but brief is the right register: 'Congratulations, that's wonderful news, I'm really happy for you.' You can add a light, sincere question like 'How are you feeling?' without prying into wedding logistics."],
      ["What should you not say to a newly engaged couple?", "Avoid immediately asking 'when's the wedding?', leading with how expensive or stressful weddings are, or making the ring your first reaction. Let them enjoy the moment first."],
      ["How do you celebrate someone's engagement?", "Mark the engagement itself by taking them out, toasting them, or sending a small treat, all before the wedding planning starts. A heartfelt note about the two of them is always welcome."],
      ["When should you offer to help with the wedding?", "After the initial excitement settles. Let the couple simply be engaged for a while, then offer specific help rather than a vague 'let me know if you need anything.'"],
    ],
    related: ["what-to-write-in-a-wedding-card", "what-to-write-in-a-new-baby-card", "what-to-write-in-an-anniversary-card"],
  },

  // ---- Batch 5 (TC-175 wave 1): proven-demand matrix expansion ----
  {
    slug: "what-to-write-in-a-sympathy-card",
    tone: "hard",
    gesturesHeading: "Ways to show you care",
    title: "What to Write in a Sympathy Card",
    meta: "Gentle, genuine sympathy card messages: what to write when words feel impossible, condolence card wording to use, phrases to avoid, and ways to keep showing up.",
    h1: "What to write in a sympathy card",
    begin: "Someone I care about is grieving and I want to send a card",
    intro: [
      "There is no perfect sentence that fixes this, and the person grieving isn't looking for one. They will remember that you reached out at all, and a few honest lines mean far more than a signed store-bought verse.",
      "Here is what to write when the words feel impossible, what to leave off, and how to keep showing up after the card is opened.",
    ],
    matters: "You cannot say the wrong thing as badly as you can say nothing. The card that lands isn't the most eloquent one, it's the one that names the person who died and lets your friend know they are <em>not</em> forgotten in this.",
    say: [
      ["“I am so sorry. I don't have the right words, but I am thinking of you and I am here.”", "Honesty about not knowing what to say is disarming and true. It removes the pressure to sound wise."],
      ["“I keep remembering how your mom laughed. The world is quieter without her.”", "Naming the person and a specific memory tells the griever their loved one mattered and is remembered."],
      ["“You don't need to reply to this. I just wanted you to know I'm holding you close right now.”", "Grief is exhausting. Releasing them from the duty to respond is a real kindness."],
      ["“I'll call Sunday to check in. If you'd rather I just drop off groceries, that's okay too.”", "A specific, low-pressure offer turns sympathy into something they can actually lean on."],
    ],
    avoid: [
      ["“Everything happens for a reason.”", "It asks the grieving person to find meaning in their pain before they're ready, and it can feel dismissive of how much it hurts."],
      ["“They're in a better place now.”", "Even when well meant, it can land as a correction of their grief rather than comfort. Let them feel the loss."],
      ["“Let me know if you need anything.”", "It sounds kind but puts the work on them. They rarely have the energy to ask, so offer something specific instead."],
    ],
    gestures: [
      ["Say the person's name", "Grieving people often fear their loved one will be forgotten. Writing or speaking the name is a gift, not a reminder of the pain they already carry."],
      ["Drop off food without asking", "Leave a meal at the door with a note. Eating is hard in early grief, and something ready to reheat quietly takes one thing off their plate."],
      ["Do a concrete chore", "Offer to mow the lawn, walk the dog, or handle a specific errand. Practical help is love made visible when they can barely function."],
      ["Mark the calendar for later", "Note the date somewhere so you can reach out in a month, when most cards have stopped and the quiet sets in."],
    ],
    sections: [
      {
        h: "What to write based on your relationship",
        rows: [
          ["A close friend", "Be personal and specific. Name the person who died, share a memory, and make a real offer of help. You have the standing to say “I love you and I'm not going anywhere.”"],
          ["A family member", "Lean into shared history. Recall the person together and acknowledge that you're grieving too, so your relative doesn't feel alone in it. “I'm here, and we'll get through this as a family.”"],
          ["A coworker or acquaintance", "Keep it warm but simpler. “I was so sorry to hear about your loss. I'm thinking of you and there's no rush on anything here.” Sincere and undemanding is exactly right."],
          ["Someone you're not close to", "A short, kind line is plenty and welcome. “Thinking of you and your family during this hard time.” You don't need to be close to offer comfort."],
        ],
      },
    ],
    followUp: "The hardest part often comes weeks later, after the funeral, when the cards stop and everyone assumes life has moved on. Put a reminder somewhere to check in around the one month mark with a simple “I'm still thinking of you, how are you really doing?” Being the person who remembers long after the crowd fades is one of the kindest things you can do.",
    faq: [
      ["What do you write in a sympathy card?", "Write a short, honest message that names the person who died, offers your comfort, and if you can, makes a specific offer of help. A line like “I'm so sorry, I'm thinking of you, and I'm here” means more than any polished verse."],
      ["What should you not say in a sympathy card?", "Avoid lines that try to explain the loss or rush the grief, like “everything happens for a reason,” “they're in a better place,” or the vague “let me know if you need anything.” Simple and sincere always beats profound."],
      ["What is a short sympathy message?", "A short message can be as simple as “Thinking of you and your family during this hard time.” Brevity is fine. The fact that you wrote at all is what the person will remember."],
      ["Is it okay to mention the person who died in a sympathy card?", "Yes, and it's often the most comforting thing you can do. Grieving people worry their loved one will be forgotten, so naming them or sharing a memory reassures them the person mattered."],
      ["What can I write instead of sorry for your loss?", "Try something warmer and more specific like “My heart is with you” or “I'm holding you close right now.” Naming a memory of the person who died lands even more personally than any stock phrase."],
      ["How do you end a sympathy card?", "Close with warmth and, ideally, an open door. “With love,” “Thinking of you,” or “Here whenever you need me” all work. Adding a gentle “no need to reply” can be a quiet relief."],
    ],
    related: ["what-to-say-when-someone-loses-a-parent", "ways-to-help-a-grieving-friend", "how-to-honor-someone-on-a-loss-anniversary"],
  },
  {
    slug: "what-to-write-in-a-thank-you-card",
    tone: "celebration",
    gesturesHeading: "Ways to make it land",
    title: "What to Write in a Thank-You Card (Without Clichés)",
    meta: "Warm, specific ideas for what to write in a thank-you card: wording for friends, family, coworkers, teachers, and gift-givers, plus lines to skip.",
    h1: "What to write in a thank-you card",
    begin: "I want to write a thank-you card to someone who did something kind",
    intro: [
      "The reason most thank-you cards feel flat is that they say the same thing: “thank you so much for everything.” It's polite, and it's forgettable. The ones people keep in a drawer for years are the ones that name the <em>actual</em> thing you're grateful for.",
      "Here's how to write a thank-you note that sounds like you, plus wording for different people in your life and the lines worth skipping.",
    ],
    matters: "The whole job of a thank-you card is to make the other person feel <em>seen</em>. Naming the specific thing they did, and what it meant to you, is what turns a nicety into something they actually feel.",
    say: [
      ["“Thank you for driving all the way out on Saturday to help me move. I know it ate your whole day, and I couldn't have done it without you.”", "It names the exact favor and acknowledges the cost. That specificity is what makes it feel real instead of routine."],
      ["“The necklace is beautiful, but honestly it's the note you tucked inside that I keep rereading.”", "Ties the thanks to a real detail and shows you noticed the thought behind the gift, not just the gift."],
      ["“You probably don't realize how much your check-in text meant that week. It landed on a hard day and it stuck with me.”", "Tells them the impact they had, which most people never actually hear. That's the part that lands."],
      ["“Thank you for believing in me before I believed in myself. I think about your advice more than you know.”", "Works for a mentor or parent. It credits them with something specific and lasting, not just a generic kindness."],
    ],
    avoid: [
      ["“Thanks for everything!”", "It's the default, and it tells the person nothing about what they actually did. Name one real thing instead."],
      ["“Sorry this is so late.”", "Leading with an apology makes the note about your guilt. A late, warm thank-you still beats a prompt, hollow one. Just say it."],
      ["“No need to thank me back!”", "Turning your own thank-you into a small instruction makes it about the transaction. Let the gratitude just sit there."],
    ],
    gestures: [
      ["Say it out loud too", "A card is lovely, and hearing “that meant a lot to me” in person or on a call hits differently. Do both when you can."],
      ["Be specific about what you'll do with it", "If it was a gift, tell them: “I'm wearing it to the interview.” If it was help, “you saved me an entire weekend.” It proves the kindness mattered."],
      ["Return the favor when they're not looking for it", "The strongest thank-you is remembering, months later, that they came through for you, and quietly showing up for them."],
      ["Send it even when it feels overdue", "People worry a late thank-you is worse than none. It isn't. A note that arrives weeks later still tells them they were on your mind."],
    ],
    sections: [
      {
        h: "What to write depending on who they are",
        rows: [
          ["A close friend", "Skip the formality and write how you actually talk. Reference the specific moment: the ride, the venting session, the thing only they would have done. Inside jokes are allowed."],
          ["A family member", "Name something they did that you may never have said out loud. “Thank you for always making a plate for me” or “for never making me feel like a burden” lands harder than a generic thanks."],
          ["A coworker or boss", "Keep it warm but specific and professional. Point to the concrete thing: they covered for you, mentored you, went to bat for you. “Thank you for trusting me with that project” beats “thanks for the opportunity.”"],
          ["A teacher or mentor", "Tell them the impact, not just the effort. Teachers rarely hear how they changed someone. “Your class is the reason I chose this major” is the kind of line they keep for years."],
          ["Someone who gave a gift", "Mention the gift by name and how you'll use it. If it was money, be gracious and concrete: “it's going toward the apartment, and it means the world.” Never leave them guessing whether it arrived."],
        ],
      },
    ],
    followUp: "Gratitude works best as a habit, not a single card. Keep noticing the people who show up for you, and tell them in the moment instead of saving it all for one occasion. A quick “hey, that really helped me” text costs nothing and lands more often than a perfect note you never get around to sending.",
    faq: [
      ["What do you write in a thank-you card?", "Name the specific thing the person did and what it meant to you, in your own words. One genuine, detailed line beats a paragraph of “thanks so much for everything.”"],
      ["How do you start a thank-you note?", "Start with the specific thing, not a generic greeting. “Thank you for driving me to the airport at 5am” pulls the reader in immediately, where “I just wanted to say thanks” doesn't."],
      ["Is it too late to send a thank-you card?", "No. A late thank-you still means more than none, and most people are simply glad you thought of them. Skip the long apology and just send it."],
      ["What should you not write in a thank-you card?", "Avoid vague filler like “thanks for everything,” a heavy apology for being late, and anything that turns it back into a transaction. Be specific instead."],
      ["How do you thank someone for a gift you didn't love?", "Thank them for the thought and the gesture, which are real, without lying about the item. “It was so thoughtful of you to remember” is honest and kind."],
      ["How long should a thank-you card be?", "A few genuine sentences is plenty. Length isn't the point; specificity is. One real detail beats three lines of politeness."],
    ],
    related: ["ways-to-thank-someone-who-is-always-there", "what-to-write-in-a-graduation-card"],
  },
  {
    slug: "what-to-write-in-a-birthday-card",
    tone: "celebration",
    title: "What to Write in a Birthday Card",
    meta: "Warm, non-cliché ideas for what to write in a birthday card, with lines for a friend, partner, family, or coworker, plus what to skip and small gestures that land.",
    h1: "What to write in a birthday card",
    begin: "Someone I care about has a birthday coming up",
    intro: [
      "A birthday card is a small chance to make someone feel truly seen, and most of us waste it on 'Happy Birthday!' plus a signature. One specific line will do more than a whole page of generic warmth.",
      "Here's what to write, what to skip, and how to make the card sound like it actually came from you.",
    ],
    matters: "A birthday reminds people they matter, and a card that names <em>why</em> they matter to you is the part they reread. Specificity is the whole game.",
    say: [
      ["“I'm so glad you were born, and so glad you're in my life.”", "Simple and direct. It says the quiet thing out loud, which most cards never do."],
      ["“The world got a lot better the day you showed up in it.”", "Warm without being sappy, and it works for almost anyone you love."],
      ["“Watching you go after that new job this year made me proud to know you.”", "Names one real thing from their year. This is what turns a card into something they keep."],
      ["“Here's to another year of you. I can't wait to see it.”", "Forward-looking and affectionate, good for a friend or partner."],
    ],
    avoid: [
      ["“Another year older!”", "The age joke is tired, and it makes the card about getting old instead of about them."],
      ["“Hope you have a great day!”", "It's fine, but it says nothing only you could say. Add one specific line and it comes alive."],
      ["“Sorry this is late!”", "Leading with the apology makes the card about you. A warm late note still lands, so just write the warm part."],
    ],
    gestures: [
      ["Name a specific memory", "Recall one moment from your year together. It tells them you actually remember, not just that you remembered the date."],
      ["Say what you'd miss", "A single line about what the world would be like without them is quietly powerful, and rare."],
      ["Make plans, not just wishes", "Offer a real date to celebrate, like dinner next week. A plan is a gift that says the card was only the start."],
      ["Write it by hand", "Even three handwritten lines beat a typed paragraph. The effort is the message."],
    ],
    sections: [
      {
        h: "What to write based on who they are",
        rows: [
          ["A close friend", "Get specific and a little bold. Name an inside joke or a moment from this year, then tell them plainly what their friendship means to you. This is the one place gushing is welcome."],
          ["A partner", "Go beyond romance into gratitude. Name something they did this year that you admired, and be tender about the ordinary life you share. Specific beats grand."],
          ["A family member", "Reach for warmth and history. A memory from years back, or a line naming a trait you've always loved in them, lands deeper than any generic wish."],
          ["A coworker or someone you don't know well", "Keep it warm but light. One genuine, specific compliment about working with them beats a formal 'best wishes,' and never feels like too much."],
        ],
      },
    ],
    followUp: "The card is the opening, not the whole gift. Actually follow through on the plan you offered, or send a text on the day itself so the warmth reaches them twice.",
    faq: [
      ["What do you write in a birthday card?", "Skip 'Happy Birthday' plus a signature and add one specific line: a memory, something you admire about them, or what they mean to you. Specificity is what makes it land."],
      ["What is a good short birthday message?", "Try 'I'm so glad you were born, and so glad you're in my life.' Short, warm, and more personal than the usual wishes."],
      ["What should you not write in a birthday card?", "Skip tired age jokes like 'another year older,' generic lines like 'hope you have a great day,' and leading with 'sorry this is late.'"],
      ["What can I write in a birthday card for a coworker?", "Keep it warm but light: one genuine, specific compliment about working with them. It feels personal without being too much."],
      ["How do you make a birthday card feel personal?", "Name one real thing: a shared memory, a trait you love, or something they did this year. One specific detail beats a page of general warmth."],
      ["What do you write in a birthday card for someone you don't know well?", "A short, sincere line works best. Wish them a good year ahead and add one small, honest compliment rather than trying to sound close."],
    ],
    related: ["what-to-write-in-a-milestone-birthday-card", "what-to-write-in-an-anniversary-card"],
  },
  {
    slug: "what-to-say-to-someone-who-is-sick",
    tone: "hard",
    gesturesHeading: "Ways to actually help",
    title: "What to Say to Someone Who Is Sick That Actually Helps",
    meta: "What to say to someone who is sick: honest get well messages, what to write in a get well card, what to avoid, and real ways to help beyond good wishes.",
    h1: "What to say to someone who is sick",
    begin: "Someone I care about is seriously ill",
    intro: [
      "When someone gets sick, most people freeze. They fall back on either forced cheer or a vague offer to help, and both land oddly because they put the work back on the person who is already exhausted. What actually helps is steadiness, a little normalcy, and specific offers they can say yes to.",
      "Here is what to say, what to write in a card, what to steer clear of, and how to keep showing up once the first wave of attention fades.",
    ],
    matters: "They are managing appointments, uncertainty, and other people's worry, often while feeling terrible. What they need from you is not to be fixed. They need to feel like a person, not a patient, and to know your support is real and not just words.",
    say: [
      ["“I'm sorry you're dealing with this. I'm here, and I'm not going anywhere.”", "It is honest, it makes no promises about the outcome, and it offers presence."],
      ["“Can I drop off dinner Thursday, or would earlier in the week be better?”", "A concrete offer with a choice is far easier to accept than a blank one."],
      ["“No need to reply. Just thinking of you and wanted you to know.”", "A get well message that expects nothing back is a gift when replying feels like a chore."],
      ["“Do you want to talk about how you're feeling, or would a normal chat be a relief right now?”", "Letting them set the register hands back a little control."],
    ],
    avoid: [
      ["“Let me know if you need anything.”", "It sounds kind but puts the burden on them to ask. Offer something specific instead."],
      ["“You'll be fine, stay positive!”", "Forced optimism can make it hard for them to admit they are scared or worn down."],
      ["“Have you tried [supplement or diet]?”", "Unsolicited health advice is tiring and can feel like you are blaming them."],
    ],
    gestures: [
      ["Bring food that reheats well", "Drop off a meal they can freeze or warm up later. No visit required, no reply expected."],
      ["Handle one dull errand", "Groceries, a prescription pickup, a load of laundry. Removing one chore lifts a real weight."],
      ["Send a short note by mail", "A card or a few lines they can hold onto lands differently than another text in the pile."],
      ["Text like normal", "Send the meme, the news, the small update about your day. Being treated as themselves is a relief."],
    ],
    sections: [
      {
        h: "What to say based on your relationship",
        rows: [
          ["A close friend", "Be direct and warm. Say you're scared for them too if that's true, then show up with specific help and normal conversation, not just serious check-ins."],
          ["A family member", "Lean on shared history. Offer the practical things family can quietly handle, rides, meals, watching the kids, without waiting to be asked."],
          ["A coworker or acquaintance", "Keep it brief and low-pressure. A short note that you're thinking of them and a small concrete offer is plenty. Don't pry into details they haven't shared."],
          ["Someone with a chronic or long-term illness", "Skip the get well soon framing, since there may be no soon. Acknowledge the reality, keep treating them normally, and stay steady over months, not just at the start."],
        ],
      },
    ],
    followUp: "Attention pours in when someone first gets sick and thins out fast, right as the long, dull stretch of being unwell sets in. That middle is the hardest part. Put a reminder in your phone to check in every couple of weeks. Showing up when everyone else has moved on is the whole point.",
    faq: [
      ["What do you say to someone who is sick?", "Something honest and steady: that you're sorry they're going through it, that you're there, and one specific offer of help they can easily accept."],
      ["What should you write in a get well card?", "Keep it warm and short. Say you're thinking of them, that they don't need to reply, and offer one concrete thing you'll do, like dropping off a meal."],
      ["What should you not say to someone who is sick?", "Avoid forced positivity, scary stories about others, unsolicited health advice, and the vague let me know if you need anything."],
      ["What is a good short get well message?", "Try: I'm sorry you're dealing with this, I'm thinking of you, and no need to reply. It's warm, honest, and asks nothing of them."],
      ["How do you comfort someone with a chronic illness?", "Drop the get well soon framing, acknowledge that it's ongoing, keep treating them like themselves, and stay in touch consistently over the long haul."],
      ["Is it okay to just send a text when someone is sick?", "Yes. A short, kind text that expects no reply is often exactly right. Pair it with a specific offer if you can help in person."],
    ],
    related: ["comforting-words-for-a-cancer-diagnosis", "how-to-help-a-friend-with-cancer", "what-to-say-to-someone-having-a-hard-week"],
  },
  {
    slug: "what-to-say-to-a-grieving-coworker",
    tone: "hard",
    gesturesHeading: "Ways to help that fit a workplace",
    title: "What to Say to a Grieving Coworker",
    meta: "What to say to a coworker who lost a loved one, from a first acknowledgment to their return to work, plus what to avoid and specific ways to help.",
    h1: "What to say to a grieving coworker",
    begin: "A coworker just lost a loved one",
    intro: [
      "Grief at work is genuinely awkward, and the fear of overstepping makes a lot of people say nothing at all. But a coworker who gets silence from the desk beside them just feels more alone. A short, sincere acknowledgment is almost always the right call, even if it feels small.",
      "You don't need to be their closest friend to say something kind. Here is how to acknowledge it, what to avoid, and how to help in ways that actually fit a workplace.",
    ],
    matters: "At work, people often worry that mentioning a loss will make it worse. It won't. What lands as cold is pretending nothing happened. A brief, warm acknowledgment tells them they can be a whole person here, not just a role.",
    say: [
      ["“I was so sorry to hear about your loss. I'm thinking of you.”", "Simple and sincere is enough. You don't need to say more than this."],
      ["“Please don't worry about the Thursday report, I've got it covered.”", "At work, taking a real task off their plate says more than any card."],
      ["“No need to reply. Just wanted you to know I'm thinking of you.”", "Give them an easy out so your kindness doesn't become one more thing to answer."],
      ["“It's good to have you back. Go at your own pace, and I'm around if you need anything picked up.”", "For when they return, this names the moment without making it heavy."],
    ],
    avoid: [
      ["“Let me know if you need anything.”", "It sounds kind but is especially empty at work, where they won't ask. Offer to cover something specific instead."],
      ["“At least you got to say goodbye.”", "Any sentence that starts with 'at least' tends to minimize what they're feeling."],
      ["“How are you holding up?” asked loudly at their desk", "Save real check-ins for a private moment. A public spotlight can force them to perform being okay."],
    ],
    gestures: [
      ["Cover their work quietly", "Pick up a deadline or field their inbox without making them ask or manage it."],
      ["Organize a group card or meal fund", "One person collects, so the team's care arrives as a single warm gesture, not ten separate asks."],
      ["Protect their space on return", "Give a heads-up to others so they're not ambushed with questions, and shield their first day back."],
      ["Handle the small logistics", "Reschedule the meetings they were leading and let clients know, so they don't return to a pileup."],
    ],
    sections: [
      {
        h: "What to say based on your role",
        rows: [
          ["If you're their manager", "Lead with the person, not the workload: “Take the time you need, and don't worry about work right now, we've got it handled.” Then actually cover it so those words are true. Be clear about leave so they aren't guessing."],
          ["If you're a close work friend", "You can be warmer and more direct: “I'm so sorry. I'm here for the work stuff and the non-work stuff, whichever you need.” Follow up privately, not just in the office."],
          ["If you're on their team but not close", "A brief, sincere note is welcome and enough: “I was sorry to hear your news. Thinking of you.” You don't need a relationship to offer basic kindness."],
          ["When they first return to work", "Acknowledge it once, simply, then follow their lead: “Good to see you. No pressure to talk about anything.” Don't over-fuss and don't pretend it never happened."],
        ],
      },
    ],
    followUp: "Grief doesn't end when someone comes back to work. Weeks later, when the team has moved on, they may still be in it. A quiet check-in a month out means a lot, and remembering the hard dates, the anniversary, the birthday, the first holiday, shows a kind of care most coworkers never offer.",
    faq: [
      ["What do you say to a coworker who lost a loved one?", "Keep it short and sincere: “I was so sorry to hear about your loss, I'm thinking of you.” Then offer to cover a specific task rather than a vague 'let me know if you need anything.'"],
      ["What do you say to a colleague whose parent died?", "A brief, warm acknowledgment is enough, even if you aren't close: “I'm so sorry about your dad. Thinking of you.” If you can, take something concrete off their plate at work."],
      ["Should you say anything to a grieving coworker or leave them alone?", "Say something. Silence reads as cold or indifferent, not respectful. A short acknowledgment lets them know they can be human at work, and you can still give them space afterward."],
      ["What do you say when a coworker returns to work after a death?", "Acknowledge it once, simply: “It's good to have you back, go at your own pace.” Then follow their lead. Don't over-fuss, and don't act like nothing happened."],
      ["Is it appropriate to send a sympathy card to a coworker?", "Yes. A group card the team signs, or a short handwritten note, is a fitting workplace gesture. Keep the message simple and sincere rather than trying to fix anything."],
      ["What should you not say to a grieving coworker?", "Avoid 'at least' phrases, silver linings, and the empty 'let me know if you need anything.' At work especially, offer specific help instead of putting the work of asking on them."],
    ],
    related: ["what-to-say-when-someone-loses-a-parent", "ways-to-help-a-grieving-friend"],
  },
  {
    slug: "what-to-say-to-someone-going-through-a-breakup",
    tone: "hard",
    title: "What to Say to Someone Going Through a Breakup",
    meta: "What to say to a friend going through a breakup: comforting words that validate the loss, what to text, what to avoid, and steady ways to help without ex-bashing or pep talks.",
    h1: "What to say to someone going through a breakup",
    begin: "A friend just went through a breakup",
    intro: [
      "A breakup is a real grief the world loves to shrug off. Everyone says there are plenty of fish, as if losing a person you built a life around is a minor inconvenience.",
      "Your friend doesn't need cheering up or a dating app. They need someone who treats this loss like it counts, because it does.",
    ],
    matters: "The hardest part is often feeling like they're not <em>allowed</em> to be this sad over someone they're no longer with. When you take the loss seriously, you give them permission to actually feel it instead of performing that they're fine.",
    say: [
      ["“This is a real loss, and I'm so sorry. You get to be sad about it for as long as you need.”", "Validates the grief instead of rushing them past it."],
      ["“You don't have to be okay right now. I'm not going anywhere.”", "Takes the pressure off having to bounce back on anyone's timeline."],
      ["“Tell me about them, or tell me about your day. Either way I'm here.”", "Lets them set the depth instead of forcing a heavy conversation."],
      ["“Want company tonight, or want me to just keep you distracted?”", "Offers presence two ways so they can pick what they can handle."],
    ],
    avoid: [
      ["“You're better off without them.”", "Even if it's true, they may not feel it yet, and it can make them defend the relationship instead."],
      ["“There are plenty of other people out there.”", "Rushes them toward the next thing before they've grieved this one."],
      ["“I never liked them anyway.”", "If they reconcile, you become the person who trashed their partner. Follow their lead."],
    ],
    gestures: [
      ["Show up with a distraction", "Bring food, a movie, a walk. Ordinary company beats a big talk when they're raw."],
      ["Handle a small logistics knot", "Offer to help untangle the shared streaming account, the returned key, the split-up plans."],
      ["Text without needing a reply", "A simple 'thinking of you today' with no question attached lets them feel seen without owing you a response."],
      ["Keep the invitations coming", "Newly single friends quietly drop off group plans. A standing invite says they still belong."],
    ],
    sections: [
      {
        h: "What to say depending on the situation",
        rows: [
          ["If it's fresh and raw", "Skip advice entirely. 'I'm so sorry, I'm right here' is enough for the first few days."],
          ["If they were the one dumped", "Guard against the shame spiral: 'This says nothing about how lovable you are.'"],
          ["If they ended it but still hurt", "Name that leaving can grieve too: 'Choosing it doesn't mean it stopped hurting.'"],
          ["If it was long-term or they lived together", "Treat it like the major life upheaval it is, not a simple split: 'You're rebuilding your whole daily life. That's huge.'"],
          ["If you never liked the ex", "Keep it to yourself for now. 'However you feel about them, I'm on your side' beats 'good riddance.'"],
        ],
      },
    ],
    followUp: "Support floods in the first week, then everyone assumes they're over it. The quiet weeks later, when the distraction fades and the empty apartment sets in, are often the hardest. Circle back then with a simple 'how are you really doing.'",
    faq: [
      ["What do you say to someone going through a breakup?", "Validate that it's a real loss and stay present: 'This is hard, you get to be sad, and I'm here.' Skip the pep talks and the ex-bashing."],
      ["What do you text someone going through a breakup?", "Keep it warm and low-pressure: 'Thinking of you today, no need to reply. Here whenever you want company.'"],
      ["How do you comfort someone after a breakup?", "Take the loss seriously, let them feel it without a timeline, and offer ordinary company. Presence helps more than advice."],
      ["Should I say bad things about their ex?", "No. It can make them defend the relationship, and if they get back together you become the one who trashed their partner. Follow their lead."],
      ["What not to say to someone going through a breakup?", "Avoid 'plenty of fish,' 'you're better off,' and 'you'll find someone else.' They rush the grief instead of honoring it."],
      ["How do you support a friend after a long-term breakup?", "Treat it as a full life upheaval. They're rebuilding daily routines and a shared home, so help with logistics and keep including them in plans."],
    ],
    related: ["what-to-say-to-someone-going-through-a-divorce", "what-to-say-to-someone-having-a-hard-week"],
  },
  {
    slug: "how-to-support-a-friend-from-far-away",
    tone: "hard",
    gesturesHeading: "Ways to help from afar",
    title: "How to Support a Friend From Far Away",
    meta: "When you can't be there in person, presence is about consistency, not proximity. How to support a grieving, sick, or struggling friend from another city, with help that arrives at their door.",
    h1: "How to support a friend from far away",
    begin: "A friend is struggling and you live far away",
    intro: [
      "Distance makes you feel useless. Someone you love is grieving or sick or falling apart, and you are hundreds of miles away, replaying how much better you'd be if you could just show up at their door. The guilt is real, and it is also a little bit of a trap, because it keeps you focused on the one thing you can't do instead of the many things you can.",
      "Presence was never really about proximity. It is about consistency and thoughtfulness, and those travel just fine. Here is how to show up in a way your friend actually feels, from wherever you are.",
    ],
    matters: "The people who live near your friend will fade as the weeks pass and life pulls them back. Distance can make you the one who <em>stays</em>, the steady voice that keeps checking in long after the crisis stops being news. That consistency is worth more than any single visit.",
    say: [
      ["“I can't be there in person, so I'm here on the phone every Sunday until this eases up. Pick up or don't, I'll keep calling.”", "Turns distance into a standing promise instead of an apology."],
      ["“I know I'm far. Tell me one thing I can handle from here and I'll do it today.”", "Offers concrete remote help instead of helpless sympathy."],
      ["“No need to reply. Just wanted you to know I'm thinking about you today.”", "Reaches across the distance without adding a task."],
      ["“Who is with you right now? I want to send them something to give you.”", "Uses a local person as your hands on the ground."],
    ],
    avoid: [
      ["“I wish I was there.”", "It centers your feelings and leaves them with nothing. Send help instead of a wish."],
      ["“Call me if you need anything.”", "From far away this is even emptier. They won't call. Offer something specific."],
      ["Going quiet because you feel too far to matter", "Silence reads as absence. A short text from a distance still lands."],
    ],
    gestures: [
      ["Send food to their door", "A meal-delivery gift card or a grocery gift card means dinner shows up without them lifting a finger."],
      ["Mail something they can hold", "A real letter or a care package outlasts a text and says you spent time, not just seconds."],
      ["Organize the friends who are close", "Coordinate the local people into a rota for meals, rides, and check-ins so nobody has to ask."],
      ["Take one online task off their plate", "Handle a form, a bill, a return, or a phone call they've been dreading, all from your own screen."],
    ],
    sections: [
      {
        h: "How to help from a distance",
        rows: [
          ["When someone local can be your hands", "Find one person near your friend and coordinate through them. You can fund a meal, plan a visit, or send flowers, and they deliver it in person on your behalf."],
          ["Sending help that arrives at their door", "Default to help that needs no decision from your friend. A meal-delivery gift card, a grocery card, a cleaning service, or a care package all land without them managing anything."],
          ["Staying present between visits", "Set a standing call or text at the same time each week so your check-in becomes something they can count on rather than something you have to remember."],
          ["If you can travel for the hardest moments", "Save your trip for when it matters most, a diagnosis, a funeral, a first week alone. Ask what would help before you book, and don't expect to be hosted once you arrive."],
        ],
      },
    ],
    followUp: "The hardest part of loving someone from far away is that you don't see the bad days, so you have to remember them on purpose. Put the anniversary, the surgery date, and the quiet weeks after the crowd leaves in your calendar now, and let a message arrive on the days you can't.",
    faq: [
      ["How do you support someone from far away?", "Trade the visit you can't make for consistency you can. Send help that arrives at their door, set a standing weekly call, and coordinate the friends who live nearby to be your hands."],
      ["How can I help a grieving friend long distance?", "Send ready-to-eat food or a meal-delivery gift card so they don't have to cook, mail a real letter, and keep checking in for months, not days. Distance lets you be the one who stays after the local crowd fades."],
      ["How do I be there for someone when I can't be there physically?", "Presence is consistency, not proximity. Pick a regular time to reach out, take a concrete task off their plate remotely, and remember the hard dates even though you won't see them arrive."],
      ["What can I send a friend who is sick or grieving far away?", "Send something that requires no effort from them: a meal-delivery or grocery gift card, a cleaning service, or a care package with easy food and comfort items. A handwritten letter alongside it lasts far longer than a text."],
      ["How do I stop feeling guilty for not being there?", "The guilt keeps you fixed on the one thing you can't do. Redirect it into the many you can, and let concrete remote help replace 'I wish I was there.' Showing up steadily from afar matters more than a single visit."],
      ["Should I travel to see a friend in crisis?", "If you can, save the trip for the moments that matter most and ask what would actually help before you book. Between visits, your consistency from a distance is what carries them."],
    ],
    related: ["ways-to-help-a-grieving-friend", "how-to-help-a-friend-with-cancer"],
  },
  {
    slug: "what-to-write-in-a-baby-shower-card",
    tone: "celebration",
    gesturesHeading: "Small ways to celebrate them",
    title: "What to Write in a Baby Shower Card",
    meta: "Warm, non-cliché things to write in a baby shower card: messages for the parent-to-be, what to avoid, and gentle notes for those who took a hard road to get here.",
    h1: "What to write in a baby shower card",
    begin: "Someone I love is having a baby shower",
    intro: [
      "A baby shower is all anticipation. The baby is not here yet, and the person you are celebrating is standing on the edge of a huge change, thrilled and a little nervous all at once. A note that speaks to <em>them</em> lands far better than one more generic 'congrats.'",
      "Here's what to write, what to skip, and how to celebrate the parent they are becoming.",
    ],
    matters: "Shower cards default to congratulating the baby that has not arrived yet. The ones people keep speak to the parent-to-be, their excitement, their nerves, and the fact that they are already loved and not alone in this.",
    say: [
      ["“I cannot wait to meet this little one, and I cannot wait to watch you become a mom.”", "Celebrates the baby and the person becoming a parent."],
      ["“You are going to be so good at this. I already see it in you.”", "Speaks to the nerves under the excitement."],
      ["“So much love is waiting for this baby, and it starts with you.”", "Warm and specific, no cliché."],
      ["“Whatever you need in these early days, I am in. Just say the word.”", "Turns a card into a real offer of help."],
    ],
    avoid: [
      ["“Say goodbye to sleep!”", "It is every card, and it greets good news with a warning."],
      ["“You have no idea what you are in for.”", "Meant as a joke, but it can land as fear."],
      ["“When are you having the next one?”", "Let them arrive at this one first."],
    ],
    gestures: [
      ["Offer a specific hand", "Not 'let me know if you need anything,' but 'I will bring dinner the first week.'"],
      ["Give something for the parent", "A cozy robe or a favorite treat, so the grown-up gets looked after too."],
      ["Write down a promise", "Note one thing you will do after the baby comes, then actually do it."],
      ["Share a small piece of wisdom", "One honest, kind line about parenthood from your own life, if you have it to give."],
    ],
    sections: [
      {
        h: "What to write depending on who they are",
        rows: [
          ["A close friend", "Be personal and a little emotional. You get to say how much this moment means to you and how sure you are that they are ready."],
          ["Your sister or family", "Lean on shared history. A memory of them, or a nod to the family this baby is joining, means the world."],
          ["A coworker", "Warm but lighter. Congratulate them, wish them an easy stretch ahead, and say the team is genuinely happy for them."],
          ["A first-time parent", "Reassure more than you tease. They are excited and nervous. Tell them plainly that they are going to be wonderful and that you are in their corner."],
          ["Someone who waited a long time or came through loss", "Go gentle and glad. Skip the jokes about the road ahead. Something like 'This little one is so lucky, and so are we to be here for it' honors the weight without naming the pain unless they have."],
        ],
      },
    ],
    followUp: "The shower ends, but the moment that matters most is still coming. Stay close through the last stretch of pregnancy and the birth, and be the person who shows up in the blurry newborn weeks with food, a check-in, and a simple 'how are <em>you</em> doing?'",
    faq: [
      ["What do you write in a baby shower card?", "A warm, specific line that celebrates the coming baby and speaks to the parent-to-be, their excitement, their nerves, and how ready they are."],
      ["What is a short baby shower message?", "Try 'So happy for you and this little one on the way.' Short and heartfelt beats long and generic."],
      ["What should you not write in a baby shower card?", "Skip 'say goodbye to sleep' and 'you have no idea what you are in for.' They greet good news with a warning."],
      ["What do you write in a baby shower card for a first-time parent?", "Reassure them. Something like 'You are going to be a natural, and I am here for whatever you need' calms the nerves under the excitement."],
      ["What do you say to someone who had a hard road to this pregnancy?", "Be gentle and glad, and skip the jokes. 'This baby is so loved already, and so are you' honors the journey without naming the hard parts unless they do."],
      ["Is a baby shower card different from a new baby card?", "Yes. A shower card is written before the baby arrives and celebrates the parent-to-be, while a new baby card comes after the birth and welcomes the baby who is here."],
    ],
    related: ["what-to-write-in-a-new-baby-card", "how-to-help-new-parents"],
  },
  {
    slug: "what-to-write-in-a-housewarming-card",
    tone: "celebration",
    gesturesHeading: "Ways to welcome them home",
    title: "What to Write in a Housewarming Card",
    meta: "Warm, non-cliché things to write in a housewarming card: new home messages for friends and family, what to avoid, and thoughtful ways to welcome them to the neighborhood.",
    h1: "What to write in a housewarming card",
    begin: "Someone I care about just moved into a new home",
    intro: [
      "It's easy to reach for “congrats on the new place” and leave it there. But a house isn't really about the square footage or the closing paperwork. It's about the life that's going to happen inside it, and a card that says so will mean far more.",
      "Here's what to write to someone settling into a new home, what to skip, and a few ways to make their first weeks feel more welcome.",
    ],
    matters: "A new home is a fresh start, and often a tiring, slightly lonely one too. The warmest notes look past the walls to <em>them</em>: the mornings, the dinners, and the quiet evenings they'll get to have here.",
    say: [
      ["“Wishing you a home full of good mornings, long dinners, and the kind of nights you never want to end.”", "Naming the ordinary life ahead beats a generic congratulations on the building itself."],
      ["“I can't wait to see what you do with the place, and to be there for a meal once the boxes are gone.”", "It celebrates them and quietly promises you'll show up, which is half of what a home is for."],
      ["“May this be the house where your best memories happen.”", "A wish for the memories they'll make lands warmer than praise for the property."],
      ["“So happy for you both. Every corner of this place is going to feel like you soon.”", "It acknowledges the newness with faith that it will become theirs, which is exactly the reassurance a big move needs."],
    ],
    avoid: [
      ["“Hope you can afford it!”", "Even as a joke, money cracks about a home land as pressure, not celebration."],
      ["“Now the real work begins.”", "Leading with the chores ahead deflates a moment that's meant to feel hopeful."],
      ["A signature and nothing else", "For someone you care about, a blank card reads like you mailed it in."],
    ],
    gestures: [
      ["Give something the home will actually use", "A good dish towel set, a plant, or a nice bottle for the first night becomes part of the place instead of clutter."],
      ["Bring a meal during moving week", "The kitchen is the last thing unpacked. A home-cooked dinner dropped off in the chaos is a kindness they won't forget."],
      ["Offer your hands, not just your words", "Showing up to carry boxes, build furniture, or hang a few things says more than any card can."],
      ["Welcome them to the area", "If you know the neighborhood, a short list of your favorite coffee shop, park, and takeout spot helps a new place start to feel like home."],
    ],
    sections: [
      {
        h: "What to write depending on who they are",
        rows: [
          ["A close friend", "Be personal and a little excited. Picture yourself in their new space: “Cannot wait to be a regular on that couch.” Warmth over formality."],
          ["Family", "You can be tender and proud. Name what this milestone means: “Watching you build a place of your own is one of my favorite things.”"],
          ["A couple's first home together", "Celebrate the two of them, not just the address. Wish them the everyday life they'll share there, the ordinary Tuesdays as much as the milestones."],
          ["A first-time homeowner", "Honor the size of it. Buying a first home is huge and a bit scary. Reassure them: “You earned this, and it's going to feel like yours before you know it.”"],
          ["Someone who moved far away", "Acknowledge the distance with love, not guilt. Tell them you're proud and that the door swings both ways: “A new adventure for you, and a place I already can't wait to visit.”"],
        ],
      },
    ],
    followUp: "The excitement of a move fades fast, and a half-unpacked house in an unfamiliar place can feel quiet and lonely. A text a few weeks later, asking how it's settling in or when you can come see it, tells them the welcome wasn't just for moving day.",
    faq: [
      ["What do you write in a housewarming card?", "Write something specific to them and the life they'll live there. Wish them good memories in the new place and, if you can, offer to help or to visit once they're settled."],
      ["What should you not write in a housewarming card?", "Skip money jokes like “hope you can afford it,” lines about all the work ahead, and leaving just a signature. Keep it hopeful, not daunting."],
      ["What's a short housewarming message?", "“So happy for you. Wishing you a home full of good memories.” Short is fine as long as it's warm and sounds like you."],
      ["What do you say for a first home?", "Honor how big it is. Try: “Your very first home. You earned this, and it's going to feel like yours in no time.” A little pride goes a long way."],
      ["How do you congratulate someone on a new house?", "Look past the house to the life in it: “Congratulations. May this be the place where your best days happen.” Specific and warm beats a plain “congrats.”"],
      ["Is it okay to give money in a housewarming card?", "Yes, and it's often welcome after the expense of a move. A short warm note alongside it keeps the gesture personal rather than transactional."],
    ],
    related: ["what-to-write-in-a-wedding-card", "what-to-write-in-a-new-baby-card"],
  },
  {
    slug: "what-to-say-to-a-caregiver",
    tone: "hard",
    gesturesHeading: "Ways to actually help",
    title: "What to Say to a Caregiver Who Feels Invisible",
    meta: "What to say to a caregiver looking after a sick or aging loved one, how to see them as a person and not a saint, plus real relief to offer and what to avoid.",
    h1: "What to say to a caregiver",
    begin: "Someone I know is caring for a sick or aging loved one",
    intro: [
      "Everyone asks how the patient is doing, and almost no one asks how the caregiver is holding up. The person doing the caring often becomes invisible, running on empty while the world checks on someone else.",
      "The most powerful thing you can do is see <em>them</em>, the caregiver, as a person who is also struggling, and then hand them real relief instead of praise.",
    ],
    matters: "Caregiving is quiet, relentless, and lonely, and calling someone a saint can make it worse, because saints aren't allowed to be tired or resentful or scared. Being seen as a whole person, and getting one real thing taken off their plate, is what actually helps.",
    say: [
      ["“How are you doing, really? Not the patient. You.”", "Turning the question toward them says they still count as a person."],
      ["“I'm coming Saturday to sit with your mom so you can leave the house.”", "A named, concrete break is worth more than any offer to help someday."],
      ["“This is hard, and you're allowed to hate it some days.”", "Permission to feel the ugly parts breaks the saint script that isolates them."],
      ["“I'm bringing dinner Thursday. Just tell me the gate code.”", "Removes the decision and the coordination, not just the cooking."],
    ],
    avoid: [
      ["“You're a saint, I could never do it.”", "It sounds kind but it isolates them and shuts down honest feelings."],
      ["“Let me know if you need anything.”", "They are too depleted to assign you tasks. Offer one specific thing instead."],
      ["“At least they still know who you are.”", "Silver linings dismiss the grief they are living every day."],
    ],
    gestures: [
      ["Give them an actual break", "Sit with their loved one for a few hours so they can sleep, walk, or just leave."],
      ["Feed them without asking", "Drop off a meal on a set day. Make it something reheatable so nothing is wasted."],
      ["Ask about their life", "Their job, their kids, a show they used to love. Remind them they exist outside the caregiving."],
      ["Take an errand off their list", "Grab the groceries, pick up the prescription, handle the one call they keep dreading."],
    ],
    sections: [
      {
        h: "What to say based on your relationship to them",
        rows: [
          ["A close friend caring for a parent", "“I've got Saturday afternoons. Standing offer, no need to ask.” Give them a repeating slot they can lean on without guilt."],
          ["A coworker stretched thin", "“I can cover the Monday report so you can breathe.” Take real weight off at work instead of just saying you understand."],
          ["A family member sharing the load", "“What is actually on you right now, and what can I take?” Split the invisible tasks, not just the visible ones."],
          ["Someone long into caregiving", "“You've been carrying this a long time. I'm still here, and I still see it.” The ones deep in it are the most forgotten, so name that you haven't moved on."],
        ],
      },
    ],
    followUp: "Caregiving is a marathon, and support fades fast while the work never does. Months in, the caregiver often disappears from everyone's radar. Set a recurring reminder to check on them, not the patient, long after the casseroles stop coming.",
    faq: [
      ["What do you say to a caregiver who is burned out?", "Ask how they are as a person, name that it's hard, and offer one concrete break like sitting with their loved one so they can rest. Praise alone can feel isolating."],
      ["Why does telling a caregiver they're a saint feel bad?", "It puts them on a pedestal where they aren't allowed to be tired, angry, or scared, and it can make them feel more alone. See them as a whole person instead."],
      ["What is the best practical help for a caregiver?", "Give them time off by sitting with the person they care for, bring reheatable meals on a set schedule, and take a recurring errand or chore fully off their plate."],
      ["How do I support a caregiver over the long term?", "Keep checking in on them specifically, long after the crisis, since support fades but the caregiving does not. Put reminders in your calendar every week or two."],
      ["What should I not say to a caregiver?", "Skip “let me know if you need anything,” silver linings like “at least,” and saint language. Offer something specific and ask about their own life."],
    ],
    related: ["how-to-help-a-friend-with-cancer", "what-to-say-to-someone-having-a-hard-week"],
  },
];

const GUIDE_BY_SLUG = Object.fromEntries(GUIDES.map((g) => [g.slug, g]));

// ---- TC-176: situation pillar pages ----
// Each pillar is a rankable hub for a head-term cluster ("sympathy messages", "celebration wishes")
// that also concentrates internal-link authority: hub → pillar → leaf, and every leaf links back up.
// Pillars are keyed by the guide `tone` so new matrix pages join their pillar automatically.
const PILLARS = [
  {
    slug: "sympathy",
    tone: "hard",
    crumb: "Sympathy & support",
    linkLabel: "All sympathy & support guides",
    title: "Sympathy & Support: What to Say in Life's Hardest Moments",
    h1: "What to say when someone is going through something hard",
    meta: "A calm library of what to say and do when someone you love is grieving, sick, or struggling: honest words, what to avoid, and how to keep showing up.",
    intro: "When someone you care about is hurting, the fear of saying the wrong thing can freeze you into saying nothing, and silence is the one thing that hurts most. These guides give you honest, specific words for the hardest moments, the things to avoid, and the small gestures that carry more than any card.",
  },
  {
    slug: "celebrations",
    tone: "celebration",
    crumb: "Celebrations & milestones",
    linkLabel: "All celebration & milestone guides",
    title: "Celebrations & Milestones: What to Write and Say",
    h1: "What to write and say for life's happy milestones",
    meta: "Warm, non-cliché words for weddings, new babies, graduations, promotions, engagements and more: what to write, what to skip, and gestures that make the moment land.",
    intro: "The happy moments deserve more than a thumbs-up in the group chat. These guides help you mark weddings, babies, graduations, new jobs and other milestones with words that feel personal, not borrowed, and gestures that turn a passing 'congrats' into something they'll remember.",
  },
  {
    slug: "everyday",
    tone: "everyday",
    crumb: "Everyday moments",
    linkLabel: "All everyday-moment guides",
    title: "Everyday Kindness: Thank-Yous and Quiet Support",
    h1: "Words for the everyday moments that matter",
    meta: "Not every meaningful moment has a name. Here's how to thank the people who are always there and support someone through an ordinary hard week.",
    intro: "Some of the most meaningful moments have no occasion at all: thanking the person who quietly holds you up, or reaching out to someone worn down by an ordinary hard week. These guides help you show people they're seen, no card aisle required.",
  },
];
const PILLAR_BY_TONE = Object.fromEntries(PILLARS.map((p) => [p.tone, p]));

// Dense internal-linking mesh (TC-176): curated `related` first (editor's picks), then auto-fill with
// same-cluster guides up to a floor of 5, so every page ships a rich, on-topic link block that grows
// automatically as the matrix expands. De-duped, never self-links.
function relatedFor(g, floor = 5) {
  const out = [];
  const seen = new Set([g.slug]);
  for (const slug of g.related || []) {
    const r = GUIDE_BY_SLUG[slug];
    if (r && !seen.has(r.slug)) { out.push(r); seen.add(r.slug); }
  }
  for (const x of GUIDES) {
    if (out.length >= floor) break;
    if (x.tone === g.tone && !seen.has(x.slug)) { out.push(x); seen.add(x.slug); }
  }
  return out;
}

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
  const pillar = PILLAR_BY_TONE[g.tone];
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Guides", item: SITE + "/guides/" },
      ...(pillar ? [{ "@type": "ListItem", position: 3, name: pillar.crumb, item: `${SITE}/guides/${pillar.slug}/` }] : []),
      { "@type": "ListItem", position: pillar ? 4 : 3, name: g.title, item: url },
    ],
  };
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: g.title,
    description: g.meta,
    mainEntityOfPage: url,
    inLanguage: "en",
    datePublished: g.published || PUBLISHED,
    dateModified: BUILD_DATE,
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
    isPartOf: pillar ? { "@type": "CollectionPage", "@id": `${SITE}/guides/${pillar.slug}/#collection`, name: pillar.title } : undefined,
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
  // Optional depth sections (SEO: consolidate a query cluster — relationship / channel variants — into
  // ONE strong page as sections instead of thin separate pages). Backward-compatible: guides without
  // `sections` render unchanged. A section is either prose ({h,p}) or a labelled row list ({h,rows}).
  const sectionsHtml = (g.sections || []).map((s) => {
    if (s.rows) {
      const rows = s.rows.map(([line, note]) => `
      <div class="row">
        <div class="line">${line}</div>
        <div class="note">${note}</div>
      </div>`).join("");
      return `
    <h2>${esc(s.h)}</h2>${rows}`;
    }
    return `
    <h2>${esc(s.h)}</h2>
    <p>${s.p}</p>`;
  }).join("");
  const faqRows = g.faq.map(([q, a]) => `
      <div class="qa"><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join("");
  const related = relatedFor(g).map((r) => `
        <a class="rel" href="/guides/${r.slug}/">${r.h1}</a>`).join("");
  const pillarLink = pillar ? `
        <a class="rel rel-pillar" href="/guides/${pillar.slug}/">${pillar.linkLabel} →</a>` : "";
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
     seam reads as one brand, but STATIC (no blobs), a reading page stays calm (brand law #6: only the
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
  .rel-pillar{background:#e3f0f6;color:var(--blue-deep)}
  footer{padding:20px 0 50px;color:var(--soft);font-size:13px;text-align:center}
</style>
</head>
<body>
<div id="bg" aria-hidden="true"></div>
${TRACKER}
<div class="wrap">
  <header class="bar">
    <a class="brand" href="/">${MARK}Thoughts Count</a>
    <div class="crumbs"><a href="/">Home</a> › <a href="/guides/">Guides</a> › ${pillar ? `<a href="/guides/${pillar.slug}/">${esc(pillar.crumb)}</a> › ` : ""}${esc(g.h1)}</div>
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
${sectionsHtml}
    <h2>How to keep showing up</h2>
    <p>${g.followUp}</p>

${dellaCta}

    <h2>Common questions</h2>
    <div class="faq">${faqRows}</div>

    <div class="related">
      <h2>More guides</h2>${related}${pillarLink}
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
     seam reads as one brand, but STATIC (no blobs), a reading page stays calm (brand law #6: only the
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
  .pillars{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:22px 0 4px}
  .pillar-link{background:var(--cloud);border:1px solid var(--line);border-radius:999px;padding:9px 18px;text-decoration:none;color:var(--blue-deep);font-weight:600;font-size:14.5px;box-shadow:0 6px 18px rgba(64,52,34,.05)}
  .pillar-link:hover{border-color:var(--blue)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin:22px 0 40px}
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
  <div class="pillars">${PILLARS.map((p) => `<a class="pillar-link" href="/guides/${p.slug}/">${esc(p.crumb)}</a>`).join("")}</div>
  <div class="grid">${cards}</div>
  <footer>Thoughts Count: helping good intentions become meaningful actions.</footer>
</div>
</body>
</html>`;
}

function pillar(p) {
  const url = `${SITE}/guides/${p.slug}/`;
  const guides = GUIDES.filter((g) => g.tone === p.tone);
  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": url + "#collection",
    name: p.title,
    url,
    description: p.meta,
    isPartOf: { "@id": SITE + "/#website" },
    inLanguage: "en",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: guides.map((g, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/guides/${g.slug}/`, name: g.title })),
    },
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "Guides", item: SITE + "/guides/" },
      { "@type": "ListItem", position: 3, name: p.crumb, item: url },
    ],
  };
  const cards = guides.map((g) => `
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
<title>${esc(p.title)} | Thoughts Count</title>
<meta name="description" content="${esc(p.meta)}" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(p.title)}" />
<meta property="og:description" content="${esc(p.meta)}" />
<meta property="og:url" content="${url}" />
<meta property="og:site_name" content="Thoughts Count" />
<meta property="og:image" content="${SITE}/og.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${SITE}/og.png" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<script type="application/ld+json">${JSON.stringify(collectionLd)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  :root{--cloud:#fdfbf7;--paper:#f7f3ec;--ink:#2c2a26;--soft:#5a554c;--blue:#118ab9;--blue-deep:#0a5876;--red:#ef4136;--line:#e7ded0}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Hanken Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);line-height:1.7;background:var(--paper)}
  #bg{position:fixed;inset:0;z-index:-2;background:radial-gradient(130% 100% at 20% 10%, #f4e6dc 0%, #dfe9ee 45%, #b9d2de 78%, #8fb9cc 100%)}
  a{color:var(--blue)}
  h1,h2{font-family:'Hanken Grotesk',system-ui,sans-serif;font-weight:700;letter-spacing:-.01em}
  .wrap{max-width:900px;margin:0 auto;padding:0 22px}
  .bar{padding:20px 0}
  .brand{font-size:15px;font-weight:700;color:var(--blue);text-decoration:none;display:inline-flex;gap:9px;align-items:center;text-transform:uppercase;letter-spacing:.18em}
  .brand svg{width:22px;height:22px}
  .crumbs{font-size:13px;color:var(--soft);margin:8px 0 0}
  .crumbs a{color:var(--soft)}
  .hero{text-align:center;padding:22px 0 8px}
  .hero h1{font-size:clamp(27px,4.4vw,40px);margin:0 0 12px}
  .hero p{color:var(--soft);max-width:56ch;margin:0 auto;font-size:17px;line-height:1.7}
  .hcta{text-align:center;margin:22px 0 4px}
  .hcta a{display:inline-block;background:var(--red);color:#fff;text-decoration:none;padding:13px 30px;border-radius:999px;font-weight:700;font-size:16px;box-shadow:0 10px 30px rgba(64,52,34,.14)}
  .hcta .sub{display:block;font-size:13px;color:var(--soft);margin-top:9px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin:26px 0 26px}
  .card{background:var(--cloud);border:1px solid var(--line);border-radius:18px;padding:20px;text-decoration:none;color:var(--ink);box-shadow:0 10px 30px rgba(64,52,34,.05);transition:transform .12s}
  .card:hover{transform:translateY(-2px)}
  .card h2{font-size:19px;margin:8px 0 6px}
  .card p{color:var(--soft);font-size:14px;margin:0}
  .tag{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:3px 9px;border-radius:999px}
  .tag.hard{background:#e3f0f6;color:var(--blue-deep)}
  .tag.celebration{background:#fdeceb;color:var(--red)}
  .tag.everyday{background:#f1ebe1;color:var(--soft)}
  .allguides{text-align:center;margin:6px 0 40px;font-size:15px}
  footer{padding:20px 0 50px;color:var(--soft);font-size:13px;text-align:center}
</style>
</head>
<body>
<div id="bg" aria-hidden="true"></div>
${TRACKER}
<div class="wrap">
  <div class="bar"><a class="brand" href="/">${MARK}Thoughts Count</a>
  <div class="crumbs"><a href="/">Home</a> › <a href="/guides/">Guides</a> › ${esc(p.crumb)}</div></div>
  <div class="hero">
    <h1>${esc(p.h1)}</h1>
    <p>${esc(p.intro)}</p>
    <div class="hcta"><a href="/">Get a plan for your situation →</a><span class="sub">Free · no account needed · personal to your relationship</span></div>
  </div>
  <div class="grid">${cards}</div>
  <p class="allguides"><a href="/guides/">← Browse all guides</a></p>
  <footer>Thoughts Count: helping good intentions become meaningful actions.</footer>
</div>
</body>
</html>`;
}

function sitemap() {
  const urls = [
    { loc: SITE + "/", pri: "1.0" },
    { loc: SITE + "/guides/", pri: "0.8" },
    { loc: SITE + "/thoughts/", pri: "0.6" }, // TC-179 daily-thought hub (freshens daily)
    ...PILLARS.map((p) => ({ loc: `${SITE}/guides/${p.slug}/`, pri: "0.7" })),
    ...GUIDES.map((g) => ({ loc: `${SITE}/guides/${g.slug}/`, pri: "0.7" })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${BUILD_DATE}</lastmod><priority>${u.pri}</priority></url>`).join("\n")}
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
let np = 0;
for (const p of PILLARS) {
  const dir = join(ROOT, "public", "guides", p.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), pillar(p));
  np++;
}
writeFileSync(join(ROOT, "public", "sitemap.xml"), sitemap());
writeFileSync(join(ROOT, "public", "robots.txt"), robots);
console.log(`Wrote ${n} guide pages + hub + ${np} pillar pages + sitemap.xml + robots.txt`);
