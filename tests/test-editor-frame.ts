// The block source editor (app/src/app/editor-entry.js createEditor) in another document: made in a frame's body,
// it lives in that document, and its own caret-line band (view/caret-line.js) is made by that document, and its keys reach the host as
// its header says: undo and redo (Mod-z, Mod-Shift-z, Mod-y) are asked of onKey, once each, for the right one (on
// Linux, Ctrl-Shift-z with the key as a lowercase 'z' was taken for undo). Headless Chromium, the module
// bundled into the page (esbuild), no app.
//
//   node tests/test-editor-frame.ts
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(HERE, 'app/package.json'));
const { chromium } = req('playwright');
const esbuild = req('esbuild');
const out = await esbuild.build({
  stdin: { contents: `import { createEditor } from './app/src/app/editor-entry.js'; window.createEditor = createEditor;`, resolveDir: HERE, loader: 'js' },
  bundle: true, format: 'iife', target: 'es2022', write: false, nodePaths: [join(HERE, 'app/node_modules')], logLevel: 'warning',
});

let n = 0, failed = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail).slice(0, 400)}`}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e: Error) => check('no page error', false, e.message));
await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><iframe id="f" style="width:600px;height:300px"></iframe></body></html>');
await page.addScriptTag({ content: out.outputFiles[0].text });
const r = await page.evaluate(async () => {
  const w = window as any;
  const frame = (document.getElementById('f') as HTMLIFrameElement).contentDocument!;
  frame.body.innerHTML = '<div id="host"></div>';
  w.keys = [] as string[];
  const ed = w.createEditor(frame.getElementById('host'), { doc: 'Some \\textbf{source} text.', onKey: (name: string) => { w.keys.push(name); return name === 'undo' || name === 'redo'; } });
  w.ed = ed;
  const view = ed.view;
  view.focus();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const dom: HTMLElement = view.dom;
  const all = [...dom.querySelectorAll('*')];
  return { inFrame: dom.ownerDocument === frame, foreign: all.filter((e) => e.ownerDocument !== frame).length,
    band: !!dom.querySelector('.cm-caretLine'),
    // made by the frame's document, not adopted into it from the page's (a node of the page's realm)
    bandRealm: dom.querySelector('.cm-caretLine') instanceof (frame.defaultView as any).HTMLElement };
});
check('the editor is made in the frame\'s document', r.inFrame, r);
check('every element of it is in the frame\'s document', r.foreign === 0, r);
check('the caret line\'s band is made by the frame\'s document (its realm), not adopted from the page', r.band && r.bandRealm, r);
// the keys: focus the frame's editor, press them
const frame = page.frameLocator('#f');
await frame.locator('.cm-content').click();
for (const k of ['Meta+z', 'Meta+Shift+z', 'Meta+y', 'Control+z', 'Control+Shift+z', 'Control+y']) await page.keyboard.press(k);
const keys: string[] = await page.evaluate(() => (window as any).keys);
check('undo and redo are asked of onKey (Mod-z, Mod-Shift-z, Mod-y)', keys.filter((k) => k === 'undo').length >= 1 && keys.filter((k) => k === 'redo').length >= 2, keys);
// on Linux and Windows (Mod is Ctrl): each key asks onKey once, for its own command only
{
  const pg = await browser.newPage({ viewport: { width: 900, height: 600 } });
  pg.on('pageerror', (e: Error) => check('no page error', false, e.message));
  await pg.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Linux x86_64' }); });
  await pg.goto('about:blank');
  await pg.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="host"></div></body></html>');
  await pg.addScriptTag({ content: out.outputFiles[0].text });
  await pg.evaluate(() => {
    const w = window as any;
    w.keys = [] as string[];
    w.ed = w.createEditor(document.getElementById('host'), { doc: 'abc', onKey: (name: string) => { w.keys.push(name); return name === 'undo' || name === 'redo'; } });
    w.ed.view.focus();
  });
  const asked: Record<string, string[]> = {};
  for (const k of ['Control+z', 'Control+Shift+z', 'Control+Shift+Z', 'Control+y']) {
    await pg.evaluate(() => { (window as any).keys = []; });
    await pg.keyboard.press(k);
    asked[k] = await pg.evaluate(() => (window as any).keys);
  }
  const text = await pg.evaluate(() => (window as any).ed.text);
  check('Ctrl: z asks undo; Shift-z and y ask redo, once each and nothing else', JSON.stringify(asked) === JSON.stringify({ 'Control+z': ['undo'], 'Control+Shift+z': ['redo'], 'Control+Shift+Z': ['redo'], 'Control+y': ['redo'] }), asked);
  check('and the text is untouched (no undo of the browser\'s or CodeMirror\'s own)', text === 'abc', text);
  await pg.close();
}
await browser.close();
console.log(`\n${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
