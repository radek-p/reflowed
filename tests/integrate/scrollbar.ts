// ── the document's scrollbar: its track starts below the bar and the strip (the glass), in each form
// and browser: where ::-webkit-scrollbar applies, the track's margin is the pane's glass inset; elsewhere (Firefox) the
// pane itself starts below the glass. That style is a classic bar's (a styled ::-webkit-scrollbar always is one), so it
// applies where the platform's bars are classic (workbench/src/scrollbars.ts); overlay bars (WebKit here,
// as macOS) are the platform's own, over the content (overlay-scrollbars.ts checks they take no room) ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^scrollbar$'
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { HERE, BASE, Q, check, idle } = h;
  const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
  for (const name of ['chromium', 'firefox', 'webkit']) {
    // a browser not installed is said, not failed
    if (name !== 'chromium' && !existsSync(pw[name].executablePath())) { console.log(`skip scrollbar: ${name} is not installed`); continue; }
    // headless Chromium hides its bars unless asked (Playwright's --hide-scrollbars): shown, they are classic (Linux)
    const b = await pw[name].launch(name === 'chromium' ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {});
    const ctx = await b.newContext({ viewport: { width: 1300, height: 860 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(240000);
    await page.goto(`${BASE}${Q}&fresh#/doc/sample`);
    await page.waitForFunction(() => (window as any).editorAPI?.workbench);
    await idle(page);
    const measure = () => page.evaluate(() => [...document.querySelectorAll('main.rtx-pane')].map((m) => {
      const r = m.getBoundingClientRect(), inset = parseFloat(getComputedStyle(m).scrollPaddingTop) || 0;
      let track: number | null = null;
      try { const v = getComputedStyle(m, '::-webkit-scrollbar-track').marginTop; track = CSS.supports('selector(::-webkit-scrollbar)') ? parseFloat(v) || 0 : null; } catch { /* none */ }
      // the glass over this pane: the bar's bottom, or its group's strip's
      const g = m.closest('.wb-group'), strip = g?.querySelector('.wb-strip:not(.wb-strip--inbar)') as HTMLElement | null;
      const glass = Math.max(document.querySelector('.wb-bar')!.getBoundingClientRect().bottom, strip ? strip.getBoundingClientRect().bottom : 0);
      const trackTop = track == null ? r.top : r.top + track;
      return { trackTop: Math.round(trackTop), glass: Math.round(glass), inset, track };
    }));
    const mode = await page.evaluate(() => document.documentElement.dataset.wbScrollbars);
    const one = await measure();
    await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
    await page.waitForFunction(() => Object.keys((window as any).editorAPI.editors()).length === 2);
    await idle(page);
    const two = await measure();
    if (mode === 'overlay' && name !== 'firefox') check(`scrollbar (${name}): overlay bars are the platform's own (no styled track)`, [...one, ...two].every((x) => !x.track), { mode, one, two });
    else check(`scrollbar (${name}, ${mode ?? 'no ::-webkit-scrollbar'}): the track starts below the bar and the strip (one group, side by side)`, [...one, ...two].every((x) => x.trackTop >= x.glass - 1), { mode, one, two });
    await ctx.close();
    await b.close();
  }
}
