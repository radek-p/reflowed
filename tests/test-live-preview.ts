// The live preview on a plain page (edit/live-preview.ts), with no ReflowEd around it: the reflowtex viewer, the
// block source editor (app/editor-entry.js createEditor) and the component, bundled into the page; a block typeset
// by ReflowEd's engine (its worker in a Node thread, TeX files from the dev server) with its source map, its fonts
// given to the viewer (host.fonts.provide). The same functions ReflowEd's editing session calls:
//   - the caret drawn in the typeset text, following the editor (and carried across typing before a compile);
//   - the selection's bands under the selected glyphs;
//   - a click on a glyph puts the caret at its character (the engine's map); a click on the bar keeps the caret;
//   - a result with no engine data (a stored drawing): a click still finds its word (the fuzzy way);
//   - swapIn: a new result swapped in with text drawn on every frame and the container's height held; an aborted
//     swap leaves the old one;
//   - renderClick with a host that has only blockById and enterEdit;
//   - all of it with the editor, the block and the render in an iframe, the code in the page around it: the marks
//     made by the frame's document.
//
//   node tests/test-live-preview.ts http://127.0.0.1:8150/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnWorker } from '../scripts/node-engine.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] ?? 'http://127.0.0.1:8150/').replace(/\/?$/, '');
const req = createRequire(join(HERE, 'app/package.json'));
const { chromium } = req('playwright');
const esbuild = req('esbuild');
let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail).slice(0, 500)}`}`); };

// ── a block typeset by ReflowEd's engine ──
const SOURCE = 'A line with $x^2 + y$ in it, then \\textbf{bold} words and a few more words so that it breaks.';
const SOURCE2 = 'Another result: $a_1$ and \\emph{emphasis}, here.';
const w = spawnWorker(readFileSync(join(HERE, 'engine/dist/editor-worker.js'), 'utf8'));
let typeset: { nodelist: string; sourcemap: unknown }[] = [];
let fonts: Record<string, string> = {}, files: Record<string, string> = {};
try {
  await w.call('init', { base: BASE });
  await w.call('engine', { format: new Uint8Array(readFileSync(join(HERE, 'engine/api/formats/latex.fmt'))), wasm: new Uint8Array(readFileSync(join(HERE, 'engine/dist/async/tectonic_wasm.wasm'))) });
  await w.call('setPreamble', { preamble: '\\documentclass{article}' });
  for (const [i, source] of [SOURCE, SOURCE2].entries()) {
    const r = await w.call('compile', { blocks: [{ id: `b${i}`, source }] });
    const b = r.blocks[`b${i}`];
    typeset.push({ nodelist: b.nodelist, sourcemap: b.sourcemap });
    Object.assign(fonts, r.fonts);
    for (const [k, v] of Object.entries(r.fontFiles as Record<string, Uint8Array>)) files[k] = Buffer.from(v).toString('base64');
  }
} finally { await w.terminate(); }
check('the engine typeset both blocks, with a source map', typeset.every((t) => t.nodelist && (t.sourcemap as { items?: unknown })?.items), typeset.map((t) => !!t.sourcemap));

// ── the page: viewer, editor, component ──
const out = await esbuild.build({
  stdin: { contents: `import { createEditor } from './app/src/app/editor-entry.js';
import { attachLivePreview, swapIn, renderClick, LIVE_PREVIEW_CSS } from './app/src/edit/live-preview.ts';
window.lp = { createEditor, attachLivePreview, swapIn, renderClick, LIVE_PREVIEW_CSS };`, resolveDir: HERE, loader: 'ts' },
  bundle: true, format: 'iife', target: 'es2022', write: false, nodePaths: [join(HERE, 'app/node_modules')], logLevel: 'warning',
});
const schema = await (await fetch(`${BASE}/lib/viewer/schema.b64`)).text();
const HEAD = `<meta charset="utf-8"><div id="latex-schema" data-schema-b64="${schema.trim()}" hidden></div>
<style>body { margin: 20px; font: 16px sans-serif } .box { width: 520px } .latex-block.incoming { position: absolute; visibility: hidden; left: 0; right: 0 }
.cm-editor { border: 1px solid #ccc; margin-top: 12px }</style>`;
const PAGE = `<!doctype html><html><head>${HEAD}</head><body><div class="box"><div id="render"></div><div id="ed"></div></div>
<script src="${BASE}/lib/viewer/protobuf.min.js"></script><script src="${BASE}/lib/viewer/latex-viewer.js"></script></body></html>`;

const browser = await chromium.launch();

/** set up the preview in `where`'s document ('page' or 'frame'); returns nothing (state on window.t) */
async function setUp(page: any, where: 'page' | 'frame') {
  await page.evaluate(async ({ where, typeset, fonts, files, SOURCE }: any) => {
    const w = window as any;
    const doc: Document = where === 'frame' ? (document.getElementById('f') as HTMLIFrameElement).contentDocument! : document;
    const host = where === 'frame' ? (doc.defaultView as any).reflowtex.host : w.reflowtex.host;
    const st = doc.createElement('style'); st.textContent = w.lp.LIVE_PREVIEW_CSS; doc.head.append(st);
    const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    for (const [orig, served] of Object.entries(fonts as Record<string, string>)) if (files[served]) await host.fonts.provide(orig, bytes(files[served]));
    const render = doc.getElementById('render')!;
    const el = doc.createElement('div'); el.className = 'latex-block'; el.dataset.nodelistB64 = typeset[0].nodelist; render.append(el);
    const block = await host.mount(el);
    const ed = w.lp.createEditor(doc.getElementById('ed'), { doc: SOURCE });
    const preview = w.lp.attachLivePreview({ editor: ed.view, render, follow: () => true, wholeDisplays: true });
    preview.setResult({ block, result: { sourcemap: typeset[0].sourcemap }, compiled: SOURCE });
    w.t = { doc, host, render, ed, preview, block };
    await host.idle();
  }, { where, typeset, fonts, files, SOURCE });
}
const frames = (page: any) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function run(where: 'page' | 'frame') {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  page.on('console', (m: any) => { if (m.type() === 'error') errors.push(m.text()); });
  if (where === 'page') await page.setContent(PAGE);
  else {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><iframe id="f" style="width:700px;height:600px;border:0"></iframe></body></html>`);
    await page.evaluate((html: string) => new Promise<void>((done) => {
      const f = document.getElementById('f') as HTMLIFrameElement;
      f.addEventListener('load', () => done(), { once: true });
      f.srcdoc = html;
    }), PAGE);
    await page.waitForFunction(() => !!((document.getElementById('f') as HTMLIFrameElement).contentWindow as any)?.reflowtex?.host);
  }
  await page.addScriptTag({ content: out.outputFiles[0].text });
  await setUp(page, where);
  const tag = `${where}:`;
  const offsetOf = (s: string) => SOURCE.indexOf(s);

  // 1. the caret drawn, following the editor
  const caretAt = async (k: number) => {
    await page.evaluate((k: number) => { const t = (window as any).t; t.ed.view.dispatch({ selection: { anchor: k } }); }, k);
    await frames(page);
    return page.evaluate(() => { const t = (window as any).t, bar = t.render.querySelector('.rtx-caret-bar'); const r = bar?.getBoundingClientRect();
      return bar ? { x: r.left + r.width / 2, y: r.top + r.height / 2, doc: bar.ownerDocument === t.doc, realm: bar instanceof (t.doc.defaultView as any).HTMLElement } : null; });
  };
  const k = offsetOf('bold') + 2;
  const bar = await caretAt(k);
  check(`${tag} the caret is drawn in the typeset text`, !!bar, bar);
  check(`${tag} its marks are made by the render's own document`, !!bar && bar.doc && bar.realm, bar);
  const toPage = async (p: { x: number; y: number }) => (where === 'frame' ? page.evaluate((p: any) => { const r = document.getElementById('f')!.getBoundingClientRect(); return { x: p.x + r.left, y: p.y + r.top }; }, p) : p);
  // a click just right of the bar puts the caret back there (the engine's map, the text editor's rule)
  if (bar) {
    const at = await toPage({ x: bar.x + 1, y: bar.y });
    await page.mouse.click(at.x, at.y);
    const caret = await page.evaluate(() => (window as any).t.ed.view.state.selection.main.head);
    check(`${tag} a click at the caret's place keeps the caret (round trip)`, caret === k, { caret, k });
  }
  // 2. a click on a glyph: its character
  const glyphAt = (ch: string, nth = 0) => page.evaluate(({ ch, nth }: any) => {
    const t = (window as any).t, gs = [...t.render.querySelectorAll('tspan')].filter((g: Element) => g.textContent === ch);
    const r = gs[nth]?.getBoundingClientRect(); return r ? { x: r.left + r.width * 0.25, y: r.top + r.height / 2 } : null;
  }, { ch, nth });
  const b = await glyphAt('b');
  if (b) {
    const at = await toPage(b);
    await page.mouse.click(at.x, at.y);
    const caret = await page.evaluate(() => (window as any).t.ed.view.state.selection.main.head);
    check(`${tag} a click on the 'b' of bold puts the caret before it`, caret === offsetOf('bold'), { caret, want: offsetOf('bold') });
  } else check(`${tag} the 'b' of bold is drawn`, false);
  // 3. the selection's bands under the selected glyphs
  const sel = await page.evaluate(({ from, to }: any) => {
    const t = (window as any).t; t.ed.view.dispatch({ selection: { anchor: from, head: to } });
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const bands = [...t.render.querySelectorAll('.rtx-sel-band')].map((e: Element) => e.getBoundingClientRect());
      const glyphs = [...t.render.querySelectorAll('tspan')].filter((g: Element) => 'bold'.includes(g.textContent ?? '#')).map((g: Element) => g.getBoundingClientRect());
      const covered = glyphs.filter((g) => bands.some((b) => g.left + g.width / 2 >= b.left && g.left + g.width / 2 <= b.right && g.top + g.height / 2 >= b.top - 1 && g.top + g.height / 2 <= b.bottom + 1)).length;
      r({ bands: bands.length, covered, b: bands.map((x) => [x.left, x.top, x.right, x.bottom].map(Math.round)), g: glyphs.slice(0, 6).map((x) => [x.left, x.top, x.right, x.bottom].map(Math.round)) });
    })));
  }, { from: offsetOf('bold'), to: offsetOf('bold') + 4 });
  check(`${tag} the selection of "bold" has a band under its glyphs`, (sel as any).bands >= 1 && (sel as any).covered >= 4, sel);
  // 4. typing before the next compile: the caret is carried
  const typed = await page.evaluate(() => { const t = (window as any).t; t.ed.view.dispatch({ changes: { from: 0, insert: 'New ' }, selection: { anchor: 4 } }); return 0; });
  void typed; await frames(page);
  check(`${tag} after typing, the caret is still drawn (carried to the compiled text)`, await page.evaluate(() => !!(window as any).t.render.querySelector('.rtx-caret-bar')));
  await page.evaluate(() => { const t = (window as any).t; t.ed.view.dispatch({ changes: { from: 0, to: 4, insert: '' } }); });
  // 5. no engine data: the fuzzy way
  await page.evaluate(() => { const t = (window as any).t; t.preview.setResult({ block: t.block, result: null, compiled: null }); });
  const w2 = await glyphAt('w', 1);
  if (w2) {
    const at = await toPage(w2);
    await page.mouse.click(at.x, at.y);
    const caret = await page.evaluate(() => (window as any).t.ed.view.state.selection.main.head);
    const want = SOURCE.indexOf('words');
    check(`${tag} with no engine result a click finds its word (fuzzy)`, caret >= want && caret <= want + 5, { caret, want });
  }
  await page.evaluate(({ sm, s }: any) => { const t = (window as any).t; t.preview.setResult({ block: t.block, result: { sourcemap: sm }, compiled: s }); }, { sm: typeset[0].sourcemap, s: SOURCE });
  // 6. swapIn: text on every frame, the height held
  const sw = await page.evaluate(async (nodelist: string) => {
    const t = (window as any).t, w = t.doc.defaultView;
    const log: { text: number; h: number }[] = [];
    let on = true;
    const tick = () => { log.push({ text: [...t.render.querySelectorAll('.latex-block:not(.incoming) tspan')].length, h: t.render.getBoundingClientRect().height }); if (on) w.requestAnimationFrame(tick); };
    const h0 = t.render.getBoundingClientRect().height;
    w.requestAnimationFrame(tick);
    const blk = await (window as any).lp.swapIn(t.render, { host: t.host, nodelistB64: nodelist });
    await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
    on = false;
    const blocks = t.render.querySelectorAll('.latex-block').length;
    // an aborted one: the old stays
    const ac = new AbortController();
    const p = (window as any).lp.swapIn(t.render, { host: t.host, nodelistB64: nodelist, signal: ac.signal });
    ac.abort();
    const aborted = await p;
    return { swapped: !!blk, blocks, after: t.render.querySelectorAll('.latex-block').length, aborted: aborted === null,
      blank: log.filter((l) => l.text === 0).length, frames: log.length, shrank: log.some((l, i) => i > 0 && l.h < h0 - 0.5 && !blk) , minH: t.render.style.minHeight };
  }, typeset[1].nodelist);
  check(`${tag} swapIn: swapped, one block left`, sw.swapped && sw.blocks === 1 && sw.after === 1, sw);
  check(`${tag} swapIn: text drawn on every frame (${sw.frames})`, sw.blank === 0 && sw.frames > 0, sw);
  check(`${tag} swapIn: an aborted swap leaves the old block, the height released`, sw.aborted && sw.minH === '', sw);
  // 7. renderClick with a minimal host
  const rc = await page.evaluate(() => new Promise((done) => {
    const t = (window as any).t, el = t.render.querySelector('.latex-block');
    const calls: unknown[] = [];
    const host = { blockById: (id: string) => ({ id, kind: 'paragraph' }), enterEdit: (...a: unknown[]) => calls.push(a.map((x) => (x instanceof Event ? 'event' : x))) };
    el.addEventListener('click', (e: MouseEvent) => { (window as any).lp.renderClick(e, { id: 'b', render: t.render, pane: 'a' }, host); done(calls); }, { once: true });
    const g = el.querySelector('tspan'); const r = g.getBoundingClientRect();
    g.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 1, clientY: r.top + 1 }));
  }));
  check(`${tag} renderClick with only blockById and enterEdit: the block is edited where clicked`, JSON.stringify(rc) === JSON.stringify([['b', 'event', null, null, null, 'a']]), rc);
  // dispose: marks gone
  const gone = await page.evaluate(() => { const t = (window as any).t; t.preview.dispose(); t.ed.view.dispatch({ selection: { anchor: 3 } });
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(t.render.querySelectorAll('.rtx-caret-bar, .rtx-sel-band, .rtx-line-band').length)))); });
  check(`${tag} dispose: the marks are gone and stay gone`, gone === 0, gone);
  check(`${tag} no page error`, errors.length === 0, errors);
  await page.close();
}

await run('page');
await run('frame');
await browser.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
