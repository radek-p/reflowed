// The ReflowEd icon (app/src/chrome/wordmark/icon.svg): in the window bar (icon only, no word) and as the
// favicon, the same drawing in both; the PNG favicons and the apple-touch-icon (Safari) rendered from it by scripts/icons.ts.
//   node tests/test-brand.ts
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { faviconSvg, sha256, APP_ICONS, APP_ICON_DIR } from '../scripts/icons.ts';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/index.html'), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };

const here = dirname(fileURLToPath(import.meta.url));
const iconFile = readFileSync(join(here, '../app/src/chrome/wordmark/icon.svg'), 'utf8');
const host = readFileSync(join(here, '../app/src/wb/host.ts'), 'utf8');
const glyph = (s: string) => /<path[^>]* d="([^"]+)"/.exec(s)?.[1] ?? '';
check('bar icon: the tile and the glyph themable (classed shapes)', /class="rfed-mark-tile"/.test(iconFile) && /class="rfed-mark-glyph"/.test(iconFile));
check('bar shows the icon only (no word part)', /mark: \{\s*icon:[^\n]*\n\s*\},/.test(host));
const icon = /<link rel="icon" href="data:image\/svg\+xml,([^"]+)">/.exec(html)?.[1];
check('favicon is an inline SVG', !!icon);
const svg = icon ? decodeURIComponent(icon) : '';
check('favicon draws the same glyph as the bar', !!glyph(svg) && glyph(svg) === glyph(iconFile));
check('favicon SVG is well formed', svg.startsWith('<svg') && svg.endsWith('</svg>'));

// the icons scripts/icons.ts writes (a fresh render matching them: node scripts/icons.ts --check)
check('icons generated from the current icon.svg (marker sha256; else run node scripts/icons.ts)', html.includes(`icon.svg sha256=${sha256(iconFile)} `));
check('SVG favicon is icon.svg (as scripts/icons.ts writes it)', icon === encodeURIComponent(faviconSvg(iconFile)));
/** a PNG's pixels (8-bit RGB or RGBA, non-interlaced), decoded with node:zlib */
function png(b64: string): { w: number; h: number; px: (x: number, y: number) => [number, number, number, number] } {
  const b = Buffer.from(b64, 'base64');
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let w = 0, h = 0, type = 0; const idat: Buffer[] = [];
  for (let o = 8; o < b.length;) {
    const n = b.readUInt32BE(o), t = b.toString('latin1', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + n);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9]; if (d[8] !== 8 || d[12] !== 0 || (type !== 2 && type !== 6)) throw new Error('PNG: only 8-bit RGB/RGBA, non-interlaced'); }
    if (t === 'IDAT') idat.push(d);
    o += 12 + n;
  }
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[row + i - bpp] : 0, up = y ? out[row - stride + i] : 0, c = y && i >= bpp ? out[row - stride + i - bpp] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      out[row + i] = (src[i] + [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f]) & 255;
    }
  }
  return { w, h, px: (x, y) => { const i = y * stride + x * bpp; return [out[i], out[i + 1], out[i + 2], bpp === 4 ? out[i + 3] : 255]; } };
}
const corners = (p: ReturnType<typeof png>) => [p.px(0, 0), p.px(p.w - 1, 0), p.px(0, p.h - 1), p.px(p.w - 1, p.h - 1)];
const pngLink = (attrs: RegExp) => new RegExp(`<link ${attrs.source} href="data:image/png;base64,([^"]+)">`).exec(html)?.[1];
const touch = pngLink(/rel="apple-touch-icon" sizes="180x180"/);
check('apple-touch-icon is an inline PNG', !!touch);
if (touch) {
  const p = png(touch);
  check('apple-touch-icon is 180×180', p.w === 180 && p.h === 180);
  check('apple-touch-icon is full bleed: its corners opaque #A232C1', corners(p).every(([r, g, b, a]) => r === 0xa2 && g === 0x32 && b === 0xc1 && a === 255));
  check('apple-touch-icon has the white glyph', [...Array(180).keys()].some((x) => { const [r, g, b] = p.px(x, 90); return r > 240 && g > 240 && b > 240; }));
}
for (const n of [32, 16]) {
  const fav = pngLink(new RegExp(`rel="icon" type="image/png" sizes="${n}x${n}"`));
  check(`PNG favicon ${n}×${n} after the SVG one`, !!fav && html.indexOf(fav) > html.indexOf('data:image/svg+xml'));
  if (!fav) continue;
  const p = png(fav);
  check(`PNG favicon ${n}: size, transparent corners, purple centre-left`, p.w === n && p.h === n && corners(p).every((c) => c[3] === 0)
    && (([r, g, b, a]) => r === 0xa2 && g === 0x32 && b === 0xc1 && a === 255)(p.px(Math.round(n * 0.1), n >> 1)));
}

// Add to Home Screen: the head's meta tags (iOS: a full-screen web app, its title), and the web app manifest's
// icons beside icon.svg (scripts/icons.ts: the multi-file release's app.webmanifest lists them)
for (const [n, c] of [['apple-mobile-web-app-capable', 'yes'], ['mobile-web-app-capable', 'yes'], ['apple-mobile-web-app-status-bar-style', 'default'], ['apple-mobile-web-app-title', 'ReflowEd']]) {
  check(`meta ${n} = ${c}`, html.includes(`<meta name="${n}" content="${c}">`));
}
for (const a of APP_ICONS) {
  const p = png(readFileSync(join(APP_ICON_DIR, a.file)).toString('base64'));
  const purple = ([r, g, b, al]: number[]) => r === 0xa2 && g === 0x32 && b === 0xc1 && al === 255;
  const cs = corners(p);
  // maskable: full bleed, and the glyph (white) inside the safe zone, a circle of 40 % of the size around the centre
  let outside = 0;
  if (a.purpose === 'maskable') for (let y = 0; y < p.h; y += 2) for (let x = 0; x < p.w; x += 2) { const [r, g, b] = p.px(x, y); if (r > 200 && g > 200 && b > 200 && Math.hypot(x - p.w / 2, y - p.h / 2) > p.w * 0.4) outside++; }
  check(`app icon ${a.file}: ${a.size}×${a.size}, ${a.purpose === 'maskable' ? 'full bleed, the glyph inside the safe zone' : 'transparent corners, purple tile'}`, p.w === a.size && p.h === a.size
    && (a.purpose === 'maskable' ? cs.every(purple) && outside === 0 : cs.every((c) => c[3] === 0) && purple(p.px(Math.round(a.size * 0.1), a.size >> 1))));
}

// the loading screen: the first thing in <body>, hidden by CSS once the parser reaches the app's module script
// (in the single file that is the last thing in it, so the screen shows while the file downloads). The rule is anchored
// on the screen itself (its later sibling), not body:has(): a :has() on <body> restyles the page at every change
const body = html.slice(html.indexOf('<body'));
check('loading screen is the first element in <body>', /^<body[^>]*>\s*<div id="boot"/.test(body));
check("loading screen hides when the module script is parsed (!important: the screen's inline display would win otherwise)", html.includes('#boot:has(~ script[type="module"]){display:none!important}'));
process.exit(failed ? 1 : 0);
