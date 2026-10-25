// Records tests/qa/fixtures/refnav-host.json for tests/test-refnav-host.ts: blocks of the intro as the dev engine
// typesets them, a paragraph with a \ref, a \cite and an \href inserted (each block: id, kind, source, and its
// render's nodelist and colour map when it has one), with the document's bibliography source. Run it again when the
// engine's output changes in a way the test depends on (the reference slots, the link marks).
//
//   node tests/qa/record-refnav-host.ts http://127.0.0.1:<port>/      (the dev server: tests/integration/serve.ts)
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '../..');
const URL0 = (process.argv[2] ?? 'http://127.0.0.1:8150/').replace(/\/?$/, '/');
const OUT = join(HERE, 'tests/qa/fixtures/refnav-host.json');
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');

const PROFILE = mkdtempSync(join(tmpdir(), 'rn-host-rec-'));
const ctx = await pw.chromium.launchPersistentContext(PROFILE, { viewport: { width: 1000, height: 900 }, reducedMotion: 'reduce' });
const page = ctx.pages()[0] ?? await ctx.newPage();
page.setDefaultTimeout(180000);
try {
  await page.goto(`${URL0}#/doc/intro`);
  await page.waitForFunction(() => (window as any).editorAPI?.route().name === 'doc');
  const rec = await page.evaluate(async () => {
    const api = (window as any).editorAPI;
    await api.whenIdle();
    const key: string = api.refsState().cites.find((c: any) => api.refsState().bib[c.keys[0]])?.keys[0];
    const at = api.blocks().findIndex((b: any) => /\\label\{sec:cite\}/.test(b.source));
    const source = `See Section~\\ref{sec:maths}, \\cite{${key}} and \\href{https://example.org/rn}{the notes}.`;
    const id: string = api.insert(at + 1, 'paragraph', source);
    await api.whenIdle();
    const blocks = api.blocks();
    const target = blocks.find((b: any) => /\\label\{sec:maths\}/.test(b.source));
    const bib = blocks.find((b: any) => b.kind === 'bibliography' || /\\(printbibliography|bibliography\s*\{)|\\begin\{thebibliography\}/.test(b.source));
    const out = [];
    for (const b of [target, blocks.find((x: any) => x.id === id), bib]) {
      const el = document.querySelector(`.blk[data-id="${b.id}"] .blk-render > .latex-block`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // the typeset blocks the test draws: the target and the paragraph; the reference list by its source only
      const typeset = b !== bib;
      out.push({ id: b.id, kind: b.kind, source: b.source, nodelistB64: typeset ? el?.dataset.nodelistB64 ?? null : null, colorMap: typeset ? el?.dataset.colorMap ?? null : null });
    }
    return { key, paragraph: id, target: target.id, list: bib.id, bib: api.currentDoc()?.bib ?? null, blocks: out };
  });
  if (!rec.blocks[0].nodelistB64 || !rec.blocks[1].nodelistB64) throw new Error('a block has no render');
  writeFileSync(OUT, `${JSON.stringify(rec, null, 1)}\n`);
  console.log(`wrote ${OUT}: cite key ${rec.key}, blocks ${rec.blocks.map((b: any) => `${b.kind}${b.nodelistB64 ? ` (${b.nodelistB64.length} B)` : ''}`).join(', ')}`);
} finally {
  await ctx.close();
  rmSync(PROFILE, { recursive: true, force: true });
}
