// ONE side sheet. Document settings and the title form are the same kit Sheet: the same computed
// geometry (width, edges, height), header, close button, body layout, footer, scrim, motion and tokens, in light and
// dark; Escape, focus in and focus back the same. Both are registered views (design/ui/views.js) whose content
// does not import the Sheet. In the dev app on the engine; waits on events and the app's idle, never on fixed times.
//
//   node tests/test-sheets.ts [http://localhost:8195/]
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { harness, EDITOR } from './qa/lib/harness.ts';
import { resultsDir } from './qa/lib/results.ts';

const at = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8195/';
const t = harness('sheets');
const { ctx, page, errors } = await t.launch({ target: 'dev', at, viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(60000);

const PRE = String.raw`\documentclass{article}
\usepackage{reflowed-meta}
\ReflowedMeta{
  title = {One Sheet},
  author = {name = {Ada Lovelace}, affil = a},
  affiliation = {id = a, name = {Analytical Engines}},
}
`;
const id = await t.newDoc(page, { title: 'Sheets test', preamble: PRE, blocks: [{ kind: 'title', source: '\\maketitle' }, { source: 'A paragraph.' }] });
await t.idle(page);
const titleId: string = await page.evaluate(() => (window as any).editorAPI.blocks().find((b: any) => b.kind === 'title')?.id);

/** every computed property the shared sheet decides, measured on the open sheet */
const measure = () => page.evaluate(() => {
  const d = document.querySelector('dialog.ui-sheet[open]') as HTMLDialogElement | null;
  if (!d) return null;
  const cs = (el: Element | null, ps: string[]) => { if (!el) return null; const s = getComputedStyle(el); return Object.fromEntries(ps.map((p) => [p, s.getPropertyValue(p)])); };
  const r = d.getBoundingClientRect();
  const head = d.querySelector(':scope > .ui-sheet-head'), body = d.querySelector(':scope > .ui-sheet-body'), foot = d.querySelector(':scope > .ui-sheet-foot');
  const close = d.querySelector('.sheet-close')!.getBoundingClientRect();
  return {
    rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) },
    sheet: cs(d, ['background-color', 'color', 'box-shadow', 'border-left', 'border-radius', 'font-size', 'font-family', 'animation-name', 'animation-duration']),
    backdrop: getComputedStyle(d, '::backdrop').getPropertyValue('background-color'),
    head: { ...cs(head, ['padding', 'height', 'display']), h: Math.round(head!.getBoundingClientRect().height) },
    title: cs(d.querySelector('.ui-dialog-title'), ['font-size', 'font-weight', 'color', 'line-height']),
    close: { w: Math.round(close.width), h: Math.round(close.height), right: Math.round(r.right - close.right) },
    body: cs(body, ['padding', 'display', 'flex-direction', 'row-gap', 'overflow-y']),
    foot: foot ? cs(foot, ['padding', 'border-top', 'align-items', 'justify-content', 'column-gap']) : null,
    footH: foot ? Math.round(foot.getBoundingClientRect().height) : null,
    note: cs(d.querySelector('.ui-sheet-note'), ['font-size', 'color']),
    primary: cs(d.querySelector('.ui-sheet-foot .ui-btn--primary'), ['height', 'border-radius', 'font-size', 'background-color']),
    modal: d.matches(':modal'),
    focusInBody: !!document.activeElement && !!body?.contains(document.activeElement),
  };
});
const openSettings = async () => {
  await page.evaluate(() => (window as any).editorAPI.settings().open({ tab: 'preamble' }));
  await page.waitForSelector('#settings-sheet[open]');
  await page.waitForFunction(() => !!document.activeElement?.closest('#settings-sheet .ui-sheet-body'));
};
const openForm = async () => {
  await page.click(`.blk[data-id="${titleId}"] .blk-render`);
  await page.waitForSelector('dialog.mf-sheet[open]');
};
const strip = (m: any) => { const { focusInBody, note, ...rest } = m; return rest; };

for (const theme of ['light', 'dark']) {
  await page.evaluate((th: string) => (window as any).editorAPI.view().set({ theme: th }), theme);
  await t.openDoc(page, id);
  await t.idle(page);
  // the opener, to see the focus come back
  await page.focus(`.blk[data-id="${titleId}"] .blk-render`);
  await openSettings();
  const a = await measure();
  await page.keyboard.press('Escape');
  await page.waitForSelector('#settings-sheet', { state: 'detached' });
  const backA = await page.evaluate((i: string) => !!document.activeElement?.closest(`.blk[data-id="${i}"]`), titleId);
  await openForm();
  const b = await measure();
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog.mf-sheet', { state: 'detached' });
  await t.idle(page);
  const backB = await page.evaluate((i: string) => !!document.activeElement?.closest(`.blk[data-id="${i}"]`), titleId);

  t.check(`${theme}: both are the kit's one sheet, modal, at the right edge, full height, one width`, !!a && !!b && a.modal && b.modal && a.rect.right === 1280 && b.rect.right === 1280
    && a.rect.top === 0 && a.rect.bottom === 900 && a.rect.width === b.rect.width && a.rect.width === 600, { a: a?.rect, b: b?.rect });   // 40vw + 88 px at 1280
  const diff: string[] = [];
  const sa = a && strip(a), sb = b && strip(b);
  if (sa && sb) for (const k of Object.keys(sa)) if (JSON.stringify(sa[k]) !== JSON.stringify(sb[k])) diff.push(`${k}: ${JSON.stringify(sa[k])} vs ${JSON.stringify(sb[k])}`);
  t.check(`${theme}: the same computed geometry and tokens (sheet, scrim, header, title, close, body, footer, primary button, motion)`, !!sa && !!sb && diff.length === 0, diff.join(' | '));
  t.check(`${theme}: both footers carry a note at the left in the same style`, !!a?.note && JSON.stringify(a?.note) === JSON.stringify(b?.note ?? a?.note), { a: a?.note, b: b?.note });
  t.check(`${theme}: the first focus is in the body (a field), for both`, !!a?.focusInBody && !!b?.focusInBody, { a: a?.focusInBody, b: b?.focusInBody });
  t.check(`${theme}: Escape closes either, the focus back where it was`, backA && backB, { backA, backB });
  if (theme === 'dark') t.check('dark: the sheet is a dark surface', !!a && /rgb\((\d+), (\d+), (\d+)\)/.test(a.sheet!['background-color']) && Number(RegExp.$1) < 80, a?.sheet);
}

// the width follows the window: clamp(480 px, 40vw + 88 px, 820 px), the whole width on a phone; both sheets
// alike at each size, and their content uses it (no sideways overflow, the fields as wide as the body)
const content = () => page.evaluate(() => {
  const d = document.querySelector('dialog.ui-sheet[open]')!, body = d.querySelector(':scope > .ui-sheet-body') as HTMLElement;
  const bs = getComputedStyle(body), bw = body.clientWidth - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight);
  const fields = [...body.querySelectorAll('input:not([type=checkbox]):not([type=radio]), textarea, select, .cm-editor')].filter((e) => (e as HTMLElement).offsetParent !== null);
  const widest = Math.max(0, ...fields.map((e) => e.getBoundingClientRect().width));
  const dl = d.getBoundingClientRect().left;
  const over = [...d.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < dl - 0.5); }).length;
  return { sideways: body.scrollWidth > body.clientWidth + 1, fill: bw ? Math.round((widest / bw) * 100) : 0, over, fields: fields.length };
});
mkdirSync(join(resultsDir(EDITOR), 'sheets'), { recursive: true });
await page.evaluate(() => (window as any).editorAPI.view().set({ theme: 'light' }));
for (const [w, h] of [[1280, 900], [1680, 1000], [2560, 1440], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await t.openDoc(page, id);
  await t.idle(page);
  const want = w <= 640 ? w : Math.round(Math.min(820, Math.max(480, 0.4 * w + 88)));
  await openSettings();
  const a = await measure(), ca = await content();
  await page.screenshot({ path: join(resultsDir(EDITOR), `sheets/settings-${w}.png`) });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#settings-sheet', { state: 'detached' });
  await openForm();
  const b = await measure(), cb = await content();
  await page.screenshot({ path: join(resultsDir(EDITOR), `sheets/title-form-${w}.png`) });
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog.mf-sheet', { state: 'detached' });
  t.check(`${w} px: both sheets are ${want} px wide at the right edge${w <= 640 ? ' (the whole width)' : ''}`, !!a && !!b && Math.abs(a.rect.width - want) <= 1 && a.rect.width === b.rect.width && a.rect.right === w && b.rect.right === w, { want, a: a?.rect, b: b?.rect });
  t.check(`${w} px: their content fits and uses the width (no sideways overflow, nothing past the edges, the widest field >= 80 % of the body)`, !ca.sideways && !cb.sideways && !ca.over && !cb.over && ca.fill >= 80 && cb.fill >= 80, { settings: ca, form: cb });
}
await page.setViewportSize({ width: 1280, height: 900 });

// the pane is the scroller; the page's overflow is the workbench's viewport's, as it was before the sheet)
const pane = () => page.evaluate(() => ({ y: document.querySelector('main.rtx-pane[data-part="page"]')?.scrollTop ?? -1, of: getComputedStyle(document.documentElement).overflow + '/' + getComputedStyle(document.body).overflow }));
await t.openDoc(page, id);
await page.evaluate(() => document.querySelector('main.rtx-pane[data-part="page"]')?.scrollTo(0, 0));
const before = await pane();
await openSettings();
const y0 = (await pane()).y;
await page.mouse.move(200, 400);
await page.mouse.wheel(0, 600);
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const y1 = await pane();
t.check('a wheel on the scrim does not scroll the document; the page keeps its overflow', y0 >= 0 && y1.y === y0 && y1.of === before.of, { y0, before: before.of, ...y1 });
await page.keyboard.press('Escape');
await page.waitForSelector('#settings-sheet', { state: 'detached' });

// registered views; the content modules render the kit's Frame, not the Sheet
const reg = await page.evaluate(() => (window as any).editorAPI.views?.() ?? null);
t.check('settings and the title form are registered views (ids, slot sheet)', Array.isArray(reg) && reg.some((v: any) => v.id === 'settings' && v.slot === 'sheet') && reg.some((v: any) => v.id === 'title-form' && v.slot === 'sheet'), reg);
const src = (p: string) => readFileSync(join(EDITOR, 'app/src', p), 'utf8');
t.check('their content does not import the Sheet (it renders Frame: the container decides)', !/\bSheet\b.*from/.test(src('settings/sheet.js')) && !/\bSheet\b.*from/.test(src('meta/form/sheet.js'))
  && /<\$\{Frame\}/.test(src('settings/sheet.js')) && /<\$\{Frame\}/.test(src('meta/form/sheet.js')));
t.check('no sheet overrides left in the two modules (width, body layout, footer)', !/\.ui-sheet|ui-dialog-body|ui-dialog-foot/.test(src('settings/style.js') + src('meta/form/style.js')));

t.check('no page errors', errors.length === 0, errors.slice(0, 3));
await ctx.close();
t.done();
