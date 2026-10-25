// The worker's fonts as a dump (dumpFonts: the release's seed fonts, and what a page publishing its blocks ships):
// every font a compile served has its file in the dump, also after later blocks patched or converted other fonts.
// The editor's worker (engine/dist/editor-worker.js) in a Node worker thread, its TeX files from the dev server.
//
//   node engine/tests/fonts-dump.test.ts --url http://127.0.0.1:8160
import { readFileSync } from 'node:fs';
import { spawnWorker } from '../../scripts/node-engine.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const url = process.argv[process.argv.indexOf('--url') + 1] ?? 'http://127.0.0.1:8160';
let bad = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

const w = spawnWorker(readFileSync(ROOT + 'engine/dist/editor-worker.js', 'utf8'));
try {
  await w.call('init', { base: url.replace(/\/$/, '') });
  await w.call('engine', { format: new Uint8Array(readFileSync(ROOT + 'engine/api/formats/latex.fmt')),
    wasm: new Uint8Array(readFileSync(ROOT + 'engine/dist/async/tectonic_wasm.wasm')) });
  const pre = await w.call('setPreamble', { preamble: '\\documentclass{article}' });
  check('the preamble warms', pre.ok, pre.errors);
  const served = new Set<string>();
  // Computer Modern maths (a Type 1 face, converted), then other faces in later blocks
  for (const [i, source] of ['Text $x$ and more.', 'Other $\\alpha+\\beta y$ and \\textit{italic} words.', '\\textbf{Bold} and $\\sum_i x_i^2$.'].entries()) {
    const r = await w.call('compile', { blocks: [{ id: `b${i}`, source }] });
    check(`block ${i + 1} compiles`, r.blocks[`b${i}`]?.status === 'ok', r.blocks[`b${i}`]?.errors);
    for (const s of Object.values(r.fonts as Record<string, string>)) served.add(s);
    const d = await w.call('dumpFonts');
    const missing = [...served].filter((s) => !(d.files as Record<string, Uint8Array>)[s]?.length);
    check(`after block ${i + 1}: every font served so far has its file in the dump (${served.size})`, missing.length === 0, missing);
  }
  check('a converted Type 1 face among them (cmmi10)', [...served].some((s) => /^cmmi10\.reflowtex-[0-9a-f]{8}\.otf$/.test(s)), [...served]);
} finally { await w.terminate(); }
if (bad) { console.log(`${bad} failed`); process.exit(1); }
