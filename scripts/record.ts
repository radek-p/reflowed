// The single file's TeX working set, recorded with the editor's own worker
// in Chromium (engine/build/devpage on the dev server): every bundle file
// the worker opens — TeX's inputs, the fonts the capture and the encoder
// read, maps and encodings — while it compiles
//   - the seed paper (preamble, bbl, figures and logo as assets, every block
//     with engine/src/defs-context.ts's context), and its PDF export;
//   - TikZ pictures (the dvisvgm driver, arrows, nodes);
//   - the sample blocks and the templates of the block model;
//   - LaTeX's font switches and sizes.
// The union with working-set-v1.txt (the v1 file's 27 documents)
// and ../engine/working-set-add.txt is what scripts/build.ts packs.
//     node scripts/record.ts [http://localhost:8141]   (the dev server up)
//     → engine/working-set.txt, engine/working-set-docs.txt
import { createRequire } from 'node:module';
// Playwright lives in engine/node_modules (engine/package.json)
const { chromium } = createRequire(new URL('../engine/package.json', import.meta.url))('playwright');
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recordDocs } from './record-docs.ts';

const BASE = process.argv[2] ?? 'http://localhost:8141';
const EDITOR = fileURLToPath(new URL('../', import.meta.url));   // ends in /
const docs = await recordDocs();

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${BASE}/devpage/index.html`);
await page.waitForFunction(() => (window as any).engineTestReady);
await page.evaluate(() => { (window as any).rec = (window as any).engineTest.createBackend({ cache: null }); });
const lines: string[] = [];
const seen = new Set<string>();
const perDoc: { tier: number | 'base'; name: string; ok: boolean; files: string[] }[] = [];
for (const d of docs) {
  const res = await page.evaluate(async (d) => {
    const be = (window as any).rec;
    be.setAssets((d.assets ?? []).map((a: any) => ({ name: a.name, mime: a.mime, hash: a.name, bytes: Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0)) })));
    await be.setBib({ kind: d.bbl ? 'bbl' : 'none', source: d.bbl ?? '' });
    const pre = await be.setPreamble(d.preamble);
    const t = performance.now();
    const r = await be.compile({ preamble: d.preamble, blocks: d.blocks.map((b: any, i: number) => ({ id: `b${i}`, source: b.source, context: b.context })), keep: [] });
    const bad = Object.entries(r.blocks).filter(([, v]: [string, any]) => v.status !== 'ok').map(([k, v]: [string, any]) => `${k}: ${v.errors.map((e: any) => e.message).join('; ')}`);
    let pdf = null;
    if (d.pdf) { const p = await be.pdf({ preamble: d.preamble, blocks: d.blocks }); pdf = p.pdf?.size ?? 0; }
    return { n: d.blocks.length, bad, ms: Math.round(performance.now() - t), pre: pre.errors.length, pdf };
  }, d);
  const line = `${d.name}: ${res.n - res.bad.length}/${res.n} ok, ${res.ms} ms${res.pre ? `, ${res.pre} preamble errors` : ''}${res.pdf != null ? `, PDF ${res.pdf} bytes` : ''}${res.bad.length ? ` — ${res.bad.join(' | ').slice(0, 300)}` : ''}`;
  console.log(line);
  lines.push(line);
  // the files this document opened first (usage is cumulative)
  const { files: now } = await page.evaluate(() => (window as any).rec.usage());
  const fresh = (now as string[]).filter((n) => !seen.has(n));
  for (const n of fresh) seen.add(n);
  perDoc.push({ tier: d.tier ?? 'base', name: d.name, ok: res.bad.length === 0 && !res.pre, files: fresh });
}
const { files } = await page.evaluate(() => (window as any).rec.usage());
await browser.close();
writeFileSync(EDITOR + 'engine/working-set.txt', files.join('\n') + '\n');
writeFileSync(EDITOR + 'engine/working-set-docs.txt', lines.join('\n') + '\n');
writeFileSync(EDITOR + 'engine/working-set-tiers.json', JSON.stringify(perDoc, null, 1) + '\n');
console.log(`${files.length} files -> engine/working-set.txt (${docs.length} documents)`);
