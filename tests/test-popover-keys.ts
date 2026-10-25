// The editing popover by keyboard and for a screen reader, in each edit layout (stacked, side by side, replace):
//   - reached from the keyboard: Tab to a block (its render, "Edit block"), Enter opens its source with the focus in it;
//   - Escape closes it and the focus goes back to the block it was opened from;
//   - the live error note is said once: a status region is there while the block is edited (empty), takes the note's
//     line when the error appears, and is not written again while typing leaves the error as it is (a screen reader
//     says a live region's change, so the same text drawn again says nothing); fixed, it is empty again.
// Every wait is on state (editorAPI, the page), never on a time.
//   node tests/test-popover-keys.ts [http://127.0.0.1:8150/]
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:8150/').replace(/\/?$/, '/');
const { chromium } = createRequire(join(HERE, 'app/package.json'))('playwright');
let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  n++; const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${d.slice(0, 700)}` : ''}`); if (!ok) fail++;
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
const problems: string[] = [];
page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
page.setDefaultTimeout(180000);
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());

await page.goto(`${BASE}?engine&fresh#/`);
await page.waitForFunction(() => (window as any).editorAPI?.workbench);
const docId: string = await page.evaluate(() => (window as any).editorAPI.store().createDoc({ title: 'Keys', preamble: '\\documentclass{article}', blocks: [
  { kind: 'paragraph', source: 'The first paragraph.' }, { kind: 'paragraph', source: 'The second paragraph, with $x$.' }, { kind: 'paragraph', source: 'The third paragraph.' }] }));
await page.evaluate((id: string) => (window as any).editorAPI.open(id), docId);
await idle();
const ids: string[] = await page.evaluate(() => (window as any).editorAPI.blocks().map((b: any) => b.id));
const target = ids[1];
/** what has the focus: the block whose render it is, or the source editor, or something else */
const focus = () => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  return { render: a?.classList.contains('blk-render') ? a.closest<HTMLElement>('.blk[data-id]')?.dataset.id ?? null : null, editor: !!a?.closest('.cm-editor'), tag: a?.tagName ?? null, cls: a?.className ?? '' };
});

for (const layout of ['stacked', 'side', 'replace']) {
  await page.evaluate((l: string) => (window as any).editorAPI.view().set({ editLayout: l }), layout);
  await idle();
  // ── reached by Tab: the block's render takes the focus; Enter opens its source there ──
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  let reached = false;
  for (let k = 0; k < 60 && !reached; k++) { await page.keyboard.press('Tab'); reached = (await focus()).render === target; }
  check(`[${layout}] Tab reaches the block (its render, a button "Edit block")`, reached, await focus());
  await page.keyboard.press('Enter');
  await page.waitForFunction((i: string) => (window as any).editorAPI.sessions().some((s: any) => s.id === i && s.text != null), target);
  await idle();
  const opened = await focus();
  const mode = await page.evaluate((i: string) => (document.querySelector(`.blk[data-id="${i}"]`) as HTMLElement | null)?.dataset.editLayout ?? null, target);
  check(`[${layout}] Enter opens the block's source (the ${layout} layout), the focus in it`, opened.editor && (mode === layout || (layout === 'side' && mode === 'stacked')), { opened, mode });
  // ── the error note's status region: there (empty) while editing, the same element when the error comes ──
  const region0 = await page.evaluate((i: string) => { const r = document.querySelector(`.blk[data-id="${i}"] .blk-source [role="status"].live-note-say`) as HTMLElement | null; if (r) r.dataset.mark = 'kept'; return r ? r.textContent : null; }, target);
  check(`[${layout}] the note's status region is there while the block is edited, empty`, region0 === '', region0);
  if (layout !== 'replace') {
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' \\undefinedcommand');
    await page.waitForFunction((i: string) => /Undefined control sequence/.test(document.querySelector(`.blk[data-id="${i}"] [role="status"].live-note-say`)?.textContent ?? ''), target);
    await idle();
    const said = await page.evaluate((i: string) => { const r = document.querySelector(`.blk[data-id="${i}"] [role="status"].live-note-say`) as HTMLElement; return { text: r.textContent, kept: r.dataset.mark === 'kept', visible: !!document.querySelector(`.blk[data-id="${i}"] .live-note`) }; }, target);
    check(`[${layout}] the error comes: the same region says it (the note shown too)`, said.kept && said.visible && /^Error: Undefined control sequence/.test(said.text ?? ''), said);
    // typing that leaves the error as it is: the region's text is not written again (nothing new to say)
    await page.evaluate((i: string) => { const r = document.querySelector(`.blk[data-id="${i}"] [role="status"].live-note-say`)!; (window as any).__said = 0; new MutationObserver((m) => { (window as any).__said += m.length; }).observe(r, { childList: true, characterData: true, subtree: true }); }, target);
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('More ', { delay: 30 });
    await idle();
    const again = await page.evaluate((i: string) => ({ said: (window as any).__said, text: document.querySelector(`.blk[data-id="${i}"] [role="status"].live-note-say`)?.textContent }), target);
    check(`[${layout}] typing that leaves the error as it is: the region is not written again (said once)`, again.said === 0 && again.text === said.text, again);
    // fixed: nothing to say
    await page.keyboard.press('ControlOrMeta+End');
    for (let k = 0; k < ' \\undefinedcommand'.length; k++) await page.keyboard.press('Backspace');
    await page.waitForFunction((i: string) => document.querySelector(`.blk[data-id="${i}"] [role="status"].live-note-say`)?.textContent === '', target);
    check(`[${layout}] fixed: the region is empty again`, true);
  }
  // ── Escape closes it; the focus goes back to the block it was opened from ──
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).editorAPI.sessions().length === 0);
  await idle();
  const back = await focus();
  check(`[${layout}] Escape closes the source; the focus is back on the block's render`, back.render === target, back);
  // put the block back as it was for the next layout
  await page.evaluate(([i, s]: string[]) => (window as any).editorAPI.setSource(i, s), [target, 'The second paragraph, with $x$.']);
  await idle();
}
check('no page errors', problems.length === 0, problems);
await browser.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
