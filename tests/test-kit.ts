// The design kit's shared parts in headless Chromium, without the app: the kit (app/src/design/ui/index.js) and the
// shared components are bundled into one page (esbuild, iife) and driven there. Waits on DOM state, never on times.
//
//   node tests/test-kit.ts [--only <regex>]
//
// Island (rendered once, never re-rendered); the layer stack (one stacking order, one Escape order, one outside-press
// rule, focus back to the opener); one toast stack; the shared Copy button and diff view; the Sheet.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(HERE, 'app/package.json'));
const { chromium } = req('playwright');
const esbuild = req('esbuild');
const argv = process.argv.slice(2);
const ONLY = argv.includes('--only') ? new RegExp(argv[argv.indexOf('--only') + 1]) : null;

const ENTRY = `
import * as kit from './app/src/design/ui/index.js';
import { DiffView } from './app/src/view/diff-view.js';
import { shownBlock } from './app/src/view/shown.ts';
import { moveInto } from './workbench/src/workbench.ts';
import * as preact from 'preact';
import * as hooks from 'preact/hooks';
import * as signals from '@preact/signals';
import * as theme from './app/src/design/theme.ts';
window.kit = kit; window.shownBlock = shownBlock; window.moveInto = moveInto; window.theme = theme; window.DiffView = DiffView; window.preact = preact; window.hooks = hooks; window.signals = signals;
`;
const out = await esbuild.build({
  stdin: { contents: ENTRY, resolveDir: HERE, loader: 'js' }, bundle: true, format: 'iife', target: 'es2022', write: false,
  loader: { '.css': 'text' }, nodePaths: [join(HERE, 'app/node_modules')], logLevel: 'warning',
});
const BUNDLE = out.outputFiles[0].text;

let n = 0, failed = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  n++; if (!ok) failed++;
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 400)}` : ''}`);
}

const browser = await chromium.launch();
async function fresh(scheme: 'light' | 'dark' = 'light') {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, colorScheme: scheme });
  page.on('pageerror', (e: Error) => check(`no page error`, false, e.message));
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:2000px"></body></html>');
  await page.addScriptTag({ content: BUNDLE });
  return page;
}
const groups: [string, () => Promise<void>][] = [];
const group = (name: string, f: () => Promise<void>) => groups.push([name, f]);

// ── Island ──
group('island', async () => {
  const page = await fresh();
  const r = await page.evaluate(() => {
    const { html, render, Island } = (window as any).kit;
    const box = document.createElement('div'); document.body.append(box);
    const draw = (k: number) => render(html`<div class="outer" data-k=${k}><${Island} tag="pre" class="isl" data-k=${k} /></div>`, box);
    draw(1);
    const isl = box.querySelector('.isl')!;
    isl.append(Object.assign(document.createElement('span'), { textContent: 'owned elsewhere' }));
    isl.classList.add('mine');
    draw(2);
    const same = box.querySelector('.isl') === isl;
    return { tag: isl.tagName, same, kept: isl.textContent, cls: isl.className, k: (isl as HTMLElement).dataset.k, outerK: (box.firstElementChild as HTMLElement).dataset.k };
  });
  check('Island: renders its tag with its first props', r.tag === 'PRE' && r.k === '1', r);
  check('Island: a re-render keeps the element, its contents and the classes set on it', r.same && r.kept === 'owned elsewhere' && r.cls === 'isl mine' && r.outerK === '2', r);
  await page.close();
});

// ── the one overlay layer ──
group('layers', async () => {
  const page = await fresh();
  // two popovers (the second opened from inside the first), a menu-like layer from openLayer, a toast, a pill
  await page.evaluate(() => {
    const w = window as any, { kit } = w;
    const b1 = Object.assign(document.createElement('button'), { id: 'b1', textContent: 'open' });
    const out = Object.assign(document.createElement('button'), { id: 'out', textContent: 'elsewhere' });
    out.style.cssText = 'position:absolute;left:600px;top:600px';
    const chrome = Object.assign(document.createElement('div'), { id: 'chrome' }); chrome.setAttribute('data-ui-chrome', '');
    const tip = Object.assign(document.createElement('div'), { className: 'cm-tooltip' });
    document.body.append(b1, out, chrome, tip);
    w.log = [];
    w.openP1 = () => {
      b1.focus();
      w.p1 = kit.openLayer((close: () => void) => kit.html`<div id="p1" style="position:fixed;left:10px;top:40px;width:200px;height:120px">
          <input id="p1-in" /><button id="p1-b">inner</button></div>`,
        { kind: 'popover', anchor: b1, toggle: true, onDismiss: (r: string) => { w.log.push(`p1:${r}`); w.p1.close(); } });
      document.getElementById('p1-in')!.focus();
    };
    w.openP2 = () => {
      w.p2 = kit.openLayer(() => kit.html`<div id="p2" style="position:fixed;left:30px;top:200px;width:200px;height:80px"><button id="p2-b">deep</button></div>`,
        { kind: 'menu', anchor: document.getElementById('p1-b'), onDismiss: (r: string) => { w.log.push(`p2:${r}`); w.p2.close(); } });
      document.getElementById('p2-b')!.focus();
    };
    w.openP1(); w.openP2();
    kit.showToast('Hello', { duration: 0 });
    const pill = Object.assign(document.createElement('button'), { id: 'pill', textContent: 'Back' }); pill.style.position = 'fixed';
    document.body.append(pill); w.pill = kit.pushLayer({ el: pill, kind: 'pill' });
  });
  const z = await page.evaluate(() => {
    const zi = (s: string) => Number(getComputedStyle(document.querySelector(s)!.closest('.ui-layer, .ui-toasts, #pill') as Element).zIndex);
    return { p1: zi('#p1'), p2: zi('#p2'), toast: zi('.ui-toast'), pill: zi('#pill'), kinds: (window as any).kit.layerState().map((l: any) => l.kind) };
  });
  check('stacking: a later float is above an earlier one; pill < floats < toasts (from the tokens)', z.pill < z.p1 && z.p1 < z.p2 && z.p2 < z.toast && z.p1 >= 50 && z.toast >= 80, z);
  // owns(): layers, foreign floating boxes and the chrome; not the page
  const own = await page.evaluate(() => { const { owns } = (window as any).kit; return [owns(document.getElementById('p2-b')), owns(document.querySelector('.ui-toast')), owns(document.querySelector('.cm-tooltip')), owns(document.getElementById('chrome')), owns(document.getElementById('out'))]; });
  check('owns(): a layer, a toast, CodeMirror\'s tooltip, the chrome own a press; the page does not', own.join() === 'true,true,true,true,false', own);
  // Escape: the top layer only, nothing below sees the key; focus back to its opener
  await page.evaluate(() => { (window as any).docKeys = 0; document.addEventListener('keydown', (e) => { if (e.key === 'Escape') (window as any).docKeys++; }); });
  await page.keyboard.press('Escape');
  let st = await page.evaluate(() => ({ log: (window as any).log.join(), p1: !!document.getElementById('p1'), p2: !!document.getElementById('p2'), focus: document.activeElement?.id, doc: (window as any).docKeys }));
  check('Escape closes the top layer only; the page does not see the key', st.log === 'p2:escape' && st.p1 && !st.p2 && st.doc === 0, st);
  check('... the focus goes back to what had it when that layer opened', st.focus === 'p1-in', st);
  // an Escape a widget inside the top layer consumed (defaultPrevented) is the widget's
  await page.evaluate(() => { document.getElementById('p1-in')!.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !(window as any).consumed) { (window as any).consumed = true; e.preventDefault(); } }); });
  await page.keyboard.press('Escape');
  st = await page.evaluate(() => ({ log: (window as any).log.join(), p1: !!document.getElementById('p1'), focus: document.activeElement?.id, doc: (window as any).docKeys }));
  check('an Escape a widget inside the layer consumed leaves the layer open', st.p1 && st.log === 'p2:escape', st);
  await page.keyboard.press('Escape');
  st = await page.evaluate(() => ({ log: (window as any).log.join(), p1: !!document.getElementById('p1'), focus: document.activeElement?.id, doc: (window as any).docKeys }));
  check('the next Escape closes it, the focus back on its button; toasts and pills stay', !st.p1 && st.focus === 'b1' && st.log === 'p2:escape,p1:escape'
    && await page.locator('.ui-toast').count() === 1 && await page.locator('#pill').count() === 1, st);
  await page.keyboard.press('Escape');
  st = await page.evaluate(() => ({ doc: (window as any).docKeys }));
  check('with no layer open the page has its Escape', st.doc === 2, st);
  // with the focus outside the layers (body), Escape still closes the top one
  await page.evaluate(() => { const w = window as any; w.log = []; w.openP1(); w.openP2(); (document.activeElement as HTMLElement).blur(); });
  await page.keyboard.press('Escape');
  st = await page.evaluate(() => ({ log: (window as any).log.join(), p1: !!document.getElementById('p1') }));
  check('Escape with the focus elsewhere: the top layer', st.log === 'p2:escape' && st.p1, st);
  // outside press: from the top, every float the press is outside of; stops at the layer that contains it
  await page.evaluate(() => { const w = window as any; w.log = []; w.openP2(); });
  await page.click('#p1-in');
  st = await page.evaluate(() => ({ log: (window as any).log.join(), p1: !!document.getElementById('p1'), p2: !!document.getElementById('p2') }));
  check('a press in the lower layer closes the one above only', st.log === 'p2:outside' && st.p1 && !st.p2, st);
  await page.evaluate(() => { const w = window as any; w.log = []; w.openP2(); w.outClicks = 0; document.getElementById('out')!.addEventListener('click', () => w.outClicks++); });
  await page.click('#out');
  st = await page.evaluate(() => ({ log: (window as any).log.join(), p1: !!document.getElementById('p1'), clicks: (window as any).outClicks }));
  check('a press outside them all closes both, top first; the press goes on to its target', st.log === 'p2:outside,p1:outside' && !st.p1 && st.clicks === 1, st);
  // a toggle anchor: a press on the button that opened the layer is not outside; toggling() says so during its click
  await page.evaluate(() => { const w = window as any; w.log = []; w.openP1(); w.tog = null;
    document.getElementById('b1')!.addEventListener('click', (e) => { w.tog = w.kit.toggling(e.currentTarget); }); });
  await page.click('#b1');
  st = await page.evaluate(() => ({ log: (window as any).log.join(), p1: !!document.getElementById('p1'), tog: (window as any).tog, after: (window as any).kit.toggling(document.getElementById('b1')) }));
  check('a press on the toggle anchor leaves the layer to its button; toggling() is true in that click only', st.log === '' && st.p1 && st.tog === true && st.after === false, st);
  await page.close();
});

// ── one toast stack ──
group('toasts', async () => {
  const page = await fresh();
  const r = await page.evaluate(async () => {
    const { kit } = window as any;
    kit.showToast('one', { duration: 0, id: 'toast', textId: 'toast-text', action: { key: 'undo', id: 'toast-undo', label: 'Undo', onClick: () => { (window as any).undone = true; } } });
    kit.showToast('two', { duration: 0, id: 'toast', textId: 'toast-text', action: { key: 'undo', id: 'toast-undo', label: 'Undo', onClick: () => { (window as any).undone = true; } } });
    return { hosts: document.querySelectorAll('.ui-toasts').length, n: document.querySelectorAll('#toast').length, text: document.getElementById('toast-text')?.textContent, layer: kit.layerState().some((l: any) => l.kind === 'toast') };
  });
  check('one toast stack: a new toast replaces the last (one #toast), in the layer order', r.hosts === 1 && r.n === 1 && r.text === 'two' && r.layer, r);
  await page.click('#toast-undo');
  await page.waitForSelector('#toast', { state: 'detached' });
  check('the action runs and the toast goes', await page.evaluate(() => (window as any).undone === true));
  await page.close();
});

// ── the one Copy button and the one diff view ──
group('copy-diff', async () => {
  const page = await fresh();
  await page.evaluate(() => {
    const w = window as any, { html, render, CopyButton } = w.kit;
    const box = document.createElement('div'); document.body.append(box);
    w.downs = 0; box.addEventListener('pointerdown', () => w.downs++);
    // about:blank is no secure context: a clipboard that records what it is given
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (s: string) => { w.clip = s; } }, configurable: true });
    render(html`<div><${CopyButton} class="err-copy" title="Copy the report" text=${() => 'the report'} />
      <${w.DiffView} a=${'one two\nthree'} b=${'one 2\nthree'} /><${w.DiffView} a="same" b="same" /></div>`, box);
  });
  await page.click('.err-copy');
  await page.waitForFunction(() => document.querySelector('.err-copy')?.textContent === 'Copied');
  const r = await page.evaluate(async () => ({ clip: (window as any).clip, copied: (document.querySelector('.err-copy') as HTMLElement).dataset.copied,
    cls: document.querySelector('.err-copy')!.className, downs: (window as any).downs, title: document.querySelector('.err-copy')!.getAttribute('title') }));
  check('CopyButton: the text on the clipboard, "Copied" (data-copied=1); the press stops at the button', r.clip === 'the report' && r.copied === '1' && r.downs === 0 && r.cls === 'ui-copy err-copy' && r.title === 'Copy the report', r);
  await page.waitForFunction(() => document.querySelector('.err-copy')?.textContent === 'Copy', null, { timeout: 4000 });
  check('... and back to its label', true);
  const d = await page.evaluate(() => { const p = document.querySelectorAll('.live-diff'); return { ins: [...p[0].querySelectorAll('ins')].map((e) => e.textContent).join('|'), del: [...p[0].querySelectorAll('del')].map((e) => e.textContent).join('|'), ctx: p[0].querySelector('.ctx')?.textContent, none: p[1].textContent }; });
  check('DiffView: the changed line, insertions and deletions, the rest as context; "(no change)"', d.ins === '2' && d.del === 'two' && d.ctx === 'one ' && d.none === '(no change)', d);
  await page.close();
});

// ── the focus ring: ≥ 3:1 on every ground of every theme (WCAG 1.4.11); the 70 % mix it was fell to 2.3:1 ──
group('focus-ring', async () => {
  // each theme as the app applies it (design/theme.ts applyTheme: the workbench's JSON theme's tokens on <html>, the
  const THEMES = ['light', 'dark', 'sepia', 'contrast'];
  const GROUNDS = ['--bg', '--editor-bg', '--sidebar-bg', '--panel-bg'];
  const page = await fresh();
  const r = await page.evaluate(({ THEMES, GROUNDS }) => {
    const rgb = (s: string) => { const m = s.match(/[\d.]+/g)!.map(Number); return s.startsWith('color(') ? [m[0] * 255, m[1] * 255, m[2] * 255, m[3] ?? 1] : [m[0], m[1], m[2], m[3] ?? 1]; };
    const lum = ([r, g, b]: number[]) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
    const out: { theme: string; ground: string; ratio: number }[] = [];
    for (const theme of THEMES) {
      (window as any).theme.applyTheme(theme);
      for (const v of GROUNDS) {
        const probe = document.createElement('div');
        probe.style.cssText = `box-shadow: var(--ui-ring); background: var(${v}, var(--bg))`;
        document.body.append(probe);
        const cs = getComputedStyle(probe);
        const page = rgb(getComputedStyle(document.body).getPropertyValue('--bg') ? (() => { const q = document.createElement('div'); q.style.background = 'var(--bg)'; document.body.append(q); const c = getComputedStyle(q).backgroundColor; q.remove(); return c; })() : 'rgb(255,255,255)');
        const g0 = rgb(cs.backgroundColor), ground = g0.slice(0, 3).map((c, i) => c * g0[3] + page[i] * (1 - g0[3]));
        const ring = rgb(cs.boxShadow.match(/(rgba?|color)\([^)]*\)/)![0]);
        const mixed = ring.slice(0, 3).map((c, i) => c * ring[3] + ground[i] * (1 - ring[3]));   // the ring over its ground
        const [a, b] = [lum(mixed), lum(ground)].sort((x, y) => y - x);
        out.push({ theme, ground: v, ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100 });
        probe.remove();
      }
    }
    return out;
  }, { THEMES, GROUNDS });
  const low = r.filter((x) => !(x.ratio >= 3));
  // a menu row reached by the keyboard shows the ring too (inset: the menu clips its rows), not only the hover ground
  await page.evaluate(() => {
    (window as any).theme.applyTheme('light');
    const m = Object.assign(document.createElement('div'), { className: 'ui-menu', innerHTML: '<button class="ui-menu-item">One</button><button class="ui-menu-item">Two</button>' });
    document.body.prepend(m);
  });
  await page.keyboard.press('Tab');
  const row = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement; for (const a of el.getAnimations()) a.finish();   // the ring fades in (--ui-fast)
    const cs = getComputedStyle(el);
    return { cls: el.className, shadow: cs.boxShadow, accent: getComputedStyle(document.documentElement).getPropertyValue('--ui-accent').trim() };
  });
  check('a keyboard-focused menu row shows the ring, inset', row.cls === 'ui-menu-item' && /inset/.test(row.shadow) && /2px/.test(row.shadow), row);
  check(`the focus ring is ≥ 3:1 on ${GROUNDS.length} grounds in ${THEMES.length} themes (lowest ${Math.min(...r.map((x) => x.ratio))})`, r.length === 16 && !low.length, low.length ? low : r);
  await page.close();
});

// ── place(): inside the document view when it fits there, else inside the window (a phone: a pane narrower than the popover) ──
group('place', async () => {
  const page = await fresh();
  const r = await page.evaluate(() => {
    const { place } = (window as any).kit;
    const at = (paneLeft: number, paneWidth: number, popWidth: number) => {
      const pane = Object.assign(document.createElement('main'), { style: `position:fixed;left:${paneLeft}px;top:0;width:${paneWidth}px;height:600px` });
      pane.dataset.pane = 'p';
      const anchor = Object.assign(document.createElement('span'), { textContent: 'x', style: `position:absolute;left:${paneWidth - 20}px;top:100px` });
      pane.append(anchor);
      const pop = Object.assign(document.createElement('div'), { style: `position:fixed;width:${popWidth}px;height:80px` });
      document.body.append(pane, pop);
      place(pop, anchor, { placement: 'bottom-start' });
      const b = pop.getBoundingClientRect();
      pane.remove(); pop.remove();
      return { left: Math.round(b.left), right: Math.round(b.right) };
    };
    return { narrow: at(780, 214, 358), fits: at(300, 600, 358) };
  });
  check('place(): a popover wider than its pane stays inside the window (it was pushed past the edge)', r.narrow.right <= 1000 - 8 && r.narrow.left >= 8, r.narrow);
  check('place(): a popover that fits its pane stays inside the pane', r.fits.left >= 308 && r.fits.right <= 900 - 8, r.fits);
  await page.close();
});

// ── shownBlock(): the typeset element a block view shows, not the incoming one nor the widths cross-fade's ghost ──
group('shown', async () => {
  const page = await fresh();
  const r = await page.evaluate(() => {
    const shown = (window as any).shownBlock;
    const blk = document.createElement('div'); blk.className = 'blk';
    blk.innerHTML = '<div class="blk-main"><div class="blk-render"><div class="latex-block incoming" id="new"></div><div class="latex-block rtx-w-ghost" id="ghost"></div><div class="latex-block" id="real"></div></div></div>';
    document.body.append(blk);
    const render = blk.querySelector('.blk-render')!;
    return { fromRender: shown(render)?.id ?? null, fromBlock: shown(blk)?.id ?? null, none: shown(null) };
  });
  check('shownBlock: the shown element, not the incoming one nor the ghost (the ghost came first among the not-incoming ones)', r.fromRender === 'real' && r.fromBlock === 'real' && r.none === null, r);
  await page.close();
});

// ── moveInto (workbench): a tab's host moved to another group keeps its scroll offsets, and reads none of an SVG's nodes
// (a document's typeset blocks: a tab move read every node's scrollTop and scrollLeft, 6 s in Firefox) ──
group('move', async () => {
  const page = await fresh();
  const r = await page.evaluate(() => {
    const a = document.createElement('div'), b = document.createElement('div');
    const host = document.createElement('div');
    host.innerHTML = '<main style="height:200px;overflow:auto"><div style="height:2000px"><div class="disp" style="width:100px;overflow-x:auto"><div style="width:900px;height:10px"></div></div><svg width="10" height="10"><text></text></svg></div></main>';
    const text = host.querySelector('text')!;
    for (let i = 0; i < 5000; i++) text.append(document.createElementNS('http://www.w3.org/2000/svg', 'tspan'));
    a.append(host); document.body.append(a, b);
    const main = host.querySelector('main')!, disp = host.querySelector('.disp') as HTMLElement;
    main.scrollTop = 300; disp.scrollLeft = 40;
    let svgReads = 0;
    const top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!, left = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft')!;
    const count = (d: PropertyDescriptor) => ({ ...d, get(this: Element) { if (this instanceof SVGElement) svgReads++; return d.get!.call(this); } });
    Object.defineProperty(Element.prototype, 'scrollTop', count(top)); Object.defineProperty(Element.prototype, 'scrollLeft', count(left));
    (window as any).moveInto(b, host);
    Object.defineProperty(Element.prototype, 'scrollTop', top); Object.defineProperty(Element.prototype, 'scrollLeft', left);
    return { moved: host.parentElement === b, top: main.scrollTop, left: disp.scrollLeft, svgReads };
  });
  check('moveInto: the host moved keeps its scroll offsets (the pane, a display) and reads none of the SVG\'s 5,000 nodes', r.moved && r.top === 300 && r.left === 40 && r.svgReads === 0, r);
  await page.close();
});

for (const [name, f] of groups) if (!ONLY || ONLY.test(name)) await f();
await browser.close();
console.log(`\n${n - failed}/${n} checks passed`);
process.exit(failed ? 1 : 0);
