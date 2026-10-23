// Caret and selection at text zoom != 100 % (View options' text size: CSS zoom on each .latex-block). For each zoom:
// glyphs sampled in the paragraphs in view are clicked at their centre; the editor's caret offset must be the one the
// same glyph gives at 100 % (the ground truth: the suites check 100 %), the mirrored caret bar in the preview must
// stand at that glyph's left or right edge on its line, and a 5-character selection made in the editor must be drawn
// over exactly those glyphs (the selection bands cover their centres and no glyph outside).
//
//   node tests/test-zoom-caret.ts [http://127.0.0.1:8150/] [--zooms 0.8,1.25,1.5,2] [--per 6] [--browser chromium|firefox|webkit]
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = (argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://127.0.0.1:8150/').replace(/\/?$/, '/');
const ZOOMS = (argv.includes('--zooms') ? argv[argv.indexOf('--zooms') + 1]! : '0.8,1.25,1.5,2').split(',').map(Number);
const BROWSER = argv.includes('--browser') ? argv[argv.indexOf('--browser') + 1]! : 'chromium';
const PER = Number(argv.includes('--per') ? argv[argv.indexOf('--per') + 1] : '6');


/** (in the page) a glyph's box in client px from its own x, y and font size and its <svg>'s rect: not from
 *  getBoundingClientRect on the <tspan> (WebKit gives the whole text run's box there) nor getScreenCTM (what is tested) */
const installBox = (page: any) => page.evaluate(() => {
  (window as any).__gbox = (t: Element) => {
    const svg = t.closest('svg') as SVGSVGElement, R = svg.getBoundingClientRect(), vb = svg.viewBox?.baseVal;
    const w0 = vb && vb.width ? vb.width : svg.width.baseVal.value, k = R.width / (w0 || 1), ox = vb && vb.width ? vb.x : 0, oy = vb && vb.width ? vb.y : 0;
    const x = parseFloat(t.getAttribute('x') ?? '0'), y = parseFloat(t.getAttribute('y') ?? '0'), fs = parseFloat(t.getAttribute('font-size') ?? (t.parentElement?.getAttribute('font-size') ?? '20'));
    const nx = (t.nextElementSibling as Element | null)?.getAttribute('x'), adv = nx != null && parseFloat(nx) > x ? parseFloat(nx) - x : fs * 0.5;
    const left = R.left + (x - ox) * k, base = R.top + (y - oy) * k;
    return { left, right: left + Math.min(adv, fs) * k, top: base - 0.75 * fs * k, bottom: base + 0.25 * fs * k, width: Math.min(adv, fs) * k, height: fs * k };
  };
});

export interface Sample { block: string; k: number; offset: number | null; caretOff: number | null; caretOn: boolean; selOk: boolean | null; detail?: unknown }

/** the k-th letter glyph of a block's render: its rect (client px) */
const glyphRect = (page: any, block: string, k: number) => page.evaluate(([b, kk]: [string, number]) => {
  const el = document.querySelector(`main.rtx-pane .blk[data-id="${b}"] .blk-render > .latex-block`);
  const g = [...(el?.querySelectorAll('svg text tspan') ?? [])].filter((t) => /\p{L}/u.test(t.textContent ?? ''))[kk];
  if (!g) return null;
  const r = (window as any).__gbox(g);
  return { x: r.left, y: r.top, w: r.width, h: r.height, ch: g.textContent };
}, [block, k]);

export async function sample(page: any, blocks: string[], per: number): Promise<Sample[]> {
  const out: Sample[] = [];
  for (const block of blocks) {
    const n = await page.evaluate((b: string) => [...(document.querySelector(`main.rtx-pane .blk[data-id="${b}"] .blk-render > .latex-block`)?.querySelectorAll('svg text tspan') ?? [])].filter((t) => /\p{L}/u.test(t.textContent ?? '')).length, block);
    for (let i = 0; i < per; i++) {
      const k = Math.floor(((i + 0.5) / per) * n);
      await page.evaluate((b: string) => document.querySelector(`main.rtx-pane .blk[data-id="${b}"]`)!.scrollIntoView({ block: 'center' }), block);
      await page.evaluate(() => (window as any).editorAPI.whenIdle());
      const r = await glyphRect(page, block, k);
      if (!r) continue;
      // a little right of the glyph's left edge: the caret goes before it (the editor's rule: the nearer boundary)
      await page.mouse.move(r.x + r.w * 0.25, r.y + r.h / 2);
      await page.mouse.click(r.x + r.w * 0.25, r.y + r.h / 2);
      await page.waitForSelector('.blk.editing .cm-editor');
      await page.evaluate(() => (window as any).editorAPI.whenIdle());
      const got = await page.evaluate(([b, kk]: [string, number]) => {
        const E = (window as any).editorAPI, view = E.editorView?.((document.querySelector('main.rtx-pane .blk.editing')?.closest('main.rtx-pane') as HTMLElement)?.dataset.pane);
        const head = view?.state.selection.main.head ?? null;
        const blk = document.querySelector(`main.rtx-pane .blk[data-id="${b}"]`)!;
        const g = [...blk.querySelectorAll('.blk-render > .latex-block svg text tspan')].filter((t) => /\p{L}/u.test(t.textContent ?? ''))[kk]!;
        const gr = (window as any).__gbox(g);
        const bar = blk.querySelector('.rtx-caret-bar')?.getBoundingClientRect() ?? null;
        // the bar at the glyph's left edge (the caret before it), on its line
        // (between this glyph and the one drawn before it on its line: a caret at a boundary that is a gap on the page, as
        // between text and maths after a space, is drawn in the gap)
        const all = [...blk.querySelectorAll('.blk-render > .latex-block svg text tspan')].filter((t) => (t.textContent ?? '').trim());
        const pe = all[all.indexOf(g) - 1], prev = pe ? (window as any).__gbox(pe) : null;
        const from = prev && Math.abs((prev.top + prev.bottom) / 2 - (gr.top + gr.bottom) / 2) < gr.height * 0.3 ? prev.right : gr.left, x = bar ? bar.left + bar.width / 2 : NaN;
        const caretOn = !!bar && x >= from - 2 && x <= gr.left + Math.max(2, gr.width * 0.35) && bar.top < gr.bottom && bar.bottom > gr.top;
        // (plain text: the glyph is its source character; a glyph of a macro's output (\\dist) is one unit with the call, the
        // caret goes before the call: no bar check there)
        const plain = head != null && view.state.sliceDoc(head, head + 1) === g.textContent;
        return { head, plain, caretOn: caretOn || !plain, bar: bar && { x: Math.round(bar.left), y: Math.round(bar.top), b: Math.round(bar.bottom) }, glyph: { x: Math.round(gr.left), y: Math.round(gr.top), b: Math.round(gr.bottom), w: Math.round(gr.width), ch: g.textContent }, prev: prev && { x: Math.round(prev.right), y: Math.round(prev.top), ch: all[all.indexOf(g) - 1]?.textContent } };
      }, [block, k]);
      // the selection: 5 characters from the caret, made in the editor; drawn over those glyphs in the preview
      const sel = await page.evaluate(async ([b, kk]: [string, number]) => {
        const E = (window as any).editorAPI, view = E.editorView?.((document.querySelector('main.rtx-pane .blk.editing')?.closest('main.rtx-pane') as HTMLElement)?.dataset.pane);
        if (!view) return null;
        const h = view.state.selection.main.head;
        // (only where the 5 characters are letters: 5 source characters are then 5 glyphs)
        if (!/^\p{L}{5}$/u.test(view.state.sliceDoc(h, h + 5))) return { skip: true };
        view.dispatch({ selection: { anchor: h, head: Math.min(view.state.doc.length, h + 5) } });
        await E.whenIdle();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const blk = document.querySelector(`main.rtx-pane .blk[data-id="${b}"]`)!;
        const bands = [...blk.querySelectorAll('.rtx-sel-band')].map((x) => x.getBoundingClientRect());
        const glyphs = [...blk.querySelectorAll('.blk-render > .latex-block svg text tspan')].filter((t) => /\p{L}/u.test(t.textContent ?? ''));
        const inBand = (g: Element) => { const r = (window as any).__gbox(g), cx = r.left + r.width / 2, cy = r.top + r.height / 2; return bands.some((q) => cx >= q.left - 0.5 && cx <= q.right + 0.5 && cy >= q.top - 0.5 && cy <= q.bottom + 0.5); };
        const want = glyphs.slice(kk, kk + 5).filter((g) => (g.textContent ?? '').trim()), wanted = new Set(want);
        // the 5 characters may include a space or punctuation: the letters among them must be covered, and nothing beyond
        const covered = want.filter(inBand).length, extra = glyphs.filter((g) => !wanted.has(g) && inBand(g)).length;
        return { bands: bands.length, covered, of: want.length, extra };
      }, [block, k]);
      out.push({ block, k, offset: got.head, caretOff: null, caretOn: got.caretOn, selOk: !sel ? null : (sel as any).skip ? true : sel.bands > 0 && sel.covered === sel.of && sel.extra === 0, detail: { ...got, sel } });
      // Escape until the editor is closed (a first Escape closes what is open in it: the completion list, a key's card)
      for (let e = 0; e < 3 && await page.$('.blk.editing'); e++) { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.blk.editing'), null, { timeout: 5000 }).catch(() => {}); }
      await page.waitForFunction(() => !document.querySelector('.blk.editing'));
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // webkit-gtk: WebKitGTK (Safari's engine) over WebDriver where Playwright's WebKit is missing (tests/qa/lib/webkit-driver.ts)
  const gtk = BROWSER === 'webkit-gtk' ? await (await import('./qa/lib/webkit-driver.ts')).webkit(process.env.WEBKIT_DRIVER ?? 'http://127.0.0.1:4444', { width: 1300, height: 900 }) : null;
  // (a failed run must not leave the driver's one session open: the next run could not start)
  if (gtk) for (const ev of ['uncaughtException', 'unhandledRejection'] as const) process.on(ev, async (e: unknown) => { console.error(e); await gtk.close(); process.exit(1); });
  const browser = gtk ? { close: () => gtk.close() } : await pw[BROWSER].launch();
  const page: any = gtk ? (await import('./qa/lib/webkit-driver.ts')).asPage(gtk) : await (browser as any).newPage({ viewport: { width: 1300, height: 900 } });
  page.setDefaultTimeout(60000);
  await page.goto(`${BASE}?engine&seed=sample&store=memory#/doc/sample`);
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle && document.querySelector('main.rtx-pane .blk-render > .latex-block svg'));
  await page.evaluate(() => (window as any).editorAPI.whenIdle());
  await installBox(page);
  const blocks: string[] = await page.evaluate(() => [...document.querySelectorAll('main.rtx-pane .blk[data-kind=paragraph]')].filter((b) => b.querySelectorAll('.latex-block svg text tspan').length > 60).slice(0, 3).map((b) => (b as HTMLElement).dataset.id!));
  const setZoom = async (z: number) => { await page.evaluate((zz: number) => (window as any).editorAPI.view().set({ zoom: zz }), z); await page.evaluate(() => (window as any).editorAPI.whenIdle()); };
  await setZoom(1);
  const truth = await sample(page, blocks, PER);
  if (truth.some((s) => s.offset == null || s.selOk == null)) { console.log('no editor view: the probe cannot read offsets', truth.slice(0, 2)); process.exit(2); }
  for (const t of truth.filter((x) => !x.caretOn || x.selOk === false)) console.log(`   at 100 % already (not the zoom's): ${t.block.slice(-6)} #${t.k}: ${JSON.stringify(t.detail)}`);
  console.log(`100 %: ${truth.length} samples; caret bar on the glyph ${truth.filter((s) => s.caretOn).length}/${truth.length}; selection drawn right ${truth.filter((s) => s.selOk).length}/${truth.length}`);
  let bad = 0;
  for (const z of ZOOMS) {
    await setZoom(z);
    const got = await sample(page, blocks, PER);
    const off = got.filter((s, i) => s.offset !== truth[i]?.offset);
    // (what is wrong at 100 % too is not the zoom's: reported at 100 %, not counted here)
    const car = got.filter((s, i) => !s.caretOn && truth[i]?.caretOn), sel = got.filter((s, i) => s.selOk === false && truth[i]?.selOk !== false);
    bad += off.length + car.length + sel.length;
    console.log(`${Math.round(z * 100)} %: offsets as at 100 % ${got.length - off.length}/${got.length}; caret bar on the glyph ${got.length - car.length}/${got.length}; selection drawn right ${got.length - sel.length}/${got.length}`);
    for (const s of [...off, ...car, ...sel].slice(0, 4)) console.log(`   ${s.block.slice(-6)} #${s.k}: offset ${s.offset} (100 %: ${truth.find((t) => t.block === s.block && t.k === s.k)?.offset}) ${JSON.stringify(s.detail)}`);
  }
  await browser.close();
  console.log(`\n${BROWSER}: ${bad ? `${bad} misses` : 'all as at 100 %'}`);
  process.exit(bad ? 1 : 0);
}
