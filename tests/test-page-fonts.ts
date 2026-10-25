// The editor's fonts in the page: the worker's font files are given to the viewer (host.fonts.provide,
// engine/web/page-fonts.ts), and nothing of the page's own is patched for it. The dev app on the intro, every block
// typeset in the page (memory store):
//   1. no global is patched: Node and Element methods, document.head.appendChild, document.fonts.check are the
//      browser's own (they were wrapped to intercept the viewer's @font-face style elements and to remember
//      document.fonts.check);
//   2. no @font-face rule: the viewer's faces are made by script;
//   3. the faces of the worker's fonts come from its bytes, every one loaded, none failed; a font's face is
//      replaced at most once (a font is patched whole, once);
//   4. typing in a block keeps it so (a live result's fonts too).
//
//   node tests/test-page-fonts.ts http://localhost:8150/
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] ?? 'http://localhost:8150/').replace(/\/?$/, '');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${JSON.stringify(detail).slice(0, 600)}`}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(300000);
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
await page.goto(`${BASE}/?engine&store=memory#/doc/intro`);
await page.waitForFunction(() => (window as any).editorAPI?.route?.().name === 'doc' && !!(window as any).editorAPI.currentDoc());
await page.evaluate(() => (window as any).editorAPI.whenIdle());

const state = () => page.evaluate(async () => {
  const w = window as any;
  const native = (f: unknown) => typeof f === 'function' && /\[native code\]/.test(Function.prototype.toString.call(f));
  const patched = [
    ...['appendChild', 'insertBefore', 'replaceChild', 'removeChild'].filter((m) => !native((Node.prototype as any)[m])).map((m) => `Node.${m}`),
    ...['append', 'prepend', 'replaceChildren'].filter((m) => !native((Element.prototype as any)[m])).map((m) => `Element.${m}`),
    ...(Object.prototype.hasOwnProperty.call(document.head, 'appendChild') ? ['document.head.appendChild'] : []),
    ...(native(document.fonts.check) && !Object.prototype.hasOwnProperty.call(document.fonts, 'check') ? [] : ['document.fonts.check']),
    ...(native(Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')?.set) ? [] : ['Node.textContent']),
  ];
  const rules = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } }).filter((r) => r instanceof CSSFontFaceRule).length;
  await w.reflowtex.host.fonts.ready();
  const faces = w.reflowtex.inspect.faces() as { family: string; status: string; url: string | null; bytes: ArrayBuffer | null }[];
  const stats = w.editorAPI.backendObject?.()?.stats?.() ?? {};
  return { patched, rules, faces: faces.length, fromBytes: faces.filter((f) => f.bytes).length,
    notLoaded: faces.filter((f) => f.status !== 'loaded').map((f) => `${f.family}:${f.status}`),
    swaps: stats.fontSwaps, perFont: stats.fontSwapsPerFont, failures: stats.fontFailures };
});

const a = await state();
check('no global patched (Node, Element, document.head, document.fonts)', a.patched.length === 0, a.patched);
check('no @font-face rule (the viewer\'s faces are made by script)', a.rules === 0, a.rules);
check('the worker\'s fonts are given as bytes, every face loaded', a.fromBytes > 0 && a.notLoaded.length === 0, a);
check('none failed; a font\'s face replaced at most once', a.failures === 0 && (a.perFont ?? 0) <= 1, a);

// typing in a block: its live results' fonts given the same way
const id = await page.evaluate(() => { const bs = (window as any).editorAPI.blocks(); return bs.find((b: any) => b.kind === 'paragraph')?.id; });
await page.evaluate((i: string) => (window as any).editorAPI.edit(i), id);
await page.waitForSelector('.cm-content');
await page.keyboard.press('End');
await page.keyboard.type(' Typed: $\\alpha_\\ell \\to \\mathfrak{g}$ and \\textsc{small caps}.');
await page.evaluate(() => (window as any).editorAPI.whenIdle());
const b = await state();
check('after typing: still no global patched, no @font-face rule', b.patched.length === 0 && b.rules === 0, b);
check('after typing: every face loaded, none failed, at most one replacement a font', b.notLoaded.length === 0 && b.failures === 0 && (b.perFont ?? 0) <= 1, b);
check('no page error', errors.length === 0, errors);
await browser.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
