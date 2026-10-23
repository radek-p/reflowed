// components, in each of the four themes, with no page error; a theme picked restyles the page; a screenshot per theme
// into test-results/gallery/. Waits on the gallery's own readiness marks (html[data-gallery-ready], each
// [data-section][data-ready]), never on fixed times.
//
//   node tests/test-gallery.ts [http://localhost:8150/]        (a dev server: tests/integration/serve.ts)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'gallery');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const BASE = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8150/').replace(/\/?$/, '/');

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 300)}` : ''}`);
}

const browser = await chromium.launch();
const THEMES = ['light', 'dark', 'sepia', 'contrast'];
const looks: Record<string, { page: string; ink: string }> = {};
for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e: Error) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(120000);
  await page.goto(`${BASE}gallery.html?theme=${theme}`);
  await page.waitForSelector('html[data-gallery-ready]');
  const s = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('[data-section]')] as HTMLElement[];
    const css = getComputedStyle(document.body);
    return {
      sections: secs.map((x) => x.dataset.section), notReady: secs.filter((x) => !x.hasAttribute('data-ready')).map((x) => x.dataset.section),
      empty: secs.filter((x) => x.getBoundingClientRect().height < 40).map((x) => x.dataset.section),
      theme: document.documentElement.dataset.galleryTheme, page: css.backgroundColor, ink: css.color,
      wide: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  looks[theme] = { page: s.page, ink: s.ink };
  check(`${theme}: every section drawn (${s.sections.length}: ${s.sections.join(', ')}), none empty`,
    s.sections.length >= 5 && s.notReady.length === 0 && s.empty.length === 0, { notReady: s.notReady, empty: s.empty });
  check(`${theme}: the theme is the one asked for; no horizontal scroll`, s.theme === theme && !s.wide, { theme: s.theme, wide: s.wide });
  check(`${theme}: no page error`, problems.length === 0, problems.slice(0, 3).join(' | '));
  // the icon catalogue: every registry icon (data-icon-count: ICON_NAMES.length), numbered 1…n in order, its name
  // shown, each drawn at 16, 20 and 32 px on Lucide's grid with something in it
  {
    const ic = await page.evaluate(() => {
      const list = document.querySelector('.gal-icons') as HTMLElement | null;
      const cells = [...(list?.querySelectorAll('.gal-ic') ?? [])] as HTMLElement[];
      return { count: Number(list?.dataset.iconCount ?? -1), names: cells.map((c) => c.dataset.icon ?? ''),
        numbered: cells.every((c, i) => c.querySelector('.gal-ic-n')?.textContent === String(i + 1) && c.querySelector('.gal-ic-name')?.textContent === c.dataset.icon),
        drawn: cells.filter((c) => { const svgs = [...c.querySelectorAll('svg')]; return svgs.length === 3 && svgs.every((x) => x.getAttribute('viewBox') === '0 0 24 24' && x.childElementCount > 0)
          && [16, 20, 32].every((w, k) => Math.round(svgs[k]!.getBoundingClientRect().width) === w); }).length };
    });
    check(`${theme}: the icon catalogue shows every registry icon (${ic.count}), numbered, named, at 16, 20 and 32 px`,
      ic.count > 40 && ic.names.length === ic.count && new Set(ic.names).size === ic.count && ic.numbered && ic.drawn === ic.count, { count: ic.count, cells: ic.names.length, numbered: ic.numbered, drawn: ic.drawn });
    const g = await page.$('[data-g="kit-icons"]');
    if (g) await g.screenshot({ path: join(OUT, `icons-${theme}.png`) });
  }
  await page.screenshot({ path: join(OUT, `gallery-${theme}.png`), fullPage: true });
  await ctx.close();
}
const pairs = new Set(Object.values(looks).map((l) => `${l.page}/${l.ink}`));   // (high contrast keeps a white page: its ink differs)
check('the four themes give four page and ink colour pairs (the tokens applied)', pairs.size === 4, looks);
// picking a theme in the header restyles the page at once (no reload)
{
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}gallery.html?theme=light`);
  await page.waitForSelector('html[data-gallery-ready]');
  await page.click('[data-theme-pick="dark"]');
  await page.waitForFunction(() => document.documentElement.dataset.galleryTheme === 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('the header\'s theme switch: dark picked, the page is dark (as with ?theme=dark)', bg === looks.dark!.page, { bg, want: looks.dark!.page });
  await ctx.close();
}

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ date: new Date().toISOString(), passed, total: results.length, results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
