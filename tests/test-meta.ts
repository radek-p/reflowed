// the title and authors form, end to end in the dev app on the engine: open it from the title block,
// add, reorder (drag) and delete authors, shared affiliations (chips, automatic numbers), ORCID and email
// checks, the live preview, apply on close as one undoable edit that recompiles the title block only, the
// round trip form → source → form (no edit writes nothing), dark mode, and "Convert to the form" on both
// seed papers. Waits on events and the app's idle, never on fixed times.
//
//   node tests/test-meta.ts [http://localhost:8195/]     (in a Playwright container, the dev server up)
import { harness } from './qa/lib/harness.ts';

const at = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8195/';
const t = harness('meta');
const { ctx, page, errors } = await t.launch({ target: 'dev', at });
page.setDefaultTimeout(120000);                 // a step that hangs fails the run instead of stalling it
const api = (f: string, ...a: unknown[]) => page.evaluate(([f, a]: [string, unknown[]]) => (window as any).editorAPI[f](...a), [f, a] as [string, unknown[]]);
const sheet = page.locator('dialog.mf-sheet');
// the sheet's events, recorded in the page from the start: a wait reads the count before the action, so an event
// that fires before the wait is set up is not missed
await page.evaluate(() => {
  const w = window as any;
  w.__meta = { opened: 0, closed: [] as boolean[] };
  document.addEventListener('editor:meta-opened', () => { w.__meta.opened++; });
  document.addEventListener('editor:meta-closed', (e: any) => { w.__meta.closed.push(e.detail.applied); });
});
const opened = async () => {
  const n: number = await page.evaluate(() => (window as any).__meta.opened);
  return { wait: () => page.waitForFunction((k: number) => (window as any).__meta.opened > k, n) };
};
const closed = async () => {
  const n: number = await page.evaluate(() => (window as any).__meta.closed.length);
  return { wait: async () => { await page.waitForFunction((k: number) => (window as any).__meta.closed.length > k, n); return page.evaluate((k: number) => (window as any).__meta.closed[k] as boolean, n); } };
};
const previewOk = () => page.waitForFunction(() => document.querySelector('.mf-preview')?.getAttribute('data-state') === 'ok' && !document.querySelector('.mf-preview-state[data-state="pending"]'));
const names = () => page.$$eval('.mf-author .mf-author-name > span:first-child', (els) => els.map((e) => e.textContent));
const chipsOf = (i: number) => page.$$eval(`.mf-author:nth-child(${i + 1}) .mf-chip`, (els) => els.map((e) => `${e.querySelector('.mf-num')?.textContent}:${e.getAttribute('data-affil')}`));
const preamble = () => page.evaluate(() => (window as any).editorAPI.currentDoc().preamble.source as string);

const PRE = String.raw`\documentclass{article}
\usepackage{reflowed-meta}
\ReflowedMeta{
  title = {On Merging Functors},
  date = {},
  author = {name = {Zo{\"e} Arden}, affil = uw},
  author = {name = {Ola Gdańska}, affil = uw, email = ann@example.org},
  affiliation = {id = uw, name = {Example University}},
}
`;
const id = await t.newDoc(page, { title: 'Meta form test', preamble: PRE, blocks: [{ kind: 'title', source: '\\maketitle' }, { source: 'A first paragraph of the paper.' }, { source: 'A second one.' }] });
const blocks: any[] = await api('blocks');
const titleId = blocks.find((b) => b.kind === 'title')?.id;
t.check('the document typesets with \\ReflowedMeta (title block and paragraphs ok)', !!titleId && blocks.every((b) => b.state === 'ok'), blocks.map((b) => [b.kind, b.state, b.errors?.[0]?.message]));
const titleText = await page.locator(`.blk[data-id="${titleId}"] .blk-render`).innerText();
t.check('the title block prints the data (title, Zoë, the affiliation)', /On Merging Functors/.test(titleText) && /Zoë Arden/.test(titleText) && /Example University/.test(titleText), titleText);

// ── open ──
let o = await opened();
await page.click(`.blk[data-id="${titleId}"] .blk-render`);
await o.wait();
t.check('a click on the title block opens the sheet (not the LaTeX editor)', await sheet.isVisible() && !(await page.$('.blk.editing')));
t.check('the form shows the title and the authors (accents as text)', (await page.inputValue('[data-field="title"] textarea')) === 'On Merging Functors' && JSON.stringify(await names()) === JSON.stringify(['Zoë Arden', 'Ola Gdańska']), await names());
await previewOk();
t.check('the preview is the class\'s own title block', /On Merging Functors/.test(await page.locator('.mf-preview').innerText()));

// ── add an author, a new affiliation, a shared one ──
await page.click('.mf-add-author');
await page.waitForFunction(() => !!document.activeElement?.closest('.mf-author.is-open [data-field="name"]'));
await page.keyboard.type('Ada Lovelace');
t.check('add: a new row, its name field focused', JSON.stringify(await names()) === JSON.stringify(['Zoë Arden', 'Ola Gdańska', 'Ada Lovelace']), await names());
await page.click('.mf-author:nth-child(3) .mf-add-affil');
await page.waitForFunction(() => !!document.activeElement?.closest('.mf-picker'));
await page.keyboard.type('ETH Zürich');
await page.keyboard.press('Enter');
t.check('a new affiliation inline: a chip numbered 2', JSON.stringify(await chipsOf(2)) === JSON.stringify(['2:ez']), await chipsOf(2));
await page.click('.mf-author:nth-child(1) .mf-add-affil');
await page.click('.mf-picker .mf-pick[data-affil="ez"]');
t.check('a shared affiliation: picked from the list, the numbers follow first use', JSON.stringify(await chipsOf(0)) === JSON.stringify(['1:uw', '2:ez']) && (await page.$$('.mf-affil')).length === 2, await chipsOf(0));

// ── reorder by dragging the handle ──
const h3 = await page.locator('.mf-author:nth-child(3) .mf-handle').boundingBox();
const r1 = await page.locator('.mf-author:nth-child(1)').boundingBox();
await page.mouse.move(h3!.x + h3!.width / 2, h3!.y + h3!.height / 2);
await page.mouse.down();
for (let k = 1; k <= 8; k++) await page.mouse.move(h3!.x + h3!.width / 2, h3!.y + h3!.height / 2 + (r1!.y + 4 - (h3!.y + h3!.height / 2)) * k / 8);
await page.mouse.up();
t.check('drag: Ada to the top', JSON.stringify(await names()) === JSON.stringify(['Ada Lovelace', 'Zoë Arden', 'Ola Gdańska']), await names());
t.check('drag: affiliations renumbered (ETH is 1 now)', JSON.stringify(await chipsOf(0)) === JSON.stringify(['1:ez']) && JSON.stringify(await chipsOf(1)) === JSON.stringify(['2:uw', '1:ez']), [await chipsOf(0), await chipsOf(1)]);
await page.focus('.mf-author:nth-child(1) .mf-handle');
await page.keyboard.press('ArrowDown');
t.check('keyboard: ↓ on the handle moves the author down', JSON.stringify(await names()) === JSON.stringify(['Zoë Arden', 'Ada Lovelace', 'Ola Gdańska']), await names());

// ── delete, undo in the sheet ──
await page.click('.mf-author:nth-child(3) .mf-author-name');
await page.click('.mf-author:nth-child(3) .mf-remove');
t.check('delete: the author goes, an Undo offered', JSON.stringify(await names()) === JSON.stringify(['Zoë Arden', 'Ada Lovelace']) && await page.isVisible('.mf-removed .mf-undo'), await names());
await page.click('.mf-removed .mf-undo');
t.check('undo brings the author back with the details', JSON.stringify(await names()) === JSON.stringify(['Zoë Arden', 'Ada Lovelace', 'Ola Gdańska']) && (await page.$$eval('.mf-author', (e) => e.length)) === 3);

// ── ORCID and email checks (kept, flagged) ──
await page.click('.mf-author:nth-child(2) .mf-author-name');
await page.fill('.mf-author:nth-child(2) [data-field="orcid"] input', '0000-0002-1825-0098');
t.check('ORCID: a wrong check digit is flagged', await page.isVisible('.mf-author:nth-child(2) [data-field="orcid"] .mf-msg.is-bad'));
await page.fill('.mf-author:nth-child(2) [data-field="orcid"] input', 'https://orcid.org/0000-0002-1825-0097');
await page.locator('.mf-author:nth-child(2) [data-field="orcid"] input').blur();
t.check('ORCID: a valid URL is accepted and stored bare', !(await page.isVisible('.mf-author:nth-child(2) [data-field="orcid"] .mf-msg.is-bad')) && (await page.inputValue('.mf-author:nth-child(2) [data-field="orcid"] input')) === '0000-0002-1825-0097');
await page.fill('.mf-author:nth-child(2) [data-field="email"] input', 'ada at example');
t.check('email: a malformed address is flagged', await page.isVisible('.mf-author:nth-child(2) [data-field="email"] .mf-msg.is-bad'));
await page.fill('.mf-author:nth-child(2) [data-field="email"] input', 'ada@example.org');
await page.fill('[data-field="title"] textarea', 'On Merging Functors & Graphs');
await previewOk();
// the viewer draws a block when it comes into view: the preview is below the sheet's fold now (three authors, open fields)
await page.locator('.mf-preview').scrollIntoViewIfNeeded();
await page.evaluate(async () => { await (window as any).reflowtex?.inspect?.idle?.(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
const pv = await page.locator('.mf-preview').innerText();
t.check('the live preview follows the edits (title with &, Ada)', /Functors & Graphs/.test(pv) && /Ada Lovelace/.test(pv), pv.slice(0, 300));

// ── dark mode ──
await page.evaluate(() => (window as any).editorAPI.view().set({ theme: 'dark' }));
const dark = await page.evaluate(() => {
  const s = document.querySelector('dialog.mf-sheet')!;
  // rgb(0..255) or color(srgb 0..1 / a)
  const lum = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); const k = c.startsWith('color(') ? 1 : 255; return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / k; };
  const bg = getComputedStyle(s).backgroundColor, fg = getComputedStyle(s).color;
  const chip = getComputedStyle(document.querySelector('.mf-chip')!).color;
  return { bg, fg, chip, bgL: lum(bg), fgL: lum(fg), chipL: lum(chip) };
});
t.check('dark mode: the sheet is dark with light text (tokens)', dark.bgL < 0.25 && dark.fgL > 0.6 && dark.chipL > 0.4, dark);
await page.screenshot({ path: `${t.out}/sheet-dark.png` });
await page.evaluate(() => (window as any).editorAPI.view().set({ theme: 'light' }));
await page.screenshot({ path: `${t.out}/sheet-light.png` });

// ── apply on close: one undoable edit, only the title block recompiles ──
const before = await preamble();
await api('resetCounters');
let c = await closed();
await page.click('.mf-done');
t.check('Done applies', await c.wait() === true && !(await sheet.isVisible()));
await t.idle(page);
const after = await preamble();
const counters: any = await api('counters');
t.check('the preamble has the edits (a shared affiliation, ORCID bare, the & escaped)', /Functors \\& Graphs/.test(after) && /name = \{Ada Lovelace\}, affil = \{ez\}/.test(after) && /affil = \{uw, ez\}/.test(after) && /orcid = \{0000-0002-1825-0097\}/.test(after) && /affiliation = \{id = \{ez\}, name = \{ETH Zürich\}\}/.test(after), after);
t.check('only the title block recompiled (the others\' keys do not hold the title data)', counters.compiledIds.length >= 1 && counters.compiledIds.every((x: string) => x === titleId), counters.compiledIds);
const tt = await page.locator(`.blk[data-id="${titleId}"] .blk-render`).innerText();
t.check('the title block shows the new data', /Functors & Graphs/.test(tt) && /Ada Lovelace/.test(tt) && /ETH Zürich/.test(tt), tt.slice(0, 300));

// ── round trip: form → source → form, no edit writes nothing ──
o = await opened();
await page.click(`.blk[data-id="${titleId}"] .blk-render`);
await o.wait();
t.check('reopened: the form reads back what it wrote', JSON.stringify(await names()) === JSON.stringify(['Zoë Arden', 'Ada Lovelace', 'Ola Gdańska']) && JSON.stringify(await chipsOf(0)) === JSON.stringify(['1:uw', '2:ez']));
c = await closed();
await page.keyboard.press('Escape');
t.check('Esc with no edit: nothing applied, the source byte for byte', await c.wait() === false && (await preamble()) === after);

// ── undo: Mod-Z after closing undoes the whole edit ──
await api('undo');
await t.idle(page);
t.check('undo restores the preamble as it was', (await preamble()) === before);
await api('redo');
await t.idle(page);
t.check('redo applies it again', (await preamble()) === after);

// ── Cancel discards ──
o = await opened();
await page.click(`.blk[data-id="${titleId}"] .blk-render`);
await o.wait();
await page.fill('[data-field="title"] textarea', 'Discarded');
c = await closed();
await page.click('.mf-cancel');
t.check('Cancel discards the edits', await c.wait() === false && (await preamble()) === after);

// ── convert title commands (a seed carries \ReflowedMeta already, the form opens filled, the conversion itself
// on made-up original title commands of five authors, as the former sample paper had them) ──
const ORIGINAL = String.raw`\documentclass[a4paper, 11pt]{article}
\title{Functors and Their Transformations\thanks{The authors received funding from the Test Council (No.~1).}}
\date{}
\author{Bea Clay, Zo{\"e} Arden, Nils M{\"a}ller\\Wit Kowal, Ola Gdańska
\\[9pt]
Institute of Informatics\\
Example University, Poland
}
`;
const orig = await t.newDoc(page, { title: 'Functors (original title commands)', preamble: ORIGINAL, blocks: [{ kind: 'title', source: '\\maketitle' }, { source: 'Text.' }] });
const docs: any[] = await page.evaluate(async () => ((await (window as any).editorAPI.store().listDocs()) as any[]).map((d) => ({ id: d.id, title: d.title })));
for (const [who, re, nAuthors] of [['Five authors (original)', /^Functors \(original/, 5]] as const) {
  const d = docs.find((x) => re.test(x.title));
  if (!t.check(`${who}: the document is there`, !!d, docs.map((x) => x.title))) continue;
  void orig;
  await t.openDoc(page, d.id);
  const tb = ((await api('blocks')) as any[]).find((b) => b.kind === 'title');
  await page.locator(`.blk[data-id="${tb.id}"]`).scrollIntoViewIfNeeded();
  const pre0 = await preamble();
  const converted = pre0.includes('\\ReflowedMeta{');
  o = await opened();
  await page.click(`.blk[data-id="${tb.id}"] .blk-render`);
  await o.wait();
  if (converted) {
    await previewOk();
    t.check(`${who}: the seed carries \\ReflowedMeta: the form opens filled`, !(await page.isVisible('.mf-convert')) && (await names()).length === nAuthors, await names());
  } else {
    t.check(`${who}: the sheet offers the conversion with the new command`, await page.isVisible('.mf-convert') && /\\ReflowedMeta\{/.test(await page.locator('.mf-convert .mf-pre').innerText()));
    await page.click('.mf-convert-go');
    await previewOk();
    t.check(`${who}: converted, the form shows the authors`, (await names()).length === nAuthors && (await preamble()).includes('\\ReflowedMeta{'), await names());
  }
  t.check(`${who}: one shared affiliation, the line break after the third name`, (await page.$$('.mf-affil')).length === 1 && /break-after/.test(await preamble()));
  c = await closed();
  await page.click('.mf-cancel');
  await c.wait();
  await t.idle(page);
  const st = ((await api('blocks')) as any[]).find((b) => b.kind === 'title');
  t.check(`${who}: the converted title block typesets without errors`, st.state === 'ok' && !st.errors.length, st.errors);
  if (!converted) {
    await api('undo');
    // the undo of a conversion made in the open sheet: the engine's keys move back once its preamble
    // lands, onto results it has; those are shown again (they stayed pending, whenIdle waited for ever). The wait is
    // bounded only so that a regression fails here instead of stalling the suite
    const settled = await Promise.race([t.idle(page).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 30000))]);
    const bs = (await api('blocks')) as any[];
    t.check(`${who}: the undo of the conversion settles (every block typeset again)`, settled && bs.every((b) => b.state === 'ok' && b.mounted), bs.map((b) => b.state).join(','));
  }
  t.check(`${who}: ${converted ? 'the preamble as it was' : 'undo restores the original preamble'}`, (await preamble()) === pre0);
}

t.check('no page errors', !errors.length, errors);
await ctx.close();
t.done();
