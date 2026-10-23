// Out of space: a store write refused with QuotaExceededError is said (one toast), not swallowed.
//   node tests/test-quota.ts dev [http://localhost:8150/] | file [dist/reflowtex-editor.html]
import { harness } from './qa/lib/harness.ts';

const argv = process.argv.slice(2);
const target = argv[0] === 'file' ? 'file' : 'dev';
const at = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
const t = harness('quota');
const { ctx, page } = await t.launch({ target, at });
await t.newDoc(page, { title: 'Quota', preamble: '\\documentclass{article}', blocks: [{ source: 'A paragraph.' }] });
await page.evaluate(() => {
  const s = (window as any).editorAPI.store();
  const full = () => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));
  s.putBlock = full; s.putBlocks = full;
});
const id: string = await page.evaluate(() => (window as any).editorAPI.blocks()[0].id);
await page.evaluate((i: string) => (window as any).editorAPI.setSource(i, 'An edit that cannot be saved.'), id);
await page.waitForFunction(() => /no room left/.test(document.querySelector('#toast-text')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
const st = await page.evaluate(() => ({ toast: document.querySelector('#toast-text')?.textContent ?? '' }));
t.check('a toast says the browser has no room left', /no room left/.test(st.toast), st);
await ctx.close();
t.done();
