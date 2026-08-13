# THOUGHTS COUNT — Rebrand Design System v2 (source of truth for TC-75 full rebrand)

**Direction:** Earthy-warm base + blue primary (`#118ab9`) + red heart accent (`#ef4136`), reconciled into ONE calm, premium, human visual language. Headspace warmth (illustration/iconography + soft palette) = the primary feel; Apple restraint (spacing, type, one-action-at-a-time) = the discipline; Airbnb card-led progressive disclosure = the structure.

**Core tension resolved:** blue is the *brand signal* (logo, hero panel, links, focus, functional icons, secondary actions). Red is the *single emotional accent* (the heart, the primary CTA). The **canvas everything sits on is warm** (warm off-white paper, warm ink, warm borders). We retire sage/terracotta as brand colors but keep their *temperature*.

Reference marks: `THOUGHTS COUNT_Brand Sheet.pdf` + `THOUGHTS COUNT_FINAL.pdf` (5 variants: lockup standard/reversed/black/all-white + app icon).

---

## 1. Color tokens
```css
:root {
  /* BRAND: blue (logo primary) */
  --tc-blue:        #118ab9;  /* primary brand, links, focus, hero panel */
  --tc-blue-hover:  #0f7ba4;
  --tc-blue-active: #0d6c91;
  --tc-blue-deep:   #0a5876;  /* headings-on-warm, deep accents, gradient anchor */
  --tc-blue-tint:   #e3f0f6;  /* soft blue wash: surfaces, selected, info bg */
  --tc-blue-tint-2: #f0f7fb;  /* faintest blue: alternating section wash */
  /* ACCENT: red heart */
  --tc-red:         #ef4136;  /* the heart, primary CTA "GET STARTED" */
  --tc-red-hover:   #e02f24;
  --tc-red-active:  #c9271d;
  --tc-red-tint:    #fdeceb;  /* faint red wash, rare */
  /* EARTHY WARM NEUTRALS (the canvas — warmth lives here) */
  --tc-paper:       #f7f3ec;  /* app background — warm off-white, NOT #fff */
  --tc-paper-2:     #f1ebe1;  /* recessed warm surface (inputs at rest, wells) */
  --tc-surface:     #fdfbf7;  /* cards/panels — warm near-white */
  --tc-surface-hi:  #ffffff;  /* pure white ONLY on-blue-panel cards / max lift */
  --tc-ink:         #2c2a26;  /* primary text — warm near-black */
  --tc-ink-soft:    #5a554c;  /* secondary text, subheads, captions */
  --tc-ink-mute:    #8a8377;  /* placeholder, meta, disabled */
  --tc-line:        #e7ded0;  /* warm hairline borders, dividers */
  --tc-line-strong: #d8cdba;  /* input borders */
  /* SEMANTIC (warm/muted, never neon) */
  --tc-success:     #4f9d7a;  --tc-success-tint: #e7f1ea;
  --tc-warn:        #cf8a3b;
  /* effects (shadows are WARM brown-alpha, never gray) */
  --tc-shadow-sm: 0 1px 2px rgba(64,52,34,.05), 0 2px 6px rgba(64,52,34,.05);
  --tc-shadow-md: 0 2px 8px rgba(64,52,34,.06), 0 14px 34px rgba(64,52,34,.08);
  --tc-shadow-lg: 0 8px 24px rgba(64,52,34,.08), 0 28px 60px rgba(64,52,34,.10);
  --tc-focus:     0 0 0 3px rgba(17,138,185,.35);
}
```
**Usage:** app bg = `--tc-paper` (never pure white). Cards = `--tc-surface` on paper (lift via warmth+shadow). Body = `--tc-ink`; secondary = `--tc-ink-soft`. Headings = `--tc-ink` default; `--tc-blue-deep` for brand-forward labels *sparingly* (don't paint every heading blue). Links = `--tc-blue`. Primary CTA = `--tc-red` fill/white ("GET STARTED", the ONE red action). Secondary = `--tc-blue`. Blue full-bleed panel = hero band. **Red is scarce** (heart + CTA + love-moments only; >2 reds/viewport = overused). Selected = `--tc-blue-tint` bg + `--tc-blue` border.
**AA contrast:** ink/paper 13.2:1 (AAA); ink-soft/paper 6.4:1 (AA); white/blue 3.7:1 → blue button labels ≥16px semibold; white/red 3.9:1 → CTA label ≥16px bold; small blue text on warm → use `--tc-blue-deep` (5.4:1).

## 2. Typography
Montserrat (Google) as Gotham stand-in. Weights 400/500/600/700. `--tc-font:'Montserrat',system-ui,-apple-system,'Segoe UI',sans-serif;`
**Warmth strategy:** Montserrat everywhere; warmth via color + spacing + illustration. Keep ONE reserved device — a warm italic in `'Fraunces',Georgia,serif` for a SINGLE emotional line per screen (pull-quote / example situation / Della's signature line), never for UI.

| Token | Size (clamp) | LH | Wt | Tracking | Use |
|---|---|---|---|---|---|
| --fs-display | clamp(38px,6vw,60px) | 1.05 | 700 | -0.01em | Hero H1 |
| --fs-h1 | clamp(30px,4vw,42px) | 1.12 | 700 | -0.01em | Page titles |
| --fs-h2 | clamp(24px,3vw,32px) | 1.18 | 700 | -0.005em | Section heads |
| --fs-h3 | 20px | 1.25 | 600 | 0 | Card titles, pillar labels |
| --fs-body-lg | 18px | 1.6 | 400 | 0 | Hero subhead, lead |
| --fs-body | 16px | 1.6 | 400 | 0 | Default body |
| --fs-small | 14px | 1.5 | 500 | 0 | Captions, meta, chips |
| --fs-eyebrow | 13px | 1.4 | 600 | 0.14em UPPER | Section eyebrows / brand labels |
| --fs-button | 16px | 1 | 700 | 0.02em | Button labels |
| --fs-tagline | 15px | 1.3 | 500 | 0.24em UPPER | "IT'S THE THOUGHT THAT COUNTS" |

**Logo kerning:** wordmark "THOUGHTS COUNT" = Montserrat 700 UPPERCASE `letter-spacing:0.32em`; tagline = 500 UPPERCASE `0.24em`. Body line-height 1.6 is a deliberate calm/warmth lever.

## 3. Background / hero
**KILL** the 6-cloud drifting green→blue gradient (`#bg .c1–.c6` + `drift*` keyframes) — remove entirely. NEW:
- Global canvas = flat `--tc-paper`. No animation behind content.
- **Hero = a blue panel** (signature move, ties to reversed lockup + app icon): `background:linear-gradient(165deg,#1595c6 0%,#118ab9 55%,#0f7ea9 100%);` white logo/text, red CTA pops, Della's orb sits here.
- Below hero: sections alternate `--tc-paper` / `--tc-blue-tint-2`.
- Optional single STATIC warm bloom top-left: `radial-gradient(120% 80% at 15% 0%, rgba(17,138,185,.05), transparent 60%)`. The ONLY animated element on the page is Della's orb.

## 4. Components
Radius: `--r-sm:10px` `--r-md:16px` `--r-lg:22px` `--r-xl:28px` `--r-pill:999px`. Shadows sm/md/lg (§1). Spacing 4-base: 4/8/12/16/24/32/48/64/96; section pad `clamp(56px,9vw,96px)`; card pad 24–32px.
- **Primary CTA `.cta`** = red fill, #fff, `--fs-button`, pad `15px 34px`, pill, shadow-md; hover red-hover + translateY(-1px). ("GET STARTED")
- **Secondary `.btn-blue`** = blue fill/white (Save, Continue).
- **Ghost `.btn-ghost`** = transparent, ink label, `1.5px solid --tc-line-strong`, hover bg paper-2.
- **Text button** = blue label, underline on hover.
- Focus (all): `box-shadow:var(--tc-focus)`.
- **Occasion CATEGORY CARDS (KEY structural change — retire `.moments .chip` text pills):** grid `repeat(auto-fill,minmax(150px,1fr))` gap 16px. Card: `--tc-surface`, `1px solid --tc-line`, `--r-lg`, pad `22px 18px`, shadow-sm, flex-col gap 12. Icon 32px line-icon `--tc-blue` top-left. Label `--fs-h3` ink. Hover translateY(-3px)+shadow-md+border blue. Selected: `1.5px solid --tc-blue` + `--tc-blue-tint` bg. Min ~150×120 tap target.
- **Header (Apple-minimal):** transparent over hero → `--tc-paper` + `--tc-line` hairline on scroll. Left = horizontal lockup. Right = one auth action. Mobile hamburger. ~64px.
- **Inputs:** `--tc-surface` bg, `1.5px solid --tc-line-strong`, `--r-sm`, pad `13px 15px`, ink text, mute placeholder; focus border blue + focus ring.
- **Plan surfaces:** `--tc-surface` card, `--r-xl`, shadow-md, pad 28–34px; section labels `--fs-eyebrow` in blue-deep; emotional situation line = reserved Fraunces italic; uncluttered.

## 5. Iconography
ONE unified warm line-icon style. Retire ALL emoji + old filled terracotta heart. Outline, 1.75px stroke @24px, round caps+joins, no fill (except the brand heart = solid red). Default `--tc-blue`; quiet/meta `--tc-ink-soft`. Sizes 16/20/24/32/40 (pillar+card icons at 32). Pillars: **What to say**→speech-bubble (blue); **What to do**→gift (blue); **How to show up**→hand cradling heart (hand blue line, heart solid red). Occasion icons same set (baby, cake, ring, memorial candle, briefcase, cap…). Source Lucide/Phosphor line-round or hand-authored on same grid.

## 6. The mark (placeholder SVG spec — swap designer SVGs when they arrive)
Primary mark = speech bubble + tail + solid red heart. `viewBox 0 0 100 100`. Bubble: near-circular rounded blob, STROKE only `#118ab9` width 7, tail lower-left. Heart: SOLID `#ef4136` centered, ~40 wide, slightly north. Round caps/joins.
**Variants (build all):** (1) standard blue bubble+red heart, wordmark `#118ab9`; (2) reversed on blue panel: bubble `#fff`, heart `#ef4136`, wordmark `#fff`; (3) one-color black `#1a1a1a`; (4) all-white on blue (heart white too); (5) **app icon**: blue rounded-square (radius ~22%), SOLID white bubble (filled) + lower-left tail, SOLID red heart centered.
**Wordmark lockup:** "THOUGHTS COUNT" Montserrat 700 UPPER `0.32em`, `#118ab9`/white; mark upper-right of wordmark (horizontal) baseline-aligned; clear space = bubble height.
**Derived assets to generate:** `favicon.svg` + `favicon.ico`(32); `apple-touch-icon.png` 180×180 (no transparency); manifest icons 192 + 512 (maskable-safe, heart in inner 80%); OG 1200×630 (blue panel + reversed lockup + tagline); `theme-color` meta `#118ab9`.

## 7. Della's orb — new colorway (`public/_orb.js`, engine untouched, palette only)
Blue "inner weather" drifting around a warm RED-coral heart core, with an earthy-amber bridge so it never goes clinical. Red heart = emotional anchor (echoes logo); blue = thoughtful weather; warm amber = human.
```js
// makePigments() new palette ([r,g,b] format)
{ col:[239,90,80],  edge:[200,64,58],  a:0.72, ox:0.00, oy:0.08, rx:0.64, ry:0.10, sp:0.22, ph:0.0, warm:true }, // red-coral heart anchor
{ col:[236,150,110], edge:[206,120,84], a:0.52, ox:0.10, oy:-0.06, rx:0.50, ry:0.14, sp:0.30, ph:1.6, warm:true }, // amber bridge
{ col:[45,150,196],  edge:[24,112,150], a:0.56, ox:-0.34, oy:0.16, rx:0.58, ry:0.20, sp:0.26, ph:2.4 }, // brand blue
{ col:[120,190,214], edge:[80,150,182], a:0.52, ox:0.30, oy:0.24, rx:0.54, ry:0.18, sp:0.24, ph:3.6 }, // sky/teal
{ col:[70,138,180],  edge:[40,100,140], a:0.48, ox:-0.20, oy:-0.28, rx:0.52, ry:0.22, sp:0.29, ph:4.7 }, // deep blue rim
{ col:[240,170,150], edge:[214,132,116], a:0.42, ox:0.24, oy:-0.22, rx:0.48, ry:0.20, sp:0.20, ph:5.9 } // warm blush light
// base wash: rgba(244,196,168,1)@0 -> rgba(150,190,206,1)@0.55 -> rgba(64,132,176,1)@1
// heart bloom: rgba(239,92,82,heartA)@0 -> rgba(214,72,64,heartA*.58)@0.45 -> rgba(214,72,64,0)@1
// vignette: rgba(30,44,58,0)@0 -> rgba(30,44,58,.10)@0.82 -> rgba(30,44,58,.34)@1
```
Orb sits on the blue hero panel — confirm the blue rim doesn't dissolve into the panel; if it does, deepen rim `[40,100,140]` or +4% vignette. Target read: "a warm heart breathing inside thoughtful blue weather" — never an LED. Verify all 3 mounts (home hero, conversation modal, reduced-motion still frame).

## 8. Warmth-preservation + premium laws
1. Warm canvas always (`--tc-paper`, never `#fff`); warmth in surfaces+brown-alpha shadows+warm ink.
2. Red is precious (heart + ONE CTA; >2/viewport = remove some).
3. Blue is the brand, not the mood (don't paint every heading blue).
4. One action per screen (Apple); progressive disclosure via cards (Airbnb).
5. Illustration/line-icons carry warmth, not photography; no generic stock people.
6. Generous air + calm; line-height 1.6; only motion = Della's orb.
7. Rounded/soft, never sharp/dashboard.
8. Della is the warm center; brand frame stays quiet so she shines.
**Voice:** warm, plain, human, confident-but-gentle; register = "Show up. Be thoughtful. Make it count." Second person, short sentences. Buttons direct. Microcopy comforts, doesn't instruct.

## Builder handoff checklist
1. Add `:root` tokens (§1); re-point old `--paper/--sage/--clay/--blush/--mist` to new values (don't keep sage/terracotta).
2. Fraunces/Nunito → Montserrat 400/500/600/700; keep Fraunces italic ONLY for the reserved emotional line.
3. Delete `#bg` clouds + `drift1–6`; warm canvas + blue hero panel (§3).
4. CTA red / secondary blue / ghost buttons (§4).
5. Replace `.moments .chip` pills with occasion category-card grid (§4) — key change.
6. Minimal header w/ lockup (§4,§6).
7. Placeholder mark SVGs (5 variants); generate favicon/apple-touch-180/manifest 192+512/OG 1200×630; `theme-color #118ab9`; add manifest.json.
8. Retune `_orb.js` palette (§7, values only).
9. Replace emoji + old heart with unified blue line-icons + solid-red brand heart (§5).
