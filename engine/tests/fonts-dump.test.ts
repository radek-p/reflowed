// The worker's fonts as a dump (dumpFonts: the release's seed fonts, and what a page publishing its blocks ships):
// every font a compile served has its file in the dump, also after later blocks patched or converted other fonts.
// And a patched font is patched whole: two workers typesetting different text in it serve the same file, under
// the same name, and a later block that needs more of it does not patch it again.
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

/** a fresh worker typesetting `sources` in turn: the served name of every font after each block, and the dump */
async function run(sources: string[]): Promise<{ names: Record<string, string>[]; files: Record<string, Uint8Array> }> {
  const v = spawnWorker(readFileSync(ROOT + 'engine/dist/editor-worker.js', 'utf8'));
  try {
    await v.call('init', { base: url.replace(/\/$/, '') });
    await v.call('engine', { format: new Uint8Array(readFileSync(ROOT + 'engine/api/formats/latex.fmt')),
      wasm: new Uint8Array(readFileSync(ROOT + 'engine/dist/async/tectonic_wasm.wasm')) });
    await v.call('setPreamble', { preamble: '\\documentclass{article}' });
    const names: Record<string, string>[] = [];
    for (const [i, source] of sources.entries()) names.push({ ...(await v.call('compile', { blocks: [{ id: `b${i}`, source }] })).fonts });
    return { names, files: (await v.call('dumpFonts')).files };
  } finally { await v.terminate(); }
}
// a bar below a letter with no precomposed form (\b{x}) is a combining mark, which the text font draws by a
// private-use code point: the font is patched
const TEXT = 'lmroman10-regular.otf';
const one = await run(['Bars \\b{x} below.']);
const two = await run(['Other \\d{q} and \\b{v} marks.', 'And \\b{w}\\c{x} more, \\k{j} too.']);
const a = one.names[0]![TEXT], b = two.names[0]![TEXT], b2 = two.names[1]![TEXT];
check('the text font is patched (renamed)', !!a && /\.reflowtex-[0-9a-f]{8}\.otf$/.test(a), one.names);
check('two documents with different text: the same patched file name', a === b, { a, b });
check('and the same bytes', !!a && !!b && !!one.files[a] && !!two.files[b] && Buffer.from(one.files[a]!).equals(Buffer.from(two.files[b]!)));
check('a later block needing more of it: no new name (not patched again)', b === b2, { b, b2 });
if (bad) { console.log(`${bad} failed`); process.exit(1); }
