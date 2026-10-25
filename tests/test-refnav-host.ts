// Reference navigation (app/src/refnav/listen.ts listenRefnav) on a page that has only the viewer: the editor's own
// code with a host's hooks, on a page of its own and in a frame (the container in the frame's document, the code in
// the page's). Headless Chromium; the viewer is the public repo's build that the dev page loads (app/lib/viewer:
// node scripts/w3-build.ts --assets); refnav and rtx:refs bundled into the page (esbuild); no app, no server.
//
//   node tests/test-refnav-host.ts
//
// The blocks: tests/qa/fixtures/refnav-host.json (tests/qa/record-refnav-host.ts records them with the dev engine): a
// section heading with \label{sec:maths}, a paragraph with a \ref to it, a \cite and an \href, and the reference
// list's source. What a unit points at is rtx:refs's (createRefs) on those sources; the hooks record what refnav asks
// of the host. One table of gestures, the one in listen.ts's header, in both places:
//   click                 edit(paragraph, the caret in the unit: after "\ref{", after "\cite{", the address)
//   ⌘/Ctrl-click          the navigator's goTo (the label's block; the reference list at the key's anchor); a link's
//                         address opened in a new tab, no opener
//   Enter                 the unit's card at once (its typeset copy of the target mounted by the frame's viewer)
//   ⌘/Ctrl+Enter          goTo
//   Alt+←, ⌘/Ctrl+[       after a go-to: the navigator's back
//   hover                 the card
//   click, read-only      the card, no edit
// and the units found again after the viewer repaints the paragraph (a narrower column). Waits on DOM state and the
// viewer's idle(), never on times.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(HERE, 'app/package.json'));
const { chromium } = req('playwright');
const esbuild = req('esbuild');
const VIEWER = join(HERE, 'app/lib/viewer');
if (!existsSync(join(VIEWER, 'latex-viewer.js'))) { console.log(`FAIL no viewer at ${VIEWER}: node scripts/w3-build.ts --assets`); process.exit(1); }
const fx = JSON.parse(readFileSync(join(HERE, 'tests/qa/fixtures/refnav-host.json'), 'utf8'));
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const out = await esbuild.build({
  stdin: { contents: `import { listenRefnav } from './app/src/refnav/listen.ts'; import { createRefs } from './app/src/refs/index.ts'; window.listenRefnav = listenRefnav; window.createRefs = createRefs;`, resolveDir: HERE, loader: 'js' },
  bundle: true, format: 'iife', target: 'es2022', write: false, loader: { '.css': 'text' }, nodePaths: [join(HERE, 'app/node_modules')], logLevel: 'warning',
});
const BUNDLE = out.outputFiles[0].text;

// the viewer's page: the schema, the blocks as the editor marks them up (a block, its pane, its render), the viewer
const inline = (f: string) => `<script>${readFileSync(join(VIEWER, f), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
const blockHtml = (b: any) => `<div class="blk" data-id="${b.id}" data-pane="A"><div class="blk-main"><div class="blk-render">${b.nodelistB64 ? `<div class="latex-block" data-nodelist-b64="${b.nodelistB64}"></div>` : ''}</div></div></div>`;
const VIEWER_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<div id="latex-schema" data-schema-b64="${readFileSync(join(VIEWER, 'schema.b64'), 'utf8').trim()}" hidden></div>
<script id="latex-font-map" type="application/json" data-fonts-base="fonts/">{}</script>
<div id="doc" style="width:600px;padding:20px">${fx.blocks.map(blockHtml).join('\n')}</div>
${inline('protobuf.min.js')}${inline('latex-viewer.js')}</body></html>`;

const ORIGIN = 'http://refnav-host.test';
const FRAME_PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><iframe id="f" src="/" style="border:0;margin:30px;width:800px;height:600px"></iframe></body></html>';

const P = fx.paragraph as string, SRC = fx.blocks.find((b: any) => b.id === P).source as string;
const CARET = { ref: SRC.indexOf('\\ref{') + 5, cite: SRC.indexOf('\\cite{') + 6, link: SRC.indexOf('\\href{') + 6 };

let n = 0, failed = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail).slice(0, 500)}`}`); };

type Where = 'page' | 'frame';
const browser = await chromium.launch();

async function open(where: Where) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  // one origin for the page and its frame (the viewer resolves its fonts against the page: none are served here)
  await page.route(`${ORIGIN}/**`, (r: any) => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/') return r.fulfill({ contentType: 'text/html', body: VIEWER_PAGE });
    if (path === '/frame') return r.fulfill({ contentType: 'text/html', body: FRAME_PAGE });
    return r.fulfill({ status: 404, body: '' });
  });
  if (where === 'page') await page.goto(`${ORIGIN}/`);
  else {
    await page.goto(`${ORIGIN}/frame`);
    await page.waitForFunction(() => (document.getElementById('f') as HTMLIFrameElement).contentWindow?.document.readyState === 'complete');
  }
  await page.addScriptTag({ content: BUNDLE });
  // the hooks: one document (rtx:refs on the blocks' sources), a navigator that keeps a history, all recorded
  await page.evaluate(async ([where, fx]: [Where, any]) => {
    const w = window as any;
    const D: Document = where === 'page' ? document : (document.getElementById('f') as HTMLIFrameElement).contentDocument!;
    w.D = D;
    await (D.defaultView as any).reflowtex.host.idle();
    const blocks = fx.blocks.map(({ id, kind, source }: any) => ({ id, kind, source }));
    const refs = w.createRefs();
    refs.update({ bib: fx.bib }, blocks.map((b: any) => ({ ...b, el: null, block: null })));
    const rec: unknown[][] = w.rec = [];
    const stack: unknown[] = [], listeners = new Set<(n: number) => void>();
    const changed = () => { for (const f of listeners) f(stack.length); };
    const nav = {
      goTo: async (blockId: string, o: any) => { rec.push(['goTo', blockId, o.anchor ?? null, o.pane ?? null]); stack.push({ pane: o.pane ?? null, from: o.from ?? null }); changed(); return true; },
      back: async () => { rec.push(['back']); stack.pop(); changed(); return true; },
      history: () => stack.map((x: any) => ({ ...x })),
      clear: () => { stack.length = 0; changed(); },
      onChange: (f: (n: number) => void) => { listeners.add(f); return () => listeners.delete(f); },
      say: (t: string) => { rec.push(['say', t]); },
      scrollOf: () => 0,
    };
    w.ro = false;
    w.navClear = () => nav.clear();
    const api = { refsState: () => refs.refsState(), numbering: () => refs.numbering(), nav: () => nav, blocks: () => blocks, readOnly: () => w.ro,
      edit: (id: string, caret?: number) => { rec.push(['edit', id, caret ?? null]); } };
    (D.defaultView as any).open = (...a: unknown[]) => { rec.push(['open', ...a]); return null; };
    w.refnav = w.listenRefnav(D.getElementById('doc'), { api });
  }, [where, fx]);
  await page.waitForFunction(() => (window as any).refnav.units().length >= 3);
  return { page, errors };
}

/** the centre of a unit's first glyph, in the page's coordinates (a frame's offset added) */
async function at(page: any, kind: string) {
  return page.evaluate(([kind, P]: string[]) => {
    const w = window as any;
    const u = w.refnav.units().find((x: any) => x.kind === kind && x.blockId === P);
    const r = (w.refnav.elements(u.id)[0] as Element).getBoundingClientRect();
    const f = document.getElementById('f')?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return { x: f.left + r.left + r.width / 2, y: f.top + r.top + r.height / 2 };
  }, [kind, P]);
}
const focusUnit = (page: any, kind: string) => page.evaluate(([kind, P]: string[]) => {
  const w = window as any;
  const u = w.refnav.units().find((x: any) => x.kind === kind && x.blockId === P);
  (w.refnav.elements(u.id)[0] as HTMLElement).focus();
}, [kind, P]);
/** a clean slate between gestures: the pointer away, the card closed, the history empty, nothing recorded */
async function reset(page: any) {
  await page.mouse.move(2, 2);
  await page.evaluate(() => { const w = window as any; w.refnav.closeCard(); (w.D.activeElement as HTMLElement | null)?.blur?.(); w.rec.length = 0; w.ro = false; });
  await page.evaluate(() => { (window as any).navClear(); });
  // the hot mark's removal repaints the line: its scan (a frame later) done before the next gesture
  await page.evaluate(() => new Promise((r) => (window as any).D.defaultView.requestAnimationFrame(() => requestAnimationFrame(r))));
}
const rec = (page: any) => page.evaluate(() => (window as any).rec.map((x: unknown[]) => [...x]));
const cardNow = (page: any) => page.evaluate(() => {
  const w = window as any, el = w.D.querySelector('#rn-card') as HTMLElement | null;
  return { open: w.refnav.card().open, kind: el?.dataset.kind ?? null, inDoc: !!el && el.ownerDocument === w.D };
});
const modClick = async (page: any, p: { x: number; y: number }) => { await page.keyboard.down(MOD); await page.mouse.click(p.x, p.y); await page.keyboard.up(MOD); };

const KINDS = ['ref', 'cite', 'link'] as const;
const GOES: Record<string, unknown[]> = { ref: ['goTo', fx.target, 'sec:maths', 'A'], cite: ['goTo', fx.list, `cite.${fx.key}`, 'A'], link: ['open', 'https://example.org/rn', '_blank', 'noopener'] };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

for (const where of ['page', 'frame'] as Where[]) {
  const { page, errors } = await open(where);
  const units = await page.evaluate((P: string) => (window as any).refnav.units().filter((u: any) => u.blockId === P).map((u: any) => u.kind), P);
  check(`[${where}] the paragraph's units, scanned once the viewer drew it: a reference, a citation, a link`, same([...units].sort(), ['cite', 'link', 'ref']), units);
  for (const kind of KINDS) {
    await reset(page);
    const p = await at(page, kind);
    await page.mouse.click(p.x, p.y);
    const r = await rec(page);
    check(`[${where}] click on the ${kind}: edit, the caret in it (${CARET[kind]})`, same(r, [['edit', P, CARET[kind]]]), r);
  }
  for (const kind of KINDS) {
    await reset(page);
    await modClick(page, await at(page, kind));
    const r = await rec(page);
    check(`[${where}] ${MOD}-click on the ${kind}: its navigation`, same(r, [GOES[kind]]), r);
  }
  for (const kind of KINDS) {
    await reset(page);
    await focusUnit(page, kind);
    await page.keyboard.press('Enter');
    const c = await cardNow(page);
    const r = await rec(page);
    check(`[${where}] Enter on the ${kind}: its card, at once, in the container's document; nothing asked of the host`, c.open && c.kind === kind && c.inDoc && r.length === 0, { c, r });
  }
  {
    // the reference's card shows the target typeset: a copy mounted by the container's viewer
    await reset(page);
    await focusUnit(page, 'ref');
    await page.keyboard.press('Enter');
    const shown = await page.waitForFunction(() => !!(window as any).D.querySelector('#rn-card .rn-body .latex-block svg'), null, { timeout: 10000 }).then(() => true, () => false);
    check(`[${where}] the reference's card: the target's typeset copy, mounted by the container's viewer`, shown);
  }
  {
    await reset(page);
    await focusUnit(page, 'ref');
    await page.keyboard.press(`${MOD}+Enter`);
    const r = await rec(page);
    check(`[${where}] ${MOD}+Enter on the reference: goTo`, same(r, [GOES.ref]), r);
  }
  for (const key of ['Alt+ArrowLeft', `${MOD}+BracketLeft`]) {
    await reset(page);
    await modClick(page, await at(page, 'ref'));
    await page.evaluate(() => { const w = window as any; (w.D.activeElement as HTMLElement | null)?.blur?.(); });
    await page.keyboard.press(key);
    const r = await rec(page);
    check(`[${where}] ${key} after a go-to: back`, same(r, [GOES.ref, ['back']]), r);
  }
  {
    await reset(page);
    const p = await at(page, 'cite');
    await page.mouse.move(p.x, p.y);
    const opened = await page.waitForFunction(() => (window as any).refnav.card().open, null, { timeout: 10000 }).then(() => true, () => false);
    const c = await cardNow(page);
    check(`[${where}] hover on the citation: its card`, opened && c.kind === 'cite', c);
  }
  {
    await reset(page);
    await page.evaluate(() => { (window as any).ro = true; });
    const p = await at(page, 'ref');
    await page.mouse.click(p.x, p.y);
    const c = await cardNow(page);
    const r = await rec(page);
    check(`[${where}] read-only: a click on the reference shows its card and edits nothing`, c.open && c.kind === 'ref' && r.length === 0, { c, r });
  }
  {
    // the paragraph's result drawn anew (as the editor mounts a new result: a new island, host.mount): its units are
    // found again, and a click still edits
    await reset(page);
    const before = await page.evaluate((P: string) => (window as any).refnav.units().find((u: any) => u.blockId === P && u.kind === 'ref').id, P);
    const els0 = await page.evaluate((id: string) => { const w = window as any; w.old = w.refnav.elements(id)[0]; return !!w.old; }, before);
    await page.evaluate(async (P: string) => {
      const w = window as any, D: Document = w.D;
      const r = D.querySelector(`.blk[data-id="${P}"] .blk-render`)!, old = r.querySelector('.latex-block') as HTMLElement;
      const el = D.createElement('div');
      el.className = 'latex-block';
      el.dataset.nodelistB64 = old.dataset.nodelistB64!;
      old.remove();
      r.append(el);
      await (D.defaultView as any).reflowtex.host.mount(el);
    }, P);
    await page.waitForFunction(() => { const w = window as any; return !w.old.isConnected && w.refnav.units().length >= 3 && w.refnav.units().every((u: any) => u.connected); }, null, { timeout: 10000 }).catch(() => {});
    const again = await page.evaluate(() => { const w = window as any; return { drawnAgain: !w.old.isConnected, units: w.refnav.units().map((u: any) => [u.kind, u.connected]) }; });
    const p = await at(page, 'ref');
    await page.mouse.click(p.x, p.y);
    const r = await rec(page);
    check(`[${where}] after the paragraph's result is drawn anew: its units found again, a click on the reference edits`,
      els0 && again.drawnAgain && again.units.length >= 3 && again.units.every((u: unknown[]) => u[1]) && same(r, [['edit', P, CARET.ref]]), { again, r });
  }
  {
    // dispose: every listener off (a click is the viewer's again: nothing recorded), the card and the pill gone
    await reset(page);
    await page.evaluate(() => (window as any).refnav.dispose());
    const p = await at(page, 'ref');
    await page.mouse.click(p.x, p.y);
    const r = await rec(page);
    const left = await page.evaluate(() => { const w = window as any; return { card: !!w.D.querySelector('#rn-card'), pill: !!w.D.querySelector('.rn-back') }; });
    check(`[${where}] dispose: a click asks nothing of the host; the card and the Back pill are gone`, r.length === 0 && !left.card && !left.pill, { r, left });
  }
  check(`[${where}] no page error`, errors.length === 0, errors);
  await page.close();
}
await browser.close();
console.log(`\n${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
