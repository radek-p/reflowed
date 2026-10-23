// The page's icons, all from the one drawing app/src/chrome/wordmark/icon.svg (the design: the purple tile, the
// white "Re"), written into app/index.html between the markers <!-- icons: … --> and <!-- /icons -->:
//   - the SVG favicon (the drawing itself, as a data URI);
//   - PNG favicons, 32×32 and 16×16, the rounded tile with transparent corners (for browsers without SVG favicons);
//   - the apple-touch-icon, 180×180, full bleed: the purple fills the square, no corners and no transparency (Safari's
//     Favourites and start page, iOS home screens round it themselves; without one Safari puts the icon on a white tile).
// And beside icon.svg, the home screen's icons for the web app manifest (the multi-file release: scripts/lib/multifile.ts
// writes app.webmanifest with them): 192 and 512, the rounded tile with transparent corners (purpose any), and 512
// maskable (full bleed, the glyph scaled into the safe zone: Android crops it to its own shape).
// The PNGs are rendered by Chromium (Playwright). The marker line carries icon.svg's sha256, so tests/test-brand.ts sees
// when the drawing changed and the icons were not regenerated. index.html is committed with the result: the dev page and
// the builds (scripts/build.ts copies the head as it is) need no run of this script.
//   node scripts/icons.ts           regenerate (needs Playwright/Chromium)
//   node scripts/icons.ts --check   exit 1 when a fresh render differs from index.html
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICON = join(ROOT, 'app/src/chrome/wordmark/icon.svg');
const INDEX = join(ROOT, 'app/index.html');
const BEGIN = /<!-- icons: [^\n]*-->\n/, END = '<!-- /icons -->';

/** icon.svg as a favicon: one line, without the bar's theming classes */
export function faviconSvg(icon: string): string {
  return icon.replace(/ class="[^"]*"/g, '').replace(/\s*\n\s*/g, '').trim();
}
/** the same drawing full bleed: the tile without its rounded corners */
export function fullBleedSvg(icon: string): string {
  const svg = faviconSvg(icon);
  if (!/<rect [^>]*rx="8"/.test(svg)) throw new Error('icon.svg: the tile (rect rx="8") not found');
  return svg.replace(/(<rect [^>]*) rx="8"/, '$1');
}
export const sha256 = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
/** maskable: full bleed, the glyph inside the safe zone (a circle of 40 % of the size around the centre: Android's masks
 *  keep at least that): scaled 0.8 about the centre */
export function maskableSvg(icon: string): string {
  const svg = fullBleedSvg(icon);
  if (!/<path [^>]*\/>/.test(svg)) throw new Error('icon.svg: the glyph (path) not found');
  return svg.replace(/(<path [^>]*\/>)/, '<g transform="translate(16 16) scale(0.8) translate(-16 -16)">$1</g>');
}
/** the web app manifest's icons, files beside icon.svg (committed, as index.html is) */
export const APP_ICON_DIR = join(ROOT, 'app/src/chrome/wordmark');
export const APP_ICONS = [
  { file: 'app-icon-192.png', size: 192, purpose: 'any' },
  { file: 'app-icon-512.png', size: 512, purpose: 'any' },
  { file: 'app-icon-maskable-512.png', size: 512, purpose: 'maskable' },
] as const;
async function appIcons(icon: string): Promise<Map<string, Buffer>> {
  const { chromium } = createRequire(join(ROOT, 'app/package.json'))('playwright') as { chromium: { launch(): Promise<Browser> } };
  const browser = await chromium.launch();
  try {
    const out = new Map<string, Buffer>();
    for (const a of APP_ICONS) out.set(a.file, await render(browser, a.purpose === 'maskable' ? maskableSvg(icon) : faviconSvg(icon), a.size, a.purpose !== 'maskable'));
    return out;
  } finally { await browser.close(); }
}

type Page = { setViewportSize(s: { width: number; height: number }): Promise<void>; setContent(h: string): Promise<void>; screenshot(o: { omitBackground: boolean; type: 'png' }): Promise<Buffer>; close(): Promise<void> };
type Browser = { newPage(o: { deviceScaleFactor: number; viewport: { width: number; height: number } }): Promise<Page>; close(): Promise<void> };

/** the SVG (32×32 user units) rendered at size×size pixels */
async function render(browser: Browser, svg: string, size: number, transparent: boolean): Promise<Buffer> {
  const page = await browser.newPage({ deviceScaleFactor: size / 32, viewport: { width: 32, height: 32 } });
  try {
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
    return await page.screenshot({ omitBackground: transparent, type: 'png' });
  } finally { await page.close(); }
}

async function block(icon: string): Promise<string> {
  const { chromium } = createRequire(join(ROOT, 'app/package.json'))('playwright') as { chromium: { launch(): Promise<Browser> } };
  const browser = await chromium.launch();
  try {
    const png = async (svg: string, size: number, transparent: boolean) => `data:image/png;base64,${(await render(browser, svg, size, transparent)).toString('base64')}`;
    const fav = faviconSvg(icon);
    return `<!-- icons: generated by scripts/icons.ts from app/src/chrome/wordmark/icon.svg sha256=${sha256(icon)} (do not edit) -->\n`
      + `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(fav)}">\n`
      + `<link rel="icon" type="image/png" sizes="32x32" href="${await png(fav, 32, true)}">\n`
      + `<link rel="icon" type="image/png" sizes="16x16" href="${await png(fav, 16, true)}">\n`
      + `<link rel="apple-touch-icon" sizes="180x180" href="${await png(fullBleedSvg(icon), 180, false)}">\n`
      + `${END}`;
  } finally { await browser.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const icon = readFileSync(ICON, 'utf8');
  const html = readFileSync(INDEX, 'utf8');
  const fresh = await block(icon);
  const m = BEGIN.exec(html);
  let next: string;
  if (m) {
    const end = html.indexOf(END, m.index);
    if (end < 0) throw new Error(`index.html: ${END} missing`);
    next = html.slice(0, m.index) + fresh + html.slice(end + END.length);
  } else {
    // the first run: in place of the hand-written SVG favicon
    const old = /<link rel="icon" href="data:image\/svg\+xml,[^"]*">/.exec(html);
    if (!old) throw new Error('index.html: no icon markers and no SVG favicon to replace');
    next = html.slice(0, old.index) + fresh + html.slice(old.index + old[0].length);
  }
  const pngs = await appIcons(icon);
  const stale = [...pngs].filter(([f, b]) => { try { return !readFileSync(join(APP_ICON_DIR, f)).equals(b); } catch { return true; } }).map(([f]) => f);
  if (process.argv.includes('--check')) {
    const ok = next === html && !stale.length;
    console.log(ok ? 'icons: index.html and the app icons are up to date' : `icons: ${next !== html ? 'index.html ' : ''}${stale.join(' ')} differ from a fresh render (run node scripts/icons.ts)`);
    process.exit(ok ? 0 : 1);
  }
  writeFileSync(INDEX, next);
  for (const f of stale) writeFileSync(join(APP_ICON_DIR, f), pngs.get(f)!);
  console.log(next === html && !stale.length ? 'icons: unchanged' : `icons: updated ${next !== html ? 'index.html ' : ''}${stale.join(' ')}`);
}
