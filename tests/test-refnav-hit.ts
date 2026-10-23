// hovering the run-in heading `\paragraph*{Further work on the closed form}` opened
// the card of the `\Cref{…}` after it — hyperref's link covered the heading).
//
//   node tests/test-refnav-hit.ts [page.html]      (default: dist/reflowtex-editor.html;
//        for unbuilt src: node app/src/perf/splice.ts dist/reflowtex-editor.html /tmp/qa/app.html)
//
// On the long test document (?seed=long: the intro repeated), at 1280 px and again at 600 px (after the reflow):
//  1. every unit's glyphs are its slot's glyphs plus brackets/punctuation only (no letters
//     or digits outside the reference's slot);
//  2. for every unit: hovering its first glyph makes it the hot unit; hovering the glyph
//     just before and just after it (other text) makes no unit hot;
//  3. the reported block (a run-in heading, then a \Cref; inserted here):
//     hovering each glyph of the heading makes no unit hot; hovering the reference opens its own card (refnav:card).
// Waits on whenIdle() and events; the hot unit is set synchronously on pointerover
// (index.js setHot), and no hot unit means no card timer, so no fixed waits are needed.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2] && !process.argv[2].startsWith('--') ? resolve(process.argv[2]) : join(HERE, 'dist/reflowtex-editor.html');
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
const REPORTED = String.raw`\paragraph*{Further work on the closed form} As \Cref{thm:gauss} shows, the sum of the first numbers has a closed form, and more follows from it.`;
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d !== '' ? ` — ${(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400)}` : ''}`); };

const ctx = await pw.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'qa-rn-')), { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
await ctx.route('**/*', (r: any) => (/^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort()));
const page = ctx.pages()[0] ?? await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e: any) => errors.push(e.message));
page.setDefaultTimeout(240000);
await page.goto(`file://${FILE}?seed=long#/doc/long`);
await page.waitForFunction(() => (window as any).editorAPI?.refnav?.());
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
await idle();
// the reported shape: a run-in heading and a \Cref after it, in a block of its own after the theorem
await page.evaluate(async (src: string) => { const api = (window as any).editorAPI; const at = api.blocks().findIndex((b: any) => /\\label\{thm:gauss\}/.test(b.source)); api.insert(at + 2, 'paragraph', src); await api.whenIdle(); }, REPORTED);

/** reveal a block, rescan, and return its units with probe points: own first glyph, the glyph before/after (not in a unit) */
const probes = (blockId: string) => page.evaluate(async (id: string) => {
  const el = document.querySelector(`.blk[data-id="${id}"]`)!;
  el.scrollIntoView({ block: 'center' });
  await (window as any).editorAPI.whenIdle();
  const rn = (window as any).editorAPI.refnav();
  rn.rescan();
  const us = rn.units().filter((u: any) => u.blockId === id);
  const all = [...el.querySelectorAll('.blk-render tspan')] as SVGTSpanElement[];
  const inAny = new Set(us.flatMap((u: any) => rn.elements(u.id)));
  const pt = (g: Element | undefined) => { if (!g) return null; const r = g.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight ? { x: r.left + r.width / 2, y: r.top + r.height / 2, t: g.textContent } : null; };
  return us.map((u: any) => {
    const els = rn.elements(u.id) as SVGTSpanElement[];
    const i0 = all.indexOf(els[0]), i1 = all.indexOf(els[els.length - 1]);
    let b = i0 - 1; while (b >= 0 && (inAny.has(all[b]) || !(all[b].textContent ?? '').trim())) b--;
    let a = i1 + 1; while (a < all.length && (inAny.has(all[a]) || !(all[a].textContent ?? '').trim())) a++;
    const extra = els.filter((g) => !(g.dataset.slot && /^rtx[racCk]:/.test(g.dataset.slot)) && /[\p{L}\p{N}]/u.test(g.textContent ?? ''));
    return { id: u.id, labels: u.labels, text: u.text, own: pt(els.find((g) => (g.textContent ?? '').trim())), before: pt(all[b]), after: pt(all[a]), extra: extra.map((g) => g.textContent).join('') };
  });
}, blockId);
const hotAt = async (p: { x: number; y: number }) => {
  await page.mouse.move(p.x, p.y);
  return page.evaluate(() => (window as any).editorAPI.refnav().hot()?.id ?? null);
};

async function sweep(width: number) {
  await page.setViewportSize({ width, height: 900 });
  await idle();
  const bs = await page.evaluate(() => (window as any).editorAPI.blocks().filter((b: any) => b.mounted && /\\(?:[cC]ref|ref|eqref|autoref)\*?\{/.test(b.source)).map((b: any) => b.id));
  let units = 0, ownOk = 0, spill: string[] = [], extra: string[] = [], miss: string[] = [];
  for (const id of bs) {
    for (const u of await probes(id)) {
      units++;
      if (u.extra) extra.push(`${u.labels.join()}: «${u.extra.slice(0, 40)}» in «${u.text.slice(0, 60)}»`);
      if (u.own) { const h = await hotAt(u.own); if (h === u.id) ownOk++; else miss.push(`${u.labels.join()} «${u.own.t}» → ${h}`); }
      for (const side of ['before', 'after'] as const) {
        const p = u[side];
        if (!p) continue;
        const h = await hotAt(p);
        if (h) spill.push(`${side} ${u.labels.join()}: «${p.t}» → ${h}`);
      }
      await page.mouse.move(2, 2);
    }
  }
  check(`${width} px: every unit is its slot plus brackets only (${units} units)`, units > 20 && extra.length === 0, extra.slice(0, 4).join(' | '));
  check(`${width} px: hovering a reference's glyph makes it hot`, ownOk > 20 && miss.length === 0, `${ownOk}/${units}; ${miss.slice(0, 3).join(' | ')}`);
  check(`${width} px: the text next to a reference is not part of it`, spill.length === 0, spill.slice(0, 4).join(' | '));
}

// the reported block: the run-in heading and its \Cref
async function reported(width: number) {
  const id = await page.evaluate(() => (window as any).editorAPI.blocks().find((b: any) => /Further work on the closed form/.test(b.source))?.id);
  check('the reported block exists', !!id);
  if (!id) return;
  await probes(id);
  const heading = await page.evaluate((i: string) => {
    const all = [...document.querySelectorAll(`.blk[data-id="${i}"] .blk-render tspan`)] as SVGTSpanElement[];
    const s = all.map((t) => t.textContent).join('');
    const at = s.indexOf('Further'), end = s.indexOf('Contribution') + 'Contribution 1'.length;
    let k = 0; const pts: any[] = [];
    all.forEach((t) => { const n = (t.textContent ?? '').length; if (k >= at && k < end && (t.textContent ?? '').trim()) { const r = t.getBoundingClientRect(); pts.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, t: t.textContent }); } k += n; });
    return pts;
  }, id);
  const hot: string[] = [];
  for (const p of heading) { const h = await hotAt(p); if (h) hot.push(`«${p.t}» → ${h}`); }
  check(`${width} px: hovering the \\paragraph* heading «Further work on the closed form» makes no reference hot`, heading.length > 20 && hot.length === 0, `${heading.length} glyphs; ${hot.slice(0, 3).join(' | ')}`);
  const u = (await probes(id)).find((x: any) => x.labels.includes('thm:gauss'));
  const num = await page.evaluate(() => (window as any).editorAPI.refsState().labels['thm:gauss']?.number);
  check(`the \\Cref{thm:gauss} unit is «Theorem ${num}» only`, !!u && !!num && u.text.replace(/\s+/g, '') === `Theorem${num}`, u?.text);
  if (u?.own) {
    const opened = page.evaluate(() => new Promise((r) => document.addEventListener('refnav:card', (e: any) => e.detail.open && r(e.detail.labels), { once: false })));
    await page.mouse.move(u.own.x, u.own.y);
    const labels = await Promise.race([opened, page.waitForTimeout(5000).then(() => null)]);   // a bound on a missing event, not a wait for state
    check('hovering the reference opens its own card', Array.isArray(labels) && (labels as string[]).includes('thm:gauss'), labels);
    await page.mouse.move(2, 2);
    await page.evaluate(() => (window as any).editorAPI.refnav().closeCard());
  }
}

await reported(1280);
await sweep(1280);
await reported(600);
await sweep(600);
check('no page errors', errors.length === 0, errors.slice(0, 3));
await ctx.close();
console.log(`\nrefnav hit areas: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
