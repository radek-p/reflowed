// Two editors mounted side by side in one page, in two plain divs (app/two-editors.html, the
// harness app/src/harness/two-editors.ts), each with its own document, on one page's services: both work, and
// neither touches the other — typing, undo, the outline, notes, find, the inspector, the document's settings (the Settings
// panel in its own sidebar) — and an editor unmounted
// leaves nothing behind (listeners on document and window, DOM nodes, the viewer's blocks, the heap, layers).
//
//   node tests/test-two-editors.ts [base=http://localhost:8151/] [--only <regex>]
//   sections: two (both editors, apart), leak (mount and unmount the right one 12 times: flat)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(resultsDir(HERE), 'two-editors');
mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
const argv = process.argv.slice(2);
const BASE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8151/';
const ONLY = argv.includes('--only') ? new RegExp(argv[argv.indexOf('--only') + 1]) : null;
const section = (name: string) => !ONLY || ONLY.test(name);

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 400)}` : ''}`);
}
const browser = await chromium.launch();
const problems: string[] = [];
const URL_ = `${BASE}two-editors.html?engine`;

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.setDefaultTimeout(180000);
  await page.goto(URL_);
  await page.waitForFunction(() => (window as any).twoEditors?.ready);
  await page.evaluate(() => (window as any).twoEditors.ready);
  return { ctx, page };
}
const H = (page: any, body: string, arg?: unknown) => page.evaluate(new Function('arg', `const h = window.twoEditors; return (async () => { ${body} })();`) as any, arg);
const idle = (page: any, slot: string) => H(page, `await h.api(arg)?.whenIdle(); return true;`, slot);
const frames = (page: any, n = 2) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(null)); f(k); }), n);
async function mount(page: any, slot: string) {
  const ok = await H(page, `return h.mount(arg);`, slot);
  await idle(page, slot);
  await frames(page);
  return ok;
}
/** the editor in #ed-<slot>: its blocks, typeset ones, its outline's entries, its title, its root's data attributes */
const look = (page: any, slot: string) => page.evaluate((s: string) => {
  const el = document.getElementById(`ed-${s}`)!;
  const blocks = [...el.querySelectorAll('.blocks > .blk')];
  return {
    root: el.classList.contains('rtx-editor'), embedded: el.hasAttribute('data-embedded'),
    blocks: blocks.length, typeset: el.querySelectorAll('.blocks > .blk .blk-render > .latex-block').length,
    outline: [...el.querySelectorAll('.ol-item')].map((x) => (x.textContent ?? '').trim()).filter(Boolean),
    title: (el.querySelector('.topbar .doc-name, .topbar .doc-title') as HTMLInputElement | null)?.textContent || (el.querySelector('.topbar .doc-title') as HTMLInputElement | null)?.value || '',
    attrs: [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).sort(),
    sidebar: !!el.querySelector('.sidebar [data-part="sb-tabs"] [role="tab"]'), topbar: !!el.querySelector('.topbar #btn-sidebar, .topbar .sb-open'),
    ids: [...el.querySelectorAll('[id]')].filter((x) => !x.closest('.blk-render')).map((x) => x.id),   // (the typeset text's anchors are the document's)
    untypeset: blocks.filter((b) => !b.querySelector('.blk-render > .latex-block')).map((b) => (b as HTMLElement).dataset.kind),
  };
}, slot);
const sourceOf = (page: any, slot: string, i: number) => H(page, `return h.api(arg.slot).blocks()[arg.i].source;`, { slot, i });

// the document part alone (mountEditor's sidebar: false): the page and its blocks, no sidebar; the panels' data is the
// container's (root.state.panels) for a host to draw; unmounted, nothing stays
if (section('part')) {
  const { ctx, page } = await open();
  const ok = await H(page, `return h.mount('a', undefined, { sidebar: false });`);
  await idle(page, 'a');
  const a = await look(page, 'a');
  const panels = await H(page, `const ed = h.editor('a'); const p = ed.root.state.panels.value; return { outline: p ? p.lists.outline.value.length : -1, add: !!document.querySelector('#ed-a [data-part="add-end"] .add-end') };`);
  check('document part: mounted without a sidebar, its blocks typeset, its top bar there', ok && a.blocks > 5 && a.typeset > 5 && !a.sidebar, a);
  check('document part: the panels\' data is the container\'s (the outline), "Add a block" drawn', panels.outline > 0 && panels.add, panels);
  await H(page, `h.unmount('a');`);
  const left = await page.evaluate(() => document.getElementById('ed-a')!.childNodes.length);
  check('document part: unmounted, its div empty', left === 0, left);
  await ctx.close();
}

if (section('two')) {
  const { ctx, page } = await open();
  const okA = await mount(page, 'a'), okB = await mount(page, 'b');
  const A = await look(page, 'a'), B = await look(page, 'b');
  check('two: both editors mounted in their divs, each on its own document, typeset', okA && okB && A.root && B.root && A.embedded && B.embedded && A.blocks > 10 && B.blocks === A.blocks + 1 && A.untypeset.every((k: string) => k === 'appendix') && B.untypeset.every((k: string) => k === 'appendix') && A.typeset > 10 && B.typeset === A.typeset + 1,   // (\appendix draws nothing)
    { okA, okB, A: { blocks: A.blocks, typeset: A.typeset, not: A.untypeset }, B: { blocks: B.blocks, typeset: B.typeset, not: B.untypeset } });
  check('two: each has its own top bar and sidebar', A.sidebar && B.sidebar && A.topbar && B.topbar, { A: [A.sidebar, A.topbar], B: [B.sidebar, B.topbar] });
  const dup = A.ids.filter((x) => B.ids.includes(x));
  check('two: no element id is in both editors', dup.length === 0, dup.slice(0, 8));
  check('two: each outline lists its own document\'s sections', A.outline.some((t) => /Functors and natural transformations/.test(t)) && !A.outline.some((t) => /Only on the right/.test(t))
    && B.outline.some((t) => /Only on the right/.test(t)) && !B.outline.some((t) => /Functors and natural transformations/.test(t)), { A: A.outline.slice(0, 8), B: B.outline.slice(0, 8) });

  // ── typing: the block editor of A, a word typed: in A's document only ──
  const para = 3;                                         // the first paragraph (after \maketitle, the abstract, \section)
  const a0 = await sourceOf(page, 'a', para), b0 = await sourceOf(page, 'b', para);
  await page.click(`#ed-a .blocks > .blk:nth-child(${para + 1}) .blk-render`);
  await page.waitForFunction(() => !!document.querySelector('#ed-a .blk.editing .cm-content'));
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('Leftword ');
  await page.waitForFunction((p: number) => (window as any).twoEditors.api('a').blocks()[p].source.startsWith('Leftword '), para);
  const typedA = await sourceOf(page, 'a', para), typedB = await sourceOf(page, 'b', para);
  const editingIn = await page.evaluate(() => ({ a: document.getElementById('ed-a')!.hasAttribute('data-editing'), b: document.getElementById('ed-b')!.hasAttribute('data-editing') }));
  check('typing: a word typed in the left editor is in its document only; data-editing on its container only', typedA === `Leftword ${a0}` && typedB === b0 && editingIn.a && !editingIn.b, { typedA: typedA.slice(0, 40), typedB: typedB.slice(0, 40), editingIn });

  // ── the same in B, while A's editor is open: A's stays open (a press in another editor is not "outside" A's block) ──
  await page.click(`#ed-b .blocks > .blk:nth-child(${para + 1}) .blk-render`);
  await page.waitForFunction(() => !!document.querySelector('#ed-b .blk.editing .cm-content'));
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('Rightword ');
  await page.waitForFunction((p: number) => (window as any).twoEditors.api('b').blocks()[p].source.startsWith('Rightword '), para);
  const bothOpen = await page.evaluate(() => ({ a: !!document.querySelector('#ed-a .blk.editing'), b: !!document.querySelector('#ed-b .blk.editing') }));
  check('typing: then a word in the right editor: in its document only; the left editor\'s block stays open', (await sourceOf(page, 'b', para)) === `Rightword ${b0}` && (await sourceOf(page, 'a', para)) === `Leftword ${a0}` && bothOpen.a && bothOpen.b, bothOpen);

  // ── undo: ⌘Z in each editor undoes its own document's typing ──
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#ed-b .blk.editing'));
  await page.click('#ed-b .blocks > .blk:nth-child(2) .blk-render');   // a press in B's page (a block, not its editor)
  await page.keyboard.press('Escape');
  await H(page, `await h.api('b').whenIdle(); return true;`);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction((p: number) => !(window as any).twoEditors.api('b').blocks()[p].source.startsWith('Rightword'), para);
  const undoneB = { a: await sourceOf(page, 'a', para), b: await sourceOf(page, 'b', para) };
  check('undo: ⌘Z in the right editor undoes its typing; the left document keeps its own', undoneB.b === b0 && undoneB.a === `Leftword ${a0}`, { a: undoneB.a.slice(0, 30), b: undoneB.b.slice(0, 30) });
  await page.keyboard.press('Escape');
  await page.click('#ed-a .blocks > .blk:nth-child(2) .blk-render');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.blk.editing'));
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction((p: number) => !(window as any).twoEditors.api('a').blocks()[p].source.startsWith('Leftword'), para);
  check('undo: and ⌘Z in the left editor undoes the left typing; the right document is as it was', (await sourceOf(page, 'a', para)) === a0 && (await sourceOf(page, 'b', para)) === b0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.blk.editing'));

  // ── find: ⌘F in the left editor opens its own bar; a word only the right document has is not found there ──
  await page.click('#ed-a .blocks > .blk:nth-child(2) .blk-render');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+f');
  await page.waitForFunction(() => document.getElementById('ed-a')!.hasAttribute('data-finding'));
  await page.keyboard.type('zebra');
  await frames(page, 3);
  const findA = await page.evaluate(() => ({
    a: document.getElementById('ed-a')!.hasAttribute('data-finding'), b: document.getElementById('ed-b')!.hasAttribute('data-finding'),
    count: document.querySelector('#ed-a [data-part="find"] .find-count, #ed-a [data-part="find"] [class*="count"]')?.textContent ?? '',
    barB: !!document.querySelector('#ed-b [data-part="find"] .find-bar:not([hidden])'),
  }));
  check('find: ⌘F in the left editor opens its bar only; "zebra" (the right document\'s) is not found there', findA.a && !findA.b && !findA.barB && /No matches/.test(findA.count), findA);
  await page.keyboard.press('Escape');
  await page.click('#ed-b .blocks > .blk:nth-child(2) .blk-render');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+f');
  await page.waitForFunction(() => document.getElementById('ed-b')!.hasAttribute('data-finding'));
  await page.keyboard.type('zebra');
  await frames(page, 3);
  const findB = await page.evaluate(() => ({ count: document.querySelector('#ed-b [data-part="find"] .find-count, #ed-b [data-part="find"] [class*="count"]')?.textContent ?? '', a: document.getElementById('ed-a')!.hasAttribute('data-finding') }));
  check('find: the right editor\'s bar finds it in its own document', /1 of 1|1 in 1|^1/.test(findB.count.trim()) || /in 1 block/.test(findB.count), findB);
  await page.keyboard.press('Escape');

  // ── notes: each editor's TODO list is its document's; a note opens in its own editor ──
  const todos = await page.evaluate(() => {
    const n = (s: string) => document.querySelectorAll(`#ed-${s} .rtx-note-chip`).length;
    return { a: n('a'), b: n('b') };
  });
  check('notes: each editor draws its own document\'s note chips', todos.a > 0 && todos.b > 0, todos);

  // ── the inspector: the page's one panel inspects the editor worked in ──
  const insp = await page.evaluate(async () => {
    const h = (window as any).twoEditors;
    const root = (s: string) => document.getElementById(`ed-${s}`);
    document.querySelector('#ed-a .blocks > .blk .blk-render')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const onA = h.inspector.root?.el === root('a');
    document.querySelector('#ed-b .blocks > .blk .blk-render')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const onB = h.inspector.root?.el === root('b');
    return { onA, onB };
  });
  check('inspector: it follows the editor pressed in (left, then right)', insp.onA && insp.onB, insp);

  // ── focus mode and the sidebar: the container's state, the other editor's untouched ──
  await page.click('#ed-a .blocks > .blk:nth-child(2) .blk-render');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Shift+f');
  const focus = await page.evaluate(() => ({ a: document.getElementById('ed-a')!.hasAttribute('data-focus-mode'), b: document.getElementById('ed-b')!.hasAttribute('data-focus-mode') }));
  await page.keyboard.press('ControlOrMeta+Shift+f');
  await page.click('#ed-b .sb-top button, #ed-b [id$="btn-sidebar-close"]');
  const side = await page.evaluate(() => ({ a: document.getElementById('ed-a')!.hasAttribute('data-sidebar-closed'), b: document.getElementById('ed-b')!.hasAttribute('data-sidebar-closed') }));
  check('state: focus mode (⌘⇧F) in the left editor only; the right sidebar closed, the left one not', focus.a && !focus.b && side.b && !side.a, { focus, side });
  // ── the document's settings in an embedded editor: the Settings panel as a tab of its sidebar (opened, the sidebar
  // shown), on the document tab, its own document's preamble focused; the other editor's tab names its own document ──
  await page.evaluate(() => (window as any).twoEditors.api('b').commands().call('doc.settings', {}));
  await page.waitForFunction(() => !!document.activeElement?.closest('#ed-b .rtx-set-editor'), null, { timeout: 20000 }).catch(() => {});
  const ds = await page.evaluate(() => {
    const of = (s: string) => { const el = document.querySelector(`#ed-${s} .sb-panel .rtx-settings`); const host = el?.closest('.sb-panel') as HTMLElement | null;
      return { drawn: !!el, shown: !!host && !host.hidden, tab: el?.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab') ?? null,
        name: el?.querySelector('[role="tab"][data-tab="document"]')?.textContent?.trim() ?? null, pre: (el?.querySelector('.rtx-set-editor .cm-content') as HTMLElement | null)?.innerText.length ?? 0 }; };
    return { a: of('a'), b: of('b'), sidebarB: !document.getElementById('ed-b')!.hasAttribute('data-sidebar-closed'), focus: !!document.activeElement?.closest('#ed-b .rtx-set-editor') };
  });
  check('embedded: Document settings opens the Settings panel in the editor\'s own sidebar (shown again), on its document\'s tab, the preamble focused',
    ds.b.drawn && ds.b.shown && ds.sidebarB && ds.b.tab === 'document' && ds.b.name === 'Right document' && ds.b.pre > 0 && ds.focus, ds);
  check('embedded: the other editor\'s Settings tab names its own document', !ds.a.drawn || ds.a.name === 'Left document', ds.a);
  // ── status and crumbs as data: each editor's own ──
  const data = await page.evaluate(() => {
    const h = (window as any).twoEditors;
    const of = (s: string) => ({ status: h.editor(s).status.value, crumbs: h.editor(s).crumbs().value });
    return { a: of('a'), b: of('b') };
  });
  check('data: each editor\'s status (all typeset, no errors, saved) and crumbs (its document\'s name, its section in view)',
    data.a.status.typesetting === false && data.b.status.typesetting === false && !data.a.status.unsaved && data.a.crumbs.doc.title === 'Left document' && data.b.crumbs.doc.title === 'Right document'
      && !!data.a.crumbs.section && !!data.b.crumbs.section, data);
  writeFileSync(join(OUT, 'two.png'), await page.screenshot());
  check('two: no page errors', !problems.some((x) => /pageerror/.test(x)), problems.filter((x) => /pageerror/.test(x)).slice(0, 3));
  await ctx.close();
}

if (section('leak')) {
  problems.length = 0;
  const { ctx, page } = await open();
  await mount(page, 'a');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const count = async (expr: string) => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
    return listeners.length;
  };
  const measure = async () => {
    for (let k = 0; k < 3; k++) await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x: any) => [x.name, x.value]));
    return { document: await count('document'), window: await count('window'), listeners: m.JSEventListeners, nodes: m.Nodes, heap: Math.round(m.JSHeapUsedSize / 1024),
      viewer: await page.evaluate(() => (window as any).reflowtex.host.blocks().length),
      layers: await page.evaluate(() => document.querySelectorAll('.ui-layer, body > div').length),
      styles: await page.evaluate(() => document.querySelectorAll('style').length),
      roots: await page.evaluate(() => (window as any).twoEditors.roots()),
      right: await page.evaluate(() => { const el = document.getElementById('ed-b')!; return el.childNodes.length + [...el.attributes].filter((a) => a.name.startsWith('data-')).length + el.classList.length - 1; }) };
  };
  const cycle = async () => {
    await mount(page, 'b');
    await page.waitForFunction(() => document.querySelectorAll('#ed-b .blocks > .blk .blk-render > .latex-block').length > 10);
    await page.evaluate(() => (window as any).twoEditors.unmount('b'));
    await page.waitForFunction(() => !document.querySelector('#ed-b *'));
    await idle(page, 'a');
    await frames(page);
  };
  await page.mouse.click(5, 5);
  for (let k = 0; k < 2; k++) await cycle();
  const m0 = await measure();
  for (let k = 0; k < 12; k++) await cycle();
  const m1 = await measure();
  check('leak: 12 × the right editor mounted and unmounted: the same listeners on document and window', m1.document === m0.document && m1.window === m0.window, { document: [m0.document, m1.document], window: [m0.window, m1.window] });
  check('leak: … the same number of listeners in the page, viewer blocks, layers and styles; one editor left, its div empty', m1.listeners <= m0.listeners + 4 && m1.viewer === m0.viewer && m1.layers === m0.layers && m1.styles === m0.styles && m1.roots === 1 && m1.right === 0,
    { listeners: [m0.listeners, m1.listeners], viewer: [m0.viewer, m1.viewer], layers: [m0.layers, m1.layers], styles: [m0.styles, m1.styles], roots: m1.roots, right: m1.right });
  check('leak: … DOM nodes and the heap flat (nodes ±2 %, heap +3 MB at most)', m1.nodes <= m0.nodes * 1.02 + 20 && m1.heap - m0.heap <= 3 * 1024, { nodes: [m0.nodes, m1.nodes], heapKB: [m0.heap, m1.heap] });
  const still = await look(page, 'a');
  check('leak: the left editor still works (typeset, its outline)', still.untypeset.every((k: string) => k === 'appendix') && still.typeset > 10 && still.outline.length > 3, { blocks: still.blocks, typeset: still.typeset });
  check('leak: no page errors', !problems.some((x) => /pageerror/.test(x)), problems.filter((x) => /pageerror/.test(x)).slice(0, 3));
  await ctx.close();
}

await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
