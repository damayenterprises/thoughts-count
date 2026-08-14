# TC Rebrand — Iteration 2 (copy cut + living gradient + real designer assets)

David reviewed the preview ("greatly improved") and asked for: (1) cleaner / fewer words; (2) the old floating-colors-in-motion background but in the NEW palette + complementary colors, no white/solid banner. Plus the designer's REAL blue/red vectors have landed.

## PART 0 — Swap in the REAL designer vectors (replaces the placeholder marks)
Real outlined SVGs are staged in `brand-assets/final/`:
- `icon-color.svg` (viewBox 0 0 250 250; blue bubble `#118ab9` + red heart `#ef4136`) → the bubble+heart mark.
- `app-icon.svg` (viewBox 0 0 250 250; blue rounded-square + white bubble + red heart) → app/PWA icon.
- `lockup-color.svg` (viewBox 0 0 1000 204.09; blue wordmark + mark, OUTLINED paths) → horizontal lockup for the header on LIGHT backgrounds.
- `lockup-reversed.svg` (white wordmark + white bubble + red heart) → lockup for DARK/gradient backgrounds.
- `lockup-white.svg`, `lockup-black.svg`, `icon-white.svg` → other variants as needed.
Actions:
- Replace `public/favicon.svg` with `icon-color.svg` content.
- Replace the inline header mark + wordmark and the modal-head mark in `public/index.html` with the real lockup (use `lockup-color.svg` paths for the light header; the mark alone from `icon-color.svg` where only the bubble+heart is used). Replace the JS-surface marks (companion.js, roster.js, import.js) and the guides generator mark with `icon-color.svg`.
- Regenerate rasters from `app-icon.svg` via the existing `scripts/gen-brand-assets.mjs` (sharp): `apple-touch-icon.png` 180, `icon-192.png`, `icon-512.png`, and `og.png` 1200×630 (blue panel + reversed lockup + tagline). Commit the PNGs.
- These are OUTLINED vectors — no font dependency. Keep `viewBox`, scale via width/height/CSS.

## PART 1 — Copy cut (ALWAYS ON, applies to both bg variants). index.html home:
- **Headline** KEEP: `Show up for the moments that *matter most.*`
- **Subhead** KEEP: `Thoughtful guidance for life's meaningful moments.`
- **CUT ENTIRELY** the `p.gets` line: ~~`What to say · what to do · what to send · how to keep showing up`~~ (redundant with subhead).
- **hero-start-label**: `I want to show up for someone...` → `Who are you showing up for?`
- **Orb prompt** KEEP `Tap to talk`; **or type instead** KEEP.
- **Reassurance**: `No account needed · Free to try · Ready in about a minute` → `No account needed · Free · About a minute`
- **Trust row**: `A calm place to think it through` → `A calm place to think`; `Your details stay yours` KEEP; `Personal to the person you have in mind` → `Personal to your person`
- **Occasion sub**: `Pick what's closest, or tell us in your own words.` → `Pick what's closest, or say it your way.`
- **Fallback CTA**: `Or tell us in your own words` → `Or say it your way`
- **How-it-works sub** (cut 2nd+3rd sentence): `You're looking for the quiet certainty that you got it just right, big moment or small. So we start with a real conversation.` → `You're looking for the quiet certainty that you got it just right.`
- **Example foot**: `This is a taste. Your plan is built around your person and what feels right to you.` → `Just a taste. Your plan is built around your person.`
- Keep quote band + footer promise as-is. Preserve ALL handlers/affordances; trimming only.
Net: ~35-40% fewer words above the fold, no features removed.

## PART 2 — Living-gradient background (GATED: `body.living-bg`, toggled by `?bg=living`; default stays the current solid-blue hero so David can A/B in ONE deploy)
Add a small script: on load, if `location.search` includes `bg=living` (or localStorage flag), add class `living-bg` to `<body>`. All gradient CSS is scoped under `body.living-bg`. The default (no param) = the current solid-blue-hero version, untouched.

### Blobs — full-viewport fixed `#bg` (populate with 6 children), scoped to `body.living-bg #bg`:
Base wash (behind blobs, never flash white): `radial-gradient(130% 100% at 20% 10%, #f4e6dc 0%, #dfe9ee 45%, #b9d2de 78%, #8fb9cc 100%)`.
Blobs (radial, transparent-edged, blurred, slow drift 28-40s, small 3-6vw amplitude):
- c1 brand blue `rgba(17,138,185,.42)` 62vw blur90 drift 34s
- c2 deep navy `rgba(10,88,118,.38)` 55vw blur100 drift 40s
- c3 sky/teal `rgba(120,190,214,.40)` 50vw blur90 drift 30s
- c4 warm amber (complement) `rgba(224,150,96,.34)` 48vw blur100 drift 36s
- c5 cream glow (unifier) `rgba(247,243,236,.55)` 44vw blur80 drift 28s
- c6 coral bloom (RARE, off-center) `rgba(239,65,54,.20)` 34vw blur110 drift 38s
(Full CSS incl. positions + `@keyframes drift1..6` small-amplitude + `prefers-reduced-motion` still-frame per Design Lead spec — implement exactly; keep c4/c6 warm blooms OFF the dead-center hero zone so the orb's coral heart stays the only strong warm point at center.)

### No white/solid banner (under `body.living-bg`):
- Header transparent at rest, uses `lockup-reversed.svg` (white wordmark + red heart). On scroll past ~40px add `.bar.scrolled`: `background:rgba(247,243,236,.72); backdrop-filter:blur(14px) saturate(120%); border-bottom:1px solid rgba(255,255,255,.35);` and swap to the standard `lockup-color.svg` (dark lockup on light frosted bar). CTA stays red.
- Hero: DELETE the blue-panel gradient → `background:transparent`. Keep white hero text. Add a soft scrim behind hero copy only:
  `.hero-inner{position:relative} .hero-inner::before{content:"";position:absolute;inset:-6% -4% -10%;z-index:-1;border-radius:40px;background:radial-gradient(80% 70% at 50% 42%, rgba(12,70,96,.42) 0%, rgba(12,70,96,.22) 45%, rgba(12,70,96,0) 78%);pointer-events:none}` (a breath of shade, not a card — seats the orb + guarantees white-text legibility over light blooms).

### Legibility (the old mistake = body copy on moving color — do NOT repeat):
- Bare gradient (large reversed white, high contrast): hero headline/subhead/reassurance, orb + Tap to talk, section H2s, quote band (reversed white italic + soft scrim; drop the blue-tint fill).
- MUST stay on calm surfaces: the generated PLAN (`--tc-surface` card), the typed conversation bubbles/field, occasion cards (already `--tc-surface` — read as floating tiles = on-brand), example card + 3 step cards. For content-dense sections use a frosted warm band: `background:rgba(253,251,247,.78); backdrop-filter:blur(8px)` on `.section` rather than bare weather.
- Rhythm: open weather at top (hero/orb), calm frosted "rooms" below.

### Orb coexistence: the hero `::before` scrim is the orb's contrast bed (keep orb centered over deepest scrim). Bump orb vignette +4% for a defined edge vs ambient blue. Keep warm blooms (c4/c6) peripheral so the orb's coral heart is the only strong warm center point. Verify all 3 orb mounts + reduced-motion.

### AA: verify white hero text over the scrim ≥4.5:1 at the LIGHTEST blob pose (cream/amber region is the risk).

## Build rules
Branch `brand/tc75-full-rebrand`. Do NOT deploy/push/merge to main or touch prod infra/.env/Della. Commit logically. Part 0+1 in one commit (real assets + copy), Part 2 in a second commit (living-bg, gated). Leave tree clean; return a concise summary + confirm the default (solid) is unchanged and `?bg=living` shows the gradient.
