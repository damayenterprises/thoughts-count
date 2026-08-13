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
const appIcon = readFileSync(join(pub, 'icon-app.svg'));

// ---- app icons (opaque; the SVG already has a solid blue rounded-square bg) ----
async function png(size, out) {
  await sharp(appIcon, { density: 384 })
    .resize(size, size, { fit: 'contain' })
    .png()
    .toFile(join(pub, out));
  console.log('wrote', out, size + 'x' + size);
}

// ---- OG image 1200x630: blue panel + reversed lockup (white bubble/red heart + white wordmark) + tagline ----
const OG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="p" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1595c6"/>
      <stop offset="0.55" stop-color="#118ab9"/>
      <stop offset="1" stop-color="#0f7ea9"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#p)"/>
  <!-- reversed mark: white bubble + red heart, centered above the wordmark -->
  <g transform="translate(548,132) scale(1.04)">
    <path d="M50 12c21 0 36 14.5 36 33 0 18.5-15 33-36 33-4.6 0-9-0.7-13-2l-16 8 4.4-15.4C15.7 96.2 14 84.5 14 45 14 26.5 29 12 50 12Z" fill="#ffffff"/>
    <path fill="#ef4136" d="M50 63c-1 0-1.9-.4-2.6-1.1l-11-11a8.8 8.8 0 0 1 0-12.5 8.8 8.8 0 0 1 12.5 0l1.1 1.1 1.1-1.1a8.8 8.8 0 0 1 12.5 0 8.8 8.8 0 0 1 0 12.5l-11 11c-.7.7-1.6 1.1-2.6 1.1Z"/>
  </g>
  <text x="600" y="360" text-anchor="middle"
    font-family="Montserrat, 'Segoe UI', Arial, sans-serif" font-weight="700"
    font-size="72" letter-spacing="18" fill="#ffffff">THOUGHTS COUNT</text>
  <text x="600" y="452" text-anchor="middle"
    font-family="Montserrat, 'Segoe UI', Arial, sans-serif" font-weight="500"
    font-size="26" letter-spacing="6" fill="rgba(255,255,255,0.92)">Thoughtful guidance for life's meaningful moments.</text>
  <text x="600" y="540" text-anchor="middle"
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
