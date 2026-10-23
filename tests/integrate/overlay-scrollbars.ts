// ── scrollbar room: no room is reserved for a scrollbar beyond what the browser itself takes. Overlay
// scrollbars (macOS, iOS: translucent, over the content) take none, so a scroller's clientWidth is its offsetWidth and
// the column is centred in the full width; classic ones (Windows, Linux, macOS "Always") take what the browser takes
// and no more. The workbench styles its scrollers' bars (a thin thumb, the track below the glass) only where the
// platform's bars are classic (workbench/src/scrollbars.ts): a styled ::-webkit-scrollbar is always a classic one, so on
// macOS it turned an overlay bar into a 12 px one that took room. Covered: the document pane, a split pane, the
// References panel and the code popover's editor; in Chromium with classic bars (the default on Linux), Chromium with
// overlay bars (mobile emulation) and WebKit ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^overlay-scrollbars$'
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Harness } from './harness.ts';

type Box = { name: string; bar: number; hbar: number; overflows: boolean; centred: number | null };

export default async function (h: Harness): Promise<void> {
  const { HERE, BASE, Q, check, idle } = h;
  const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
  // headless Chromium hides its bars (--hide-scrollbars, Playwright's default): shown, they are Linux's classic ones, or
  // overlay ones in mobile emulation; WebKit's (WebKitGTK) are overlay ones, as macOS's
  const shown = { ignoreDefaultArgs: ['--hide-scrollbars'] };
  const forms: [string, string, Record<string, unknown>, Record<string, unknown>][] = [
    ['chromium, classic bars', 'chromium', shown, {}],
    ['chromium, overlay bars', 'chromium', shown, { isMobile: true, hasTouch: true }],
    ['webkit', 'webkit', {}, {}],
  ];
  for (const [form, name, launch, opts] of forms) {
    if (name !== 'chromium' && !existsSync(pw[name].executablePath())) { console.log(`skip overlay-scrollbars: ${name} is not installed`); continue; }
    const b = await pw[name].launch(launch);
    const ctx = await b.newContext({ viewport: { width: 1300, height: 860 }, reducedMotion: 'reduce', ...opts });
    const page = await ctx.newPage();
    page.setDefaultTimeout(240000);
    await page.goto(`${BASE}${Q}&fresh#/doc/sample`);
    await page.waitForFunction(() => (window as any).editorAPI?.workbench);
    await idle(page);
    // the platform's own bar: a plain scroller's (no styles of ours), and what the workbench made of it
    const platform = await page.evaluate(() => {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;top:-200px;left:0;width:100px;height:100px;overflow:scroll;visibility:hidden';
      document.body.append(d);
      const bar = d.offsetWidth - d.clientWidth;
      d.remove();
      return { bar, mode: document.documentElement.dataset.wbScrollbars ?? null };
    });
    const measure = (sel: string, label: string) => page.evaluate(([s, n]: string[]) => [...document.querySelectorAll(s!)].map((el, i): Box => {
      const e = el as HTMLElement, cs = getComputedStyle(e);
      const bl = parseFloat(cs.borderLeftWidth) || 0, br = parseFloat(cs.borderRightWidth) || 0;
      const bt = parseFloat(cs.borderTopWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0;
      // a pane's column (its children: max-width var(--col), centred): the gap at its right edge less the one at its left
      let centred: number | null = null;
      const kid = e.matches('main.rtx-pane') ? e.querySelector(':scope > .doc-view-host') as HTMLElement | null : null;
      if (kid) {
        const r = e.getBoundingClientRect(), k = kid.getBoundingClientRect();
        const left = k.left - (r.left + bl + (parseFloat(cs.paddingLeft) || 0));
        const right = (r.left + bl + e.clientWidth - (parseFloat(cs.paddingRight) || 0)) - k.right;
        centred = Math.round((right - left) * 10) / 10;
      }
      return { name: `${n}${i ? ` ${i + 1}` : ''}`, bar: e.offsetWidth - bl - br - e.clientWidth, hbar: e.offsetHeight - bt - bb - e.clientHeight,
        overflows: e.scrollHeight > e.clientHeight + 1, centred };
    }), [sel, label]);
    const boxes: Box[] = [];
    boxes.push(...await measure('main.rtx-pane', 'document pane'));
    // a split: two panes side by side
    await page.evaluate(() => (window as any).editorAPI.workbench().run('splitRight'));
    await page.waitForFunction(() => Object.keys((window as any).editorAPI.editors()).length === 2);
    await idle(page);
    boxes.push(...await measure('main.rtx-pane', 'split pane'));
    // the code popover's editor: a paragraph edited
    await page.evaluate(async () => {
      const E = (window as any).editorAPI, t = E.workbench().current.peek().tab.id, A = E.forPane(t);
      const blk = A.blocks().filter((x: any) => x.kind === 'paragraph' && x.source.length > 40)[0];
      A.editIn(t, blk.id, 0); await E.whenIdle();
    });
    await page.waitForFunction(() => !!document.querySelector('.blk.editing .cm-scroller'));
    boxes.push(...await measure('.blk.editing .cm-scroller', 'code popover'));
    await page.keyboard.press('Escape');
    await idle(page);
    // the References panel (bibpane): its list's scroller
    await page.evaluate(() => (window as any).editorAPI.workbench().showPanel('references'));
    await page.waitForFunction(() => !!document.querySelector('.bp-body'));
    await idle(page);
    boxes.push(...await measure('.bp-body', 'References'));
    const classic = platform.bar > 0;
    // nothing beyond the browser's own bar; none where the bars are overlay ones; none where nothing overflows
    const bad = boxes.filter((x) => x.bar > platform.bar || x.hbar > platform.bar || (!classic && (x.bar !== 0 || x.hbar !== 0))
      || (!x.overflows && x.bar !== 0) || (x.centred != null && Math.abs(x.centred) > 1));
    check(`overlay-scrollbars (${form}): the workbench reads the platform's bars (${classic ? 'classic' : 'overlay'}, ${platform.bar} px)`, platform.mode === (classic ? 'classic' : 'overlay'), platform);
    check(`overlay-scrollbars (${form}): no room for a scrollbar beyond the browser's own; the column centred in the visible width`, boxes.length >= 5 && bad.length === 0, { platform, bad, boxes });
    await ctx.close();
    await b.close();
  }
}
