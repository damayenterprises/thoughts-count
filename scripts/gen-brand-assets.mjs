// TC-75 rebrand — generate raster brand assets from the placeholder SVG marks.
//   apple-touch-icon.png 180x180 (opaque, app-icon)
//   icon-192.png / icon-512.png (maskable-safe app icon)
//   og.png 1200x630 (blue panel + reversed lockup + tagline)
//
// sharp + node_modules are gitignored; the OUTPUT PNGs are committed.
// Run: node scripts/gen-brand-assets.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const finalDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'brand-assets', 'final');
const appIcon = readFileSync(join(pub, 'icon-app.svg'));

// Real designer lockup (white wordmark + white bubble + red heart on blue).
// Pull the inner markup so we can place it inside the OG canvas as a nested <svg>.
const lockupReversed = readFileSync(join(finalDir, 'lockup-reversed.svg'), 'utf8');
// Strip the lockup's own opaque blue <rect> so our OG gradient panel shows through.
const lockupInner = lockupReversed.replace(/<rect\b[^>]*class="cls-1"[^>]*\/>/, '');

// ---- app icons (opaque; the SVG already has a solid blue rounded-square bg) ----
async function png(size, out) {
  await sharp(appIcon, { density: 384 })
    .resize(size, size, { fit: 'contain' })
    .png()
    .toFile(join(pub, out));
  console.log('wrote', out, size + 'x' + size);
}

// ---- OG image 1200x630: blue panel + REAL reversed lockup (designer vector) + tagline ----
// The lockup is placed as a nested <svg> (its viewBox is 0 0 1000 204.09). Centered,
// 760px wide, sitting above the tagline.
const LOCKUP_W = 760, LOCKUP_H = LOCKUP_W * (204.09 / 1000);
const OG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="p" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1595c6"/>
      <stop offset="0.55" stop-color="#118ab9"/>
      <stop offset="1" stop-color="#0f7ea9"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#p)"/>
  <svg x="${(1200 - LOCKUP_W) / 2}" y="${(630 - LOCKUP_H) / 2 - 30}" width="${LOCKUP_W}" height="${LOCKUP_H}" viewBox="0 0 1000 204.09">
    ${lockupInner.replace(/<\?xml[^>]*\?>/, '').replace(/<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '')}
  </svg>
  <text x="600" y="470" text-anchor="middle"
    font-family="Montserrat, 'Segoe UI', Arial, sans-serif" font-weight="500"
    font-size="26" letter-spacing="6" fill="rgba(255,255,255,0.92)">Thoughtful guidance for life's meaningful moments.</text>
  <text x="600" y="548" text-anchor="middle"
    font-family="Montserrat, 'Segoe UI', Arial, sans-serif" font-weight="500"
    font-size="22" letter-spacing="8" fill="rgba(255,255,255,0.82)">IT'S THE THOUGHT THAT COUNTS</text>
</svg>`;

async function og() {
  await sharp(Buffer.from(OG)).png().toFile(join(pub, 'og.png'));
  console.log('wrote og.png 1200x630');
}

await png(180, 'apple-touch-icon.png');
await png(192, 'icon-192.png');
await png(512, 'icon-512.png');
await og();
console.log('done');
