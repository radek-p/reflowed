// a stacked editing popover keeps its place in the window while its live preview grows and shrinks, and nothing
// shakes while typing, in both panes.
//
//   node tests/test-popover-hold.ts [http://localhost:8150/]
//
// The long test document (the intro repeated) on the engine (live results land as typed), a paragraph opened in the middle of the pane, each pane:
//   grow    74 keystrokes at its end (the preview grows by a line or more)
//   shrink  then 140 Backspaces (what was typed and some of the paragraph: the preview shrinks below where it was)
//   still   then, the reader's keys over (the anchor keeper holds again: perf/anchor.js ACTIVE_MS), a sentence inserted
//           without a key (execCommand): its result lands while no key is pressed, and the popover holds all the same
//           (the keeper took the popover's correction for a change of the page and scrolled it back)
// every frame from the first key to idle after the last: the popover's top (≤ 1 px over the whole run), the preview's
// top and height; the preview's top moves one way per phase (up while it grows, down while it shrinks: any step
// Waits on whenIdle() and frames; the keys are typed with a 40 ms delay (a typist's pace, so results land between).
import { createRequire } from 'node:module';
import { paneA, splitB } from './qa/lib/panes.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:8150/').replace(/\/?$/, '/');
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  n++; const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 500)}` : ''}`); if (!ok) fail++;
};
// the panes' selectors: pane A the document's tab, pane B the split's
const SEL: Record<string, string> = {};
const ctx = await pw.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-hold-')), { viewport: { width: 1600, height: 900 } });
const page = ctx.pages()[0] ?? await ctx.newPage();
page.setDefaultTimeout(300000);
const errors: string[] = [];
page.on('pageerror', (e: any) => errors.push(e.message.slice(0, 200)));
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = (k = 2) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(0)); f(k); }), k);

await page.goto(`${BASE}?engine&store=memory&seed=long#/doc/long`);
await page.waitForFunction(() => (window as any).editorAPI?.whenIdle && document.querySelectorAll('[data-part="page"] .blocks > .blk').length > 20);
await idle();
SEL.a = await paneA(page);
const id = await page.evaluate(() => (window as any).editorAPI.blocks().filter((b: any) => b.kind === 'paragraph' && b.source.length > 300 && b.source.length < 900 && !b.parentId)[2].id);

/** the per-frame recorder: [t, popover top, preview top, preview height, phase] */
const rec = (sel: string) => page.evaluate((s: string) => {
  const w = window as any; w.__h = []; w.__on = true; w.__phase = 0;
  const f = () => {
    const b = document.querySelector(`${s} .blk.editing`) as HTMLElement | null;
    if (b) { const p = b.querySelector('.blk-source')!.getBoundingClientRect(), x = b.querySelector('.blk-render')!.getBoundingClientRect(); w.__h.push([performance.now(), p.top, x.top, x.height, w.__phase, document.documentElement.classList.contains('rtx-moving') || !!b.closest('.rtx-moving')]); }
    if (w.__on) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}, sel);
const oneWay = (ys: number[], dir: number) => { let worst = 0; for (let i = 1; i < ys.length; i++) { const d = ys[i] - ys[i - 1]; if (Math.sign(d) === -dir && Math.abs(d) > worst) worst = Math.abs(d); } return worst; };

for (const p of ['a', 'b']) {
  if (p === 'b') { SEL.b = await splitB(page); await idle(); }
  const sel = SEL[p];
  // the paragraph in the middle of the pane, opened at its start by a click
  await page.evaluate(([s, i]: string[]) => (document.querySelector(s) as HTMLElement).querySelector(`.blk[data-id="${i}"]`)!.scrollIntoView({ block: 'center' }), [sel, id]);
  await idle(); await frames(3);
  const pt = await page.evaluate(([s, i]: string[]) => { const r = document.querySelector(`${s} .blk[data-id="${i}"] .blk-render`)!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 12 }; }, [sel, id]);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction(([pp, i]: string[]) => (window as any).editorAPI.sessions().some((s: any) => s.pane === pp && s.id === i), [/data-pane="([^"]+)"/.exec(sel)![1], id]);
  await idle(); await frames(20);                                          // the open's motion is over
  const mode = await page.evaluate((s: string) => (document.querySelector(`${s} .blk.editing`) as HTMLElement).dataset.editLayout, sel);
  await rec(sel);
  // grow: 20 keystrokes at the end
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' and some more words typed here, to grow the paragraph by a line or more.', { delay: 40 });
  await idle(); await frames(10);
  // shrink: 60 Backspaces
  await page.evaluate(() => { (window as any).__phase = 1; });
  for (let k = 0; k < 140; k++) await page.keyboard.press('Backspace', { delay: 15 });
  await idle(); await frames(10);
  const h: any[] = await page.evaluate(() => { (window as any).__on = false; return (window as any).__h; });
  const grow = h.filter((x) => x[4] === 0), shrink = h.filter((x) => x[4] === 1);
  const span = (rows: any[], k: number) => (rows.length ? Math.max(...rows.map((v) => v[k])) - Math.min(...rows.map((v) => v[k])) : 0);
  const grewBy = (grow.at(-1)?.[3] ?? 0) - (grow[0]?.[3] ?? 0), shrankBy = (shrink[0]?.[3] ?? 0) - (shrink.at(-1)?.[3] ?? 0);
  check(`[${p}] the case: stacked, the preview grew (${Math.round(grewBy)} px) and shrank (${Math.round(shrankBy)} px)`, mode === 'stacked' && grewBy > 10 && shrankBy > 10, { mode, grewBy, shrankBy, frames: h.length });
  check(`[${p}] the popover keeps its place in the window while the preview grows and shrinks (within 1 px)`, span(h, 1) <= 1, { popover: span(h, 1), moving: h.filter((x) => x[5]).length });
  // the preview's top goes up while it grows and down while it shrinks; no step back
  const back = { grow: oneWay(grow.map((v) => v[2]), -1), shrink: oneWay(shrink.map((v) => v[2]), 1) };
  check(`[${p}] no shake: the preview's top moves one way per phase (steps back ≤ 1 px)`, back.grow <= 1 && back.shrink <= 1, back);
  // still: no key pressed for 30 frames (over the keeper's 250 ms), then a sentence comes without a key event
  await frames(30);
  await rec(sel);
  await page.evaluate(() => document.execCommand('insertText', false, ' A sentence that comes without a key, long enough to take the paragraph to another line.'));
  await idle(); await frames(30);
  const hs: any[] = await page.evaluate(() => { (window as any).__on = false; return (window as any).__h; });
  const grewStill = (hs.at(-1)?.[3] ?? 0) - (hs[0]?.[3] ?? 0);
  check(`[${p}] a result landing while no key is pressed: the preview grew (${Math.round(grewStill)} px) and the popover kept its place (within 1 px)`,
    grewStill > 10 && span(hs, 1) <= 1, { popover: span(hs, 1), grewStill, frames: hs.length });
  await page.keyboard.press('Escape'); await idle();
}
check('no page errors', errors.length === 0, errors);
await ctx.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
