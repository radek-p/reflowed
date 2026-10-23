// The workbench demo: fake views in two groups; the layout saved in this browser (?fresh starts anew).
import { createWorkbench, Workbench, html, render, model as M, ownViewport, panelHint, kit, type DocStatus, type DocStatusInput, type MenuEntryLike } from '../src/index.ts';
import { THEME, setTheme } from './theme.ts';
import { gallery } from './gallery.ts';
import { registerDemoViews, DEMO_CSS, stats, DOCS } from './views.ts';
import ICON_SVG from './wordmark/icon.svg';
import WORD_SVG from './wordmark/word.svg';

const q = new URLSearchParams(location.search);

if (q.has('gallery')) gallery(q);
else start();

function start() {

// the workbench owns the window: the page never scrolls (Safari's bounce and focus scrolling, viewport.ts)
const viewport = ownViewport();

const KEY = 'wb-demo-layout';
const style = document.createElement('style');
style.textContent = DEMO_CSS;
document.head.append(style);

function initial() {
  const wb = createWorkbench({ idPrefix: 'd' });
  registerDemoViews(wb, { panels: q.get('sides') !== '0' });
  const items = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p} ${i + 1}`);
  wb.open({ view: 'document', state: { doc: 'lemma' } });
  wb.open({ view: 'document', state: { doc: 'graphs' } });
  wb.open({ view: 'list', state: { name: 'Fruit', items: items('Fruit', 40) } });
  const b = wb.open({ view: 'list', state: { name: 'Vegetables', items: items('Vegetable', 6) } });
  wb.split(b, 'right', undefined, { copy: false });
  wb.open({ view: 'text', state: { text: 'A note' } });
  wb.activate(b);
  return wb.serialize();
}

/** One document: the integrated look (no strip until a second tab opens). */
function single() {
  const wb = createWorkbench({ idPrefix: 'd' });
  registerDemoViews(wb, { panels: q.get('sides') !== '0' });
  wb.open({ view: 'document', state: { doc: 'lemma' } });
  wb.collapseSide('right', true);      // the editor has no right sidebar: it is there, hidden (Ctrl+Shift+\\)
  return wb.serialize();
}
/** The scenario (?scenario=paper): one long paper open three times (the body, the appendix), another
 *  document and a book at a chapter (its crumb: a chapter as a section is); beside them a note and the paper at §4.1. */
function paper() {
  const wb = createWorkbench({ idPrefix: 'd' });
  registerDemoViews(wb, { panels: q.get('sides') !== '0' });
  const first = wb.open({ view: 'document', state: { doc: 'konig', section: '2 Definitions', paras: 3 } });
  wb.open({ view: 'document', state: { doc: 'konig', section: '4.2 Proof of Theorem 3', paras: 3 } });
  wb.open({ view: 'document', state: { doc: 'konig', section: 'A Extended proof of Theorem 3', paras: 3 } });
  wb.open({ view: 'document', state: { doc: 'graphs', section: 'Main result' } });
  wb.open({ view: 'document', state: { doc: 'thesis', section: 'Chapter 2 Minors and their models', paras: 3 } });
  const n = wb.open({ view: 'text', state: { text: 'Notes on Theorem 3' } });
  wb.split(n, 'right', undefined, { copy: false });
  wb.open({ view: 'document', state: { doc: 'konig', section: '4.1 Two lemmas', paras: 3 } });
  wb.activate(first);
  return wb.serialize();
}
let saved = null;
if (!q.has('fresh')) { try { saved = localStorage.getItem(KEY); } catch { /* no storage */ } }
const first = () => (q.has('single') ? single() : q.get('scenario') === 'paper' ? paper() : initial());
let layout = first();
if (saved) layout = saved;     // an old or broken save: createWorkbench drops it (wb.layoutDropped) and starts anew

// the document status in the tabs: each document's state from ?docstatus=konig:typesetting,graphs:errors=2,streams:unsaved+typesetting
const wb = createWorkbench({ idPrefix: 'd', layout });
if (wb.layoutDropped) wb.load(first());     // the demo's own start, not an empty one
for (const part of (q.get('docstatus') ?? '').split(',').filter(Boolean)) {
  const [doc = '', flags = ''] = part.split(':'), s: DocStatusInput = {};
  for (const f of flags.split('+')) { const [k, v] = f.split('='); if (k === 'typesetting' || k === 'unsaved') s[k] = true; if (k === 'errors' || k === 'error') s.errors = Number(v ?? 1); }
  wb.setDocStatus(doc, s);
}
registerDemoViews(wb, { panels: q.get('sides') !== '0' });
/** A simulated typesetting run (the tab status): n blocks, each taking a random time around a 0.7 s median
 *  (log-normal), reported as { typesetting: { done: k, total: n } }; it ends OK, or with an error when err (every
 *  second run with ?simerr=1); then, looping, a pause and the next run. ?simulate=<doc>:<n> starts it on load. The bar:
 *  ?simbar=full (the default, a full document render) or band (a few blocks: the thin band, the active tab too), or
 *  ?simbar=alt to alternate: full, then band */
const sims = new Map<string, { stop(): void }>();
function simulate(doc: string, n = 12, { err = false, loop = false, bar = 'full' }: { err?: boolean; loop?: boolean; bar?: string } = {}) {
  sims.get(doc)?.stop();
  let stopped = false, runs = 0;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const blockMs = () => 700 * Math.exp(0.6 * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()));
  (async () => {
    do {
      const fail = err && runs % 2 === 1;
      for (let k = 0; k <= n && !stopped; k++) { wb.setDocStatus(doc, { ...wb.getDocStatus(doc), errors: 0, typesetting: { done: k, total: n, bar: bar === 'alt' ? (runs % 2 ? 'band' : 'full') : bar === 'band' ? 'band' : 'full' } }); if (k < n) await wait(blockMs()); }
      if (stopped) break;
      wb.setDocStatus(doc, { unsaved: wb.getDocStatus(doc).unsaved, errors: fail ? 1 : 0 });
      runs++;
      if (loop) await wait(3500);
    } while (loop && !stopped);
  })();
  sims.set(doc, { stop: () => { stopped = true; } });
}
if (q.get('simulate')) { const [d = '', n] = q.get('simulate')!.split(':'); simulate(d, Number(n) || 12, { err: q.get('simerr') === '1', loop: true, bar: q.get('simbar') ?? 'full' }); }
wb.on('change', () => { try { localStorage.setItem(KEY, wb.serialize()); } catch { /* no storage */ } });

function many(n = 60, paras = 12): void {
  for (let i = 0; i < n; i++) wb.open({ view: 'document', state: { doc: ['lemma', 'graphs', 'streams'][i % 3], paras } }, { activate: false });
}
function Bar() {
  return html`<h1>Workbench</h1>
    <${kit.ThemeSwitch} data-demo="theme" label=${`Theme: ${THEME.value}`} value=${THEME.value} onChange=${setTheme} />
    <${kit.Button} data-demo="reset" label="Reset layout" onClick=${() => wb.load(initial())} />
    <${kit.Button} data-demo="single" label="One document" onClick=${() => wb.load(single())} />
    <${kit.Button} data-demo="many" label="Add 60 documents" onClick=${() => many()} />
    <span class="sp"></span>
    <span class="demo-hint" style="margin:0" data-demo="chord">${wb.chord.value ? `${wb.chord.value} was pressed: waiting for the second key` : ([['close', 'close'], ['reopen', 'reopen'], ['splitRight', 'split'], ['maximize', 'maximise']] as const).map(([a, t]) => `${wb.shortcut(a)} ${t}`).join(' · ')}</span>`;
}
const barEl = document.getElementById('bar')!;
const draw = () => render(html`<${Bar} />`, barEl);
if (q.has('embed')) barEl.hidden = true;
draw();
// the editor's top bar and sidebar header (app/src/chrome/top-bar.js, sidebar-chrome.js), as a host gives them
// (?bar=0: none, the workbench alone)
const BAR = q.get('bar') !== '0' ? {
  label: 'ReflowEd',
  // the editor's wordmark (app/src/chrome/sidebar-chrome.js .brand): at the bar's left while no tabs are in it
  mark: { icon: () => html`<span class="demo-logo" data-demo="logo" dangerouslySetInnerHTML=${{ __html: ICON_SVG }}></span>`,
    text: () => html`<span class="demo-brand" data-demo="brand" dangerouslySetInnerHTML=${{ __html: WORD_SVG }}></span>` },
  // no split button: a split is the tab's context menu or its key, as on the editor's page
  right: () => html`<${kit.IconButton} data-demo="view" icon=${q.get('viewicon') === 'sliders' ? 'settings' : 'textSize'} label="View" />
    <${kit.ThemeSwitch} data-demo="theme" value=${THEME.value} onChange=${setTheme} />
    <${kit.IconButton} data-demo="menu" icon="more" label="Document menu" tip="Menu" aria-haspopup="menu"
      onClick=${(e: MouseEvent) => kit.openMenu(e.currentTarget as HTMLElement, [{ id: "shortcuts", label: "Keyboard shortcuts", shortcut: wb.shortcut("shortcuts"), onSelect: () => wb.run("shortcuts") }, ...statusItems(e.currentTarget as HTMLElement)], { label: "Document menu" })} />`,
} : null;
// The wordmark: the icon and the word as SVG files (demo/wordmark/icon.svg, word.svg: placeholders;
// colours and form). Each is inlined as it is (currentColor: the part's ink), drawn at the
// bar's fixed size (demo/views.ts .demo-logo, .demo-brand), the word with its baseline on the tab text's.
/** The demo's status control (the bar's menu): a simulated run, then each document's state (a second menu). */
function statusItems(anchor: HTMLElement): MenuEntryLike[] {
  const st = wb.docStatus.value, words = (s: Partial<DocStatus>) => [s.typesetting && 'typesetting', s.errors && `${s.errors} error${s.errors > 1 ? 's' : ''}`, s.unsaved && 'unsaved'].filter(Boolean).join(', ') || 'saved';
  return [{ separator: true }, { heading: 'Status in the tabs' },
    { id: 'simulate', label: 'Simulate a typesetting run (the active document)', onSelect: () => { const t = wb.current.peek()?.tab, d = t && wb.docOf(t); if (d) simulate(d, 12); } },
    { heading: 'Document status' },
    ...Object.entries(DOCS).map(([id, d]) => ({ id: `docstatus-${id}`, label: d.title, hint: words(st.get(id) ?? {}), onSelect: () => docMenu(anchor, id) }))];
}
function docMenu(anchor: HTMLElement, id: string) {
  const s = wb.getDocStatus(id), set = (x: DocStatusInput) => wb.setDocStatus(id, { ...s, ...x }), title = DOCS[id]?.title ?? id;
  kit.openMenu(anchor, [{ heading: title },
    { id: 'st-typesetting', label: 'Typesetting', active: s.typesetting, onSelect: () => set({ typesetting: !s.typesetting }) },
    { id: 'st-error1', label: 'One error', active: s.errors === 1, onSelect: () => set({ errors: s.errors === 1 ? 0 : 1 }) },
    { id: 'st-error3', label: 'Three errors', active: s.errors === 3, onSelect: () => set({ errors: s.errors === 3 ? 0 : 3 }) },
    { id: 'st-unsaved', label: 'Unsaved', active: s.unsaved, onSelect: () => set({ unsaved: !s.unsaved }) },
    { id: 'st-idle', label: 'Saved and idle', active: !s.typesetting && !s.errors && !s.unsaved, onSelect: () => wb.setDocStatus(id, {}) }], { label: `Status: ${title}` });
}
// the left column's status bar (the host's sideStatus): the build's label, as the editor's "Preview · dev"
const SIDE_STATUS = () => html`<span class="demo-version" data-demo="version" title="Limited preview, not for distribution">Preview · dev</span>`;
render(html`<${Workbench} wb=${wb} label="Demo workbench" bar=${BAR} sideStatus=${q.get('bar') !== '0' ? SIDE_STATUS : null} />`, document.getElementById('wb')!);
if (BAR) barEl.style.display = 'none';     // the bar is the app's: the demo's own toolbar steps aside

// the host routes the workbench keys when the focus is outside it (on the page)
addEventListener('keydown', (e) => { if (!wb.root()?.contains(e.target as Node)) wb.handleKey(e); });
addEventListener('keyup', (e) => { if (!wb.root()?.contains(e.target as Node)) wb.keyup(e); });

// lib: for a test that draws a second workbench on the page (two stores, one page)
Object.assign(globalThis, { demo: { wb, M, stats, many, initial, single, viewport, panelHint, simulate, lib: { createWorkbench, Workbench, html, render, registerDemoViews } } });
}

