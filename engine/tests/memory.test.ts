// The engine's memory in each browser (Chromium, WebKit = Safari's engine):
// the default document (the intro) compiled as the app sends it (context prefix,
// requests of 8 blocks, the figures and logo as assets), then a PDF export
// and a TikZ rendition; per request the wasm heap and the snapshot's bytes.
// Fails on any engine abort, and when the wasm heap grows while blocks are
// compiled (a failed memory.grow is Safari's "Aborted()").
//   node tests/memory.test.ts [http://localhost:8141] [--browsers chromium,webkit]   → test-results/memory.json
import { chromium, webkit } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { contextFor } from '../../app/src/refs/context.ts';

const BASE = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:8141';
const which = (process.argv[process.argv.indexOf('--browsers') + 1] ?? '').includes(',') || process.argv.includes('--browsers')
  ? process.argv[process.argv.indexOf('--browsers') + 1].split(',') : ['chromium', 'webkit'];
const OUT = new URL('../test-results/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };
const seed = JSON.parse(readFileSync(new URL('../../build/seed/intro.json', import.meta.url), 'utf8')).init;
const MARKERS = new Set(['macros', 'comment', 'appendix']);
const blocks = seed.blocks.map((b: any, i: number) => ({ id: `b${i}`, kind: b.kind, source: b.source, context: contextFor(seed.blocks, i) })).filter((b: any) => !MARKERS.has(b.kind));
const out: Record<string, unknown> = {};
for (const name of which) {
  const browser = await ({ chromium, webkit } as any)[name].launch();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  page.on('console', (m: any) => { if (/^progress|abort|error/i.test(m.text())) console.log(`  [${name}] ${m.text().slice(0, 200)}`); });
  let pageCrashed = false;
  page.on('crash', () => { pageCrashed = true; console.log(`  [${name}] PAGE CRASHED`); });
  await page.goto(`${BASE}/devpage/index.html`);
  await page.waitForFunction(() => (window as any).engineTestReady);
  const t0 = Date.now();
  const crashP = new Promise<null>((res) => page.on('crash', () => res(null)));
  const r: any = await Promise.race([crashP, page.evaluate(async ({ preamble, bbl, assets, blocks }) => {
    const T = (window as any).engineTest;
    const be = T.createBackend({ cache: null });
    be.setAssets(assets.map((a: any) => ({ name: a.name, mime: a.mime, hash: a.name, ipe: a.ipe, bytes: Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0)) })));
    await be.setBib({ kind: 'bbl', source: bbl });
    await be.setPreamble(preamble);
    const mem: any[] = [{ at: 'warm', ...(await be.memory()) }];
    const bad: string[] = [];
    for (let i = 0; i < blocks.length; i += 8) {
      const part = blocks.slice(i, i + 8);
      try {
        const res = await be.compile({ preamble, blocks: part, keep: [] });
        for (const [id, v] of Object.entries(res.blocks) as [string, any][]) if (v.status !== 'ok') bad.push(`${id}: ${v.errors.map((e: any) => e.message).join('; ').slice(0, 160)}`);
      } catch (e) { bad.push(`request ${i}: ${(e as Error).message}`); }
      mem.push({ at: `blocks ${i}-${i + part.length - 1}`, ...(await be.memory()) });
      console.log(`progress ${JSON.stringify(mem[mem.length - 1])}`);
    }
    let pdf = 0;
    try { const p = await be.pdf({ preamble, blocks }); pdf = p.pdf?.size ?? 0; if (!pdf) bad.push(`pdf: ${p.errors.map((e: any) => e.message).join('; ').slice(0, 300)}`); } catch (e) { bad.push(`pdf: ${(e as Error).message}`); }
    mem.push({ at: 'pdf', ...(await be.memory()) });
    const tz = await be.renderTikz('\\begin{tikzpicture}\\draw (0,0) -- (1,1) node[above] {label};\\end{tikzpicture}').catch((e: Error) => ({ error: e.message }));
    mem.push({ at: 'tikz', ...(await be.memory()) });
    // blocks again after the full compiles (the snapshot made again)
    try { const res = await be.compile({ preamble, blocks: blocks.slice(0, 8).map((b: any) => ({ ...b, source: b.source + ' ' })), keep: [] });
      for (const [id, v] of Object.entries(res.blocks) as [string, any][]) if (v.status !== 'ok') bad.push(`again ${id}: ${v.errors.map((e: any) => e.message).join('; ').slice(0, 160)}`); }
    catch (e) { bad.push(`again: ${(e as Error).message}`); }
    mem.push({ at: 'again', ...(await be.memory()) });
    return { mem, bad, pdf, tikz: !!(tz as any).svg, stats: be.stats() };
  }, { preamble: seed.preamble, bbl: seed.bib.source, assets: seed.assets.filter((a: any) => /\.(pdf|png)$/.test(a.name)), blocks })
    .catch((e: Error) => null)]);
  if (!r) { check(`${name}: the page survives the document (no crash)`, false, pageCrashed ? 'the web content process crashed' : 'page.evaluate failed'); out[name] = { crashed: true }; await browser.close().catch(() => {}); continue; }
  const MB = (n: number) => Math.round(n / 1048576);
  const heaps = r.mem.map((m: any) => m.heap);
  const warm = r.mem[0].heap, blockMax = Math.max(...r.mem.filter((m: any) => /^blocks/.test(m.at)).map((m: any) => m.heap));
  console.log(`${name}: ${Math.round((Date.now() - t0) / 1000)} s; heap after warm ${MB(warm)} MB, max while compiling blocks ${MB(blockMax)} MB, after PDF ${MB(r.mem.find((m: any) => m.at === 'pdf').heap)} MB, snapshot ${MB(r.mem[0].snapshot)} MB; restarts ${r.stats.restarts}`);
  // TeX errors of the seed (an import that split an environment) are not the engine's: only crashes fail
  const crashes = r.bad.filter((m: string) => /engine crashed|Aborted|RuntimeError|worker failed|request \d|restarted/.test(m));
  if (r.bad.length > crashes.length) console.log(`  (${r.bad.length - crashes.length} TeX errors in the seed: ${r.bad.filter((m: string) => !crashes.includes(m)).slice(0, 3).join(' | ')})`);
  check(`${name}: no engine crash or abort over ${blocks.length} blocks`, crashes.length === 0 && !errors.length && !pageCrashed, [...crashes, ...errors].slice(0, 5).join(' | '));
  check(`${name}: the heap does not grow while blocks compile (${MB(warm)} → ${MB(blockMax)} MB)`, blockMax === warm, heaps.map(MB).join(' '));
  check(`${name}: PDF export and a TikZ rendition in the same engine`, r.pdf > 100000 && r.tikz, JSON.stringify({ pdf: r.pdf, tikz: r.tikz }));
  out[name] = { ...r, mem: r.mem.map((m: any) => ({ ...m, heapMB: MB(m.heap), snapshotMB: MB(m.snapshot) })) };
  await browser.close();
}
writeFileSync(OUT + 'memory.json', JSON.stringify(out, null, 1));
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
